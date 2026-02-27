import { useCallback, useEffect, useRef, useState } from 'react';
import type { Editor } from '@tldraw/tldraw';
import { api, type FolderRecord } from './api';
import { MainCanvas, placeFolderShape, refreshFolderShape } from './components/MainCanvas';
import { FolderCanvas } from './components/FolderCanvas';
import { ChatPanel } from './components/ChatPanel';
import { Sidebar } from './components/Sidebar';
import { TopBar } from './components/TopBar';
import './App.css';

type NavState =
  | { view: 'main' }
  | { view: 'folder'; folder: FolderRecord };

export default function App() {
  const mainEditorRef             = useRef<Editor | null>(null);
  const folderEditorRef           = useRef<Editor | null>(null);
  const [nav, setNav]             = useState<NavState>({ view: 'main' });
  const [isSidebarOpen, setSidebar] = useState(true);
  const [isChatOpen, setChatOpen] = useState(false);
  const [isZoomMenuOpen, setZoomMenuOpen] = useState(false);
  const [zoomPercent, setZoomPercent] = useState(100);
  const zoomMenuRef = useRef<HTMLDivElement | null>(null);

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
  const getActiveEditor = useCallback(
    () => (nav.view === 'folder' ? folderEditorRef.current : mainEditorRef.current),
    [nav.view]
  );
  const chatSessionId = isFolder ? `folder:${nav.folder.id}` : 'main';

  useEffect(() => {
    const timer = setInterval(() => {
      const editor = getActiveEditor();
      if (!editor) return;
      setZoomPercent(Math.round(editor.getZoomLevel() * 100));
    }, 120);
    return () => clearInterval(timer);
  }, [getActiveEditor]);

  useEffect(() => {
    if (!isZoomMenuOpen) return;
    function onPointerDown(e: MouseEvent) {
      if (!zoomMenuRef.current) return;
      if (!zoomMenuRef.current.contains(e.target as Node)) setZoomMenuOpen(false);
    }
    window.addEventListener('mousedown', onPointerDown);
    return () => window.removeEventListener('mousedown', onPointerDown);
  }, [isZoomMenuOpen]);

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
              onMount={(ed) => { folderEditorRef.current = ed; }}
            />
          </div>
        )}

        <div className="zoom-controls" ref={zoomMenuRef}>
          {isZoomMenuOpen && (
            <div className="zoom-menu">
              <button
                className="zoom-menu-item"
                onClick={() => {
                  getActiveEditor()?.zoomToFit({ animation: { duration: 220 } });
                  setZoomMenuOpen(false);
                }}
              >
                Zoom to fit
              </button>
              <button
                className="zoom-menu-item"
                onClick={() => {
                  getActiveEditor()?.zoomToSelection({ animation: { duration: 220 } });
                  setZoomMenuOpen(false);
                }}
              >
                Zoom to selection
              </button>
              <button
                className="zoom-menu-item"
                onClick={() => {
                  getActiveEditor()?.resetZoom(undefined, { animation: { duration: 220 } });
                  setZoomMenuOpen(false);
                }}
              >
                Reset to 100%
              </button>
            </div>
          )}
          <button
            className="zoom-btn"
            onClick={() => getActiveEditor()?.zoomIn(undefined, { animation: { duration: 160 } })}
            title="Zoom in"
          >
            +
          </button>
          <button
            className="zoom-btn"
            onClick={() => getActiveEditor()?.zoomOut(undefined, { animation: { duration: 160 } })}
            title="Zoom out"
          >
            -
          </button>
          <button
            className="zoom-btn zoom-value"
            onClick={() => setZoomMenuOpen((v) => !v)}
            title="Zoom options"
          >
            {zoomPercent}%
          </button>
        </div>

        <div className={`chat-floating ${isChatOpen ? 'open' : ''}`}>
          <div className="chat-panel-wrap">
            <ChatPanel
              sessionId={chatSessionId}
              isOpen={true}
              onToggle={() => setChatOpen(false)}
              getEditor={getActiveEditor}
              panelStyle={{
                width: '100%',
                height: '100%',
                borderLeft: 'none',
                border: '1px solid var(--border)',
                borderRadius: 14,
                boxShadow: '0 12px 28px rgba(20,15,10,0.14), 0 2px 6px rgba(20,15,10,0.08)',
              }}
            />
          </div>
        </div>

        {!isChatOpen && (
          <button className="chat-fab" onClick={() => setChatOpen(true)} title="Open AI chat">
            <ChatBubbleIcon />
            <span>AI Chat</span>
          </button>
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

function ChatBubbleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}
