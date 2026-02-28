# Personal AI Knowledge Canvas — TODO

> Tasks are ordered by build phase. Complete Phase 1 entirely before moving to Phase 2.
> P0 = blocking, must be done first | P1 = required for phase | P2 = important but not blocking

---

## Phase 1 — Foundation (File Drop → Canvas) ✅ COMPLETE

### Project Setup
- [x] Run `npm init -y` in `/backend` and configure `package.json` with `"type": "module"`
- [x] Run `npm create vite@latest frontend -- --template react-ts` in project root
- [x] Run `cargo tauri init` in project root to scaffold `/src-tauri`
- [x] Install backend dependencies: `fastify`, `better-sqlite3`, `uuid`, `sharp`, `p-queue`, `@types/better-sqlite3`, `pdfjs-dist`, `execa`, `groq-sdk`, `dotenv`
- [x] Install frontend dependencies: `tldraw`, `axios`
- [x] Install dev dependencies in backend: `typescript`, `tsx`, `@types/node`
- [x] Create `tsconfig.json` in `/backend`
- [x] Create `tsconfig.json` in `/frontend` (Vite does this automatically)
- [x] Add `.gitignore`
- [x] **VERIFIED**: Backend builds correctly via `npm run build` (tsc)
- [x] **VERIFIED**: Frontend builds correctly via `npm run build` (vite build)
- [ ] Configure `tauri.conf.json` — allow `http` for localhost, declare `/storage` path in allowlist *(defer: not needed until Tauri packaging)*

### Backend — SQLite (P0)
- [x] Create `/backend/src/services/sqlite.ts`
- [x] Write schema: `files`, `file_metadata`, `tags`, `canvas_nodes`, `chat_messages`, `files_fts`
- [x] Enable WAL mode on init: `PRAGMA journal_mode = WAL`, `synchronous = NORMAL`, `foreign_keys = ON`
- [x] Export `getDb()` singleton function
- [x] **VERIFIED**: WAL files (`.sqlite-wal`, `.sqlite-shm`) confirmed present in `/storage/db`

### Backend — File Deduplication (P0)
- [x] Create `/backend/src/services/dedup.ts`
- [x] Implement `hashFile(filePath): Promise<string>` using SHA-256 stream hashing
- [x] **VERIFIED**: Re-uploading same file returns `{ duplicate: true }` — no duplicate record created

### Backend — File Storage
- [x] Create `/backend/src/services/storage.ts`
- [x] Implement `saveFile(sourcePath, fileId, originalName): Promise<string>`
- [x] Ensure `/storage/files` and `/storage/thumbnails` directories exist on startup

### Backend — File Type Detection
- [x] Create `/backend/src/services/fileTypes.ts`
- [x] **VERIFIED**: `.py`, `.ts`, `.sh`, `.json` → `code`; `.txt`, `.md`, `.csv` → `text`; `.pdf` → `pdf`

### Backend — Thumbnail Generation
- [x] Create `/backend/src/services/thumbnails.ts`
- [x] Image thumbnails via `sharp` (resize to 300×200, WebP output)
- [x] PDF: page count via `pdfjs-dist` + SVG placeholder (full render deferred to Phase 5)
- [x] Video: ffmpeg frame extraction at 10% duration, fallback to SVG placeholder
- [x] Audio, code, text, other: colored SVG placeholders with emoji icons
- [x] **VERIFIED**: All 7 test file types generate thumbnails on disk

### Backend — File Upload Route
- [x] Create `/backend/src/routes/files.ts`
- [x] `POST /api/files` — multipart upload, hash, dedup, save, thumbnail, SQLite insert
- [x] `GET /api/files` — all files with metadata, tags, canvas node
- [x] `GET /api/files/:id` — single file record
- [x] `GET /api/files/:id/status` — lightweight status poll
- [x] `DELETE /api/files/:id` — disk delete, cascade SQLite delete, thumbnail delete
- [x] `GET /api/thumbnail?path=...` — secure thumbnail serving (path-traversal guard)
- [x] **VERIFIED**: All endpoints return correct HTTP status codes and response shapes

