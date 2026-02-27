import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react';
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
import { api, type FileRecord, type NodeUpdate } from '../api';

const CUSTOM_SHAPE_UTILS = [FileCardShapeUtil];

function buildCardMeta(file: FileRecord): FileCardMeta {
  // tldraw requires all meta values to be JSON-serializable — no undefined allowed.
  // Use null or omit the key entirely; here we use null for optional strings.
  const meta: FileCardMeta = {
    fileId: file.id,
    tags: file.tags ?? [],
    status: file.status,
  };
  if (file.metadata?.ai_title) meta.aiTitle = file.metadata.ai_title;
  if (file.metadata?.ai_summary) meta.summary = file.metadata.ai_summary;
  if (file.error_message) meta.errorMessage = file.error_message;
  return meta;
}

function CanvasInner() {
  const editor = useEditor();
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollTimersRef = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map());

  const updateShapeFromFile = useCallback((ed: Editor, file: FileRecord) => {
    const shapeId = createShapeId(file.id);
    const shape = ed.getShape(shapeId) as TLShape & { props?: { _v?: number } } | undefined;
    if (!shape) return;

    ed.updateShape({
      id: shapeId,
      type: 'file-card',
      meta: buildCardMeta(file),
      props: {
        ...(shape.props as any),
        _v: ((shape.props as any)?._v ?? 0) + 1,
      },
    } as any);
  }, []);

  const startPolling = useCallback((fileId: string, ed: Editor) => {
    if (pollTimersRef.current.has(fileId)) return;

    const timer = setInterval(async () => {
      try {
        const { status } = await api.getFileStatus(fileId);
        if (status !== 'complete' && status !== 'error') return;

        clearInterval(timer);
        pollTimersRef.current.delete(fileId);

        const updated = await api.getFile(fileId);
        fileStore.set(fileId, updated);
        updateShapeFromFile(ed, updated);
      } catch (err) {
        console.error(`Poll failed for ${fileId}:`, err);
      }
    }, 3000);

    pollTimersRef.current.set(fileId, timer);
  }, [updateShapeFromFile]);

  const retryIngest = useCallback(async (fileId: string) => {
    try {
      await api.retryFile(fileId);
      const existing = fileStore.get(fileId);
      if (existing) {
        const optimistic: FileRecord = {
          ...existing,
          status: 'pending',
          retry_count: 0,
          error_message: null,
        };
        fileStore.set(fileId, optimistic);
        updateShapeFromFile(editor, optimistic);
      }

      startPolling(fileId, editor);
    } catch (err) {
      console.error(`Retry failed for ${fileId}:`, err);
    }
  }, [editor, startPolling, updateShapeFromFile]);

  useEffect(() => {
    setRetryHandler(retryIngest);
  }, [retryIngest]);

  useEffect(() => {
    let cancelled = false;

    async function restoreCanvas() {
      try {
        const files = await api.listFiles();
        if (cancelled) return;

        for (const file of files) {
          fileStore.set(file.id, file);
          const shapeId = createShapeId(file.id);
          if (!editor.getShape(shapeId)) {
            const x = file.canvas_node?.x ?? Math.random() * 600;
            const y = file.canvas_node?.y ?? Math.random() * 400;
            const w = file.canvas_node?.width ?? CARD_WIDTH;
            const h = file.canvas_node?.height ?? CARD_HEIGHT;

            editor.createShape({
              id: shapeId,
              type: 'file-card',
              x,
              y,
              props: { w, h, fileId: file.id, _v: 0 },
              meta: buildCardMeta(file),
            } as any);
          }

          updateShapeFromFile(editor, file);
          if (file.status !== 'complete' && file.status !== 'error') {
            startPolling(file.id, editor);
          }
        }
      } catch (err) {
        console.error('Failed to restore canvas:', err);
      }
    }

    restoreCanvas();

    return () => {
      cancelled = true;
      for (const timer of pollTimersRef.current.values()) clearInterval(timer);
      pollTimersRef.current.clear();
    };
  }, [editor, startPolling, updateShapeFromFile]);

  useEffect(() => {
    // Sweep every 5 seconds (not 1) — starts polling for any file that somehow
    // missed the initial startPolling call (e.g. added by another tab/window).
    // startPolling is idempotent so redundant calls are safe.
    const sweep = setInterval(() => {
      for (const [fileId, file] of fileStore.entries()) {
        if (file.status === 'complete' || file.status === 'error') continue;
        startPolling(fileId, editor);
      }
    }, 5000);

    return () => clearInterval(sweep);
  }, [editor, startPolling]);

  useEffect(() => {
    const unsub = editor.store.listen(
      (entry) => {
        const updates: NodeUpdate[] = [];
        for (const [, next] of Object.values(entry.changes.updated) as [TLShape, TLShape][]) {
          if (
            next.typeName === 'shape' &&
            (next as TLShape & { meta: { fileId?: string } }).meta?.fileId
          ) {
            const shape = next as TLShape & {
              props: { w: number; h: number };
              meta: { fileId: string };
            };
            updates.push({
              id: shape.id,
              fileId: shape.meta.fileId,
              x: shape.x,
              y: shape.y,
              width: shape.props.w,
              height: shape.props.h,
            });
          }
        }

        if (updates.length === 0) return;
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        saveTimerRef.current = setTimeout(() => {
          api.saveCanvasNodes(updates).catch((err) => console.error('Canvas save failed:', err));
        }, 2000);
      },
      { source: 'user', scope: 'document' }
    );

    return unsub;
  }, [editor]);

  return null;
}

