import path from 'path';
import fs from 'fs';
import sharp from 'sharp';
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
        return generateAudioThumbnail(filePath, thumbPath);
      case 'code':
        return generateCodeThumbnail(filePath, thumbPath);
      case 'text':
        return generateTextThumbnail(filePath, thumbPath);
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

/**
 * Real PDF thumbnail: render page 1 in-process via pdfjs-dist + canvas.
 * Falls back to pdftoppm (Poppler) if available, then to styled SVG placeholder.
 *
 * Priority: pdfjs-dist (in-process) → pdftoppm (Poppler) → SVG fallback
 */
async function generatePdfThumbnail(pdfPath: string, dest: string): Promise<string | null> {
  // ── Attempt 1: in-process render via pdfjs-dist + canvas npm package ──────
  try {
    return await renderPdfWithPdfjs(pdfPath, dest);
  } catch (err) {
    console.warn(`[thumbnails] pdfjs render failed (${path.basename(pdfPath)}):`, (err as Error).message);
  }

  // ── Attempt 2: pdftoppm (Poppler) ────────────────────────────────────────
  const tempPrefix = dest.replace(/\.webp$/, '_pdfframe');
  const tempPng    = `${tempPrefix}-1.png`;
  try {
    const { execa } = await import('execa');
    await execa('pdftoppm', [
      '-r', '150', '-singlefile', '-png', '-f', '1', '-l', '1',
      pdfPath, tempPrefix,
    ]);
    if (!fs.existsSync(tempPng)) throw new Error('pdftoppm produced no output');
    await sharp(tempPng)
      .resize(THUMB_WIDTH, THUMB_HEIGHT, { fit: 'cover', position: 'top' })
      .webp({ quality: 82 })
      .toFile(dest);
    fs.unlink(tempPng, () => {});
    return dest;
  } catch (err) {
    fs.unlink(tempPng, () => {});
    const msg = (err as Error).message ?? '';
    if (!msg.includes('ENOENT') && !msg.includes('not found')) {
      console.warn(`[thumbnails] pdftoppm failed (${path.basename(pdfPath)}):`, msg);
    }
  }

  // ── Attempt 3: styled SVG placeholder ────────────────────────────────────
  return generatePdfSvgFallback(dest, pdfPath);
}

/**
 * Render page 1 of a PDF entirely in-process using pdfjs-dist (legacy build)
 * and the `canvas` npm package as the rendering backend.
 *
 * This avoids any native binary dependency (Poppler) and works cross-platform.
 */
async function renderPdfWithPdfjs(pdfPath: string, dest: string): Promise<string> {
  const { createCanvas } = await import('canvas');
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');

  // Disable worker — we're running synchronously in Node
  pdfjs.GlobalWorkerOptions.workerSrc = '';

  const data = new Uint8Array(fs.readFileSync(pdfPath));
  const loadingTask = pdfjs.getDocument({
    data,
    // Suppress non-fatal font/cmap warnings
    verbosity: 0,
  } as any);

  // 15-second timeout to prevent hanging on corrupt/large PDFs
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('pdfjs render timeout')), 15_000)
  );
  const pdfDoc = await Promise.race([loadingTask.promise, timeoutPromise]);
  const page = await pdfDoc.getPage(1);

  // Scale to give us roughly THUMB_WIDTH pixels wide at 96dpi equivalent
  const viewport = page.getViewport({ scale: 1.0 });
  const scale = THUMB_WIDTH / viewport.width;
  const scaledViewport = page.getViewport({ scale });

  const canvasWidth  = Math.round(scaledViewport.width);
  const canvasHeight = Math.round(scaledViewport.height);

  const canvasEl = createCanvas(canvasWidth, canvasHeight);
  const ctx = canvasEl.getContext('2d') as unknown as CanvasRenderingContext2D;

  // White background (PDFs are transparent by default)
  (ctx as any).fillStyle = '#ffffff';
  (ctx as any).fillRect(0, 0, canvasWidth, canvasHeight);

  await page.render({
    canvasContext: ctx as any,
    viewport: scaledViewport,
  } as any).promise;

  await pdfDoc.destroy();

  // Convert canvas PNG buffer → WebP thumbnail via sharp
  const pngBuffer = canvasEl.toBuffer('image/png');
  await sharp(pngBuffer)
    .resize(THUMB_WIDTH, THUMB_HEIGHT, { fit: 'cover', position: 'top' })
    .webp({ quality: 85 })
    .toFile(dest);

  return dest;
}

