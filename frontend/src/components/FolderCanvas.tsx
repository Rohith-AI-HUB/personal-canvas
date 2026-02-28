import { useCallback, useEffect, useRef, useState, type DragEvent, type MouseEvent as ReactMouseEvent } from 'react';
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
  setOpenFileHandler,
  type FileCardMeta,
} from './FileCard';
import { FileContextMenu, type ContextMenuAction } from './FileContextMenu';
import { FileInspector } from './FileInspector';
import { ArrangeToolbar } from './ArrangeToolbar';
import { api, type FileRecord, type FolderRecord, type NodeUpdate } from '../api';

const SHAPE_UTILS = [FileCardShapeUtil];
const AUTO_COLS = 5;
const AUTO_START_X = 60;
const AUTO_START_Y = 60;

export function buildCardMeta(file: FileRecord): FileCardMeta {
  const meta: FileCardMeta = { fileId: file.id, tags: file.tags ?? [], status: file.status };
  if (file.metadata?.ai_title)   meta.aiTitle      = file.metadata.ai_title;
  if (file.metadata?.ai_summary) meta.summary      = file.metadata.ai_summary;
  if (file.error_message)        meta.errorMessage = file.error_message;
  return meta;
}

async function autoArrangeFolderFiles(editor: Editor, canvasId: string): Promise<void> {
  const cards = editor
    .getCurrentPageShapes()
    .filter((s: any) => s.type === 'file-card')
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));

  const updates: NodeUpdate[] = [];
  cards.forEach((shape: any, i) => {
    const col = i % AUTO_COLS;
    const row = Math.floor(i / AUTO_COLS);
    const x = AUTO_START_X + col * (CARD_WIDTH + 24);
    const y = AUTO_START_Y + row * (CARD_HEIGHT + 32);
    if (shape.x !== x || shape.y !== y) {
      editor.updateShape({ id: shape.id, type: 'file-card', x, y } as any);
    }
    const fileId = shape?.meta?.fileId ?? shape?.props?.fileId;
    if (typeof fileId === 'string' && fileId.length > 0) {
      updates.push({
        id: shape.id,
        fileId,
        canvasId,
        x,
        y,
        width: shape?.props?.w ?? CARD_WIDTH,
        height: shape?.props?.h ?? CARD_HEIGHT,
      });
    }
  });

  if (updates.length > 0) {
    await api.saveCanvasNodes(updates).catch(console.error);
  }
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

      await autoArrangeFolderFiles(editor, canvasId);
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
        const removedFileIds = Array.from(new Set(
          Object.values(entry.changes.removed)
            .filter((rec: any) => rec?.typeName === 'shape')
            .map((shape: any) => shape?.meta?.fileId ?? shape?.props?.fileId)
            .filter((id: unknown): id is string => typeof id === 'string' && id.length > 0)
        ));

        if (removedFileIds.length > 0) {
          const isHardDelete =
            (editor as any).getShiftKey?.() === true || (editor as any).shiftKey === true;
          const removeOp = (fileId: string) =>
            isHardDelete ? api.deleteFile(fileId) : api.removeFileFromFolder(folder.id, fileId);

          Promise.allSettled(removedFileIds.map(removeOp))
            .then((results) => {
              const deleted = removedFileIds.filter((_, i) => results[i].status === 'fulfilled');
              deleted.forEach((fileId) => fileStore.delete(fileId));
              if (deleted.length) onFilesChanged();
            })
            .catch((err) => console.error('File delete sync failed:', err));
        }

        if (removedFileIds.length > 0) {
          setTimeout(() => { void autoArrangeFolderFiles(editor, canvasId); }, 120);
        }

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
  }, [editor, canvasId, folder.id, onFilesChanged]);

  return null;
}

// ── Upload helper ─────────────────────────────────────────────────────────────

export async function uploadAndAddToFolder(
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

    // New uploads need their own polling cycle; otherwise thumbnail/status updates
    // only appear after folder remount.
    if (fileRecord.status !== 'complete' && fileRecord.status !== 'error') {
      let attempts = 0;
      const timer = setInterval(async () => {
        attempts += 1;
        try {
          const { status } = await api.getFileStatus(fileRecord.id);
          if (status !== 'complete' && status !== 'error') {
            if (attempts >= 120) clearInterval(timer); // ~6 minutes safety cap
            return;
          }

          clearInterval(timer);
          const updated = await api.getFile(fileRecord.id);
          fileStore.set(updated.id, updated);

          const shape = editor.getShape(shapeId);
          if (shape) {
            editor.updateShape({
              id: shapeId,
              type: 'file-card',
              meta: buildCardMeta(updated),
              props: { ...(shape as any).props, _v: ((shape as any).props._v ?? 0) + 1 },
            } as any);
          }

          onFilesChanged();
        } catch {
          if (attempts >= 120) clearInterval(timer);
        }
      }, 3000);
    }

    await autoArrangeFolderFiles(editor, canvasId);
  } catch (err) {
    console.error('Upload failed:', err);
  }
}

// ── Public component ──────────────────────────────────────────────────────────

interface FolderCanvasProps {
  folder:          FolderRecord;
  onFilesChanged:  () => void;
  onMount?:        (editor: Editor) => void;
  onOpenViewer?:   (file: FileRecord) => void;
}

interface ContextMenu {
  x:      number;
  y:      number;
  fileId: string;
}

interface Inspector {
  x:      number;
  y:      number;
  fileId: string;
}

