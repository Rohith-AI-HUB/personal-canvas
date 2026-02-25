# Personal AI Knowledge Canvas — TODO

> Tasks are ordered by build phase. Complete Phase 1 entirely before moving to Phase 2.
> P0 = blocking, must be done first | P1 = required for phase | P2 = important but not blocking

---

## Phase 1 — Foundation (File Drop → Canvas)

### Project Setup
- [x] Run `npm init -y` in `/backend` and configure `package.json` with `"type": "module"`
- [x] Run `npm create vite@latest frontend -- --template react-ts` in project root
- [x] Run `cargo tauri init` in project root to scaffold `/src-tauri` (or `npx @tauri-apps/cli init`)
- [ ] Install Rust (required for Tauri) - download from [rustup.rs](https://rustup.rs/)
- [ ] Install backend dependencies: `fastify`, `better-sqlite3`, `uuid`, `sharp`, `p-queue`, `@types/better-sqlite3`
- [ ] Install frontend dependencies: `tldraw`, `axios`
- [ ] Install dev dependencies in backend: `typescript`, `tsx`, `@types/node`
- [ ] Create `tsconfig.json` in `/backend`
- [ ] Create `tsconfig.json` in `/frontend` (Vite does this automatically)
- [ ] Add `.gitignore` (node_modules, storage/files, storage/db, dist, target)
- [ ] Configure `tauri.conf.json` — allow `http` for localhost, declare `/storage` path in allowlist

### Backend — SQLite (P0)
- [ ] Create `/backend/src/services/sqlite.ts`
- [ ] Write schema: `files`, `file_metadata`, `tags`, `canvas_nodes`, `chat_messages`, `files_fts`
- [ ] Enable WAL mode on init: `PRAGMA journal_mode = WAL`, `synchronous = NORMAL`, `foreign_keys = ON`
- [ ] Export `getDb()` singleton function
- [ ] Test: verify WAL files (`.sqlite-wal`, `.sqlite-shm`) appear in `/storage/db` on first run

### Backend — File Deduplication (P0)
- [ ] Create `/backend/src/services/dedup.ts`
- [ ] Implement `hashFile(filePath): Promise<string>` using SHA-256 stream hashing
- [ ] Test: hash the same file twice, confirm identical output

### Backend — File Storage
- [ ] Create `/backend/src/services/storage.ts`
- [ ] Implement `saveFile(sourcePath, originalName): Promise<string>` — copies file to `/storage/files/{uuid}-{filename}`
- [ ] Ensure `/storage/files` and `/storage/thumbnails` directories exist on startup (create if missing)

### Backend — Thumbnail Generation
- [ ] Create `/backend/src/services/thumbnails.ts`
- [ ] Implement image thumbnail using `sharp` (resize to 300px wide, output WebP)
- [ ] Implement PDF thumbnail using `pdfjs-dist` (render page 1 to image → sharp resize)
- [ ] Implement video thumbnail using `ffmpeg` (extract frame at 10% duration)
- [ ] Implement audio thumbnail — use a static waveform placeholder image
- [ ] Implement code/text thumbnail — render filename + first 5 lines as a simple image
- [ ] Return thumbnail path from each function

### Backend — File Upload Route
- [ ] Create `/backend/src/routes/files.ts`
- [ ] Implement `POST /api/files` — accepts multipart file upload
- [ ] On upload: hash → deduplicate check → save to disk → generate thumbnail → insert SQLite record (status: `pending`) → return file record
- [ ] Implement `GET /api/files` — return all files with metadata for canvas restore on startup
- [ ] Implement `DELETE /api/files/:id` — delete file from disk, SQLite, and (later) Qdrant

### Backend — Server Bootstrap
- [ ] Create `/backend/src/server.ts`
- [ ] Initialize Fastify with multipart plugin (`@fastify/multipart`)
- [ ] Enable CORS for Tauri webview origin
- [ ] Register file routes
- [ ] Call `getDb()` on startup to initialize SQLite + WAL mode
- [ ] Ensure storage directories exist on startup
- [ ] Listen on `localhost:3001`

### Frontend — Canvas Setup
- [ ] Create `/frontend/src/components/Canvas.tsx`
- [ ] Mount `<Tldraw />` component full-screen
- [ ] Define custom `FileCardShape` type for tldraw
- [ ] Implement `FileCard.tsx` — renders thumbnail, filename, file type icon, status badge
- [ ] On app load: fetch `GET /api/files` and restore all file cards to canvas at saved positions

### Frontend — File Drop
- [ ] Wire OS drag-and-drop into tldraw canvas (use tldraw's `onDrop` or overlay handler)
- [ ] On drop: `POST /api/files` with the file
- [ ] On success: create a `FileCardShape` on canvas at drop coordinates
- [ ] Show thumbnail immediately after upload (before AI processing)

### Frontend — Canvas State Persistence
- [ ] Create `/frontend/src/components/Canvas.tsx` onChange listener
- [ ] Filter to only file card shapes with a `meta.fileId`
- [ ] Debounce writes at 2 seconds
- [ ] `POST /api/canvas/nodes` with position/size updates
- [ ] Create `POST /api/canvas/nodes` route in backend — upsert into `canvas_nodes` table
- [ ] Use `{ source: 'user', scope: 'document' }` listener option to exclude camera changes

### Phase 1 Done Criteria
- [ ] Drop 20 mixed-type files → all show thumbnails on canvas
- [ ] Re-drop same file → no duplicate created (deduplication works)
- [ ] Close and reopen app → all files restore to correct canvas positions
- [ ] SQLite WAL files present, no UI hangs during file drops

---

## Phase 2 — AI Ingest Pipeline

### Groq Integration
- [ ] Create `/backend/src/services/groq.ts`
- [ ] Implement `getAIMetadata(fileType, content): Promise<AIMetadata>` using Groq llama-3.1-70b
- [ ] Use JSON schema enforcement mode
- [ ] Wrap JSON parse in try/catch with fallback schema
- [ ] Implement `transcribeAudio(audioPath): Promise<string>` using Groq Whisper API
- [ ] Store `GROQ_API_KEY` in `.env`, load via `dotenv`

### Deepseek Coder Integration
- [ ] Create `/backend/src/services/deepseek.ts`
- [ ] Implement `summarizeCode(content): Promise<string>` via Ollama local endpoint
- [ ] Extract function names, class names, top-level comments as structured metadata

### Content Extraction
- [ ] Create `/backend/src/services/ingest.ts`
- [ ] Implement `extractContent(file): Promise<string>` dispatcher by file type
- [ ] PDF: use `pdfjs-dist` text extraction; fallback to Tesseract.js OCR if no text layer
- [ ] Image: run Tesseract.js OCR + request short AI caption from Groq
- [ ] Video: ffmpeg audio extraction → Groq Whisper transcription
- [ ] Audio: Groq Whisper transcription directly
- [ ] Code: read raw text → send to Deepseek Coder for functional summary
- [ ] Text/Markdown: read raw content directly

### Ingest Queue (P1)
- [ ] Create `/backend/src/queue/ingestQueue.ts`
- [ ] Configure `p-queue`: `concurrency: 1`, `intervalCap: 1`, `interval: 2500`
- [ ] Implement full `runIngestPipeline(file)` function with status state machine
- [ ] Status flow: `pending → processing → complete` or `pending → processing → error`
- [ ] On error: increment `retry_count`, store `error_message`, set status back to `pending` if `retry_count < 3`, else `error`
- [ ] Implement `recoverPendingJobs()` — reset `processing → pending` on startup, re-enqueue all `pending` with `retry_count < 3`
- [ ] Call `recoverPendingJobs()` in `server.ts` on startup

### Frontend — Processing State
- [ ] Show spinner badge on FileCard while `status === 'processing'`
- [ ] Show error badge on FileCard when `status === 'error'`
- [ ] Add click-to-retry on error badge → `POST /api/files/:id/retry`
- [ ] Implement `POST /api/files/:id/retry` route — reset retry_count to 0, re-enqueue
- [ ] Poll `GET /api/files/:id/status` every 3 seconds while file is pending/processing
- [ ] On status → complete: fetch updated metadata and update FileCard (show tags + summary)

### Phase 2 Done Criteria
- [ ] Drop a PDF → AI returns accurate title, summary, category, tags within ~5 seconds
- [ ] Drop a video → transcript generated, tags reflect video content
- [ ] Drop a code file → functional summary generated by Deepseek Coder
- [ ] Crash app mid-ingest → restart → file resumes processing automatically
- [ ] Malformed AI response → file marked error, no crash, error badge shown on card

---

## Phase 3 — Semantic Search

### Qdrant Setup
- [ ] Create `docker-compose.yml` in project root for Qdrant container (port 6333, persist data to `/storage/db/qdrant`)
- [ ] Create `/backend/src/services/qdrant.ts`
- [ ] On startup: check if `knowledge_base` collection exists; create it if not (768 dimensions, Cosine distance)
- [ ] Implement `upsertChunks(fileId, chunks, embeddings, metadata)` using UUID v5 point IDs
- [ ] Implement `searchChunks(queryEmbedding, topN): Promise<ScoredChunk[]>`
- [ ] Implement `deleteByFileId(fileId)` — filter delete by `file_id` payload field

### Embeddings
- [ ] Create `/backend/src/services/embeddings.ts`
- [ ] Implement `embedText(text): Promise<number[]>` via Ollama `nomic-embed-text`
- [ ] Implement `chunkText(text, chunkSize=500, overlap=50): string[]`
- [ ] Skip chunks under 100 tokens
- [ ] Implement `chunkPointId(fileId, chunkIndex): string` using UUID v5

### Wire Embeddings into Ingest
- [ ] After AI tagging completes, chunk extracted content
- [ ] Generate embedding for each chunk
- [ ] Upsert all chunks to Qdrant
- [ ] Update SQLite record to `complete`

### Search Backend
- [ ] Create `/backend/src/routes/search.ts`
- [ ] Implement `GET /api/search?q=...`
- [ ] Kick off SQLite FTS5 query immediately (return as `keyword` results)
- [ ] In parallel: embed query → Qdrant vector search → return as `semantic` results
- [ ] Merge and re-rank: `(semantic_score × 0.6) + (keyword_score × 0.4)`
- [ ] Deduplicate by file ID
- [ ] Return ranked list of files with match highlights

### Search Frontend
- [ ] Create `/frontend/src/components/SearchBar.tsx`
- [ ] On type: debounce 300ms → `GET /api/search?q=...`
- [ ] Show keyword results immediately as they arrive
- [ ] Merge semantic results when they land (re-sort in place)
- [ ] On result click: call `editor.zoomToFit([nodeId])` to navigate canvas to that file
- [ ] Briefly highlight the target node on canvas after navigation
- [ ] Add filter chips: file type, date range, category, tag

### Phase 3 Done Criteria
- [ ] Search "neural networks" → finds relevant files without that exact phrase in filename
- [ ] Keyword results appear in under 20ms
- [ ] Clicking a result navigates canvas to the correct node
- [ ] Deleting a file removes its Qdrant vectors (no orphaned vectors)

---

## Phase 4 — RAG Chat

### Ollama Chat Integration
- [ ] Create `/backend/src/services/ollama.ts`
- [ ] Implement `streamChat(messages, onChunk): Promise<void>` via Ollama `gpt-oss-120b`
- [ ] Handle streaming response and forward chunks via Fastify SSE or WebSocket

### RAG Pipeline
- [ ] Create `/backend/src/routes/chat.ts`
- [ ] Implement `POST /api/chat` — accepts `{ sessionId, message }`
- [ ] Embed the user message
- [ ] Retrieve top 10 chunks from Qdrant
- [ ] Assemble context with token budget (max 6000 tokens, highest-score chunks first)
- [ ] Build system prompt with context + citation headers
- [ ] Append last 5 chat exchanges from SQLite as conversation history
- [ ] Stream response back to frontend
- [ ] On completion: store user message + assistant response in `chat_messages` with citations JSON

### Chat Frontend
- [ ] Create `/frontend/src/components/ChatPanel.tsx`
- [ ] Sidebar layout (collapsible)
- [ ] Message list with streaming text render
- [ ] Citation chips on assistant messages (filename + click → canvas navigation)
- [ ] Input box with send on Enter
- [ ] Create `/frontend/src/hooks/useChat.ts` — manages session ID, message history, streaming state

### Phase 4 Done Criteria
- [ ] Ask "summarize everything I have on transformers" → coherent cited answer from actual files
- [ ] Citations are clickable and navigate canvas to the correct file
- [ ] Conversation history maintained across 5+ turns
- [ ] Large context files don't overflow token budget

---

## Phase 5 — Polish

- [ ] Canvas "snap to grid" helper
- [ ] Canvas "align selected nodes" helper
- [ ] Canvas "group selected" with label
- [ ] Clipboard paste support (screenshot → drops as image file on canvas)
- [ ] Bulk folder import — select a folder, ingest all files inside
- [ ] Manual re-analysis trigger on FileCard (right-click → "Re-analyze")
- [ ] Editable tags and title in File Inspector panel (saved with `source = 'manual'`)
- [ ] Keyboard shortcuts: `Cmd+F` focus search, `Cmd+K` open chat, `Escape` close panels
- [ ] Progress indicator during batch import (e.g., "12/47 files processed")
- [ ] Export canvas view as PNG/SVG
- [ ] Configurable file size limit for auto-transcription (skip large videos by default)
- [ ] App version display in settings/tray menu

---

## Ongoing / Infra

- [ ] Add `.env.example` with required keys: `GROQ_API_KEY`, `OLLAMA_BASE_URL`, `BACKEND_PORT`
- [ ] Add `docker-compose.yml` for Qdrant
- [ ] Write startup script that launches backend + Qdrant together
- [ ] Pin `tldraw` to specific version in `package.json` (do not auto-upgrade)
- [ ] Add basic request logging in Fastify (file upload events, ingest completions, errors)
- [ ] Test WAL mode under concurrent load (background ingest + UI reads simultaneously)
