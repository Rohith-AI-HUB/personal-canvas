import { useCallback, useRef, useState } from 'react';
import type { Editor } from '@tldraw/tldraw';
import { api, type FolderRecord } from './api';
import { MainCanvas, placeFolderShape, refreshFolderShape } from './components/MainCanvas';
import { FolderCanvas } from './components/FolderCanvas';
import { Sidebar } from './components/Sidebar';
import { TopBar } from './components/TopBar';
import './App.css';

type NavState =
  | { view: 'main' }
  | { view: 'folder'; folder: FolderRecord };

export default function App() {
  const mainEditorRef             = useRef<Editor | null>(null);
  const [nav, setNav]             = useState<NavState>({ view: 'main' });
  const [isSidebarOpen, setSidebar] = useState(true);

  const openFolder = useCallback(async (folderId: string) => {
    try {
      const folders = await api.listFolders();
      const folder  = folders.find((f) => f.id === folderId);
      if (folder) setNav({ view: 'folder', folder });
    } catch (err) { console.error('openFolder:', err); }
  }, []);

  const goBack = useCallback(() => setNav({ view: 'main' }), []);

  const handleNewFolder = useCallback(async () => {
    try {
      const folder = await api.createFolder('New Folder');
      if (mainEditorRef.current) placeFolderShape(mainEditorRef.current, folder);
      setNav({ view: 'folder', folder });
    } catch (err) { console.error('createFolder:', err); }
  }, []);

  // Stable callback — reads navRef to avoid stale closure
  const navRef = useRef(nav);
  navRef.current = nav;

  const handleFilesChanged = useCallback(async () => {
    const current = navRef.current;
    if (current.view !== 'folder') return;
    try {
      const folders = await api.listFolders();
      const updated = folders.find((f) => f.id === current.folder.id);
      if (!updated) return;
      setNav({ view: 'folder', folder: updated });
      if (mainEditorRef.current) refreshFolderShape(mainEditorRef.current, updated);
    } catch { /* non-fatal */ }
  }, []);

  const handleRename = useCallback(async (name: string) => {
    if (nav.view !== 'folder') return;
    try {
      const updated = await api.updateFolder(nav.folder.id, { name });
      setNav({ view: 'folder', folder: updated });
      if (mainEditorRef.current) refreshFolderShape(mainEditorRef.current, updated);
    } catch (err) { console.error('rename:', err); }
  }, [nav]);

  const isFolder = nav.view === 'folder';

  return (
    <div className="app-layout">
      <Sidebar
        isOpen={isSidebarOpen}
        onToggle={() => setSidebar((v) => !v)}
        onOpenFolder={openFolder}
        onNewFolder={handleNewFolder}
      />

      <div className="workspace">

        {/* Breadcrumb bar — folder view only */}
        {isFolder && (
          <div className="breadcrumb-bar">
            <button className="back-btn" onClick={goBack}>
              <BackArrow />
              <span>Library</span>
            </button>
            <span className="breadcrumb-sep">›</span>
            <InlineRename
              value={nav.folder.name}
              onCommit={handleRename}
            />
          </div>
        )}

        {/* Top bar — main canvas only */}
        {!isFolder && (
          <div className="topbar">
            <TopBar
              getEditor={() => mainEditorRef.current}
              onNewFolder={handleNewFolder}
            />
          </div>
        )}

        {/* Main bookshelf canvas — always mounted */}
        <div className="canvas-layer" style={{ display: isFolder ? 'none' : 'block' }}>
          <MainCanvas
            onOpenFolder={openFolder}
            onMount={(ed) => { mainEditorRef.current = ed; }}
          />
        </div>

        {/* Folder canvas — mounted per folder */}
        {isFolder && (
          <div className="canvas-layer">
            <FolderCanvas
              key={nav.folder.id}
              folder={nav.folder}
              onFilesChanged={handleFilesChanged}
            />
          </div>
        )}
      </div>
    </div>
  );
}

// ── Inline rename input ───────────────────────────────────────────────────────

function InlineRename({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft,   setDraft]   = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  const startEdit = () => {
    setDraft(value);
    setEditing(true);
    setTimeout(() => { inputRef.current?.select(); }, 10);
  };

  const commit = () => {
    setEditing(false);
    const trimmed = draft.trim();
    if (trimmed && trimmed !== value) onCommit(trimmed);
    else setDraft(value);
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        id="rename-input"
        name="rename-input"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') { setEditing(false); setDraft(value); }
        }}
        style={{
          fontSize: 12,
          fontWeight: 600,
          color: 'var(--text-1)',
          background: 'var(--bg-canvas)',
          border: '1.5px solid var(--accent)',
          borderRadius: 5,
          padding: '2px 7px',
          outline: 'none',
          fontFamily: 'inherit',
          width: Math.max(100, draft.length * 7.5),
          maxWidth: 320,
          letterSpacing: '-0.01em',
        }}
        autoFocus
      />
    );
  }

  return (
    <span
      className="breadcrumb-title"
      style={{ cursor: 'text' }}
      onClick={startEdit}
      title="Click to rename"
    >
      {value}
    </span>
  );
}

function BackArrow() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 12H5M12 5l-7 7 7 7"/>
    </svg>
  );
}
