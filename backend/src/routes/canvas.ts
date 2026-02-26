import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getDb } from '../services/sqlite.js';

interface NodeUpdate {
  id: string;       // tldraw shape ID
  fileId: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export async function canvasRoutes(fastify: FastifyInstance): Promise<void> {

  // POST /api/canvas/nodes — batch upsert node positions from tldraw onChange
  fastify.post('/api/canvas/nodes', async (req: FastifyRequest, reply: FastifyReply) => {
    const body = req.body as unknown;
    const nodes = Array.isArray(body) ? body : (body as { nodes?: NodeUpdate[] })?.nodes;

    if (!Array.isArray(nodes) || nodes.length === 0) {
      return reply.code(400).send({ error: 'Expected array of node updates' });
    }

    const db = getDb();

    const upsert = db.prepare(`
      INSERT INTO canvas_nodes (id, file_id, x, y, width, height, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET
        x = excluded.x,
        y = excluded.y,
        width = excluded.width,
        height = excluded.height,
        updated_at = CURRENT_TIMESTAMP
    `);

    const batchUpsert = db.transaction((updates: NodeUpdate[]) => {
      for (const n of updates) {
        upsert.run(n.id, n.fileId, n.x, n.y, n.width, n.height);
      }
    });

    batchUpsert(nodes);

    return reply.code(204).send();
  });
}
