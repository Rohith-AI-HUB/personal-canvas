import path from 'path';
import fs from 'fs';
import sharp from 'sharp';
import { THUMBNAILS_DIR } from './storage.js';
import type { FileType } from './fileTypes.js';
import pdfParse from 'pdf-parse';

const THUMB_WIDTH = 300;
const THUMB_HEIGHT = 200;

/**
 * Generate a thumbnail for a given file.
 * Returns the absolute path to the saved thumbnail, or null if generation failed.
 * All failures are non-fatal — the file card will show a placeholder icon instead.
 */
export async function generateThumbnail(
  filePath: string,
  fileId: string,
  fileType: FileType
): Promise<string | null> {
  const thumbPath = path.join(THUMBNAILS_DIR, `${fileId}.webp`);

  try {
    switch (fileType) {
      case 'image':
        return await generateImageThumbnail(filePath, thumbPath);
      case 'pdf':
        return await generatePdfThumbnail(filePath, thumbPath);
      case 'video':
        return await generateVideoThumbnail(filePath, thumbPath, fileId);
      case 'audio':
        return generateSvgPlaceholder(thumbPath, '#2980b9', 'AUDIO', '🎵');
      case 'code':
        return generateSvgPlaceholder(thumbPath, '#27ae60', 'CODE', '💻');
      case 'text':
        return generateSvgPlaceholder(thumbPath, '#34495e', 'TEXT', '📝');
      default:
        return generateSvgPlaceholder(thumbPath, '#95a5a6', 'FILE', '📁');
    }
  } catch (err) {
    console.error(`Thumbnail generation failed for ${fileId} (${fileType}):`, err);
    return null;
  }
}

// ── Image ──────────────────────────────────────────────────────────────────────

async function generateImageThumbnail(src: string, dest: string): Promise<string> {
  await sharp(src)
    .resize(THUMB_WIDTH, THUMB_HEIGHT, { fit: 'cover', position: 'centre' })
    .webp({ quality: 80 })
    .toFile(dest);
  return dest;
}

// ── PDF ────────────────────────────────────────────────────────────────────────
// Phase 1: SVG placeholder with page-count info.
// Phase 3+: Replace with pdfjs-dist + puppeteer/playwright headless renderer.
// We deliberately avoid node-canvas here — it requires native binaries and
// Visual Studio build tools on Windows, which is not worth the setup cost.

async function generatePdfThumbnail(pdfPath: string, dest: string): Promise<string | null> {
  try {
    // Try to extract page count from PDF for a slightly more informative placeholder
    const data = fs.readFileSync(pdfPath);
    const result = await pdfParse(data);
    const pageCount = result.numpages;

    return generateSvgPlaceholder(
      dest,
      '#e74c3c',
      'PDF',
      '📄',
      pageCount > 0 ? `${pageCount} page${pageCount !== 1 ? 's' : ''}` : undefined
    );
  } catch {
    return generateSvgPlaceholder(dest, '#e74c3c', 'PDF', '📄');
  }
}

// ── Video ──────────────────────────────────────────────────────────────────────

async function generateVideoThumbnail(
  videoPath: string,
  dest: string,
  fileId: string
): Promise<string | null> {
  const tempFrame = path.join(THUMBNAILS_DIR, `${fileId}_frame.png`);

  try {
    const { execa } = await import('execa');

    // Get duration via ffprobe
    const probe = await execa('ffprobe', [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_format',
      videoPath,
    ]);
    const info = JSON.parse(probe.stdout) as { format?: { duration?: string } };
    const duration = parseFloat(info.format?.duration ?? '10');
    const seekTime = Math.max(0, Math.floor(duration * 0.1));

    // Extract one frame
    await execa('ffmpeg', [
      '-ss', String(seekTime),
      '-i', videoPath,
      '-vframes', '1',
      '-q:v', '2',
      '-y',
      tempFrame,
    ]);

    await sharp(tempFrame)
      .resize(THUMB_WIDTH, THUMB_HEIGHT, { fit: 'cover', position: 'centre' })
      .webp({ quality: 80 })
      .toFile(dest);

    fs.unlink(tempFrame, () => { });
    return dest;
  } catch (err) {
    fs.unlink(tempFrame, () => { });
    // ffmpeg not installed or video unreadable — fall back to placeholder
    console.warn(`Video frame extraction failed for ${fileId}:`, (err as Error).message);
    return generateSvgPlaceholder(dest, '#8e44ad', 'VIDEO', '🎬');
  }
}

// ── SVG Placeholder ────────────────────────────────────────────────────────────

/**
 * Renders a colored SVG card as a WebP thumbnail.
 * Used for audio, code, text, PDF (Phase 1), and any unsupported type.
 */
async function generateSvgPlaceholder(
  dest: string,
  bgColor: string,
  label: string,
  icon: string,
  subtitle?: string
): Promise<string> {
  const subtitleEl = subtitle
    ? `<text x="150" y="145" font-family="Arial, sans-serif" font-size="13"
         fill="rgba(255,255,255,0.7)" text-anchor="middle">${subtitle}</text>`
    : '';

  const svg = `
    <svg width="${THUMB_WIDTH}" height="${THUMB_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${THUMB_WIDTH}" height="${THUMB_HEIGHT}" fill="${bgColor}" rx="8"/>
      <text x="150" y="90" font-family="Arial, sans-serif" font-size="44"
        text-anchor="middle" dominant-baseline="middle">${icon}</text>
      <text x="150" y="125" font-family="Arial, sans-serif" font-size="14"
        font-weight="bold" fill="rgba(255,255,255,0.85)" text-anchor="middle"
        letter-spacing="2">${label}</text>
      ${subtitleEl}
    </svg>
  `.trim();

  await sharp(Buffer.from(svg))
    .resize(THUMB_WIDTH, THUMB_HEIGHT)
    .webp({ quality: 85 })
    .toFile(dest);

  return dest;
}