export function FolderCanvas({ folder, onFilesChanged, onMount, onOpenViewer }: FolderCanvasProps) {
  const [editor, setEditor]           = useState<Editor | null>(null);
  const editorRef                     = useRef<Editor | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null);
  const [inspector,   setInspector]   = useState<Inspector | null>(null);
  const canvasId  = `folder:${folder.id}`;

  useEffect(() => {
    setOpenFileHandler(onOpenViewer);
    return () => setOpenFileHandler(undefined);
  }, [onOpenViewer]);

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

  const handleReanalyze = useCallback(async (fileId: string) => {
    try {
      await api.reanalyzeFile(fileId);
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
    } catch (err) { console.error('Re-analyze failed:', err); }
  }, []);

  const handleContextMenuCapture = useCallback((e: ReactMouseEvent<HTMLDivElement>) => {
    const ed = editorRef.current;
    if (!ed) return;

    const pagePoint = ed.screenToPage({ x: e.clientX, y: e.clientY });
    const shapes    = ed.getCurrentPageShapes();
    const hit       = shapes.find((s: any) => {
      if (s.type !== 'file-card') return false;
      const w = s.props?.w ?? CARD_WIDTH;
      const h = s.props?.h ?? CARD_HEIGHT;
      return (
        pagePoint.x >= s.x && pagePoint.x <= s.x + w &&
        pagePoint.y >= s.y && pagePoint.y <= s.y + h
      );
    });

    if (!hit) return;

    e.preventDefault();
    e.stopPropagation();
    (e.nativeEvent as MouseEvent).stopImmediatePropagation?.();
    const fileId = (hit as any).props?.fileId ?? (hit as any).meta?.fileId;
    if (!fileId) return;

    setContextMenu({ x: e.clientX, y: e.clientY, fileId });
  }, []);

  const handleInspectorSaved = useCallback((updated: FileRecord) => {
    fileStore.set(updated.id, updated);
    const ed = editorRef.current;
    if (!ed) return;
    const shapeId = createShapeId(updated.id);
    const shape   = ed.getShape(shapeId);
    if (!shape) return;
    ed.updateShape({
      id: shapeId, type: 'file-card',
      meta: buildCardMeta(updated),
      props: { ...(shape as any).props, _v: ((shape as any).props._v ?? 0) + 1 },
    } as any);
  }, []);

  const contextMenuActions = useCallback((fileId: string): ContextMenuAction[] => {
    const file = fileStore.get(fileId);
    return [
      {
        label: 'Edit title & tags',
        icon:  <EditIcon />,
        onClick: () => {
          setInspector({ x: contextMenu!.x + 210, y: contextMenu!.y, fileId });
        },
      },
      {
        label: 'Re-analyze with AI',
        icon:  <SparkleIcon />,
        onClick: () => void handleReanalyze(fileId),
        disabled: file?.status === 'processing' || file?.status === 'pending',
      },
      {
        label: 'Remove from folder',
        icon:  <RemoveIcon />,
        danger: true,
        onClick: () => {
          const ed = editorRef.current;
          if (!ed) return;
          const shapeId = createShapeId(fileId);
          ed.deleteShape(shapeId);
        },
      },
    ];
  }, [handleReanalyze, contextMenu]);

  // Clipboard paste: images pasted from clipboard land on the canvas
  useEffect(() => {
    if (!editor) return;

    async function onPaste(e: ClipboardEvent) {
      const items = Array.from(e.clipboardData?.items ?? []);
      const imageItem = items.find((item) => item.type.startsWith('image/'));
      if (!imageItem) return;

      e.preventDefault();
      const blob = imageItem.getAsFile();
      if (!blob) return;

      // Give the pasted image a timestamped filename
      const ext  = blob.type.split('/')[1] ?? 'png';
      const name = `paste-${Date.now()}.${ext}`;
      const file = new File([blob], name, { type: blob.type });

      const vp = editor!.getViewportPageBounds();
      const x  = vp.x + vp.w / 2 - CARD_WIDTH  / 2;
      const y  = vp.y + vp.h / 2 - CARD_HEIGHT / 2;

      await uploadAndAddToFolder(
        editor!, file, folder.id, x, y,
        canvasId, onFilesChanged,
      );
    }

    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [editor, folder.id, canvasId, onFilesChanged]);

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

  return (
    <div
      className="canvas-container"
      onDrop={handleDomDrop}
      onDragOver={(e) => e.preventDefault()}
      onContextMenuCapture={handleContextMenuCapture}
    >
      <Tldraw shapeUtils={SHAPE_UTILS} onMount={handleMount} hideUi={true}>
        {editor && (
          <FolderCanvasInner
            folder={folder}
            canvasId={canvasId}
            onRetry={handleRetry}
            onFilesChanged={onFilesChanged}
          />
        )}
      </Tldraw>

      {contextMenu && (
        <FileContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          actions={contextMenuActions(contextMenu.fileId)}
          onClose={() => setContextMenu(null)}
        />
      )}

      {inspector && (() => {
        const file = fileStore.get(inspector.fileId);
        if (!file) return null;
        return (
          <FileInspector
            file={file}
            x={inspector.x}
            y={inspector.y}
            onClose={() => setInspector(null)}
            onSaved={(updated) => { handleInspectorSaved(updated); }}
          />
        );
      })()}

      {editor && <ArrangeToolbar editor={editor} />}
    </div>
  );
}

// ── Context menu icons ────────────────────────────────────────────────────────

function EditIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
    </svg>
  );
}

function SparkleIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3l1.9 5.8L20 10.5l-4.6 4.3 1.3 6.2L12 18l-4.7 3 1.3-6.2L4 10.5l6.1-1.7z"/>
    </svg>
  );
}

function RemoveIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 6L6 18M6 6l12 12"/>
    </svg>
  );
}
