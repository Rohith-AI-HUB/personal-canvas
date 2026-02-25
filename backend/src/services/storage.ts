import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const STORAGE_ROOT = path.resolve(__dirname, '../../../storage');
export const FILES_DIR = path.join(STORAGE_ROOT, 'files');
export const THUMBNAILS_DIR = path.join(STORAGE_ROOT, 'thumbnails');

/**
 * Ensure all storage directories exist. Call on server startup.
 */
export function ensureStorageDirs(): void {
  fs.mkdirSync(FILES_DIR, { recursive: true });
  fs.mkdirSync(THUMBNAILS_DIR, { recursive: true });
  fs.mkdirSync(path.join(STORAGE_ROOT, 'db'), { recursive: true });
}

/**
 * Copy an uploaded temp file into permanent storage.
 * Returns the final absolute path.
 */
export async function saveFile(
  tempPath: string,
  fileId: string,
  originalName: string
): Promise<string> {
  const ext = path.extname(originalName);
  const safeName = `${fileId}${ext}`;
  const destPath = path.join(FILES_DIR, safeName);

  await fs.promises.copyFile(tempPath, destPath);

  return destPath;
}

/**
 * Delete a file and its thumbnail from disk.
 * Non-throwing — logs errors but does not propagate.
 */
export async function deleteFileFromDisk(
  storagePath: string,
  thumbnailPath: string | null
): Promise<void> {
  const remove = async (p: string) => {
    try {
      await fs.promises.unlink(p);
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.error(`Failed to delete ${p}:`, err);
      }
    }
  };

  await remove(storagePath);
  if (thumbnailPath) await remove(thumbnailPath);
}
