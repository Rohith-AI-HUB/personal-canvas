import path from 'path';
import fs from 'fs';
import sharp from 'sharp';
import { PDFParse } from 'pdf-parse';
import { THUMBNAILS_DIR } from './storage.js';
import type { FileType } from './fileTypes.js';

const THUMB_WIDTH = 300;
const THUMB_HEIGHT = 200;

/**
 * Generate a thumbnail for a given file.
 * Returns the absolute path to the saved thumbnail, or null if generation failed.
 * All failures are non-fatal so upload can proceed.
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
        return generateSvgPlaceholder(thumbPath, '#2980b9', 'AUDIO', 'A');
      case 'code':
        return generateSvgPlaceholder(thumbPath, '#27ae60', 'CODE', '{}');
      case 'text':
        return generateSvgPlaceholder(thumbPath, '#34495e', 'TEXT', 'T');
      default:
        return generateSvgPlaceholder(thumbPath, '#95a5a6', 'FILE', 'F');
    }
  } catch (err) {
    console.error(`Thumbnail generation failed for ${fileId} (${fileType}):`, err);
    return null;
  }
}

async function generateImageThumbnail(src: string, dest: string): Promise<string> {
  await sharp(src)
    .resize(THUMB_WIDTH, THUMB_HEIGHT, { fit: 'cover', position: 'centre' })
    .webp({ quality: 80 })
    .toFile(dest);
  return dest;
}

// Phase 1: placeholder card with page-count info.
async function generatePdfThumbnail(pdfPath: string, dest: string): Promise<string | null> {
  let parser: PDFParse | null = null;

  try {
    const data = fs.readFileSync(pdfPath);
    parser = new PDFParse({ data });
    const info = await parser.getInfo();
    const pageCount = info.total;

    return generateSvgPlaceholder(
      dest,
      '#e74c3c',
      'PDF',
      'PDF',
      pageCount > 0 ? `${pageCount} page${pageCount !== 1 ? 's' : ''}` : undefined
    );
  } catch {
    return generateSvgPlaceholder(dest, '#e74c3c', 'PDF', 'PDF');
  } finally {
    if (parser) {
      await parser.destroy().catch(() => {});
    }
  }
}

async function generateVideoThumbnail(
  videoPath: string,
  dest: string,
  fileId: string
): Promise<string | null> {
  const tempFrame = path.join(THUMBNAILS_DIR, `${fileId}_frame.png`);

  try {
    const { execa } = await import('execa');

    const probe = await execa('ffprobe', [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_format',
      videoPath,
    ]);
    const info = JSON.parse(probe.stdout) as { format?: { duration?: string } };
    const duration = parseFloat(info.format?.duration ?? '10');
    const seekTime = Math.max(0, Math.floor(duration * 0.1));

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

    fs.unlink(tempFrame, () => {});
    return dest;
  } catch (err) {
    fs.unlink(tempFrame, () => {});
    console.warn(`Video frame extraction failed for ${fileId}:`, (err as Error).message);
    return generateSvgPlaceholder(dest, '#8e44ad', 'VIDEO', 'V');
  }
}

async function generateSvgPlaceholder(
  dest: string,
  bgColor: string,
  label: string,
  icon: string,
  subtitle?: string
): Promise<string> {
  const subtitleEl = subtitle
    ? `<text x="150" y="145" font-family="Arial, sans-serif" font-size="13" fill="rgba(255,255,255,0.7)" text-anchor="middle">${subtitle}</text>`
    : '';

  const svg = `
    <svg width="${THUMB_WIDTH}" height="${THUMB_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${THUMB_WIDTH}" height="${THUMB_HEIGHT}" fill="${bgColor}" rx="8"/>
      <text x="150" y="90" font-family="Arial, sans-serif" font-size="32" text-anchor="middle" dominant-baseline="middle">${icon}</text>
      <text x="150" y="125" font-family="Arial, sans-serif" font-size="14" font-weight="bold" fill="rgba(255,255,255,0.85)" text-anchor="middle" letter-spacing="2">${label}</text>
      ${subtitleEl}
    </svg>
  `.trim();

  await sharp(Buffer.from(svg))
    .resize(THUMB_WIDTH, THUMB_HEIGHT)
    .webp({ quality: 85 })
    .toFile(dest);

  return dest;
}