### Backend — Server Bootstrap
- [x] Create `/backend/src/server.ts`
- [x] Fastify with `@fastify/multipart` (500MB limit) and `@fastify/cors`
- [x] CORS configured for `http://localhost:5173`, `tauri://localhost`, `https://tauri.localhost`
- [x] Routes registered: `fileRoutes`, `canvasRoutes`
- [x] SQLite initialized and storage dirs created on startup
- [x] Graceful shutdown on `SIGINT`/`SIGTERM`

### Backend — Canvas Route
- [x] Create `/backend/src/routes/canvas.ts`
- [x] `POST /api/canvas/nodes` — batch upsert in a single SQLite transaction
- [x] **VERIFIED**: Node at `x=123.5, y=456.7` saved and restored correctly via `GET /api/files/:id`

### Frontend — Canvas Setup
- [x] Create `/frontend/src/components/Canvas.tsx`
- [x] `<Tldraw />` mounted full-screen with custom shape utils
- [x] Define custom `FileCardShape` type for tldraw
- [x] `FileCard.tsx` — renders thumbnail (WebP via backend), filename/AI title, file type chip, status badge, tag chips, summary
- [x] On app load: `GET /api/files` → restores all file cards to saved canvas positions

### Frontend — File Drop
- [x] OS drag-and-drop wired via `onDrop` on canvas wrapper div
- [x] Screen → canvas coordinate conversion via `editor.screenToPage()`
- [x] Multiple files offset horizontally on drop (220px per file)
- [x] `POST /api/files` on drop; duplicate files skipped silently
- [x] FileCardShape created at drop point immediately after upload

### Frontend — Canvas State Persistence
- [x] `editor.store.listen()` with `{ source: 'user', scope: 'document' }` — excludes camera changes
- [x] Filters to shapes with `meta.fileId` only
- [x] Debounced 2 seconds before `POST /api/canvas/nodes`
- [x] **VERIFIED**: Position persistence round-trip confirmed

### Frontend — Processing State (Polling)
- [x] `GET /api/files/:id/status` polled every 3 seconds for `pending`/`processing` files
- [x] Poll stops on `complete` or `error`
- [x] Shape re-rendered on status change via `fileStore` map + `editor.updateShape()`
- [x] Status badges: ⏳ pending, ⚙️ processing, ⚠️ error

### Phase 1 Done Criteria — ALL MET ✅
- [x] Upload 7 mixed-type files → all show thumbnails on canvas (test: 21/21 pass)
- [x] Re-upload same file → `duplicate: true`, no second record created
- [x] Canvas node positions persisted and restored correctly
- [x] SQLite WAL files present, concurrent read/write safe
- [x] DELETE removes file from disk, SQLite, and thumbnail

---

## Phase 2 — AI Ingest Pipeline ✅ COMPLETE

### Groq Integration
- [x] Create `/backend/src/services/groq.ts`
- [x] Implement `getAIMetadata(fileType, content): Promise<AIMetadata>` using `llama-3.1-70b-versatile`
- [x] Use JSON mode / response_format enforcement
- [x] Wrap JSON parse in try/catch with fallback schema (title=filename, summary=null, tags=[], category='Other')
- [x] Implement `transcribeAudio(audioPath): Promise<string>` using Groq Whisper API (`whisper-large-v3-turbo`)
- [x] Load `GROQ_API_KEY` from `.env` via `dotenv`

### Deepseek Coder Integration (Local via Ollama)
- [x] Create `/backend/src/services/deepseek.ts`
- [x] Implement `summarizeCode(content, filename): Promise<string>` via Ollama `deepseek-coder:1.3b`
- [x] Extract function/class names and top-level comments as structured metadata

### Content Extraction
- [x] Create `/backend/src/services/ingest.ts`
- [x] Implement `extractContent(file): Promise<string>` dispatcher by file type:
  - PDF: `pdfjs-dist` text extraction; fallback Tesseract.js OCR if no text layer
  - Image: Tesseract.js OCR + Groq short caption
  - Video: ffmpeg audio strip → Groq Whisper transcription
  - Audio: Groq Whisper transcription directly
  - Code: raw text → Deepseek Coder functional summary
  - Text/Markdown: read raw content directly

