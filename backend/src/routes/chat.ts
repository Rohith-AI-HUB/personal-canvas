import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { embedText } from '../services/embeddings.js';
import { searchChunks } from '../services/qdrant.js';
import { getDb, getSessionHistory, insertMessage, deleteSessionMessages, type ChatRole } from '../services/sqlite.js';
import { streamGroqChat, type ChatMessage } from '../services/groq.js';

const MAX_CONTEXT_TOKENS = 6000;
const APPROX_CHARS_PER_TOKEN = 4;
const MAX_HISTORY_MESSAGES = 10; // 5 exchanges

// Hard cap on user message length.
// At 4 chars/token this is ~2000 tokens — enough for any reasonable question
// while preventing a malformed/huge input from consuming the entire context budget.
const MAX_QUESTION_CHARS = 8000;

const SYSTEM_PROMPT = `You are a personal knowledge assistant with access to the user's file collection.
Answer questions based only on the provided context. If the answer is not in the context, say so clearly.
Always cite which files your information comes from using the format [filename].
Be concise and specific. Do not fabricate information.`;

interface ChatRequestBody {
  message: string;
  session_id: string;
  history?: Array<{
    role: ChatRole;
    content: string;
  }>;
}

interface RetrievedChunk {
  file_id: string;
  filename: string;
  text: string;
  score: number;
}

function buildContext(chunks: RetrievedChunk[]): { context: string; citedFileIds: string[] } {
  let budget = MAX_CONTEXT_TOKENS;
  const included: RetrievedChunk[] = [];
  const seenFileIds = new Set<string>();

  const ranked = [...chunks].sort((a, b) => b.score - a.score);
  for (const chunk of ranked) {
    const estimate = Math.ceil(chunk.text.length / APPROX_CHARS_PER_TOKEN);
    if (estimate > budget) continue;
    included.push(chunk);
    seenFileIds.add(chunk.file_id);
    budget -= estimate;
    if (budget <= 0) break;
  }

  const byFile = new Map<string, { filename: string; texts: string[] }>();
  for (const chunk of included) {
    const entry = byFile.get(chunk.file_id) ?? { filename: chunk.filename, texts: [] };
    entry.texts.push(chunk.text);
    byFile.set(chunk.file_id, entry);
  }

  const context = [...byFile.values()]
    .map(({ filename, texts }) => `--- File: "${filename}" ---\n${texts.join('\n')}`)
    .join('\n\n');

  return { context, citedFileIds: [...seenFileIds] };
}

function enrichChunks(rawChunks: Array<{ file_id: string; text: string; score: number }>): RetrievedChunk[] {
  if (rawChunks.length === 0) return [];

  const db = getDb();
  const ids = [...new Set(rawChunks.map((chunk) => chunk.file_id))];
  const placeholders = ids.map(() => '?').join(', ');

  const rows = db
    .prepare(`
      SELECT f.id, COALESCE(m.ai_title, f.filename) AS display_name
      FROM files f
      LEFT JOIN file_metadata m ON m.file_id = f.id
      WHERE f.id IN (${placeholders})
    `)
    .all(...ids) as Array<{ id: string; display_name: string }>;

  const nameMap = new Map(rows.map((row) => [row.id, row.display_name]));

  return rawChunks
    .filter((chunk) => nameMap.has(chunk.file_id))
    .map((chunk) => ({
      file_id: chunk.file_id,
      filename: nameMap.get(chunk.file_id)!,
      text: chunk.text,
      score: chunk.score,
    }));
}

function normalizeHistory(history: ChatRequestBody['history']): Array<{ role: ChatRole; content: string }> {
  if (!Array.isArray(history)) return [];

  return history
    .filter((entry): entry is { role: ChatRole; content: string } => {
      if (!entry) return false;
      const validRole = entry.role === 'user' || entry.role === 'assistant';
      const validContent = typeof entry.content === 'string' && entry.content.trim().length > 0;
      return validRole && validContent;
    })
    .map((entry) => ({
      role: entry.role,
      content: entry.content.trim(),
    }));
}

function safeParseCitations(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((value): value is string => typeof value === 'string');
  } catch {
    return [];
  }
}

