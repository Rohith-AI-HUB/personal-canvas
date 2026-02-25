# Personal AI Knowledge Canvas

A local-first desktop application for managing, understanding, and querying your personal file collection using AI.

## Stack

- **Frontend:** React + tldraw (infinite canvas)
- **Desktop Shell:** Tauri (thin wrapper — window, tray, file dialogs only)
- **Backend:** Node.js + Fastify (localhost:3001)
- **Metadata DB:** SQLite (WAL mode, FTS5)
- **Vector DB:** Qdrant (local Docker container)
- **Embeddings:** nomic-embed-text via Ollama
- **Ingest AI:** Groq API (llama-3.1-70b + Whisper)
- **Chat AI:** gpt-oss-120b via Ollama Cloud
- **Code AI:** Deepseek Coder 1.5b (local)

## Project Structure

```
/personal-canvas
├── /frontend         → React app (tldraw canvas, chat panel, search)
├── /backend          → Node.js + Fastify server
├── /storage          → All user data (files, thumbnails, SQLite DB)
├── /src-tauri        → Tauri Rust shell (thin)
└── README.md
```

## Build Phases

1. **Phase 1** — File drop → canvas display with thumbnails + deduplication
2. **Phase 2** — AI ingest pipeline (tagging, summarization, transcription)
3. **Phase 3** — Hybrid semantic + keyword search
4. **Phase 4** — RAG chat panel with citations
5. **Phase 5** — Polish (grouping, bulk import, keyboard shortcuts)

## Prerequisites

- Node.js 20+
- Rust (for Tauri)
- Docker (for Qdrant)
- Ollama installed and running locally
- Groq API key

## Critical Notes

- SQLite WAL mode must be enabled at initialization
- Qdrant point IDs must be UUID v5 (not arbitrary strings)
- File deduplication via SHA-256 hash before any processing
- Ingest queue uses p-queue with crash recovery on startup
- Frontend communicates with backend over localhost HTTP — not Tauri IPC