### Ingest Queue (P1)
- [x] Create `/backend/src/queue/ingestQueue.ts`
- [x] Configure `p-queue`: `concurrency: 1`, `intervalCap: 1`, `interval: 2500`
- [x] Implement `runIngestPipeline(file)` with full status state machine:
  - `pending → processing → complete`
  - `pending → processing → error` (increment `retry_count`, store `error_message`)
  - Files with `retry_count >= 3` permanently set to `error`
- [x] Implement `recoverPendingJobs()` — reset `processing → pending` on boot, re-enqueue `pending` with `retry_count < 3`
- [x] Call `recoverPendingJobs()` in `server.ts` on startup (after `getDb()`)
- [x] Export `enqueueFile(file)` for use in `POST /api/files` route

### Wire Queue into Upload Route
- [x] After SQLite insert in `POST /api/files`, call `enqueueFile(fileRecord)`
- [x] Add `POST /api/files/:id/retry` route — reset `retry_count = 0`, re-enqueue

### Frontend — AI Metadata Display
- [x] Show spinner animation on status badge while `status === 'processing'`
- [x] Error badge clickable → `POST /api/files/:id/retry`
- [x] On status → `complete`: fetch updated record, update `fileStore`, trigger shape re-render to show tags + summary

### Phase 2 Done Criteria
- [x] Drop a PDF → AI returns title, summary, category, tags within ~5 seconds
- [x] Drop a video → transcript generated, tags reflect content
- [x] Drop a code file → Deepseek Coder functional summary generated
- [x] Crash app mid-ingest → restart → file resumes automatically
- [x] Malformed AI response → `error` status, no crash, error badge shown

---

## Phase 3 — Semantic Search ✅ COMPLETE

### Qdrant Setup
- [x] Create `docker-compose.yml` in project root for Qdrant (port 6333, data in `/storage/db/qdrant`)
- [x] Create `/backend/src/services/qdrant.ts`
- [x] On startup: ensure `knowledge_base` collection exists (768 dimensions, Cosine distance)
- [x] `upsertChunks(fileId, chunks, embeddings, metadata)` with UUID v5 point IDs
- [x] `searchChunks(queryEmbedding, topN)` → `ScoredChunk[]`
- [x] `deleteByFileId(fileId)` — filter delete, call from DELETE route

### Embeddings
- [x] Create `/backend/src/services/embeddings.ts`
- [x] `embedText(text): Promise<number[]>` via Ollama `nomic-embed-text`
- [x] `chunkText(text, chunkSize=500, overlap=50): string[]` (skip chunks < 100 tokens)
- [x] `chunkPointId(fileId, chunkIndex): string` via UUID v5

### Wire Embeddings into Ingest
- [x] After AI tagging, chunk extracted content, embed, upsert to Qdrant
- [x] Update SQLite status to `complete` only after Qdrant upsert succeeds

### Search Backend
- [x] Create `/backend/src/routes/search.ts`
- [x] `GET /api/search?q=...`
- [x] SQLite FTS5 query fires immediately
- [x] In parallel: embed query → Qdrant vector search
- [x] Hybrid ranking: `(semantic × 0.6) + (keyword × 0.4)`, deduplicated by file ID

### Search Frontend
- [x] Create `/frontend/src/components/SearchBar.tsx`
- [x] 300ms debounce on input
- [x] Keyword results render immediately; semantic results merged when ready
- [x] Click result → `editor.zoomToFit([nodeId])` + brief highlight
- [x] Filter chips: file type, date range, category, tag

### Phase 3 Done Criteria
- [x] "neural networks" finds relevant files without that phrase in filename
- [x] Keyword results appear < 20ms
- [x] Clicking result navigates canvas to correct node
- [x] Deleting a file removes its Qdrant vectors

---

## Phase 4 — RAG Chat ✅ COMPLETE

### Ollama Chat Integration
- [x] Create `/backend/src/services/ollama.ts`
- [x] `streamChat(messages, onChunk): Promise<void>` via Ollama `gpt-oss-120b`
- [x] Forward chunks via Fastify SSE

### RAG Pipeline
- [x] Create `/backend/src/routes/chat.ts`
- [x] `POST /api/chat` → embed question → retrieve top 10 chunks → token-budget context assembly (max 6000 tokens) → system prompt + context + last 5 chat history → stream response
- [x] Store exchange in `chat_messages` with citations JSON

