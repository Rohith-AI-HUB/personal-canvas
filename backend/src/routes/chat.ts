import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { embedText } from '../services/embeddings.js';
import { searchChunks } from '../services/qdrant.js';
import { getDb, insertChatMessage, getSessionHistory } from '../services/sqlite.js';
import { streamOllamaChat, type ChatMessage } from '../services/ollama.js';

const MAX_CONTEXT_TOKENS = 6000;
const APPROX_CHARS_PER_TOKEN = 4;
const SYSTEM_PROMPT = `You are a personal knowledge assistant with access to the user's file collection.
Answer questions based only on the provided context. If the answer is not in the context, say so clearly.
Always cite which files your information comes from using the format [filename].
Be concise and specific. Do not fabricate information.`;

interface ChatRequestBody {
  message: string;
  session_id: string;
}

interface RetrievedChunk {
  file_id: string;
  filename: string;
  text: string;
  score: number;
}

// Build context string within a hard token budget, best chunks first
function buildContext(chunks: RetrievedChunk[]): { context: string; citedFileIds: string[] } {
  let budget = MAX_CONTEXT_TOKENS;
  const included: RetrievedChunk[] = [];
  const seenFileIds = new Set<string>();

  for (const chunk of chunks) {
    const estimate = Math.ceil(chunk.text.length / APPROX_CHARS_PER_TOKEN);
    if (estimate > budget) break;
    included.push(chunk);
    budget -= estimate;
    seenFileIds.add(chunk.file_id);
  }

  // Group chunks by file for clean context blocks
  const byFile = new Map<string, { filename: string; texts: string[] }>();
  for (const chunk of included) {
    const entry = byFile.get(chunk.file_id) ?? { filename: chunk.filename, texts: [] };
    entry.texts.push(chunk.text);
    byFile.set(chunk.file_id, entry);
  }

  const contextBlocks = [...byFile.values()]
    .map(({ filename, texts }) => `--- File: "${filename}" ---\n${texts.join('\n')}`)
    .join('\n\n');

  return {
    context: contextBlocks,
    citedFileIds: [...seenFileIds],
  };
}

// Enrich raw Qdrant chunks with filenames from SQLite
function enrichChunks(
  rawChunks: Array<{ file_id: string; text: string; score: number }>
): RetrievedChunk[] {
  if (rawChunks.length === 0) return [];

  const db = getDb();
  const ids = rawChunks.map((c) => c.file_id);
  const placeholders = ids.map(() => '?').join(', ');

  const rows = db.prepare(`
    SELECT f.id, COALESCE(m.ai_title, f.filename) AS display_name
    FROM files f
    LEFT JOIN file_metadata m ON m.file_id = f.id
    WHERE f.id IN (${placeholders})
  `).all(...ids) as Array<{ id: string; display_name: string }>;

  const nameMap = new Map(rows.map((r) => [r.id, r.display_name]));

  return rawChunks
    .filter((c) => nameMap.has(c.file_id))
    .map((c) => ({
      file_id: c.file_id,
      filename: nameMap.get(c.file_id)!,
      text: c.text,
      score: c.score,
    }));
}

export async function chatRoutes(fastify: FastifyInstance): Promise<void> {
  // POST /api/chat — streams SSE tokens back to client
  fastify.post(
    '/api/chat',
    async (req: FastifyRequest<{ Body: ChatRequestBody }>, reply: FastifyReply) => {
      const { message, session_id } = req.body ?? {};

      if (!message?.trim() || !session_id?.trim()) {
        return reply.status(400).send({ error: 'message and session_id are required' });
      }

      // 1. Persist user message immediately
      insertChatMessage(session_id, 'user', message.trim());

      // 2. Retrieve relevant chunks from Qdrant
      let rawChunks: Array<{ file_id: string; text: string; score: number }> = [];
      try {
        const queryEmbedding = await embedText(message);
        const scored = await searchChunks(queryEmbedding, 10);
        rawChunks = scored.map((s) => ({
          file_id: s.file_id,
          text: s.text,
          score: s.score,
        }));
      } catch (err) {
        // Embedding or Qdrant failure — answer without context rather than crashing
        fastify.log.warn('[chat] RAG retrieval failed, proceeding without context:', err);
      }

      // 3. Enrich with filenames and assemble context
      const enriched = enrichChunks(rawChunks);
      const { context, citedFileIds } = buildContext(enriched);

      // 4. Load last 5 history exchanges (10 messages)
      const history = getSessionHistory(session_id, 10);

      // 5. Build prompt
      const promptMessages: ChatMessage[] = [
        { role: 'system', content: SYSTEM_PROMPT },
      ];

      if (context) {
        promptMessages.push({
          role: 'system',
          content: `Relevant context from the user's files:\n\n${context}`,
        });
      }

      // Append conversation history (exclude the message we just inserted)
      for (const msg of history.slice(0, -1)) {
        promptMessages.push({ role: msg.role, content: msg.content });
      }

      promptMessages.push({ role: 'user', content: message.trim() });

      // 6. Stream SSE response
      reply.raw.setHeader('Content-Type', 'text/event-stream');
      reply.raw.setHeader('Cache-Control', 'no-cache');
      reply.raw.setHeader('Connection', 'keep-alive');
      reply.raw.setHeader('X-Accel-Buffering', 'no');
      reply.raw.flushHeaders();

      let fullResponse = '';

      const abortController = new AbortController();
      req.raw.on('close', () => abortController.abort());

      try {
        for await (const token of streamOllamaChat(promptMessages, abortController.signal)) {
          fullResponse += token;
          // SSE format: data: <json>\n\n
          reply.raw.write(`data: ${JSON.stringify({ token })}\n\n`);
        }

        // Send citations in final event
        reply.raw.write(
          `data: ${JSON.stringify({ done: true, citations: citedFileIds })}\n\n`
        );

        // Persist assistant response with citations
        insertChatMessage(session_id, 'assistant', fullResponse, citedFileIds);
      } catch (err: unknown) {
        const isAbort =
          err instanceof Error &&
          (err.name === 'AbortError' || err.message.includes('aborted'));

        if (!isAbort) {
          fastify.log.error('[chat] Stream error:', err);
          reply.raw.write(
            `data: ${JSON.stringify({ error: 'Stream failed. Please try again.' })}\n\n`
          );
        }

        // Still persist whatever was generated before the failure
        if (fullResponse) {
          insertChatMessage(session_id, 'assistant', fullResponse, citedFileIds);
        }
      } finally {
        reply.raw.end();
      }
    }
  );

  // GET /api/chat/history?session_id=xxx — load prior messages on mount
  fastify.get(
    '/api/chat/history',
    async (req: FastifyRequest<{ Querystring: { session_id?: string; limit?: string } }>, reply: FastifyReply) => {
      const sessionId = req.query.session_id?.trim();
      if (!sessionId) return reply.status(400).send({ error: 'session_id required' });

      const limit = Math.min(Number(req.query.limit ?? 50), 100);
      const messages = getSessionHistory(sessionId, limit);

      return reply.send({
        session_id: sessionId,
        messages: messages.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          citations: m.citations ? (JSON.parse(m.citations) as string[]) : [],
          created_at: m.created_at,
        })),
      });
    }
  );
}
