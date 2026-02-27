import { useCallback, useEffect, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import {
  Tldraw,
  createShapeId,
  useEditor,
  type Editor,
  type TLShape,
} from '@tldraw/tldraw';
import '@tldraw/tldraw/tldraw.css';
import {
  FileCardShapeUtil,
  fileStore,
  CARD_WIDTH,
  CARD_HEIGHT,
  setRetryHandler,
  type FileCardMeta,
} from './FileCard';
import { api, type FileRecord, type FolderRecord, type NodeUpdate } from '../api';

const SHAPE_UTILS = [FileCardShapeUtil];

function buildCardMeta(file: FileRecord): FileCardMeta {
  const meta: FileCardMeta = { fileId: file.id, tags: file.tags ?? [], status: file.status };
  if (file.metadata?.ai_title)   meta.aiTitle      = file.metadata.ai_title;
  if (file.metadata?.ai_summary) meta.summary      = file.metadata.ai_summary;
  if (file.error_message)        meta.errorMessage = file.error_message;
  return meta;
}

// ── Inner ─────────────────────────────────────────────────────────────────────

interface InnerProps {
  folder:   FolderRecord;
  canvasId: string;
  onRetry:  (id: string) => void;
  onFilesChanged: () => void;
}

function FolderCanvasInner({ folder, canvasId, onRetry, onFilesChanged }: InnerProps) {
  const editor       = useEditor();
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollsRef     = useRef(new Map<string, ReturnType<typeof setInterval>>());

  useEffect(() => { setRetryHandler(onRetry); }, [onRetry]);

  // Load folder files + restore positions
  useEffect(() => {
    let cancelled = false;

    async function restore() {
      const [files, savedNodes] = await Promise.all([
        api.getFolderFiles(folder.id),
        api.getCanvasNodes(canvasId),
      ]);
      if (cancelled) return;

      const nodeMap = new Map<string, (typeof savedNodes)[number]>();
      for (const node of savedNodes) {
        if (node.file_id) nodeMap.set(node.file_id, node);
      }

      files.forEach((file, i) => {
        fileStore.set(file.id, file);
        const shapeId = createShapeId(file.id);
        if (editor.getShape(shapeId)) return;

        const saved = nodeMap.get(file.id);
        const col = i % 5;
        const row = Math.floor(i / 5);
        const x   = saved?.x ?? col * (CARD_WIDTH + 24) + 60;
        const y   = saved?.y ?? row * (CARD_HEIGHT + 32) + 60;

        editor.createShape({
          id: shapeId, type: 'file-card', x, y,
          props: { w: CARD_WIDTH, h: CARD_HEIGHT, fileId: file.id, _v: 0 },
          meta: buildCardMeta(file),
        } as any);

        if (file.status !== 'complete' && file.status !== 'error') {
          startPolling(file.id);
        }
      });
    }

    restore().catch(console.error);
    return () => {
      cancelled = true;
      for (const t of pollsRef.current.values()) clearInterval(t);
      pollsRef.current.clear();
    };
  }, [editor, folder.id, canvasId]); // eslint-disable-line

  function startPolling(fileId: string) {
    if (pollsRef.current.has(fileId)) return;
    const t = setInterval(async () => {
      try {
        const { status } = await api.getFileStatus(fileId);
        if (status !== 'complete' && status !== 'error') return;
        clearInterval(t);
        pollsRef.current.delete(fileId);

        const updated = await api.getFile(fileId);
        fileStore.set(updated.id, updated);

        const shapeId = createShapeId(updated.id);
        const shape   = editor.getShape(shapeId);
        if (!shape) return;

        editor.updateShape({
          id: shapeId, type: 'file-card',
          meta: buildCardMeta(updated),
          props: { ...(shape as any).props, _v: ((shape as any).props._v ?? 0) + 1 },
        } as any);

        onFilesChanged();
      } catch (err) { console.error('Poll failed:', err); }
    }, 3000);
    pollsRef.current.set(fileId, t);
  }

  // Persist positions
  useEffect(() => {
    const unsub = editor.store.listen(
      (entry) => {
        const updates: NodeUpdate[] = [];
        for (const [, next] of Object.values(entry.changes.updated) as [TLShape, TLShape][]) {
          if (next.typeName === 'shape' && (next as any).meta?.fileId) {
            const s = next as any;
            updates.push({
              id: s.id, fileId: s.meta.fileId,
              canvasId,
              x: s.x, y: s.y, width: s.props.w, height: s.props.h,
            });
          }
        }
        if (!updates.length) return;
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        saveTimerRef.current = setTimeout(() => {
          api.saveCanvasNodes(updates).catch(console.error);
        }, 2000);
      },
      { source: 'user', scope: 'document' }
    );
    return unsub;
  }, [editor, canvasId]);

  return null;
}

// ── Upload helper ─────────────────────────────────────────────────────────────

async function uploadAndAddToFolder(
  editor: Editor,
  file: File,
  folderId: string,
  x: number,
  y: number,
  canvasId: string,
  onFilesChanged: () => void,
) {
  try {
    const result = await api.uploadFile(file);
    if (result.duplicate) {
      // Still add to folder even if file existed elsewhere
      await api.addFilesToFolder(folderId, [result.file.id]);
    } else {
      await api.addFilesToFolder(folderId, [result.file.id]);
    }

    const fileRecord = result.file;
    fileStore.set(fileRecord.id, fileRecord);

    const shapeId = createShapeId(fileRecord.id);
    if (!editor.getShape(shapeId)) {
      editor.createShape({
        id: shapeId, type: 'file-card', x, y,
        props: { w: CARD_WIDTH, h: CARD_HEIGHT, fileId: fileRecord.id, _v: 0 },
        meta: buildCardMeta(fileRecord),
      } as any);

      // Save position immediately
      await api.saveCanvasNodes([{
        id: shapeId, fileId: fileRecord.id, canvasId,
        x, y, width: CARD_WIDTH, height: CARD_HEIGHT,
      }]);
    }

    onFilesChanged();
  } catch (err) {
    console.error('Upload failed:', err);
  }
}

// ── Public component ──────────────────────────────────────────────────────────

interface FolderCanvasProps {
  folder:          FolderRecord;
  onFilesChanged:  () => void;   // called when files added/status changed → refresh folder cover
  onMount?:        (editor: Editor) => void;
}

export function FolderCanvas({ folder, onFilesChanged, onMount }: FolderCanvasProps) {
  const [editor, setEditor] = useState<Editor | null>(null);
  const editorRef = useRef<Editor | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const canvasId  = `folder:${folder.id}`;

  const handleRetry = useCallback(async (fileId: string) => {
    try {
      await api.retryFile(fileId);
      const existing = fileStore.get(fileId);
      if (!existing || !editorRef.current) return;
      const optimistic: FileRecord = { ...existing, status: 'pending', retry_count: 0, error_message: null };
      fileStore.set(fileId, optimistic);
      const shapeId = createShapeId(fileId);
      const shape   = editorRef.current.getShape(shapeId);
      if (!shape) return;
      editorRef.current.updateShape({
        id: shapeId, type: 'file-card',
        meta: buildCardMeta(optimistic),
        props: { ...(shape as any).props, _v: ((shape as any).props._v ?? 0) + 1 },
      } as any);
    } catch (err) { console.error('Retry failed:', err); }
  }, []);

  const handleMount = useCallback((ed: Editor) => {
    setEditor(ed);
    editorRef.current = ed;
    onMount?.(ed);

    ed.registerExternalContentHandler('files', async ({ point, files: dropped }) => {
      const p = point ?? { x: 100, y: 100 };
      for (let i = 0; i < dropped.length; i++) {
        await uploadAndAddToFolder(
          ed, dropped[i], folder.id,
          p.x + i * (CARD_WIDTH + 24), p.y,
          canvasId, onFilesChanged,
        );
      }
    });

    ed.registerExternalContentHandler('url',  async () => {});
    ed.registerExternalContentHandler('text', async () => {});
  }, [folder.id, canvasId, onFilesChanged, onMount]);

  const handleDomDrop = useCallback(async (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const ed = editorRef.current;
    if (!ed) return;
    const files = Array.from(e.dataTransfer.files);
    if (!files.length) return;
    const p = ed.screenToPage({ x: e.clientX, y: e.clientY });
    for (let i = 0; i < files.length; i++) {
      await uploadAndAddToFolder(
        ed, files[i], folder.id,
        p.x + i * (CARD_WIDTH + 24), p.y,
        canvasId, onFilesChanged,
      );
    }
  }, [folder.id, canvasId, onFilesChanged]);

  const handlePickerFiles = useCallback(async (e: ChangeEvent<HTMLInputElement>) => {
    const ed = editorRef.current;
    if (!ed) return;

    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;

    const vp = ed.getViewportPageBounds();
    const startX = vp.x + Math.max(36, vp.w * 0.15);
    const startY = vp.y + Math.max(36, vp.h * 0.15);

    for (let i = 0; i < files.length; i++) {
      await uploadAndAddToFolder(
        ed, files[i], folder.id,
        startX + i * (CARD_WIDTH + 24), startY,
        canvasId, onFilesChanged,
      );
    }

    // Reset so selecting the same file again still triggers onChange.
    e.target.value = '';
  }, [folder.id, canvasId, onFilesChanged]);

  return (
    <div
      className="canvas-container"
      onDrop={handleDomDrop}
      onDragOver={(e) => e.preventDefault()}
    >
      <input
        ref={fileInputRef}
        id="folder-file-input"
        name="folder-file-input"
        type="file"
        multiple
        onChange={handlePickerFiles}
        style={{ display: 'none' }}
      />

      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        title="Add files to this folder"
        style={{
          position: 'absolute',
          top: 14,
          right: 440,
          zIndex: 520,
          height: 35,
          padding: '0 12px',
          borderRadius: 9,
          border: '1px solid rgba(28,25,23,0.12)',
          background: 'rgba(254,252,249,0.92)',
          backdropFilter: 'blur(14px)',
          WebkitBackdropFilter: 'blur(14px)',
          boxShadow: '0 1px 3px rgba(20,15,10,0.06)',
          cursor: 'pointer',
          fontFamily: "'Inter', system-ui, sans-serif",
          fontSize: 12,
          fontWeight: 600,
          color: '#1C1917',
          letterSpacing: '-0.01em',
        }}
      >
        Add Files
      </button>

      <Tldraw shapeUtils={SHAPE_UTILS} onMount={handleMount} hideUi={false}>
        {editor && (
          <FolderCanvasInner
            folder={folder}
            canvasId={canvasId}
            onRetry={handleRetry}
            onFilesChanged={onFilesChanged}
          />
        )}
      </Tldraw>
    </div>
  );
}