/**
 * Better-looking SVG fallback for PDFs — mimics a document page rather than
 * a generic colored box.
 */
async function generatePdfSvgFallback(dest: string, pdfPath: string): Promise<string> {
  let pageCount = 0;
  try {
    const pdfParse = await import('pdf-parse');
    const parseFn = (pdfParse as any).default ?? pdfParse;
    const data = fs.readFileSync(pdfPath);
    const result = await parseFn(data);
    pageCount = result.numpages ?? 0;
  } catch { /* ignore */ }

  const pageLine = pageCount > 0
    ? `<text x="80" y="170" font-family="Arial, sans-serif" font-size="11" fill="#9CA3AF" text-anchor="middle">${pageCount} page${pageCount !== 1 ? 's' : ''}</text>`
    : '';

  const svg = `
<svg width="${THUMB_WIDTH}" height="${THUMB_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <!-- Background -->
  <rect width="${THUMB_WIDTH}" height="${THUMB_HEIGHT}" fill="#FFF5F5" rx="6"/>
  <!-- Document shadow -->
  <rect x="62" y="28" width="118" height="154" rx="5" fill="rgba(0,0,0,0.08)"/>
  <!-- Document page -->
  <rect x="58" y="24" width="118" height="154" rx="5" fill="#FFFFFF" stroke="#FECACA" stroke-width="1.5"/>
  <!-- Fold corner -->
  <polygon points="148,24 176,52 148,52" fill="#FEE2E2"/>
  <path d="M148,24 L176,52" stroke="#FECACA" stroke-width="1.5"/>
  <!-- Text lines -->
  <rect x="70" y="64" width="68" height="5" rx="2" fill="#FCA5A5"/>
  <rect x="70" y="80" width="88" height="4" rx="2" fill="#FECACA"/>
  <rect x="70" y="92" width="82" height="4" rx="2" fill="#FECACA"/>
  <rect x="70" y="104" width="74" height="4" rx="2" fill="#FECACA"/>
  <rect x="70" y="116" width="86" height="4" rx="2" fill="#FECACA"/>
  <rect x="70" y="128" width="60" height="4" rx="2" fill="#FECACA"/>
  <!-- PDF label -->
  <rect x="70" y="144" width="32" height="15" rx="3" fill="#EF4444"/>
  <text x="86" y="155" font-family="Arial, sans-serif" font-size="8" font-weight="bold" fill="white" text-anchor="middle">PDF</text>
  <!-- Page count -->
  ${pageLine}
</svg>`.trim();

  await sharp(Buffer.from(svg))
    .resize(THUMB_WIDTH, THUMB_HEIGHT)
    .webp({ quality: 85 })
    .toFile(dest);

  return dest;
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

function generateAudioThumbnail(_filePath: string, dest: string): Promise<string> {
  return generateSvgPlaceholder(dest, '#0A8FA4', 'AUDIO', '🎵');
}

function generateCodeThumbnail(_filePath: string, dest: string): Promise<string> {
  return generateSvgPlaceholder(dest, '#1A9460', 'CODE', '{ }');
}

function generateTextThumbnail(_filePath: string, dest: string): Promise<string> {
  return generateSvgPlaceholder(dest, '#4D4BB8', 'TEXT', '📄');
}
