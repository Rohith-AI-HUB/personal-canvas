import fs from 'fs/promises';
import path from 'path';
import { execa } from 'execa';
import os from 'os';
import type { FileRecord } from '../types.js';
import type { FileType } from './fileTypes.js';
import { transcribeAudio } from './groq.js';
import { summarizeCode, extractCodeSymbols } from './deepseek.js';

// ─────────────────────────────────────────────
// Exported shape for extraction results
// ─────────────────────────────────────────────
export interface ExtractionResult {
  content: string;          // primary text for AI tagging + embedding
  wordCount: number;
  language: string | null;
  codeSymbols?: string[];   // only for code files
}

// ─────────────────────────────────────────────
// Dispatcher — routes by file type
// ─────────────────────────────────────────────
export async function extractContent(file: FileRecord): Promise<ExtractionResult> {
  const type = file.file_type as FileType;

  switch (type) {
    case 'pdf':    return extractPdf(file.storage_path);
    case 'image':  return extractImage(file.storage_path);
    case 'video':  return extractVideo(file.storage_path);
    case 'audio':  return extractAudio(file.storage_path);
    case 'code':   return extractCode(file.storage_path, file.filename);
    case 'text':   return extractText(file.storage_path);
    default:       return { content: file.filename, wordCount: 0, language: null };
  }
}

// ─────────────────────────────────────────────
// PDF — pdfjs-dist text layer; fallback to Tesseract OCR
// ─────────────────────────────────────────────
async function extractPdf(filePath: string): Promise<ExtractionResult> {
  try {
    // Dynamic import — pdfjs-dist is ESM and can be slow to load
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');

    const data = new Uint8Array(await fs.readFile(filePath));
    const doc = await pdfjs.getDocument({ data, verbosity: 0 }).promise;

    const pageTexts: string[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const text = content.items
        .map((item: unknown) => {
          const t = item as { str?: string };
          return t.str ?? '';
        })
        .join(' ');
      pageTexts.push(text);
    }

    const combined = pageTexts.join('\n').trim();

    // If the PDF has no selectable text (scanned doc), run OCR
    if (combined.length < 50) {
      return extractPdfOcr(filePath);
    }

    return {
      content: combined,
      wordCount: countWords(combined),
      language: null,
    };
  } catch (err) {
    console.error('[extraction] PDF failed, attempting OCR:', (err as Error).message);
    return extractPdfOcr(filePath);
  }
}

async function extractPdfOcr(filePath: string): Promise<ExtractionResult> {
  const tempBase = path.join(os.tmpdir(), `pc-pdf-${Date.now()}`);
  const firstPagePng = `${tempBase}.png`;

  try {
    // Render first PDF page to PNG using pdftoppm (part of poppler-utils).
    // Required system dependency: install with:
    //   Windows (via choco): choco install poppler
    //   macOS:               brew install poppler
    //   Ubuntu/Debian:       apt-get install poppler-utils
    // Falls back to empty content if poppler is not installed.
    await execa('pdftoppm', ['-f', '1', '-singlefile', '-png', filePath, tempBase]);
    return extractImageOcr(firstPagePng);
  } catch (err) {
    const msg = (err as Error).message ?? '';
    if (msg.includes('ENOENT') || msg.includes('not found') || msg.includes('not recognized')) {
      console.warn(
        '[extraction] PDF OCR skipped: pdftoppm not found. ' +
        'Install poppler-utils to enable OCR for scanned PDFs.'
      );
    } else {
      console.error('[extraction] PDF OCR fallback failed:', msg);
    }
    return { content: '', wordCount: 0, language: null };
  } finally {
    fs.unlink(firstPagePng).catch(() => {});
  }
}

// ─────────────────────────────────────────────
// Image — Tesseract.js OCR
// ─────────────────────────────────────────────
async function extractImage(filePath: string): Promise<ExtractionResult> {
  return extractImageOcr(filePath);
}

async function extractImageOcr(filePath: string): Promise<ExtractionResult> {
  let worker: Awaited<ReturnType<(typeof import('tesseract.js'))['createWorker']>> | null = null;

  // Validate file is readable and non-empty before passing to Tesseract.
  // A corrupted image will still fail inside the worker, but this eliminates
  // the trivial cases (0-byte files, missing files) without spinning up a worker.
  try {
    const stat = await fs.stat(filePath);
    if (stat.size === 0) {
      console.error('[extraction] OCR skipped: file is empty:', filePath);
      return { content: '', wordCount: 0, language: null };
    }
  } catch {
    console.error('[extraction] OCR skipped: file not accessible:', filePath);
    return { content: '', wordCount: 0, language: null };
  }

  try {
    const Tesseract = await import('tesseract.js');
    worker = await Tesseract.createWorker('eng');

    const { data } = await worker.recognize(filePath);

    const text = data.text.trim();

    return {
      content: text,
      wordCount: countWords(text),
      language: (data as any).script ?? null,
    };
  } catch (err) {
    console.error('[extraction] OCR failed:', (err as Error).message);
    return { content: '', wordCount: 0, language: null };
  } finally {
    if (worker) {
      await worker.terminate().catch(() => {});
    }
  }
}

