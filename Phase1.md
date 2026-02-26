# Phase 1 — Real Data Testing Guide

> **Scope:** This guide covers manual end-to-end testing of the Phase 1 system using real files from your machine. It assumes the automated integration suite (`test_phase1.mjs`) has already passed 21/21. The goal here is to validate behavior that automated tests cannot cover: visual rendering in the canvas, thumbnail quality, drag-and-drop UX, and canvas persistence across app restarts.

---

## Prerequisites

Before starting, confirm all three services can run:

### 1. Start the Backend

```bash
cd personal-canvas/backend
npx tsx src/server.ts
```

Expected output:
```
INFO: Server listening at http://127.0.0.1:3001
INFO: Backend running on http://127.0.0.1:3001
```

Confirm it's alive:
```bash
curl http://127.0.0.1:3001/health
# → {"status":"ok","ts":...}
```

### 2. Start the Frontend

In a second terminal:
```bash
cd personal-canvas/frontend
npm run dev
```

Open `http://localhost:5173` in your browser. You should see a blank tldraw canvas.

### 3. Verify Storage Directories

Check that these exist (created automatically on first backend start):
```
personal-canvas/storage/files/        ← uploaded originals land here
personal-canvas/storage/thumbnails/   ← generated WebP thumbnails here
personal-canvas/storage/db/           ← knowledge.sqlite + WAL files here
```

---

## What Files to Use

Gather **at least one real file** from each category below. These are the types the system handles differently — each exercises a distinct code path in `thumbnails.ts` and will be the input to AI models in Phase 2.

### Required File Types

| Type | Extensions | Thumbnail Path | What to Use |
|------|-----------|----------------|-------------|
| **PDF** | `.pdf` | SVG placeholder + page count | Any PDF: invoice, paper, manual, ebook chapter |
| **Image** | `.jpg` `.png` `.webp` | Real image, resized to 300×200 | A photo, screenshot, diagram, or wallpaper |
| **Video** | `.mp4` `.mov` `.mkv` | Frame extracted at 10% duration | Any short video clip (even a phone recording) |
| **Audio** | `.mp3` `.wav` `.m4a` | 🎵 placeholder (blue) | Any song, podcast clip, or voice memo |
| **Code** | `.py` `.ts` `.js` `.go` `.rs` `.sql` | 💻 placeholder (green) | Any source file from a project you have locally |
| **Text / Markdown** | `.txt` `.md` `.csv` `.log` | 📝 placeholder (dark) | A README, notes file, or exported CSV |
| **Other** | anything else | 📁 placeholder (grey) | A `.zip`, `.epub`, `.fig`, `.sketch`, or binary |

