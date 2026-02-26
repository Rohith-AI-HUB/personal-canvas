import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { getDb } from '../services/sqlite.js';
import { embedText } from '../services/embeddings.js';
import { searchChunks } from '../services/qdrant.js';
import { reindexAllCompleteFiles } from '../queue/ingestQueue.js';

type SearchQuery = {
  q?: string;
  type?: string;
  category?: string;
  semantic?: string;
  topN?: string;
};

type SearchResultRow = {
  file_id: string;
  filename: string;
  file_type: string;
  ai_title: string | null;
  ai_category: string | null;
  tags: string;
  keyword_score: number;
  keyword_bm25: number;
  highlight: string | null;
  created_at: string;
};

type SemanticChunk = {
  file_id: string;
  score: number;
  text: string;
};

export async function searchRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/api/search', async (req: FastifyRequest<{ Querystring: SearchQuery }>, reply: FastifyReply) => {
    const query = (req.query.q ?? '').trim();
    if (!query) {
      return reply.send({
        query,
        keyword_results: [],
        semantic_results: [],
        results: [],
      });
    }

    const fileType = normalizeFilter(req.query.type);
    const category = normalizeFilter(req.query.category);
    const semanticEnabled = req.query.semantic !== '0';
    const topN = parseTopN(req.query.topN);

    const semanticPromise = semanticEnabled ? (async () => {
      const embedding = await embedText(query);
      const chunks = await searchChunks(embedding, topN);
      return chunks.map((chunk) => ({
        file_id: chunk.file_id,
        score: normalizeSemanticScore(chunk.score),
        text: chunk.text,
      })) as SemanticChunk[];
    })() : Promise.resolve([] as SemanticChunk[]);

    const keywordResults = runKeywordSearch(query, fileType, category, topN);
    if (!semanticEnabled) {
      return reply.send({
        query,
        keyword_results: keywordResults,
        semantic_results: [],
        results: keywordResults,
      });
    }

    const semanticResults = await semanticPromise;
    const merged = hybridRank(keywordResults, semanticResults, topN, fileType, category);

    return reply.send({
      query,
      keyword_results: keywordResults,
      semantic_results: semanticResults,
      results: merged,
    });
  });

  fastify.post('/api/admin/reindex', async (_req: FastifyRequest, reply: FastifyReply) => {
    const stats = await reindexAllCompleteFiles();
    return reply.send({
      ok: true,
      files_total: stats.filesTotal,
      files_indexed: stats.filesIndexed,
      files_skipped: stats.filesSkipped,
      chunks_indexed: stats.chunksIndexed,
    });
  });
}

function runKeywordSearch(
  query: string,
  fileType: string | null,
  category: string | null,
  topN: number
): SearchResultRow[] {
  const db = getDb();

  const clauses: string[] = ['files_fts MATCH ?', `f.status = 'complete'`];
  const params: unknown[] = [ftsQuery(query)];

  if (fileType) {
    clauses.push('f.file_type = ?');
    params.push(fileType);
  }
  if (category) {
    clauses.push('m.ai_category = ?');
    params.push(category);
  }

  params.push(topN);

  const sql = `
    SELECT
      f.id AS file_id,
      f.filename,
      f.file_type,
      f.created_at,
      m.ai_title,
      m.ai_category,
      COALESCE((SELECT GROUP_CONCAT(t.tag, ' ') FROM tags t WHERE t.file_id = f.id), '') AS tags,
      snippet(files_fts, 6, '<mark>', '</mark>', ' ... ', 16) AS highlight,
      bm25(files_fts) AS keyword_bm25
    FROM files_fts
    JOIN files f ON f.id = files_fts.file_id
    LEFT JOIN file_metadata m ON m.file_id = f.id
    WHERE ${clauses.join(' AND ')}
    ORDER BY bm25(files_fts) ASC
    LIMIT ?
  `;

  const rows = db.prepare(sql).all(...params) as SearchResultRow[];
  return rows.map((row) => ({
    ...row,
    keyword_score: bm25ToScore(row.keyword_bm25),
  }));
}

