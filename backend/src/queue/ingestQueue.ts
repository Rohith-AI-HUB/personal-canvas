import PQueue from 'p-queue';
import { getDb } from '../services/sqlite.js';
import { extractContent } from '../services/extraction.js';
import { getAIMetadata } from '../services/groq.js';
import { chunkText, embedText } from '../services/embeddings.js';
import { deleteByFileId, upsertChunks } from '../services/qdrant.js';
import type { FileRecord } from '../types.js';

const ingestQueue = new PQueue({
  concurrency: 2,        // process 2 files in parallel
  intervalCap: 2,        // allow 2 per interval window
  interval: 500,         // 500ms window instead of 2500ms
});

export function enqueueFile(file: FileRecord): void {
  ingestQueue.add(() => runIngestPipeline(file));
}

export function recoverPendingJobs(): void {
  const db = getDb();

  db.prepare(`
    UPDATE files SET status = 'pending', updated_at = CURRENT_TIMESTAMP
    WHERE status = 'processing'
  `).run();

  const pending = db.prepare(`
    SELECT id, filename, original_path, storage_path, thumbnail_path,
           file_type, file_size, mime_type, content_hash, status,
           retry_count, error_message, created_at, updated_at
    FROM files
    WHERE status = 'pending' AND retry_count < 3
  `).all() as FileRecord[];

  if (pending.length > 0) {
    console.log(`[ingestQueue] Recovering ${pending.length} pending job(s) from previous session`);
    for (const file of pending) {
      enqueueFile(file);
    }
  }
}

export function getQueueSize(): number {
  return ingestQueue.size + ingestQueue.pending;
}

type EmbeddingPayload = {
  filename: string;
  file_type: string;
  ai_title: string;
  ai_category: string | null;
  tags: string[];
};

async function indexFileContent(fileId: string, content: string, payload: EmbeddingPayload): Promise<number> {
  const chunks = chunkText(content, 500, 50);
  if (chunks.length === 0) {
    // Nothing to index — wipe any stale vectors from a previous ingest run.
    await deleteByFileId(fileId);
    return 0;
  }

  // Embed ALL chunks BEFORE touching Qdrant.
  // If any embed call fails we throw here and the catch block in runIngestPipeline
  // marks the file pending/error — existing Qdrant vectors are left intact.
  const embeddings: number[][] = [];
  for (const chunk of chunks) {
    embeddings.push(await embedText(chunk));
  }

  // All embeddings succeeded — now it is safe to replace the stored vectors.
  await deleteByFileId(fileId);
  await upsertChunks(fileId, chunks, embeddings, payload);

  return chunks.length;
}

export async function reindexAllCompleteFiles(): Promise<{
  filesTotal: number;
  filesIndexed: number;
  filesSkipped: number;
  chunksIndexed: number;
}> {
  const db = getDb();

  const rows = db.prepare(`
    SELECT
      f.id AS file_id,
      f.filename,
      f.file_type,
      m.ai_title,
      m.ai_category,
      m.extracted_text,
      COALESCE(GROUP_CONCAT(t.tag, ' '), '') AS tag_blob
    FROM files f
    LEFT JOIN file_metadata m ON m.file_id = f.id
    LEFT JOIN tags t ON t.file_id = f.id
    WHERE f.status = 'complete'
    GROUP BY f.id
    ORDER BY f.created_at ASC
  `).all() as Array<{
    file_id: string;
    filename: string;
    file_type: string;
    ai_title: string | null;
    ai_category: string | null;
    extracted_text: string | null;
    tag_blob: string;
  }>;

  let filesIndexed = 0;
  let filesSkipped = 0;
  let chunksIndexed = 0;

  for (const row of rows) {
    const content = (row.extracted_text ?? '').trim();
    if (!content) {
      filesSkipped += 1;
      continue;
    }

    const chunkCount = await indexFileContent(row.file_id, content, {
      filename: row.filename,
      file_type: row.file_type,
      ai_title: row.ai_title ?? row.filename,
      ai_category: row.ai_category,
      tags: row.tag_blob.trim() ? row.tag_blob.trim().split(/\s+/) : [],
    });

    if (chunkCount === 0) {
      filesSkipped += 1;
      continue;
    }

    filesIndexed += 1;
    chunksIndexed += chunkCount;
    console.log(`[ingestQueue] reindex ${row.filename}: ${chunkCount} chunks`);
  }

  return {
    filesTotal: rows.length,
    filesIndexed,
    filesSkipped,
    chunksIndexed,
  };
}

async function runIngestPipeline(file: FileRecord): Promise<void> {
  const db = getDb();

  db.prepare(`
    UPDATE files SET status = 'processing', updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(file.id);

  try {
    const extraction = await extractContent(file);
    const aiMeta = await getAIMetadata(file.filename, extraction.content);
    const title = aiMeta.title || file.filename;

    const upsertMetadata = db.prepare(`
      INSERT INTO file_metadata
        (file_id, ai_title, ai_summary, ai_category, extracted_text, word_count, language, processed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(file_id) DO UPDATE SET
        ai_title       = excluded.ai_title,
        ai_summary     = excluded.ai_summary,
        ai_category    = excluded.ai_category,
        extracted_text = excluded.extracted_text,
        word_count     = excluded.word_count,
        language       = excluded.language,
        processed_at   = CURRENT_TIMESTAMP
    `);

    const insertTags = db.prepare(`
      INSERT INTO tags (file_id, tag, source) VALUES (?, ?, 'ai')
    `);

    const deleteFts = db.prepare(`DELETE FROM files_fts WHERE file_id = ?`);
    const insertFts = db.prepare(`
      INSERT INTO files_fts
        (file_id, filename, ai_title, ai_summary, ai_category, tags, extracted_text)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    db.transaction(() => {
      upsertMetadata.run(
        file.id,
        title,
        aiMeta.summary,
        aiMeta.category,
        extraction.content.slice(0, 100_000),
        extraction.wordCount,
        extraction.language
      );

      db.prepare(`DELETE FROM tags WHERE file_id = ? AND source = 'ai'`).run(file.id);
      for (const tag of aiMeta.tags) {
        insertTags.run(file.id, tag);
      }

      deleteFts.run(file.id);
      insertFts.run(
        file.id,
        file.filename,
        title,
        aiMeta.summary,
        aiMeta.category,
        aiMeta.tags.join(' '),
        extraction.content.slice(0, 50_000)
      );
    })();

    const chunkCount = await indexFileContent(file.id, extraction.content, {
      filename: file.filename,
      file_type: file.file_type,
      ai_title: title,
      ai_category: aiMeta.category,
      tags: aiMeta.tags,
    });

    db.prepare(`
      UPDATE files SET status = 'complete', updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(file.id);

    console.log(`[ingestQueue] SUCCESS: ${file.filename} (${file.file_type}) -> "${title}" [${chunkCount} chunks]`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[ingestQueue] ERROR: ${file.filename} failed:`, message);

    db.prepare(`
      UPDATE files
      SET
        status        = CASE WHEN retry_count + 1 >= 3 THEN 'error' ELSE 'pending' END,
        retry_count   = retry_count + 1,
        error_message = ?,
        updated_at    = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(message, file.id);
  }
}
