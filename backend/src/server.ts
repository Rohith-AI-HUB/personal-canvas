import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import fs from 'fs/promises';
import path from 'path';
import type Database from 'better-sqlite3';
import { getDb } from './services/sqlite.js';
import { ensureStorageDirs, FILES_DIR, THUMBNAILS_DIR } from './services/storage.js';
import { fileRoutes } from './routes/files.js';
import { canvasRoutes } from './routes/canvas.js';
import { recoverPendingJobs } from './queue/ingestQueue.js';

const PORT = Number(process.env.BACKEND_PORT) || 3001;

const fastify = Fastify({
  logger: {
    transport: {
      target: 'pino-pretty',
      options: { colorize: true, translateTime: 'SYS:standard' },
    },
  },
});

async function cleanOrphanFiles(db: Database.Database): Promise<void> {
  const diskFiles = await fs.readdir(FILES_DIR).catch(() => [] as string[]);
  let removed = 0;

  const findById = db.prepare('SELECT id FROM files WHERE id = ?');

  for (const filename of diskFiles) {
    const fileId = path.parse(filename).name;
    if (!fileId) continue;

    const row = findById.get(fileId) as { id: string } | undefined;
    if (row) continue;

    await fs.unlink(path.join(FILES_DIR, filename)).catch(() => {});
    await fs.unlink(path.join(THUMBNAILS_DIR, `${fileId}.webp`)).catch(() => {});
    removed += 1;
  }

  if (removed > 0) {
    fastify.log.warn({ removed }, 'Cleaned orphaned files from storage');
  }
}

async function bootstrap(): Promise<void> {
  // Storage directories must exist before any routes fire.
  ensureStorageDirs();

  // Initialize SQLite with WAL mode.
  const db = getDb();

  // Cleanup for crash-window leftovers from interrupted uploads.
  await cleanOrphanFiles(db);

  // Phase 2: recover any files left pending/processing from a previous crashed session
  recoverPendingJobs();

  // CORS - allow Tauri webview origin and browser dev server.
  await fastify.register(cors, {
    origin: [
      'http://localhost:5173',
      'http://127.0.0.1:5173',
      'tauri://localhost',
      'https://tauri.localhost',
    ],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  // Multipart - required for file uploads.
  await fastify.register(multipart, {
    limits: { fileSize: 500 * 1024 * 1024 },
  });

  // Allow top-level arrays in JSON bodies.
  fastify.addContentTypeParser('application/json', { parseAs: 'string' }, function (_req, body, done) {
    try {
      done(null, JSON.parse(body as string));
    } catch (err) {
      done(err as Error, undefined);
    }
  });

  await fastify.register(fileRoutes);
  await fastify.register(canvasRoutes);

  fastify.get('/health', async () => ({ status: 'ok', ts: Date.now() }));

  await fastify.listen({ port: PORT, host: '127.0.0.1' });
  fastify.log.info(`Backend running on http://127.0.0.1:${PORT}`);
}

const shutdown = async (signal: string) => {
  fastify.log.info(`Received ${signal}, shutting down...`);
  await fastify.close();
  process.exit(0);
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

bootstrap().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
