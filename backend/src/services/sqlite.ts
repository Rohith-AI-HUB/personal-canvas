import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.resolve(__dirname, '../../../storage/db/knowledge.sqlite');

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;

  // Ensure the directory exists
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

  db = new Database(DB_PATH);

  // P0: WAL mode must be first — prevents background ingest writes from blocking UI reads
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  db.pragma('cache_size = -32000'); // 32MB page cache

  initSchema(db);

  return db;
}

function initSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS files (
      id              TEXT PRIMARY KEY,
      filename        TEXT NOT NULL,
      original_path   TEXT,
      storage_path    TEXT NOT NULL,
      thumbnail_path  TEXT,
      file_type       TEXT NOT NULL,
      file_size       INTEGER,
      mime_type       TEXT,
      content_hash    TEXT UNIQUE,
      status          TEXT DEFAULT 'pending',
      retry_count     INTEGER DEFAULT 0,
      error_message   TEXT,
      created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS file_metadata (
      file_id         TEXT PRIMARY KEY REFERENCES files(id) ON DELETE CASCADE,
      ai_title        TEXT,
      ai_summary      TEXT,
      ai_category     TEXT,
      extracted_text  TEXT,
      word_count      INTEGER,
      language        TEXT,
      processed_at    DATETIME
    );

    CREATE TABLE IF NOT EXISTS tags (
      id      INTEGER PRIMARY KEY AUTOINCREMENT,
      file_id TEXT REFERENCES files(id) ON DELETE CASCADE,
      tag     TEXT NOT NULL,
      source  TEXT DEFAULT 'ai'
    );

    CREATE TABLE IF NOT EXISTS canvas_nodes (
      id          TEXT PRIMARY KEY,
      file_id     TEXT REFERENCES files(id) ON DELETE CASCADE,
      canvas_id   TEXT DEFAULT 'main',
      x           REAL NOT NULL DEFAULT 0,
      y           REAL NOT NULL DEFAULT 0,
      width       REAL NOT NULL DEFAULT 200,
      height      REAL NOT NULL DEFAULT 250,
      updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS chat_messages (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id  TEXT NOT NULL,
      role        TEXT NOT NULL,
      content     TEXT NOT NULL,
      citations   TEXT,
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS files_fts USING fts5(
      file_id UNINDEXED,
      filename,
      ai_title,
      ai_summary,
      ai_category,
      tags,
      extracted_text,
      content='',
      contentless_delete=1
    );

    CREATE INDEX IF NOT EXISTS idx_files_status ON files(status);
    CREATE INDEX IF NOT EXISTS idx_files_hash ON files(content_hash);
    CREATE INDEX IF NOT EXISTS idx_tags_file_id ON tags(file_id);
    CREATE INDEX IF NOT EXISTS idx_canvas_file_id ON canvas_nodes(file_id);
    CREATE INDEX IF NOT EXISTS idx_chat_session ON chat_messages(session_id);
  `);
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