export async function chatRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post(
    '/api/chat',
    async (req: FastifyRequest<{ Body: ChatRequestBody }>, reply: FastifyReply) => {
      const { message, session_id, history } = req.body ?? {};
      const question = message?.trim();
      const sessionId = session_id?.trim();

      if (!question || !sessionId) {
        return reply.status(400).send({ error: 'message and session_id are required' });
      }

      // Truncate at the character budget so a huge paste cannot push context
      // out of the prompt or cause the embedding model to fail silently.
      const safeQuestion =
        question.length > MAX_QUESTION_CHARS
          ? question.slice(0, MAX_QUESTION_CHARS) + ' [message truncated]'
          : question;

      const providedHistory = normalizeHistory(history);
      const historyWindow =
        providedHistory.length > 0
          ? providedHistory.slice(-MAX_HISTORY_MESSAGES)
          : getSessionHistory(sessionId, MAX_HISTORY_MESSAGES).map((msg) => ({
              role: msg.role,
              content: msg.content,
            }));

      if (
        historyWindow.length > 0 &&
        historyWindow[historyWindow.length - 1]?.role === 'user' &&
        historyWindow[historyWindow.length - 1]?.content === safeQuestion
      ) {
        historyWindow.pop();
      }

      insertMessage(sessionId, 'user', safeQuestion);

      let rawChunks: Array<{ file_id: string; text: string; score: number }> = [];
      try {
        const queryEmbedding = await embedText(safeQuestion);
        const scored = await searchChunks(queryEmbedding, 10);
        rawChunks = scored.map((chunk) => ({
          file_id: chunk.file_id,
          text: chunk.text,
          score: chunk.score,
        }));
      } catch (err) {
        fastify.log.warn({ err }, '[chat] RAG retrieval failed, proceeding without context');
      }

      const enriched = enrichChunks(rawChunks);
      const { context, citedFileIds } = buildContext(enriched);

      const promptMessages: ChatMessage[] = [{ role: 'system', content: SYSTEM_PROMPT }];
      if (context) {
        promptMessages.push({
          role: 'system',
          content: `Relevant context from the user's files:\n\n${context}`,
        });
      }
      promptMessages.push(...historyWindow);
      promptMessages.push({ role: 'user', content: safeQuestion });

      // CORS must be set manually here because we bypass Fastify's response
      // pipeline by writing directly to reply.raw for SSE streaming.
      const requestOrigin = req.headers.origin ?? '';
      const allowedOrigins = [
        'http://localhost:5173',
        'http://127.0.0.1:5173',
        'tauri://localhost',
        'http://tauri.localhost',
        'https://tauri.localhost',
      ];
      const isAllowed =
        !requestOrigin ||
        allowedOrigins.includes(requestOrigin) ||
        /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(requestOrigin);

      reply.raw.setHeader('Access-Control-Allow-Origin', isAllowed ? (requestOrigin || '*') : 'null');
      reply.raw.setHeader('Access-Control-Allow-Credentials', 'true');
      reply.raw.setHeader('Content-Type', 'text/event-stream');
      reply.raw.setHeader('Cache-Control', 'no-cache');
      reply.raw.setHeader('Connection', 'keep-alive');
      reply.raw.setHeader('X-Accel-Buffering', 'no');
      reply.raw.flushHeaders();

      let fullResponse = '';
      const abortController = new AbortController();
      req.raw.on('close', () => abortController.abort());

      try {
        for await (const token of streamGroqChat(promptMessages, abortController.signal)) {
          fullResponse += token;
          reply.raw.write(`data: ${JSON.stringify({ token })}\n\n`);
        }

        reply.raw.write(`data: ${JSON.stringify({ done: true, citations: citedFileIds })}\n\n`);
        insertMessage(sessionId, 'assistant', fullResponse, citedFileIds);
      } catch (err: unknown) {
        const isAbort =
          err instanceof Error &&
          (err.name === 'AbortError' || err.message.toLowerCase().includes('aborted'));

        if (!isAbort) {
          fastify.log.error({ err }, '[chat] Stream error');
          reply.raw.write(
            `data: ${JSON.stringify({ error: 'Stream failed. Please try again.' })}\n\n`
          );
        }

        if (fullResponse) {
          insertMessage(sessionId, 'assistant', fullResponse, citedFileIds);
        }
      } finally {
        reply.raw.end();
      }
    }
  );

  fastify.get(
    '/api/chat/history',
    async (
      req: FastifyRequest<{ Querystring: { session_id?: string; limit?: string } }>,
      reply: FastifyReply
    ) => {
      const sessionId = req.query.session_id?.trim();
      if (!sessionId) {
        return reply.status(400).send({ error: 'session_id required' });
      }

      const rawLimit = Number(req.query.limit ?? 50);
      const limit = Number.isFinite(rawLimit)
        ? Math.min(Math.max(Math.trunc(rawLimit), 1), 100)
        : 50;

      const messages = getSessionHistory(sessionId, limit);
      return reply.send({
        session_id: sessionId,
        messages: messages.map((msg) => ({
          id: msg.id,
          role: msg.role,
          content: msg.content,
          citations: msg.citations ? safeParseCitations(msg.citations) : [],
          created_at: msg.created_at,
        })),
      });
    }
  );

  fastify.delete(
    '/api/chat/session',
    async (
      req: FastifyRequest<{ Querystring: { session_id?: string } }>,
      reply: FastifyReply
    ) => {
      const sessionId = req.query.session_id?.trim();
      if (!sessionId) {
        return reply.status(400).send({ error: 'session_id required' });
      }
      const deleted = deleteSessionMessages(sessionId);
      return reply.send({ ok: true, session_id: sessionId, deleted });
    }
  );
}