export function forceShapeUpdate(editor: Editor, fileId: string, file?: FileRecord) {
  const shapeId = createShapeId(fileId);
  const shape = editor.getShape(shapeId);
  if (!shape) return;

  editor.updateShape({
    id: shapeId,
    type: 'file-card',
    meta: file ? buildCardMeta(file) : (shape as any).meta,
    props: {
      ...(shape as any).props,
      _v: ((shape as any).props._v ?? 0) + 1,
    },
  } as any);
}

async function uploadAndCreateShape(
  editor: Editor,
  file: File,
  x: number,
  y: number,
  onFileDropped?: (f: FileRecord) => void
) {
  try {
    const result = await api.uploadFile(file);
    if (result.duplicate) {
      console.info(`Duplicate skipped: ${file.name}`);
      return;
    }

    const fileRecord = result.file;
    fileStore.set(fileRecord.id, fileRecord);

    editor.createShape({
      id: createShapeId(fileRecord.id),
      type: 'file-card',
      x,
      y,
      props: { w: CARD_WIDTH, h: CARD_HEIGHT, fileId: fileRecord.id, _v: 0 },
      meta: buildCardMeta(fileRecord),
    } as any);

    forceShapeUpdate(editor, fileRecord.id, fileRecord);
    onFileDropped?.(fileRecord);
  } catch (err) {
    console.error(`Upload failed for ${file.name}:`, err);
  }
}

interface CanvasProps {
  onFileDropped?: (file: FileRecord) => void;
  onMount?: (editor: Editor) => void;
}

export function Canvas({ onFileDropped, onMount }: CanvasProps) {
  const [editor, setEditor] = useState<Editor | null>(null);
  const editorRef = useRef<Editor | null>(null);

  const handleMount = useCallback((ed: Editor) => {
    setEditor(ed);
    editorRef.current = ed;
    onMount?.(ed);

    // Suppress tldraw's built-in media/file handlers so every drop goes through
    // our single DOM onDrop path below. Without this, tldraw intercepts image and
    // video drops before the DOM event fires, causing those file types to be handled
    // twice (once by tldraw's default handler, once by ours) or not at all.
    ed.registerExternalContentHandler('files', async () => {});
    ed.registerExternalContentHandler('url',   async () => {});
    ed.registerExternalContentHandler('text',  async () => {});
  }, [onMount]);

  // Clipboard paste: images pasted from clipboard land at viewport center
  useEffect(() => {
    const ed = editorRef.current;
    if (!ed) return;

    async function onPaste(e: ClipboardEvent) {
      const items = Array.from(e.clipboardData?.items ?? []);
      const imageItem = items.find((item) => item.type.startsWith('image/'));
      if (!imageItem) return;

      e.preventDefault();
      const blob = imageItem.getAsFile();
      if (!blob || !editorRef.current) return;

      const ext  = blob.type.split('/')[1] ?? 'png';
      const name = `paste-${Date.now()}.${ext}`;
      const file = new File([blob], name, { type: blob.type });

      const vp = editorRef.current.getViewportPageBounds();
      const x  = vp.x + vp.w / 2 - CARD_WIDTH  / 2;
      const y  = vp.y + vp.h / 2 - CARD_HEIGHT / 2;

      await uploadAndCreateShape(editorRef.current, file, x, y, onFileDropped);
    }

    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [editor, onFileDropped]); // re-register when editor mounts

  const handleDomDrop = useCallback(
    async (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();

      const ed = editorRef.current;
      if (!ed) return;

      const files = Array.from(e.dataTransfer.files);
      if (files.length === 0) return;

      const canvasPoint = ed.screenToPage({ x: e.clientX, y: e.clientY });
      for (let i = 0; i < files.length; i++) {
        await uploadAndCreateShape(
          ed,
          files[i],
          canvasPoint.x + i * (CARD_WIDTH + 20),
          canvasPoint.y,
          onFileDropped
        );
      }
    },
    [onFileDropped]
  );

  return (
    <div
      className="canvas-container"
      onDrop={handleDomDrop}
      onDragOver={(e) => e.preventDefault()}
    >
      <Tldraw shapeUtils={CUSTOM_SHAPE_UTILS} onMount={handleMount} hideUi={true}>
        {editor && <CanvasInner />}
      </Tldraw>
    </div>
  );
}
