import { createHash } from 'crypto';
import { createReadStream } from 'fs';

/**
 * Compute SHA-256 hash of a file via streaming.
 * Used for deduplication — if hash exists in DB, skip ingest entirely.
 */
export async function hashFile(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}
