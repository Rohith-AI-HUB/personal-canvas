import PQueue from 'p-queue';
import { getDb } from '../services/sqlite.js';
import { extractContent } from '../services/extraction.js';
import { getAIMetadata } from '../services/groq.js';
import type { FileRecord } from '../types.js';

// ─────────────────────────────────────────────
// Queue — single-concurrency, throttled to Groq free tier limits
// 1 job per 2.5 seconds = ~24 files/minute, comfortably under free tier
// ─────────────────────────────────────────────
const ingestQueue = new PQueue({
  concurrency: 1,
  intervalCap: 1,
  interval: 2500,
});

// ─────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────

/**
 * Enqueue a file for AI ingest.
 * Safe to call multiple times with the same file — queue will process it once.
 */
export function enqueueFile(file: FileRecord): void {
  ingestQueue.add(() => runIngestPipeline(file));
}

/**
 * On every app boot:
 * 1. Reset any file stuck in 'processing' (crash during previous run)
 * 2. Re-enqueue all 'pending' files with retry_count < 3
 */
export function recoverPendingJobs(): void {
  const db = getDb();

  // Files left as 'processing' mean the app crashed mid-ingest
  db.prepare(`
    UPDATE files SET status = 'pending', updated_at = CURRENT_TIMESTAMP
    WHERE status = 'processing'
  `).run();

  const pending = db.prepare(`
    SELECT id, filename, original_path, storage_path, thumbnail_path,
           file_type, file_size, mime_type, content_hash, status,
           retry_count, error_message, created_at, updated_at
    FROM files
    WHERE status = 'pending' AND retry_count < 3
  `).all() as FileRecord[];

  if (pending.length > 0) {
    console.log(`[ingestQueue] Recovering ${pending.length} pending job(s) from previous session`);
    for (const file of pending) {
      enqueueFile(file);
    }
  }
}

export function getQueueSize(): number {
  return ingestQueue.size + ingestQueue.pending;
}

// ─────────────────────────────────────────────
// Core Pipeline
// Status state machine:  pending → processing → complete
//                                            ↘ error (retry_count++)
// Files with retry_count >= 3 are permanently error.
// ─────────────────────────────────────────────
async function runIngestPipeline(file: FileRecord): Promise<void> {
  const db = getDb();

  // Mark as processing
  db.prepare(`
    UPDATE files SET status = 'processing', updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(file.id);

  try {
    // Step 1: Extract content (text, OCR, transcript, code summary)
    const extraction = await extractContent(file);

    // Step 2: Get AI-generated title, summary, category, tags
    const aiMeta = await getAIMetadata(file.filename, extraction.content);

    // Use filename as title fallback if AI returned empty
    const title = aiMeta.title || file.filename;

    // Step 3: Persist metadata to SQLite
    const upsertMetadata = db.prepare(`
      INSERT INTO file_metadata
        (file_id, ai_title, ai_summary, ai_category, extracted_text, word_count, language, processed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(file_id) DO UPDATE SET
        ai_title       = excluded.ai_title,
        ai_summary     = excluded.ai_summary,
        ai_category    = excluded.ai_category,
        extracted_text = excluded.extracted_text,
        word_count     = excluded.word_count,
        language       = excluded.language,
        processed_at   = CURRENT_TIMESTAMP
    `);

    const insertTags = db.prepare(`
      INSERT INTO tags (file_id, tag, source) VALUES (?, ?, 'ai')
    `);

    // Contentless FTS5 doesn't support ON CONFLICT — must DELETE then INSERT
    const deleteFts = db.prepare(`DELETE FROM files_fts WHERE file_id = ?`);
    const insertFts = db.prepare(`
      INSERT INTO files_fts
        (file_id, filename, ai_title, ai_summary, ai_category, tags, extracted_text)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const markComplete = db.prepare(`
      UPDATE files SET status = 'complete', updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);

    // All SQLite writes in one transaction for atomicity
    db.transaction(() => {
      upsertMetadata.run(
        file.id,
        title,
        aiMeta.summary,
        aiMeta.category,
        extraction.content.slice(0, 100_000), // cap stored text at 100k chars
        extraction.wordCount,
        extraction.language
      );

      // Clear old AI tags before inserting new ones
      db.prepare(`DELETE FROM tags WHERE file_id = ? AND source = 'ai'`).run(file.id);
      for (const tag of aiMeta.tags) {
        insertTags.run(file.id, tag);
      }

      // Contentless FTS5: delete existing row first, then re-insert
      deleteFts.run(file.id);
      insertFts.run(
        file.id,
        file.filename,
        title,
        aiMeta.summary,
        aiMeta.category,
        aiMeta.tags.join(' '),
        extraction.content.slice(0, 50_000) // FTS needs less than full text
      );

      markComplete.run(file.id);
    })();

    console.log(`[ingestQueue] ✓ ${file.filename} (${file.file_type}) → "${title}"`);

    // Phase 3 hook: embeddings + Qdrant upsert will be added here

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[ingestQueue] ✗ ${file.filename}:`, message);

    // State machine: increment retry_count; if >= 3 → permanent error
    db.prepare(`
      UPDATE files
      SET
        status        = CASE WHEN retry_count + 1 >= 3 THEN 'error' ELSE 'pending' END,
        retry_count   = retry_count + 1,
        error_message = ?,
        updated_at    = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(message, file.id);
  }
}