### Chat Frontend
- [x] Create `/frontend/src/components/ChatPanel.tsx` (collapsible sidebar)
- [x] Streaming text render
- [x] Citation chips → canvas navigation
- [x] Create `/frontend/src/hooks/useChat.ts`

### Phase 4 Done Criteria
- [x] "summarize everything I have on transformers" → cited answer from actual files
- [x] Citations clickable, navigate canvas to source file
- [x] 5+ turn conversation history maintained
- [x] Token budget prevents context overflow

---

## Pre-Phase-5 Bug Fixes ✅ COMPLETE

- [x] **BUG #1 (Critical)** `embeddings.ts:chunkText` — short files (< 100 tokens) produced zero chunks, silently leaving the file unindexed in Qdrant. Fixed: `minChunkTokens` now scales with total token count; short content emits a single merged chunk instead of nothing.
- [x] **BUG #2 (Critical)** `ingestQueue.ts:indexFileContent` — Qdrant vectors were deleted BEFORE embedding, so a Qdrant/Ollama failure mid-ingest destroyed existing vectors with no recovery path. Fixed: embed all chunks first, then delete, then upsert — existing vectors survive any failure.
- [x] **BUG #3 (Medium)** `extraction.ts:extractPdfOcr` — silent failure when `pdftoppm` (poppler) is not installed. Fixed: differentiated ENOENT (missing binary) from actual errors with a clear install instruction warning.
- [x] **BUG #4 (Medium)** `search.ts:ftsQuery` — multi-word queries only did per-token prefix search, dropping phrase intent. Fixed: multi-word queries now emit `"full phrase" OR "token1"* "token2"*`, giving FTS5 both precision (phrase) and recall (prefix).
- [x] **BUG #5 (Medium)** `chat.ts` — no guard on user message length; a 50k-character paste consumed the entire context budget. Fixed: messages truncated at 8000 chars (≈2000 tokens) with `[message truncated]` suffix.
- [x] **BUG #6 (Minor)** `sqlite.ts:migrateLegacyContentlessFts` — migration detection used fragile SQL string matching (`includes("content=''")`) that breaks on whitespace variants. Fixed: uses `PRAGMA table_info` on the FTS5 `_config` shadow table instead.
- [x] **BUG #7 (Minor)** `Canvas.tsx` — dual drop handlers (DOM `onDrop` + tldraw `registerExternalContentHandler`) caused media files to be intercepted by tldraw before custom handler could run. Fixed: all tldraw external handlers suppressed; DOM `onDrop` is the sole upload path. Sweep interval reduced from 1s to 5s.

---



- [ ] Canvas "snap to grid" helper
- [ ] Canvas "align selected nodes"
- [ ] Canvas "group selected" with label
- [ ] Clipboard paste support (screenshot → image file on canvas)
- [ ] Bulk folder import
- [ ] Manual re-analysis trigger (right-click FileCard → "Re-analyze")
- [ ] Editable tags and title in File Inspector panel (`source = 'manual'`)
- [ ] Keyboard shortcuts: `Cmd+F` search, `Cmd+K` chat, `Escape` close panels
- [ ] Progress indicator during batch import
- [ ] Export canvas view as PNG/SVG
- [ ] Configurable file size limit for auto-transcription
- [ ] Real PDF thumbnail using `pdfjs-dist` page render (replace SVG placeholder)

---

## Ongoing / Infra

- [x] `.env` in backend with `GROQ_API_KEY` placeholder
- [x] Add `.env.example` with all required keys: `GROQ_API_KEY`, `OLLAMA_BASE_URL`, `BACKEND_PORT`
- [x] Add `docker-compose.yml` for Qdrant
- [x] Write startup script that launches backend + Qdrant together (`start.bat` / `start.sh`)
- [x] Pin `tldraw` version in `package.json` (currently `4.4.0`)
- [x] Add request logging for file upload events, ingest completions, errors
- [x] Test WAL mode under load — confirmed via integration tests
- [x] Clean up test artifacts (test_pdf_thumb.mjs, test_upload_types.mjs, etc.)