function hybridRank(
  keyword: SearchResultRow[],
  semantic: SemanticChunk[],
  topN: number,
  fileType: string | null,
  category: string | null
) {
  const db = getDb();
  const map = new Map<string, {
    file_id: string;
    filename?: string;
    file_type?: string;
    ai_title?: string | null;
    ai_category?: string | null;
    tags?: string;
    keyword_score: number;
    semantic_score: number;
    highlight: string | null;
    semantic_text: string | null;
    created_at?: string;
  }>();

  for (const row of keyword) {
    map.set(row.file_id, {
      file_id: row.file_id,
      filename: row.filename,
      file_type: row.file_type,
      ai_title: row.ai_title,
      ai_category: row.ai_category,
      tags: row.tags,
      keyword_score: row.keyword_score,
      semantic_score: 0,
      highlight: row.highlight,
      semantic_text: null,
      created_at: row.created_at,
    });
  }

  for (const row of semantic) {
    const existing = map.get(row.file_id);
    if (existing) {
      if (row.score > existing.semantic_score) {
        existing.semantic_score = row.score;
        existing.semantic_text = row.text;
      }
      continue;
    }

    map.set(row.file_id, {
      file_id: row.file_id,
      keyword_score: 0,
      semantic_score: row.score,
      highlight: null,
      semantic_text: row.text,
    });
  }

  const missingIds = [...map.values()]
    .filter((row) => !row.filename)
    .map((row) => row.file_id);

  if (missingIds.length > 0) {
    const placeholders = missingIds.map(() => '?').join(', ');
    const enriched = db.prepare(`
      SELECT
        f.id AS file_id,
        f.filename,
        f.file_type,
        f.created_at,
        m.ai_title,
        m.ai_category,
        COALESCE(GROUP_CONCAT(t.tag, ' '), '') AS tags
      FROM files f
      LEFT JOIN file_metadata m ON m.file_id = f.id
      LEFT JOIN tags t ON t.file_id = f.id
      WHERE f.status = 'complete' AND f.id IN (${placeholders})
      GROUP BY f.id
    `).all(...missingIds) as Array<{
      file_id: string;
      filename: string;
      file_type: string;
      created_at: string;
      ai_title: string | null;
      ai_category: string | null;
      tags: string;
    }>;

    for (const row of enriched) {
      const target = map.get(row.file_id);
      if (!target) continue;
      target.filename = row.filename;
      target.file_type = row.file_type;
      target.ai_title = row.ai_title;
      target.ai_category = row.ai_category;
      target.tags = row.tags;
      target.created_at = row.created_at;
    }
  }

  return [...map.values()]
    .filter((row) => Boolean(row.filename))
    .filter((row) => (fileType ? row.file_type === fileType : true))
    .filter((row) => (category ? row.ai_category === category : true))
    .map((row) => ({
      file_id: row.file_id,
      filename: row.filename as string,
      file_type: row.file_type as string,
      ai_title: row.ai_title ?? null,
      ai_category: row.ai_category ?? null,
      tags: (row.tags ?? '').trim(),
      highlight: row.highlight,
      semantic_text: row.semantic_text,
      keyword_score: row.keyword_score,
      semantic_score: row.semantic_score,
      hybrid_score: (row.semantic_score * 0.6) + (row.keyword_score * 0.4),
      created_at: row.created_at ?? null,
    }))
    .sort((a, b) => b.hybrid_score - a.hybrid_score)
    .slice(0, topN);
}

function ftsQuery(query: string): string {
  return query
    .split(/\s+/)
    .map((token) => token.replace(/["*]/g, '').trim())
    .filter(Boolean)
    .map((token) => `"${token}"*`)
    .join(' ');
}

function normalizeFilter(value?: string): string | null {
  const normalized = value?.trim().toLowerCase();
  if (!normalized || normalized === 'all') return null;
  return normalized;
}

function normalizeSemanticScore(score: number): number {
  if (score >= -1 && score <= 1) {
    return clamp01((score + 1) / 2);
  }
  return clamp01(score);
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function bm25ToScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  // Lower BM25 is better in FTS5; sigmoid(-bm25) maps to [0,1].
  return clamp01(1 / (1 + Math.exp(value)));
}

function parseTopN(raw?: string): number {
  const parsed = Number(raw ?? 20);
  if (!Number.isFinite(parsed)) return 20;
  return Math.max(1, Math.min(Math.round(parsed), 50));
}
