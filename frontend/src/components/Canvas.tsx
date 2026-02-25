import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Tldraw,
  createShapeId,
  useEditor,
  type Editor,
  type TLShape,
} from '@tldraw/tldraw';
import '@tldraw/tldraw/tldraw.css';
import { FileCardShapeUtil, fileStore } from './FileCard';
import { api, type FileRecord, type NodeUpdate } from '../api';

const CUSTOM_SHAPE_UTILS = [FileCardShapeUtil];

// ── Canvas inner — has access to editor via useEditor ────────────────────────

function CanvasInner() {
  const editor = useEditor();
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollTimersRef = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map());

  // ── Restore canvas state on mount ─────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;

    async function restoreCanvas() {
      try {
        const files = await api.listFiles();
        if (cancelled) return;

        for (const file of files) {
          fileStore.set(file.id, file);

          const shapeId = createShapeId(file.id);

          // Skip if shape already on canvas (e.g. hot-reload)
          if (editor.getShape(shapeId)) continue;

          const x = file.canvas_node?.x ?? Math.random() * 600;
          const y = file.canvas_node?.y ?? Math.random() * 400;
          const w = file.canvas_node?.width ?? 200;
          const h = file.canvas_node?.height ?? 250;

          editor.createShape({
            id: shapeId,
            type: 'file-card',
            x,
            y,
            props: { w, h, fileId: file.id },
            meta: { fileId: file.id },
          });

          // Start polling for non-complete files
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
      // Clear all polling timers
      for (const timer of pollTimersRef.current.values()) {
        clearInterval(timer);
      }
      pollTimersRef.current.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  // ── Canvas state persistence (debounced, filtered) ────────────────────────

  useEffect(() => {
    const unsub = editor.store.listen(
      (entry) => {
        const updates: NodeUpdate[] = [];

        for (const [, next] of Object.values(entry.changes.updated) as [TLShape, TLShape][]) {
          if (next.typeName === 'shape' && (next as TLShape & { meta: { fileId?: string } }).meta?.fileId) {
            const shape = next as TLShape & { props: { w: number; h: number }; meta: { fileId: string } };
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

        // Debounce — write 2s after last change
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        saveTimerRef.current = setTimeout(() => {
          api.saveCanvasNodes(updates).catch((err) =>
            console.error('Canvas save failed:', err)
          );
        }, 2000);
      },
      { source: 'user', scope: 'document' } // excludes camera movement
    );

    return unsub;
  }, [editor]);

  // ── Polling helper for in-progress files ─────────────────────────────────

  function startPolling(fileId: string, ed: Editor) {
    if (pollTimersRef.current.has(fileId)) return;

    const timer = setInterval(async () => {
      try {
        const { status, error_message } = await api.getFileStatus(fileId);

        if (status === 'complete' || status === 'error') {
          clearInterval(timer);
          pollTimersRef.current.delete(fileId);

          // Fetch full updated record and refresh shape
          const updated = await api.getFile(fileId);
          fileStore.set(fileId, updated);

          // Force shape re-render by nudging a prop
          const shapeId = createShapeId(fileId);
          const shape = ed.getShape(shapeId);
          if (shape) {
            ed.updateShape({
              id: shapeId,
              type: 'file-card',
              // Touch props to force HTMLContainer re-render
              props: { ...(shape as any).props },
            });
          }
        }
      } catch (err) {
        console.error(`Poll failed for ${fileId}:`, err);
      }
    }, 3000);

    pollTimersRef.current.set(fileId, timer);
  }

  return null; // renders nothing — all canvas output comes from tldraw shapes
}

// ── Drop handler ─────────────────────────────────────────────────────────────

interface CanvasProps {
  onFileDropped?: (file: FileRecord) => void;
}

export function Canvas({ onFileDropped }: CanvasProps) {
  const [editor, setEditor] = useState<Editor | null>(null);

  const handleMount = useCallback((ed: Editor) => {
    setEditor(ed);
  }, []);

  const handleFileDrop = useCallback(
    async (ed: Editor, files: File[], point: { x: number; y: number }) => {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const x = point.x + i * 220; // offset multiple drops horizontally
        const y = point.y;

        try {
          const result = await api.uploadFile(file);

          if (result.duplicate) {
            console.info(`Duplicate file skipped: ${file.name}`);
            continue;
          }

          const fileRecord = result.file;
          fileStore.set(fileRecord.id, fileRecord);

          const shapeId = createShapeId(fileRecord.id);

          ed.createShape({
            id: shapeId,
            type: 'file-card',
            x,
            y,
            props: { w: 200, h: 250, fileId: fileRecord.id },
            meta: { fileId: fileRecord.id },
          });

          onFileDropped?.(fileRecord);
        } catch (err) {
          console.error(`Failed to upload ${file.name}:`, err);
        }
      }
    },
    [onFileDropped]
  );

  return (
    <div
      style={{ position: 'fixed', inset: 0 }}
      onDrop={async (e) => {
        e.preventDefault();
        if (!editor) return;

        const files = Array.from(e.dataTransfer.files);
        if (files.length === 0) return;

        // Convert screen coords to canvas coords
        const canvasPoint = editor.screenToPage({ x: e.clientX, y: e.clientY });
        await handleFileDrop(editor, files, canvasPoint);
      }}
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
