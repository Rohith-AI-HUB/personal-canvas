import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Tldraw,
  createShapeId,
  useEditor,
  type Editor,
  type TLShape,
} from '@tldraw/tldraw';
import '@tldraw/tldraw/tldraw.css';
import {
  FolderCardShapeUtil,
  folderStore,
  FOLDER_WIDTH,
  FOLDER_HEIGHT,
  setOpenFolderHandler,
} from './FolderCard';
import {
  FileCardShapeUtil,
  fileStore,
  CARD_WIDTH,
  CARD_HEIGHT,
  setOpenFileHandler,
} from './FileCard';
import { api, type FolderRecord, type NodeUpdate, type FileRecord } from '../api';

const SHAPE_UTILS = [FolderCardShapeUtil, FileCardShapeUtil];
const CANVAS_ID   = 'main';
const FOLDER_COLS = 6;
const FILE_COLS = 5;
const FOLDER_START_X = 60;
const FOLDER_START_Y = 60;
const FILE_START_X = 80;

async function autoArrangeMain(editor: Editor): Promise<void> {
  const shapes = editor.getCurrentPageShapes();
  const folders = shapes
    .filter((s: any) => s.type === 'folder-card')
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const files = shapes
    .filter((s: any) => s.type === 'file-card')
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));

  const updates: NodeUpdate[] = [];

  folders.forEach((shape: any, i) => {
    const col = i % FOLDER_COLS;
    const row = Math.floor(i / FOLDER_COLS);
    const x = FOLDER_START_X + col * (FOLDER_WIDTH + 32);
    const y = FOLDER_START_Y + row * (FOLDER_HEIGHT + 48);
    if (shape.x !== x || shape.y !== y) {
      editor.updateShape({ id: shape.id, type: 'folder-card', x, y } as any);
    }
    const folderId = shape?.meta?.folderId ?? shape?.props?.folderId;
    if (typeof folderId === 'string' && folderId.length > 0) {
      updates.push({
        id: shape.id,
        folderId,
        canvasId: CANVAS_ID,
        x,
        y,
        width: shape?.props?.w ?? FOLDER_WIDTH,
        height: shape?.props?.h ?? FOLDER_HEIGHT,
      });
    }
  });

  const folderRows = Math.max(1, Math.ceil(folders.length / FOLDER_COLS));
  const fileStartY = FOLDER_START_Y + folderRows * (FOLDER_HEIGHT + 48) + 100;
  files.forEach((shape: any, i) => {
    const col = i % FILE_COLS;
    const row = Math.floor(i / FILE_COLS);
    const x = FILE_START_X + col * (CARD_WIDTH + 24);
    const y = fileStartY + row * (CARD_HEIGHT + 32);
    if (shape.x !== x || shape.y !== y) {
      editor.updateShape({ id: shape.id, type: 'file-card', x, y } as any);
    }
    const fileId = shape?.meta?.fileId ?? shape?.props?.fileId;
    if (typeof fileId === 'string' && fileId.length > 0) {
      updates.push({
        id: shape.id,
        fileId,
        canvasId: CANVAS_ID,
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

export function autoArrangeMainCanvas(editor: Editor): void {
  void autoArrangeMain(editor);
}

// ── Helpers exported for App.tsx ──────────────────────────────────────────────

export function placeFolderShape(editor: Editor, folder: FolderRecord): void {
  folderStore.set(folder.id, folder);
  const shapeId = createShapeId(folder.id);
  if (editor.getShape(shapeId)) return;
  const vp = editor.getViewportPageBounds();
  const x  = vp.x + vp.w / 2 - FOLDER_WIDTH  / 2 + (Math.random() - 0.5) * 200;
  const y  = vp.y + vp.h / 2 - FOLDER_HEIGHT / 2 + (Math.random() - 0.5) * 100;
  editor.createShape({
    id: shapeId, type: 'folder-card', x, y,
    props: { w: FOLDER_WIDTH, h: FOLDER_HEIGHT, folderId: folder.id, _v: 0 },
    meta:  { folderId: folder.id },
  } as any);
  void autoArrangeMain(editor);
}

export function refreshFolderShape(editor: Editor, folder: FolderRecord): void {
  folderStore.set(folder.id, folder);
  const shapeId = createShapeId(folder.id);
  const shape   = editor.getShape(shapeId);
  if (!shape) return;
  editor.updateShape({
    id: shapeId, type: 'folder-card',
    meta:  (shape as any).meta,
    props: { ...(shape as any).props, _v: ((shape as any).props._v ?? 0) + 1 },
  } as any);
}

// ── Inner (needs editor context) ─────────────────────────────────────────────

function MainCanvasInner() {
  const editor       = useEditor();
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function restore() {
      const [folders, files, savedNodes] = await Promise.all([
        api.listFolders(),
        api.listFiles(),
        api.getCanvasNodes(CANVAS_ID),
      ]);
      if (cancelled) return;

      const nodeMap = new Map<string, (typeof savedNodes)[number]>();
      for (const node of savedNodes) {
        const key = node.folder_id ?? node.file_id;
        if (key) nodeMap.set(key, node);
      }

      const fileIds = new Set(files.map((f) => f.id));

      folders.forEach((folder, i) => {
        folderStore.set(folder.id, folder);
        const shapeId = createShapeId(folder.id);
        if (editor.getShape(shapeId)) return;

        const saved = nodeMap.get(folder.id);
        const col = i % 6;
        const row = Math.floor(i / 6);
        const x   = saved?.x ?? col * (FOLDER_WIDTH + 32) + 60;
        const y   = saved?.y ?? row * (FOLDER_HEIGHT + 48) + 60;

        editor.createShape({
          id: shapeId, type: 'folder-card', x, y,
          props: { w: FOLDER_WIDTH, h: FOLDER_HEIGHT, folderId: folder.id, _v: 0 },
          meta:  { folderId: folder.id },
        } as any);
      });

      files.forEach((file, i) => {
        fileStore.set(file.id, file);
        const shapeId = createShapeId(file.id);
        if (editor.getShape(shapeId)) return;

        const saved = nodeMap.get(file.id);
        // Only render file cards that have an explicit node on the main canvas.
        if (!saved) return;
        const col = i % 5;
        const row = Math.floor(i / 5);
        const x   = saved.x ?? col * (CARD_WIDTH + 24) + 80;
        const y   = saved.y ?? row * (CARD_HEIGHT + 32) + 420;

        editor.createShape({
          id: shapeId, type: 'file-card', x, y,
          props: { w: CARD_WIDTH, h: CARD_HEIGHT, fileId: file.id, _v: 0 },
          meta:  { fileId: file.id },
        } as any);
      });

      // Remove stale file-card shapes that no longer exist in backend.
      editor
        .getCurrentPageShapes()
        .filter((s: any) => s.type === 'file-card')
        .forEach((s: any) => {
          const fileId = s?.meta?.fileId ?? s?.props?.fileId;
          if (typeof fileId === 'string' && fileId.length > 0 && !fileIds.has(fileId)) {
            editor.deleteShape(s.id);
          }
        });

      await autoArrangeMain(editor);
    }

    restore().catch(console.error);
    return () => { cancelled = true; };
  }, [editor]);

  useEffect(() => {
    const unsub = editor.store.listen(
      (entry) => {
        const removedFolderIds = Array.from(new Set(
          Object.values(entry.changes.removed)
            .filter((rec: any) => rec?.typeName === 'shape')
            .map((shape: any) => shape?.meta?.folderId ?? shape?.props?.folderId)
            .filter((id: unknown): id is string => typeof id === 'string' && id.length > 0)
        ));

        if (removedFolderIds.length > 0) {
          Promise.allSettled(removedFolderIds.map((folderId) => api.deleteFolder(folderId)))
            .then((results) => {
              const deleted = removedFolderIds.filter((_, i) => results[i].status === 'fulfilled');
              deleted.forEach((folderId) => folderStore.delete(folderId));
            })
            .catch((err) => console.error('Folder delete sync failed:', err));
        }

        const removedFileIds = Array.from(new Set(
          Object.values(entry.changes.removed)
            .filter((rec: any) => rec?.typeName === 'shape')
            .map((shape: any) => shape?.meta?.fileId ?? shape?.props?.fileId)
            .filter((id: unknown): id is string => typeof id === 'string' && id.length > 0)
        ));

        if (removedFileIds.length > 0) {
          Promise.allSettled(removedFileIds.map((fileId) => api.deleteFile(fileId)))
            .then((results) => {
              const deleted = removedFileIds.filter((_, i) => results[i].status === 'fulfilled');
              deleted.forEach((fileId) => fileStore.delete(fileId));
            })
            .catch((err) => console.error('File delete sync failed:', err));
        }

        if (removedFolderIds.length > 0 || removedFileIds.length > 0) {
          setTimeout(() => { void autoArrangeMain(editor); }, 120);
        }

        const updates: NodeUpdate[] = [];
        for (const [, next] of Object.values(entry.changes.updated) as [TLShape, TLShape][]) {
          if (next.typeName === 'shape' && (next as any).meta?.folderId) {
            const s = next as any;
            updates.push({
              id: s.id, folderId: s.meta.folderId,
              canvasId: CANVAS_ID,
              x: s.x, y: s.y, width: s.props.w, height: s.props.h,
            });
          } else if (next.typeName === 'shape' && (next as any).meta?.fileId) {
            const s = next as any;
            updates.push({
              id: s.id, fileId: s.meta.fileId,
              canvasId: CANVAS_ID,
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
  }, [editor]);

  return null;
}

// ── Public component ──────────────────────────────────────────────────────────

interface MainCanvasProps {
  onOpenFolder: (folderId: string) => void;
  onOpenViewer?: (file: FileRecord) => void;
  onMount?:     (editor: Editor) => void;
}

export function MainCanvas({ onOpenFolder, onOpenViewer, onMount }: MainCanvasProps) {
  const [editor, setEditor] = useState<Editor | null>(null);

  useEffect(() => {
    setOpenFolderHandler(onOpenFolder);
  }, [onOpenFolder]);

  useEffect(() => {
    setOpenFileHandler(onOpenViewer);
    return () => setOpenFileHandler(undefined);
  }, [onOpenViewer]);

  const handleMount = useCallback((ed: Editor) => {
    setEditor(ed);
    onMount?.(ed);
    ed.registerExternalContentHandler('files', async () => {});
    ed.registerExternalContentHandler('url',   async () => {});
    ed.registerExternalContentHandler('text',  async () => {});
  }, [onMount]);

  return (
    <div className="canvas-container">
      <Tldraw shapeUtils={SHAPE_UTILS} onMount={handleMount} hideUi={true}>
        {editor && <MainCanvasInner />}
      </Tldraw>
    </div>
  );
}
