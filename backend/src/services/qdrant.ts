import 'dotenv/config';
import { QdrantClient } from '@qdrant/js-client-rest';
import { chunkPointId } from './embeddings.js';

const QDRANT_URL = process.env.QDRANT_URL ?? 'http://127.0.0.1:6333';
const COLLECTION = 'knowledge_base';
const VECTOR_SIZE = 768;

const qdrant = new QdrantClient({ url: QDRANT_URL, timeout: 5000 });

export interface ChunkPayload {
  file_id: string;
  chunk_index: number;
  text: string;
  filename?: string;
  file_type?: string;
  ai_title?: string | null;
  ai_category?: string | null;
  tags?: string[];
}

export interface ScoredChunk {
  point_id: string;
  file_id: string;
  text: string;
  score: number;
  payload: Record<string, unknown>;
}

export async function ensureCollection(): Promise<void> {
  const exists = await qdrant.collectionExists(COLLECTION);
  if (exists.exists) return;

  await qdrant.createCollection(COLLECTION, {
    vectors: {
      size: VECTOR_SIZE,
      distance: 'Cosine',
    },
  });
}

export async function upsertChunks(
  fileId: string,
  chunks: string[],
  embeddings: number[][],
  payload: Omit<ChunkPayload, 'file_id' | 'chunk_index' | 'text'>
): Promise<void> {
  if (chunks.length !== embeddings.length) {
    throw new Error(`Chunk/vector mismatch: ${chunks.length} chunks vs ${embeddings.length} vectors`);
  }

  if (chunks.length === 0) return;

  const points = chunks.map((chunk, chunkIndex) => ({
    id: chunkPointId(fileId, chunkIndex),
    vector: embeddings[chunkIndex],
    payload: {
      file_id: fileId,
      chunk_index: chunkIndex,
      text: chunk,
      ...payload,
    },
  }));

  await qdrant.upsert(COLLECTION, {
    wait: true,
    points,
  });
}

export async function searchChunks(queryEmbedding: number[], topN = 20): Promise<ScoredChunk[]> {
  const results = await qdrant.search(COLLECTION, {
    vector: queryEmbedding,
    limit: topN,
    with_payload: true,
    with_vector: false,
  });

  return results.map((point) => {
    const payload = (point.payload ?? {}) as Record<string, unknown>;
    return {
      point_id: String(point.id),
      file_id: String(payload.file_id ?? ''),
      text: String(payload.text ?? ''),
      score: Number(point.score ?? 0),
      payload,
    };
  }).filter((row) => row.file_id);
}

export async function deleteByFileId(fileId: string): Promise<void> {
  await qdrant.delete(COLLECTION, {
    wait: true,
    filter: {
      must: [
        {
          key: 'file_id',
          match: { value: fileId },
        },
      ],
    },
  });
}

