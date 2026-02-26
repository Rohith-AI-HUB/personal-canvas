import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import { getDb } from './services/sqlite.js';
import { ensureStorageDirs } from './services/storage.js';
import { fileRoutes } from './routes/files.js';
import { canvasRoutes } from './routes/canvas.js';

const PORT = Number(process.env.BACKEND_PORT) || 3001;

const fastify = Fastify({
  logger: {
    transport: {
      target: 'pino-pretty',
      options: { colorize: true, translateTime: 'SYS:standard' },
    },
  },
});

async function bootstrap(): Promise<void> {
  // Storage directories must exist before any routes fire
  ensureStorageDirs();

  // P0: Initialize SQLite with WAL mode
  getDb();

  // CORS — allow Tauri webview origin and browser dev server
  await fastify.register(cors, {
    origin: [
      'http://localhost:5173',   // Vite dev server
      'http://127.0.0.1:5173',  // Vite dev server (IP form — browsers treat this as a separate origin)
      'tauri://localhost',        // Tauri production webview
      'https://tauri.localhost',  // Tauri v2 webview origin
    ],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  // Multipart — required for file uploads
  // 500MB limit per file; adjust as needed
  await fastify.register(multipart, {
    limits: { fileSize: 500 * 1024 * 1024 },
  });

  // Custom JSON parser to safely allow top-level arrays which Fastify may reject by default
  fastify.addContentTypeParser('application/json', { parseAs: 'string' }, function (req, body, done) {
    try {
      done(null, JSON.parse(body as string));
    } catch (err) {
      done(err as Error, undefined);
    }
  });

  // Routes
  await fastify.register(fileRoutes);
  await fastify.register(canvasRoutes);

  // Health check
  fastify.get('/health', async () => ({ status: 'ok', ts: Date.now() }));

  await fastify.listen({ port: PORT, host: '127.0.0.1' });
  fastify.log.info(`Backend running on http://127.0.0.1:${PORT}`);
}

// Graceful shutdown
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
