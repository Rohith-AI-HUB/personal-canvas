import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { pipeline } from 'stream/promises';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createReadStream } from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../services/sqlite.js';
import { hashFile } from '../services/dedup.js';
import { saveFile, deleteFileFromDisk } from '../services/storage.js';
import { generateThumbnail } from '../services/thumbnails.js';
import { detectFileType } from '../services/fileTypes.js';
import { deleteByFileId } from '../services/qdrant.js';
import type { FileRecord, FileWithMetadata } from '../types.js';
import { enqueueFile } from '../queue/ingestQueue.js';

export async function fileRoutes(fastify: FastifyInstance): Promise<void> {

  // POST /api/files - upload a single file
  fastify.post('/api/files', async (req: FastifyRequest, reply: FastifyReply) => {
    const data = await req.file();
    if (!data) {
      return reply.code(400).send({ error: 'No file provided' });
    }

    const db = getDb();
    const originalName = data.filename;
    const mimeType = data.mimetype;
    const fileType = detectFileType(originalName);

    // Save upload to OS temp dir first (we need it on disk to hash it)
    const tempId = uuidv4();
    const tempPath = path.join(os.tmpdir(), `pc-upload-${tempId}`);
    let storagePath: string | null = null;
    let thumbnailPath: string | null = null;

    try {
      await pipeline(data.file, fs.createWriteStream(tempPath));

      const stat = fs.statSync(tempPath);
      const contentHash = await hashFile(tempPath);

      // Fast pre-check for obvious duplicates before doing extra disk work.
      const existing = db
        .prepare('SELECT id FROM files WHERE content_hash = ?')
        .get(contentHash) as { id: string } | undefined;

      if (existing) {
        fs.unlink(tempPath, () => {});
        const full = getFullFileRecord(existing.id);
        return reply.code(200).send({ duplicate: true, file: full });
      }

      // Persist to permanent storage.
      const fileId = uuidv4();
      storagePath = await saveFile(tempPath, fileId, originalName);
      fs.unlink(tempPath, () => {}); // remove temp after copy

      // Generate thumbnail (best-effort, null on failure).
      thumbnailPath = await generateThumbnail(storagePath, fileId, fileType);

      // Keep file row + FTS row in one transaction so search index stays in sync.
      const insertFile = db.prepare(`
        INSERT INTO files
          (id, filename, storage_path, thumbnail_path, file_type, file_size, mime_type, content_hash, status)
        VALUES
          (?, ?, ?, ?, ?, ?, ?, ?, 'pending')
      `);
      const insertFts = db.prepare(`
        INSERT INTO files_fts
          (file_id, filename, ai_title, ai_summary, ai_category, tags, extracted_text)
        VALUES
          (?, ?, '', '', '', '', '')
      `);
      const insertTx = db.transaction(() => {
        insertFile.run(fileId, originalName, storagePath, thumbnailPath, fileType, stat.size, mimeType, contentHash);
        insertFts.run(fileId, originalName);
      });

      try {
        insertTx();
      } catch (err) {
        const sqliteErr = err as NodeJS.ErrnoException;

        // Concurrent uploads can race and both pass the pre-check.
        if (sqliteErr.code === 'SQLITE_CONSTRAINT_UNIQUE') {
          await deleteFileFromDisk(storagePath, thumbnailPath);
          const winner = db
            .prepare('SELECT id FROM files WHERE content_hash = ?')
            .get(contentHash) as { id: string } | undefined;

          if (winner) {
            const full = getFullFileRecord(winner.id);
            return reply.code(200).send({ duplicate: true, file: full });
          }
        }

        throw err;
      }

      const full = getFullFileRecord(fileId);

      // Phase 2: kick off background AI ingest immediately after upload
      if (full) enqueueFile(full);

      return reply.code(201).send({ duplicate: false, file: full });

    } catch (err) {
      fs.unlink(tempPath, () => {});
      if (storagePath) {
        await deleteFileFromDisk(storagePath, thumbnailPath);
      }
      fastify.log.error(err, 'File upload failed');
      return reply.code(500).send({ error: 'Upload failed' });
    }
  });

  // GET /api/files - return all files with metadata for canvas restore
  fastify.get('/api/files', async (_req: FastifyRequest, reply: FastifyReply) => {
    const db = getDb();
    const files = db
      .prepare('SELECT id FROM files ORDER BY created_at DESC')
      .all() as { id: string }[];

    const results = files.map((f) => getFullFileRecord(f.id)).filter(Boolean);
    return reply.send(results);
  });

  // GET /api/files/:id - single file record
  fastify.get('/api/files/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const file = getFullFileRecord(id);
    if (!file) return reply.code(404).send({ error: 'Not found' });
    return reply.send(file);
  });

  // GET /api/files/:id/status - lightweight status poll
  fastify.get('/api/files/:id/status', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const db = getDb();
    const row = db
      .prepare('SELECT status, retry_count, error_message FROM files WHERE id = ?')
      .get(id) as { status: string; retry_count: number; error_message: string | null } | undefined;

    if (!row) return reply.code(404).send({ error: 'Not found' });
    return reply.send(row);
  });

  // DELETE /api/files/:id
  fastify.delete('/api/files/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const db = getDb();

    const file = db
      .prepare('SELECT storage_path, thumbnail_path FROM files WHERE id = ?')
      .get(id) as { storage_path: string; thumbnail_path: string | null } | undefined;

    if (!file) return reply.code(404).send({ error: 'Not found' });

    // Delete from disk.
    await deleteFileFromDisk(file.storage_path, file.thumbnail_path);

    // Keep FTS table in sync when files are deleted.
    db.prepare('DELETE FROM files_fts WHERE file_id = ?').run(id);

    // Cascade deletes tags, metadata, canvas_nodes via FK ON DELETE CASCADE.
    db.prepare('DELETE FROM files WHERE id = ?').run(id);

    await deleteByFileId(id);

    return reply.code(204).send();
  });

  // POST /api/files/:id/retry — reset error state and re-enqueue
  fastify.post('/api/files/:id/retry', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const db = getDb();

    const file = db
      .prepare(`SELECT * FROM files WHERE id = ?`)
      .get(id) as FileRecord | undefined;

    if (!file) {
      return reply.code(404).send({ error: 'Not found' });
    }
    if (file.status !== 'error') {
      return reply.code(400).send({ error: 'File is not in error state' });
    }

    // Reset retry counter so state machine allows re-processing
    db.prepare(`
      UPDATE files
      SET status = 'pending', retry_count = 0, error_message = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(id);

    enqueueFile({ ...file, status: 'pending', retry_count: 0 });

    return reply.code(200).send({ queued: true });
  });

  // GET /api/thumbnail - serve thumbnail file by absolute path
  // The path param is the absolute path stored in SQLite thumbnail_path
  fastify.get('/api/thumbnail', async (req: FastifyRequest, reply: FastifyReply) => {
    const { path: thumbPath } = req.query as { path?: string };

    if (!thumbPath) return reply.code(400).send({ error: 'path required' });

    // Security: only serve files from within the thumbnails directory.
    const { THUMBNAILS_DIR } = await import('../services/storage.js');
    const resolved = path.resolve(thumbPath);
    if (!resolved.startsWith(path.resolve(THUMBNAILS_DIR))) {
      return reply.code(403).send({ error: 'Forbidden' });
    }

    if (!fs.existsSync(resolved)) {
      return reply.code(404).send({ error: 'Not found' });
    }

    const ext = path.extname(resolved).toLowerCase();
    const mimeTypes: Record<string, string> = {
      '.webp': 'image/webp',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
    };

    reply.header('Content-Type', mimeTypes[ext] ?? 'application/octet-stream');
    reply.header('Cache-Control', 'public, max-age=86400');
    return reply.send(createReadStream(resolved));
  });
}

// Helpers
function getFullFileRecord(fileId: string): FileWithMetadata | null {
  const db = getDb();

  const file = db
    .prepare('SELECT * FROM files WHERE id = ?')
    .get(fileId) as any;

  if (!file) return null;

  const metadata = db
    .prepare('SELECT * FROM file_metadata WHERE file_id = ?')
    .get(fileId) as any ?? null;

  const tagRows = db
    .prepare('SELECT tag FROM tags WHERE file_id = ?')
    .all(fileId) as { tag: string }[];

  const canvas_node = db
    .prepare('SELECT * FROM canvas_nodes WHERE file_id = ?')
    .get(fileId) as any ?? null;

  return {
    ...file,
    metadata,
    tags: tagRows.map((t) => t.tag),
    canvas_node,
  };
}