// ─────────────────────────────────────────────
// Transcription size limit
// Auto-transcription is skipped for files larger than this threshold.
// Override via TRANSCRIPTION_MAX_MB in .env (default: 100 MB).
// Set to 0 to disable the limit entirely.
// ─────────────────────────────────────────────
function getMaxTranscriptionBytes(): number {
  const mb = parseFloat(process.env.TRANSCRIPTION_MAX_MB ?? '100');
  if (isNaN(mb) || mb <= 0) return Infinity;
  return mb * 1024 * 1024;
}

// ─────────────────────────────────────────────
// Video — ffmpeg audio extraction → Groq Whisper
// ─────────────────────────────────────────────
async function extractVideo(filePath: string): Promise<ExtractionResult> {
  // Check size limit before spinning up ffmpeg / Whisper
  try {
    const stat = await fs.stat(filePath);
    const maxBytes = getMaxTranscriptionBytes();
    if (stat.size > maxBytes) {
      const limitMb = Math.round(maxBytes / 1024 / 1024);
      console.warn(`[extraction] Video transcription skipped: file exceeds ${limitMb} MB limit (${Math.round(stat.size / 1024 / 1024)} MB). Set TRANSCRIPTION_MAX_MB in .env to raise the limit.`);
      return { content: '', wordCount: 0, language: null };
    }
  } catch { /* non-fatal — proceed and let downstream errors handle it */ }

  const tempAudio = path.join(os.tmpdir(), `pc-audio-${Date.now()}.wav`);

  try {
    // Extract audio track from video as 16kHz mono WAV (optimal for Whisper)
    await execa('ffmpeg', [
      '-i', filePath,
      '-vn',                   // no video
      '-ar', '16000',          // 16kHz
      '-ac', '1',              // mono
      '-f', 'wav',
      '-y',                    // overwrite
      tempAudio,
    ]);

    return await extractAudio(tempAudio);
  } catch (err) {
    console.error('[extraction] Video audio extraction failed:', (err as Error).message);
    return { content: '', wordCount: 0, language: null };
  } finally {
    fs.unlink(tempAudio).catch(() => {});
  }
}

// ─────────────────────────────────────────────
// Audio — Groq Whisper transcription
// ─────────────────────────────────────────────
async function extractAudio(filePath: string): Promise<ExtractionResult> {
  // Check size limit
  try {
    const stat = await fs.stat(filePath);
    const maxBytes = getMaxTranscriptionBytes();
    if (stat.size > maxBytes) {
      const limitMb = Math.round(maxBytes / 1024 / 1024);
      console.warn(`[extraction] Audio transcription skipped: file exceeds ${limitMb} MB limit (${Math.round(stat.size / 1024 / 1024)} MB). Set TRANSCRIPTION_MAX_MB in .env to raise the limit.`);
      return { content: '', wordCount: 0, language: null };
    }
  } catch { /* non-fatal */ }

  try {
    const transcript = await transcribeAudio(filePath);

    return {
      content: transcript,
      wordCount: countWords(transcript),
      language: null,
    };
  } catch (err) {
    console.error('[extraction] Audio transcription failed:', (err as Error).message);
    return { content: '', wordCount: 0, language: null };
  }
}

// ─────────────────────────────────────────────
// Code — Deepseek Coder functional summary + symbol extraction
// ─────────────────────────────────────────────
async function extractCode(filePath: string, filename: string): Promise<ExtractionResult> {
  let rawContent = '';
  try {
    rawContent = await fs.readFile(filePath, 'utf-8');
  } catch {
    return { content: '', wordCount: 0, language: null };
  }

  const [summary, symbols] = await Promise.all([
    summarizeCode(rawContent, filename),
    Promise.resolve(extractCodeSymbols(rawContent)),
  ]);

  // Combine summary + symbols + raw (truncated) for richer embeddings in Phase 3
  const symbolStr = symbols.length > 0 ? `Functions/classes: ${symbols.join(', ')}` : '';
  const content = [summary, symbolStr, rawContent.slice(0, 3000)]
    .filter(Boolean)
    .join('\n\n');

  return {
    content,
    wordCount: countWords(content),
    language: detectCodeLanguage(filename),
    codeSymbols: symbols,
  };
}

// ─────────────────────────────────────────────
// Text / Markdown / Notes
// ─────────────────────────────────────────────
async function extractText(filePath: string): Promise<ExtractionResult> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return {
      content: content.trim(),
      wordCount: countWords(content),
      language: null,
    };
  } catch (err) {
    console.error('[extraction] Text read failed:', (err as Error).message);
    return { content: '', wordCount: 0, language: null };
  }
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────
function countWords(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

function detectCodeLanguage(filename: string): string | null {
  const ext = filename.slice(filename.lastIndexOf('.')).toLowerCase();
  const langMap: Record<string, string> = {
    '.js': 'JavaScript', '.jsx': 'JavaScript',
    '.ts': 'TypeScript', '.tsx': 'TypeScript',
    '.py': 'Python', '.rb': 'Ruby', '.go': 'Go',
    '.rs': 'Rust', '.cpp': 'C++', '.c': 'C',
    '.cs': 'C#', '.java': 'Java', '.kt': 'Kotlin',
    '.swift': 'Swift', '.php': 'PHP',
    '.sh': 'Shell', '.bash': 'Shell',
    '.sql': 'SQL', '.html': 'HTML',
    '.css': 'CSS', '.scss': 'SCSS',
    '.vue': 'Vue', '.svelte': 'Svelte',
  };
  return langMap[ext] ?? null;
}
