import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Tldraw,
  createShapeId,
  useEditor,
  type Editor,
  type TLShape,
} from '@tldraw/tldraw';
import '@tldraw/tldraw/tldraw.css';
import { FileCardShapeUtil, fileStore, CARD_WIDTH, CARD_HEIGHT } from './FileCard';
import { api, type FileRecord, type NodeUpdate } from '../api';

const CUSTOM_SHAPE_UTILS = [FileCardShapeUtil];

// ── Canvas Inner ─────────────────────────────────────────────────────────────

function CanvasInner() {
  const editor = useEditor();
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollTimersRef = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map());

  // ── Restore canvas on mount ───────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;

    async function restoreCanvas() {
      try {
        const files = await api.listFiles();
        if (cancelled) return;

        for (const file of files) {
          fileStore.set(file.id, file);
          const shapeId = createShapeId(file.id);
          if (editor.getShape(shapeId)) continue;

          const x = file.canvas_node?.x ?? Math.random() * 600;
          const y = file.canvas_node?.y ?? Math.random() * 400;
          // Use uniform card dimensions
          const w = file.canvas_node?.width ?? CARD_WIDTH;
          const h = file.canvas_node?.height ?? CARD_HEIGHT;

          editor.createShape({
            id: shapeId,
            type: 'file-card',
            x,
            y,
            props: { w, h, fileId: file.id, _v: 0 },
            meta: { fileId: file.id },
          } as any);

          // FIX: Force re-render after createShape so the fileStore data
          // is picked up immediately (HTMLContainer otherwise shows stale state)
          forceShapeUpdate(editor, file.id);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  // ── Canvas position persistence (debounced) ───────────────────────────────

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
          api.saveCanvasNodes(updates).catch((err) =>
            console.error('Canvas save failed:', err)
          );
        }, 2000);
      },
      { source: 'user', scope: 'document' }
    );
    return unsub;
  }, [editor]);

  // ── Status polling ────────────────────────────────────────────────────────

  function startPolling(fileId: string, ed: Editor) {
    if (pollTimersRef.current.has(fileId)) return;

    const timer = setInterval(async () => {
      try {
        const { status } = await api.getFileStatus(fileId);

        if (status === 'complete' || status === 'error') {
          clearInterval(timer);
          pollTimersRef.current.delete(fileId);

          const updated = await api.getFile(fileId);
          fileStore.set(fileId, updated);
          forceShapeUpdate(ed, fileId);
        }
      } catch (err) {
        console.error(`Poll failed for ${fileId}:`, err);
      }
    }, 3000);

    pollTimersRef.current.set(fileId, timer);
  }

  return null;
}

// ── Force re-render helper ────────────────────────────────────────────────────
// tldraw's HTMLContainer only re-renders when its own store changes.
// After mutating fileStore, call this to nudge tldraw into re-rendering the shape.

export function forceShapeUpdate(editor: Editor, fileId: string) {
  const shapeId = createShapeId(fileId);
  const shape = editor.getShape(shapeId);
  if (!shape) return;

  editor.updateShape({
    id: shapeId,
    type: 'file-card',
    props: {
      ...(shape as any).props,
      _v: ((shape as any).props._v ?? 0) + 1
    },
  });
}

// ── File upload + shape creation ──────────────────────────────────────────────

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

    // Set in store BEFORE creating shape so first render has data
    fileStore.set(fileRecord.id, fileRecord);

    const shapeId = createShapeId(fileRecord.id);

    editor.createShape({
      id: shapeId,
      type: 'file-card',
      x,
      y,
      props: { w: CARD_WIDTH, h: CARD_HEIGHT, fileId: fileRecord.id, _v: 0 },
      meta: { fileId: fileRecord.id },
    } as any);

    // Force immediate re-render so thumbnail shows without waiting for a nudge
    forceShapeUpdate(editor, fileRecord.id);

    onFileDropped?.(fileRecord);
  } catch (err) {
    console.error(`Upload failed for ${file.name}:`, err);
  }
}

// ── Canvas Component ──────────────────────────────────────────────────────────

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

    // FIX BUG 2: Override ALL tldraw external content handlers so tldraw
    // doesn't consume dropped files/urls/text before our handler runs.

    // Handle dropped files through our upload pipeline
    ed.registerExternalContentHandler('files', async ({ point, files: droppedFiles }) => {
      const canvasPoint = point ?? { x: 100, y: 100 };
      for (let i = 0; i < droppedFiles.length; i++) {
        await uploadAndCreateShape(
          ed,
          droppedFiles[i],
          canvasPoint.x + i * (CARD_WIDTH + 20),
          canvasPoint.y,
          onFileDropped
        );
      }
    });

    // No-op handlers: prevent tldraw from trying to process URLs/text as its
    // own content (which would consume the drop event for non-image types)
    ed.registerExternalContentHandler('url', async () => {
      // Intentionally empty — we don't handle URL drops
    });
    ed.registerExternalContentHandler('text', async () => {
      // Intentionally empty — we don't handle text drops
    });
  }, [onFileDropped]);

  // Fallback: also handle the raw DOM drop event for cases where
  // registerExternalContentHandler doesn't fire (e.g. browser quirks)
  const handleDomDrop = useCallback(
    async (e: React.DragEvent<HTMLDivElement>) => {
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
      <Tldraw
        shapeUtils={CUSTOM_SHAPE_UTILS}
        onMount={handleMount}
        hideUi={false}
      >
        {editor && <CanvasInner />}
      </Tldraw>
    </div>
  );
}
