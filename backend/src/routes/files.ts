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
        fastify.log.info({ fileId: existing.id, filename: originalName }, 'Duplicate file upload skipped');
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
            fastify.log.info({ fileId: winner.id, filename: originalName }, 'Concurrent duplicate file upload handled');
            return reply.code(200).send({ duplicate: true, file: full });
          }
        }

        throw err;
      }

      const full = getFullFileRecord(fileId);
      fastify.log.info({ fileId, filename: originalName, fileType }, 'File uploaded and record created');

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

    fastify.log.info({ fileId: id }, 'File and associated records deleted');

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

    fastify.log.info({ fileId: id, filename: file.filename }, 'File retry initiated');

    enqueueFile({ ...file, status: 'pending', retry_count: 0 });

    return reply.code(200).send({ queued: true });
  });

  // POST /api/files/:id/reanalyze — force re-run AI ingest regardless of current status
  fastify.post('/api/files/:id/reanalyze', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const db = getDb();

    const file = db
      .prepare(`SELECT * FROM files WHERE id = ?`)
      .get(id) as FileRecord | undefined;

    if (!file) return reply.code(404).send({ error: 'Not found' });

    // Clear existing AI metadata so ingest pipeline generates fresh results
    db.prepare(`DELETE FROM tags WHERE file_id = ? AND source = 'ai'`).run(id);
    db.prepare(`DELETE FROM file_metadata WHERE file_id = ?`).run(id);

    db.prepare(`
      UPDATE files
      SET status = 'pending', retry_count = 0, error_message = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(id);

    // Update FTS to clear stale AI fields
    db.prepare(`
      UPDATE files_fts
      SET ai_title = '', ai_summary = '', ai_category = '', tags = ''
      WHERE file_id = ?
    `).run(id);

    enqueueFile({ ...file, status: 'pending', retry_count: 0 });

    return reply.code(200).send({ queued: true });
  });

  // PATCH /api/files/:id — update manual title and/or tags
  // Only touches 'manual' source fields; AI-generated data is preserved separately.
  fastify.patch('/api/files/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id }  = req.params as { id: string };
    const body    = req.body as { title?: string; tags?: string[] };
    const db      = getDb();

    const file = db.prepare('SELECT id, status FROM files WHERE id = ?').get(id) as { id: string; status: string } | undefined;
    if (!file) return reply.code(404).send({ error: 'Not found' });

    const { title, tags } = body;
    if (title === undefined && tags === undefined) {
      return reply.code(400).send({ error: 'Provide title and/or tags' });
    }

    db.transaction(() => {
      // Update manual title in file_metadata (upsert)
      if (title !== undefined) {
        const trimmed = title.trim().slice(0, 200);
        const exists  = db.prepare('SELECT 1 FROM file_metadata WHERE file_id = ?').get(id);
        if (exists) {
          db.prepare('UPDATE file_metadata SET ai_title = ? WHERE file_id = ?').run(trimmed, id);
        } else {
          db.prepare(`
            INSERT INTO file_metadata (file_id, ai_title, ai_summary, ai_category, extracted_text, word_count, language, processed_at)
            VALUES (?, ?, '', '', '', 0, '', datetime('now'))
          `).run(id, trimmed);
        }
        // Update FTS
        db.prepare('UPDATE files_fts SET ai_title = ? WHERE file_id = ?').run(trimmed, id);
      }

      // Replace all manual tags for this file
      if (tags !== undefined) {
        const clean = tags
          .map((t) => t.trim().toLowerCase().replace(/\s+/g, '-'))
          .filter((t) => t.length > 0 && t.length <= 60)
          .slice(0, 15);

        db.prepare(`DELETE FROM tags WHERE file_id = ? AND source = 'manual'`).run(id);
        const insertTag = db.prepare(`INSERT INTO tags (file_id, tag, source) VALUES (?, ?, 'manual')`);
        for (const tag of clean) insertTag.run(id, tag);

        // Rebuild FTS tag field: AI tags + manual tags combined
        const allTags = db
          .prepare('SELECT tag FROM tags WHERE file_id = ?')
          .all(id) as { tag: string }[];
        db.prepare('UPDATE files_fts SET tags = ? WHERE file_id = ?')
          .run(allTags.map((r) => r.tag).join(' '), id);
      }
    })();

    const full = getFullFileRecord(id);
    return reply.send(full);
  });

  // GET /api/files/:id/content — full extracted text for @ mention deep context
  fastify.get('/api/files/:id/content', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const db = getDb();

    const row = db.prepare(`
      SELECT f.filename, f.file_type, m.ai_title, m.ai_summary, m.extracted_text
      FROM files f
      LEFT JOIN file_metadata m ON m.file_id = f.id
      WHERE f.id = ?
    `).get(id) as {
      filename: string; file_type: string;
      ai_title: string | null; ai_summary: string | null; extracted_text: string | null;
    } | undefined;

    if (!row) return reply.code(404).send({ error: 'Not found' });
    return reply.send({
      file_id: id,
      filename: row.filename,
      file_type: row.file_type,
      ai_title: row.ai_title ?? null,
      ai_summary: row.ai_summary ?? null,
      extracted_text: row.extracted_text ?? null,
    });
  });

  // POST /api/files/create-text — save AI-generated text as a real canvas file
  fastify.post('/api/files/create-text', async (req: FastifyRequest, reply: FastifyReply) => {
    const body = req.body as { filename?: string; content?: string; source_file_id?: string };
    const filename = body.filename?.trim();
    const content  = body.content?.trim();
    if (!filename || !content) {
      return reply.code(400).send({ error: 'filename and content are required' });
    }

    const db = getDb();
    const { saveTextFile } = await import('../services/storage.js');
    const { hashString }   = await import('../services/dedup.js');
    const { v4: uuidv4 }   = await import('uuid');

    const fileId      = uuidv4();
    const contentHash = hashString(content);

    const existing = db.prepare('SELECT id FROM files WHERE content_hash = ?')
      .get(contentHash) as { id: string } | undefined;
    if (existing) {
      return reply.code(200).send({ duplicate: true, file: getFullFileRecord(existing.id) });
    }

    const storagePath = await saveTextFile(content, fileId, filename);
    const byteSize    = Buffer.byteLength(content, 'utf8');
    const wordCount   = content.split(/\s+/).filter(Boolean).length;

    db.transaction(() => {
      db.prepare(`
        INSERT INTO files (id, filename, storage_path, thumbnail_path, file_type, file_size, mime_type, content_hash, status)
        VALUES (?, ?, ?, NULL, 'text', ?, 'text/plain', ?, 'complete')
      `).run(fileId, filename, storagePath, byteSize, contentHash);

      db.prepare(`
        INSERT INTO file_metadata (file_id, ai_title, ai_summary, ai_category, extracted_text, word_count, language, processed_at)
        VALUES (?, ?, 'AI-generated document', 'Other', ?, ?, 'en', datetime('now'))
      `).run(fileId, filename, content, wordCount);

      db.prepare(`
        INSERT INTO files_fts (file_id, filename, ai_title, ai_summary, ai_category, tags, extracted_text)
        VALUES (?, ?, ?, 'AI-generated document', '', '', ?)
      `).run(fileId, filename, filename, content);
    })();

    fastify.log.info({ fileId, filename }, 'AI-generated text file created');
    return reply.code(201).send({ duplicate: false, file: getFullFileRecord(fileId) });
  });

  // GET /api/files/:id/raw — serve the raw file bytes (for in-app viewers)
  fastify.get('/api/files/:id/raw', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const db = getDb();

    const row = db.prepare('SELECT storage_path, mime_type, filename FROM files WHERE id = ?')
      .get(id) as { storage_path: string; mime_type: string | null; filename: string } | undefined;

    if (!row) return reply.code(404).send({ error: 'Not found' });
    if (!fs.existsSync(row.storage_path)) return reply.code(404).send({ error: 'File not on disk' });

    // Infer content-type from extension if mime_type not stored
    const ext = path.extname(row.filename).toLowerCase();
    const mimeMap: Record<string, string> = {
      '.pdf':  'application/pdf',
      '.doc':  'application/msword',
      '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      '.txt':  'text/plain',
      '.md':   'text/markdown',
      '.py':   'text/plain',
      '.js':   'text/plain',
      '.ts':   'text/plain',
      '.json': 'application/json',
      '.csv':  'text/csv',
    };
    const contentType = row.mime_type || mimeMap[ext] || 'application/octet-stream';

    reply.header('Content-Type', contentType);
    reply.header('Content-Disposition', `inline; filename="${row.filename}"`);
    reply.header('Cache-Control', 'private, max-age=3600');
    return reply.send(createReadStream(row.storage_path));
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

