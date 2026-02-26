import 'dotenv/config';
import { v5 as uuidv5 } from 'uuid';

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434';
const EMBED_MODEL = 'nomic-embed-text';
const CHUNK_NAMESPACE = uuidv5('personal-canvas-chunks', uuidv5.DNS);

type OllamaEmbedResponse = {
  embeddings?: number[][];
  embedding?: number[];
};

export async function embedText(text: string): Promise<number[]> {
  const input = text.trim();
  if (!input) {
    throw new Error('embedText requires non-empty text');
  }

  const body = {
    model: EMBED_MODEL,
    input,
  };

  const response = await fetch(`${OLLAMA_BASE_URL}/api/embed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });

  if (!response.ok) {
    throw new Error(`Ollama embed failed: ${response.status}`);
  }

  const data = (await response.json()) as OllamaEmbedResponse;
  const embedding =
    data.embeddings?.[0] ??
    data.embedding;

  if (!embedding || embedding.length === 0) {
    throw new Error('Ollama embed returned empty vector');
  }

  return embedding;
}

export function chunkText(text: string, chunkSize = 500, overlap = 50): string[] {
  const tokens = text
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (tokens.length === 0) return [];

  const chunks: string[] = [];
  const step = Math.max(1, chunkSize - overlap);

  for (let start = 0; start < tokens.length; start += step) {
    const slice = tokens.slice(start, start + chunkSize);
    if (slice.length < 100) continue;
    chunks.push(slice.join(' '));
  }

  return chunks;
}

export function chunkPointId(fileId: string, chunkIndex: number): string {
  return uuidv5(`${fileId}:${chunkIndex}`, CHUNK_NAMESPACE);
}
