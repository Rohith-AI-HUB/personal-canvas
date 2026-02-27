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
import { api, type FolderRecord, type NodeUpdate } from '../api';

const SHAPE_UTILS = [FolderCardShapeUtil];
const CANVAS_ID   = 'main';

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
      const [folders, savedNodes] = await Promise.all([
        api.listFolders(),
        api.getCanvasNodes(CANVAS_ID),
      ]);
      if (cancelled) return;

      const nodeMap = new Map<string, (typeof savedNodes)[number]>();
      for (const node of savedNodes) {
        const key = node.folder_id ?? node.file_id;
        if (key) nodeMap.set(key, node);
      }

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
    }

    restore().catch(console.error);
    return () => { cancelled = true; };
  }, [editor]);

  useEffect(() => {
    const unsub = editor.store.listen(
      (entry) => {
        const updates: NodeUpdate[] = [];
        for (const [, next] of Object.values(entry.changes.updated) as [TLShape, TLShape][]) {
          if (next.typeName === 'shape' && (next as any).meta?.folderId) {
            const s = next as any;
            updates.push({
              id: s.id, folderId: s.meta.folderId,
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
  onMount?:     (editor: Editor) => void;
}

export function MainCanvas({ onOpenFolder, onMount }: MainCanvasProps) {
  const [editor, setEditor] = useState<Editor | null>(null);

  useEffect(() => {
    setOpenFolderHandler(onOpenFolder);
  }, [onOpenFolder]);

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
