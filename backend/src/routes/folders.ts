import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../services/sqlite.js';
import type { FileWithMetadata } from '../types.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface FolderRecord {
  id:          string;
  name:        string;
  cover_color: string;
  file_count:  number;
  created_at:  string;
  updated_at:  string;
  // hydrated:
  preview_thumbnails?: Array<string | null>; // first 4 thumbnail paths
}

// ── Helper: get full folder with file count + preview thumbnails ──────────────

function getFolderRecord(folderId: string): FolderRecord | null {
  const db = getDb();

  const folder = db.prepare(`
    SELECT id, name, cover_color, file_count, created_at, updated_at
    FROM folders WHERE id = ?
  `).get(folderId) as FolderRecord | undefined;

  if (!folder) return null;

  // Grab first 4 thumbnail paths for the folder cover mosaic
  const thumbRows = db.prepare(`
    SELECT f.thumbnail_path
    FROM folder_files ff
    JOIN files f ON f.id = ff.file_id
    WHERE ff.folder_id = ?
    ORDER BY ff.added_at DESC
    LIMIT 4
  `).all(folderId) as Array<{ thumbnail_path: string | null }>;

  return {
    ...folder,
    preview_thumbnails: thumbRows.map((r) => r.thumbnail_path),
  };
}

function syncFileCount(folderId: string): void {
  const db = getDb();
  db.prepare(`
    UPDATE folders
    SET file_count = (SELECT COUNT(*) FROM folder_files WHERE folder_id = ?),
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(folderId, folderId);
}

// ── Routes ────────────────────────────────────────────────────────────────────

export async function folderRoutes(fastify: FastifyInstance): Promise<void> {

  // GET /api/folders — list all folders
  fastify.get('/api/folders', async (_req, reply: FastifyReply) => {
    const db = getDb();
    const rows = db.prepare(`
      SELECT id FROM folders ORDER BY created_at ASC
    `).all() as { id: string }[];

    const folders = rows.map((r) => getFolderRecord(r.id)).filter(Boolean);
    return reply.send(folders);
  });

  // POST /api/folders — create a new folder
  fastify.post('/api/folders', async (req: FastifyRequest, reply: FastifyReply) => {
    const body = req.body as { name?: string; cover_color?: string };
    const name = (body.name ?? 'New Folder').trim().slice(0, 80);
    const color = body.cover_color ?? pickDefaultColor();

    const db = getDb();
    const id = uuidv4();

    db.prepare(`
      INSERT INTO folders (id, name, cover_color) VALUES (?, ?, ?)
    `).run(id, name, color);

    return reply.code(201).send(getFolderRecord(id));
  });

  // PATCH /api/folders/:id — rename or recolor
  fastify.patch('/api/folders/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const body   = req.body as { name?: string; cover_color?: string };
    const db     = getDb();

    const folder = db.prepare(`SELECT id FROM folders WHERE id = ?`).get(id);
    if (!folder) return reply.code(404).send({ error: 'Folder not found' });

    if (body.name !== undefined) {
      db.prepare(`UPDATE folders SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
        .run(body.name.trim().slice(0, 80), id);
    }
    if (body.cover_color !== undefined) {
      db.prepare(`UPDATE folders SET cover_color = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
        .run(body.cover_color, id);
    }

    return reply.send(getFolderRecord(id));
  });

  // DELETE /api/folders/:id — delete folder (files are NOT deleted, only the folder)
  fastify.delete('/api/folders/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const db     = getDb();

    const folder = db.prepare(`SELECT id FROM folders WHERE id = ?`).get(id);
    if (!folder) return reply.code(404).send({ error: 'Folder not found' });

    // CASCADE deletes folder_files rows automatically
    db.prepare(`DELETE FROM folders WHERE id = ?`).run(id);
    // Also remove any canvas_nodes for this folder's canvas
    db.prepare(`DELETE FROM canvas_nodes WHERE canvas_id = ?`).run(`folder:${id}`);

    return reply.code(204).send();
  });

  // GET /api/folders/:id/files — list files in folder
  fastify.get('/api/folders/:id/files', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const db     = getDb();

    const folder = db.prepare(`SELECT id FROM folders WHERE id = ?`).get(id);
    if (!folder) return reply.code(404).send({ error: 'Folder not found' });

    const fileIds = db.prepare(`
      SELECT file_id FROM folder_files WHERE folder_id = ? ORDER BY added_at ASC
    `).all(id) as { file_id: string }[];

    const files = fileIds
      .map((r) => getFullFileRecord(r.file_id))
      .filter(Boolean);

    return reply.send(files);
  });

  // POST /api/folders/:id/files — add file(s) to folder
  fastify.post('/api/folders/:id/files', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id }  = req.params as { id: string };
    const body    = req.body as { file_ids: string[] };
    const db      = getDb();

    const folder = db.prepare(`SELECT id FROM folders WHERE id = ?`).get(id);
    if (!folder) return reply.code(404).send({ error: 'Folder not found' });

    const insert = db.prepare(`
      INSERT OR IGNORE INTO folder_files (folder_id, file_id) VALUES (?, ?)
    `);

    db.transaction(() => {
      for (const fileId of body.file_ids ?? []) {
        insert.run(id, fileId);
      }
    })();

    syncFileCount(id);
    return reply.send(getFolderRecord(id));
  });

  // DELETE /api/folders/:id/files/:fileId — remove a file from a folder
  fastify.delete('/api/folders/:id/files/:fileId', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id, fileId } = req.params as { id: string; fileId: string };
    const db = getDb();

    db.prepare(`DELETE FROM folder_files WHERE folder_id = ? AND file_id = ?`).run(id, fileId);
    syncFileCount(id);

    // Also remove the canvas node for this file inside the folder canvas
    db.prepare(`
      DELETE FROM canvas_nodes WHERE file_id = ? AND canvas_id = ?
    `).run(fileId, `folder:${id}`);

    return reply.code(204).send();
  });
}

// ── Shared helper (mirrors files.ts) ─────────────────────────────────────────

function getFullFileRecord(fileId: string): FileWithMetadata | null {
  const db = getDb();

  const file = db.prepare(`SELECT * FROM files WHERE id = ?`).get(fileId) as any;
  if (!file) return null;

  const metadata = db.prepare(`SELECT * FROM file_metadata WHERE file_id = ?`).get(fileId) as any ?? null;
  const tagRows  = db.prepare(`SELECT tag FROM tags WHERE file_id = ?`).all(fileId) as { tag: string }[];
  const canvas_node = db.prepare(`SELECT * FROM canvas_nodes WHERE file_id = ?`).get(fileId) as any ?? null;

  return { ...file, metadata, tags: tagRows.map((t) => t.tag), canvas_node };
}

// Cycle through a set of pleasant default colors for new folders
const DEFAULT_COLORS = [
  '#C94F4F', '#3070C4', '#6B4CC4', '#0A8FA4',
  '#1A9460', '#4D4BB8', '#C27832', '#6B7785',
];
let _colorIndex = 0;
function pickDefaultColor(): string {
  return DEFAULT_COLORS[_colorIndex++ % DEFAULT_COLORS.length];
}