> **Tip:** A 10–20 file batch is the sweet spot. It covers all types without overwhelming the canvas layout during Phase 1 (when AI metadata isn't filling the cards yet).

### Files That Stress-Test Edge Cases

Include at least one of each:

- **Large image** (> 5MB JPEG or PNG) — tests sharp's resize performance
- **Multi-page PDF** (10+ pages) — verifies page count appears in placeholder subtitle
- **Video with audio** (any `.mp4`, even 30 seconds) — tests ffprobe duration probe + ffmpeg frame extraction
- **File with a very long filename** (60+ characters) — tests title truncation in the FileCard
- **File with spaces in the name** — e.g. `my notes 2024.txt` — tests URL encoding in the thumbnail route
- **Duplicate test** — same file, renamed — e.g. copy `notes.txt` to `notes_copy.txt` — they are different filenames but same content hash; the system **should** treat them as duplicates (same SHA-256)

---

## Test Procedure

Work through each section in order. Check the box when the behavior matches expected.

---

### Test 1: Single File Drop

**Goal:** Confirm the basic upload → thumbnail → canvas card flow works end-to-end with a real file.

1. Open `http://localhost:5173`
2. Open your file manager (Explorer / Finder)
3. Drag **one image file** (`.jpg` or `.png`) from your desktop onto the canvas
4. Release it anywhere on the canvas

**Expected behavior:**

- [ ] The file card appears at the drop location within 1–2 seconds
- [ ] The thumbnail shows the actual image content (not a placeholder icon)
- [ ] The file type chip (`IMAGE`) appears in the bottom-left of the thumbnail area
- [ ] The status badge shows ⏳ (pending) — this is correct, Phase 2 AI hasn't run yet
- [ ] The filename appears in the card's info area

**If thumbnail shows a blank/white area instead of the image:**
Check `storage/thumbnails/` — the `.webp` file should exist. If it does, the issue is the thumbnail serving route. Open browser DevTools → Network tab → look for the `/api/thumbnail?path=...` request and check its response.

---

### Test 2: Multi-File Batch Drop (All Types)

**Goal:** Drop one file of each type simultaneously and confirm all cards render correctly.

1. Select 6–7 files covering all types (PDF, image, video, audio, code, text, other)
2. Drag them all onto the canvas at once and drop

**Expected behavior:**

- [ ] All files appear as separate cards, offset horizontally from each other
- [ ] Each card shows the correct thumbnail type:
  - Image → actual photo thumbnail
  - PDF → red card with 📄 icon and page count (e.g. "12 pages")
  - Video → actual video frame (if ffmpeg is installed) OR purple 🎬 placeholder
  - Audio → blue 🎵 placeholder
  - Code → green 💻 placeholder
  - Text/Markdown → dark 📝 placeholder
  - Other → grey 📁 placeholder
- [ ] Each card shows the correct file type chip in its accent color
- [ ] All cards show ⏳ status badge (pending)
- [ ] No cards are missing from the canvas (count should match files dropped)

**Check the backend terminal** for any error logs during this batch. Thumbnail generation failures log as warnings but don't crash the upload.

---

### Test 3: Video Thumbnail (ffmpeg Required)

**Goal:** Confirm ffmpeg frame extraction works for video files.

> Skip this test if ffmpeg is not installed. The system degrades gracefully to a 🎬 placeholder.

1. Drop a `.mp4` or `.mov` file onto the canvas
2. Wait 2–3 seconds for the thumbnail to generate

**Expected behavior:**

- [ ] The video card shows an actual frame from the video (not the purple placeholder)
- [ ] The frame is from approximately 10% into the video duration

**To verify ffmpeg is installed:**
```bash
ffmpeg -version
```

If not installed, download from https://ffmpeg.org/download.html and add to PATH.

---

### Test 4: Deduplication with Real Files

**Goal:** Confirm SHA-256 content hashing prevents duplicate records when the same content is uploaded twice.

**Scenario A — Same file, same name:**
1. Drop a file onto the canvas (e.g. `report.pdf`)
2. Drop the exact same file again

**Expected:** Second drop is silently ignored. No second card appears. Console logs `Duplicate file skipped: report.pdf`.

**Scenario B — Same content, different filename:**
1. Make a copy of any file and rename it (e.g. copy `notes.txt` → `notes_backup.txt`)
2. Drop the original onto the canvas
3. Drop the renamed copy onto the canvas

**Expected:** Second drop is silently ignored. The system hashes the *content*, not the filename. One card, not two.

**Scenario C — Different content, same filename:**
1. Create two different text files both named `draft.txt` with different content
2. Drop file 1 → card appears
3. Drop file 2 (same name, different content)

**Expected:** Second card **does** appear. Different SHA-256 hashes → not a duplicate. The second file is saved as `{uuid}.txt` internally, so the filename collision is handled.

---

### Test 5: Canvas Position Persistence

**Goal:** Confirm file card positions are saved to SQLite and restored on backend restart.

1. Drop 3–4 files onto the canvas
2. Arrange them into a deliberate layout — put them in different corners
3. Wait 3 seconds (debounce fires and saves positions)
4. Note the visual arrangement

**Restart the backend:**
```bash
# Kill the running backend (Ctrl+C in its terminal)
# Restart:
cd personal-canvas/backend && npx tsx src/server.ts
```

5. Refresh the frontend page (`F5` or `Cmd+R`)
6. Observe the canvas on load

**Expected behavior:**

- [ ] All previously dropped files reappear on the canvas
- [ ] Each card is in the **exact position** you left it, not scattered randomly
- [ ] Cards that had saved positions restore without animation (instant)
- [ ] Status badges still show ⏳ (pending — AI hasn't run yet)

**To confirm positions were saved before restart, query SQLite directly:**
```bash
cd personal-canvas
npx better-sqlite3 storage/db/knowledge.sqlite "SELECT id, x, y, width, height FROM canvas_nodes"
```
Or use any SQLite browser (DB Browser for SQLite is free and excellent).

---

### Test 6: File Delete

**Goal:** Confirm deletion removes the file from disk, the database, and the canvas.

1. Drop any file onto the canvas — note its card appears
2. Open a terminal and call the delete API directly:

```bash
# First, get the file ID
curl http://127.0.0.1:3001/api/files

# Then delete by ID (replace with actual ID from above)
curl -X DELETE http://127.0.0.1:3001/api/files/{FILE_ID}
# → Should return HTTP 204 No Content
```

3. Refresh the frontend

**Expected behavior:**

- [ ] `DELETE` returns `204`
- [ ] The file card no longer appears on canvas after refresh
- [ ] The file is gone from `storage/files/` on disk
- [ ] The thumbnail is gone from `storage/thumbnails/` on disk
- [ ] `GET /api/files` no longer includes the deleted record

> **Note:** In Phase 1 the canvas doesn't have a right-click delete UI yet — that's Phase 5 polish. The API-level delete tested here is the critical path. The UI trigger will call the same route.

---

### Test 7: Long Filename and Special Characters

**Goal:** Test edge cases in filename handling that real-world files expose.

Create or find files with these naming patterns and drop them:

1. `My Research Notes - Q4 2024 (Final Version).pdf` — spaces + parentheses
2. `données_analyse.csv` — accented characters
3. `2024-11-15_meeting_recording.mp3` — date-prefixed name
4. A file with a name exactly 80+ characters long

**Expected behavior:**

- [ ] All files upload without error
- [ ] The filename shown in the card is truncated gracefully with `text-overflow: ellipsis` (not wrapping or overflowing the card)
- [ ] Hovering over the title shows the full filename via browser tooltip
- [ ] Thumbnail endpoint handles encoded paths correctly (`%20` for spaces, etc.)

**Test the thumbnail URL manually for a file with spaces:**
```bash
# Get a file record to find thumbnail_path
curl http://127.0.0.1:3001/api/files | python -m json.tool | grep thumbnail_path

# Fetch the thumbnail with encoded path
curl -I "http://127.0.0.1:3001/api/thumbnail?path=C%3A%5CUsers%5Crohit%5C..."
# → Should return HTTP 200 with Content-Type: image/webp
```

---

### Test 8: Large File Upload

**Goal:** Confirm the 500MB multipart limit and streaming upload work for large files.

1. Find a video file between 50MB and 200MB
2. Drop it onto the canvas
3. Watch the upload progress in the browser DevTools Network tab

**Expected behavior:**

- [ ] Upload completes without timeout (may take 10–30 seconds for large files on localhost)
- [ ] Card appears on canvas after upload completes
- [ ] ffmpeg generates a thumbnail from the video frame
- [ ] Backend logs show no errors

**If upload times out:**
Check that `@fastify/multipart` limit is set correctly in `server.ts`:
```typescript
limits: { fileSize: 500 * 1024 * 1024 }  // 500MB
```

---

### Test 9: Status Polling Verification

**Goal:** Confirm the frontend correctly polls `/api/files/:id/status` for pending files.

Since Phase 2 AI isn't wired yet, all uploaded files sit in `pending` status. Verify the polling mechanism is active:

1. Open browser DevTools → Network tab
2. Filter by `status`
3. Drop any file onto the canvas
4. Watch the network requests

**Expected behavior:**

- [ ] Requests to `/api/files/{id}/status` appear every ~3 seconds
- [ ] Each returns `{"status":"pending","retry_count":0,"error_message":null}`
- [ ] Polling continues (it will keep going until Phase 2 changes status to `complete`)

To stop the polling (simulating Phase 2 completion), manually update the DB:
```bash
cd personal-canvas
npx better-sqlite3 storage/db/knowledge.sqlite \
  "UPDATE files SET status = 'complete' WHERE id = '{YOUR_FILE_ID}'"
```

After the next poll, the frontend will:
- [ ] Stop the polling interval for that file
- [ ] Fetch the full updated record
- [ ] Re-render the shape (status badge disappears since status is `complete`)

---

### Test 10: Canvas Zoom and Pan with Many Files

**Goal:** Confirm tldraw's canvas performance with 15–20 real file cards.

1. Drop 15–20 files of mixed types onto the canvas
2. Use mouse wheel to zoom out until all cards are visible
3. Pan around the canvas
4. Zoom into individual cards

**Expected behavior:**

- [ ] Canvas remains smooth (no lag or frame drops) at full zoom-out
- [ ] Individual thumbnails are visible when zoomed in
- [ ] tldraw's built-in selection, multi-select, and drag still work on file cards
- [ ] Dragging a card to a new position and waiting 3 seconds updates its SQLite record

**Verify a moved card's position was saved:**
```bash
curl http://127.0.0.1:3001/api/files/{FILE_ID} | python -m json.tool | grep -A5 canvas_node
```

---

## Quick API Reference for Manual Testing

All endpoints you'll use during real data testing:

```bash
# List all files
curl http://127.0.0.1:3001/api/files | python -m json.tool

# Get single file
curl http://127.0.0.1:3001/api/files/{ID} | python -m json.tool

# Poll status
curl http://127.0.0.1:3001/api/files/{ID}/status

# Delete file
curl -X DELETE http://127.0.0.1:3001/api/files/{ID}

# Batch save canvas positions manually
curl -X POST http://127.0.0.1:3001/api/canvas/nodes \
  -H "Content-Type: application/json" \
  -d '[{"id":"shape:test","fileId":"{ID}","x":100,"y":200,"width":200,"height":250}]'

# Health check
curl http://127.0.0.1:3001/health

# Count files in DB (requires sqlite3 CLI or npx better-sqlite3)
npx better-sqlite3 storage/db/knowledge.sqlite "SELECT COUNT(*) FROM files"
npx better-sqlite3 storage/db/knowledge.sqlite "SELECT id, filename, file_type, status FROM files"
npx better-sqlite3 storage/db/knowledge.sqlite "SELECT * FROM canvas_nodes"
```

---

## Interpreting the Results

### Everything Passes

You're done with Phase 1. The system is stable enough for real daily use. Move to Phase 2: `backend/src/services/groq.ts` and `backend/src/queue/ingestQueue.ts`.

### Video Thumbnail Shows Placeholder Instead of Frame

ffmpeg is either not installed or not on PATH. The system degrades gracefully — this is expected behavior, not a bug. Install ffmpeg if you want real video thumbnails:
- **Windows:** `winget install ffmpeg` or download from https://ffmpeg.org
- Restart the backend after installing

### Canvas Positions Not Restoring

The debounce is 2 seconds. If you closed the tab or killed the backend within 2 seconds of moving a card, the save didn't fire. This is the expected trade-off. In Phase 5 we'll add a `beforeunload` flush.

### Upload Fails with `500`

Check the backend terminal for the stack trace. Most common causes:
- `storage/files/` doesn't exist — backend startup creates it, but if it was manually deleted between runs, restart the backend
- `sharp` native binary not built for your Node.js version — run `npm rebuild sharp` in `/backend`
- `pdfjs-dist` legacy build import fails on some Node versions — verify Node >= 18

### Thumbnail Shows as Broken Image Icon in Browser

The `/api/thumbnail?path=...` request is failing. Most likely cause: the `thumbnail_path` stored in SQLite contains a Windows backslash path that isn't being encoded correctly. Check the Network tab for the exact URL being requested, then call it manually with `curl -v` to see the error response from the backend.

---

## Phase 1 Sign-Off Checklist

Complete all of the following before considering Phase 1 done:

- [ ] Automated tests: `node test_phase1.mjs` → **21/21 pass**
- [ ] Real image file drops and shows actual thumbnail (not placeholder)
- [ ] Real PDF file drops and shows page count in placeholder
- [ ] Real video file drops and shows extracted frame (or graceful placeholder)
- [ ] Batch drop of 10+ mixed files — all cards appear, all thumbnails correct
- [ ] Duplicate content detected and silently skipped
- [ ] Canvas positions survive backend restart and page refresh
- [ ] Deletion removes file from disk + DB + thumbnail
- [ ] Long filenames display with ellipsis, no overflow
- [ ] Backend terminal shows no uncaught exceptions during any of the above

**You're ready for Phase 2** once all boxes are checked.
