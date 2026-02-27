import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getDb } from '../services/sqlite.js';

interface NodeUpdate {
  id: string; // tldraw shape ID
  fileId?: string;
  folderId?: string;
  canvasId?: string; // 'main' | 'folder:{id}'
  x: number;
  y: number;
  width: number;
  height: number;
}

interface NormalizedNodeUpdate {
  id: string;
  fileId: string | null;
  folderId: string | null;
  canvasId: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function normalizeNodeUpdate(node: unknown): NormalizedNodeUpdate | null {
  if (!node || typeof node !== 'object') return null;

  const candidate = node as NodeUpdate;
  if (typeof candidate.id !== 'string' || candidate.id.length === 0) return null;
  if (!isFiniteNumber(candidate.x) || !isFiniteNumber(candidate.y)) return null;
  if (!isFiniteNumber(candidate.width) || !isFiniteNumber(candidate.height)) return null;

  const fileId = typeof candidate.fileId === 'string' && candidate.fileId.length > 0
    ? candidate.fileId
    : null;
  const folderId = typeof candidate.folderId === 'string' && candidate.folderId.length > 0
    ? candidate.folderId
    : null;

  // Ignore ambiguous or malformed rows instead of failing the full autosave batch.
  if ((fileId && folderId) || (!fileId && !folderId)) return null;

  return {
    id: candidate.id,
    fileId,
    folderId,
    canvasId: typeof candidate.canvasId === 'string' && candidate.canvasId.length > 0
      ? candidate.canvasId
      : 'main',
    x: candidate.x,
    y: candidate.y,
    width: candidate.width,
    height: candidate.height,
  };
}

function getExistingIds(
  db: ReturnType<typeof getDb>,
  table: 'files' | 'folders',
  ids: string[]
): Set<string> {
  if (ids.length === 0) return new Set<string>();

  const placeholders = ids.map(() => '?').join(', ');
  const rows = db.prepare(`
    SELECT id FROM ${table} WHERE id IN (${placeholders})
  `).all(...ids) as Array<{ id: string }>;

  return new Set(rows.map((row) => row.id));
}

export async function canvasRoutes(fastify: FastifyInstance): Promise<void> {

  // POST /api/canvas/nodes - batch upsert node positions from tldraw onChange
  fastify.post('/api/canvas/nodes', async (req: FastifyRequest, reply: FastifyReply) => {
    const body = req.body as unknown;
    const nodes = Array.isArray(body) ? body : (body as { nodes?: NodeUpdate[] })?.nodes;

    if (!Array.isArray(nodes) || nodes.length === 0) {
      return reply.code(400).send({ error: 'Expected array of node updates' });
    }

    const normalized = nodes.map(normalizeNodeUpdate).filter(Boolean) as NormalizedNodeUpdate[];
    if (normalized.length === 0) {
      return reply.code(204).send();
    }

    const db = getDb();
    const fileIds = [...new Set(normalized.flatMap((node) => (node.fileId ? [node.fileId] : [])))];
    const folderIds = [...new Set(normalized.flatMap((node) => (node.folderId ? [node.folderId] : [])))];
    const existingFileIds = getExistingIds(db, 'files', fileIds);
    const existingFolderIds = getExistingIds(db, 'folders', folderIds);

    const upsert = db.prepare(`
      INSERT INTO canvas_nodes (id, file_id, folder_id, canvas_id, x, y, width, height, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET
        file_id = excluded.file_id,
        folder_id = excluded.folder_id,
        canvas_id = excluded.canvas_id,
        x = excluded.x,
        y = excluded.y,
        width = excluded.width,
        height = excluded.height,
        updated_at = CURRENT_TIMESTAMP
    `);

    const batchUpsert = db.transaction((updates: NormalizedNodeUpdate[]) => {
      for (const n of updates) {
        if (n.fileId && !existingFileIds.has(n.fileId)) continue;
        if (n.folderId && !existingFolderIds.has(n.folderId)) continue;

        upsert.run(n.id, n.fileId, n.folderId, n.canvasId, n.x, n.y, n.width, n.height);
      }
    });

    batchUpsert(normalized);

    return reply.code(204).send();
  });

  // GET /api/canvas/:canvasId/nodes - load all node positions for a canvas
  fastify.get('/api/canvas/:canvasId/nodes', async (req: FastifyRequest, reply: FastifyReply) => {
    const { canvasId } = req.params as { canvasId: string };
    const db = getDb();

    const nodes = db.prepare(`
      SELECT cn.id, cn.file_id, cn.folder_id, cn.canvas_id, cn.x, cn.y, cn.width, cn.height
      FROM canvas_nodes cn
      WHERE cn.canvas_id = ?
    `).all(canvasId) as Array<{
      id: string;
      file_id: string | null;
      folder_id: string | null;
      canvas_id: string;
      x: number;
      y: number;
      width: number;
      height: number;
    }>;

    return reply.send(nodes);
  });
}
