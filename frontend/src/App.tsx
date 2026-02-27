import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import type { Editor } from '@tldraw/tldraw';
import { api, type FolderRecord } from './api';
import { MainCanvas, placeFolderShape, refreshFolderShape } from './components/MainCanvas';
import { FolderCanvas, uploadAndAddToFolder } from './components/FolderCanvas';
import { CARD_WIDTH, CARD_HEIGHT } from './components/FileCard';
import { ChatPanel } from './components/ChatPanel';
import { Sidebar } from './components/Sidebar';
import { TopBar } from './components/TopBar';
import { FolderToolbar } from './components/FolderToolbar';
import { exportCanvasToPng } from './components/exportCanvas';
import './App.css';

type NavState =
  | { view: 'main' }
  | { view: 'folder'; folder: FolderRecord };

export default function App() {
  const mainEditorRef   = useRef<Editor | null>(null);
  const folderEditorRef = useRef<Editor | null>(null);
  const [nav, setNav]   = useState<NavState>({ view: 'main' });
  const [isSidebarOpen, setSidebar]     = useState(true);
  const [isChatOpen, setChatOpen]       = useState(false);
  const [isZoomMenuOpen, setZoomMenuOpen] = useState(false);
  const [zoomPercent, setZoomPercent]   = useState(100);
  const zoomMenuRef    = useRef<HTMLDivElement | null>(null);
  const fileInputRef   = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const [importProgress, setImportProgress] = useState<{ done: number; total: number } | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [uiError, setUiError] = useState<string | null>(null);

  const handleExportFolder = useCallback(async () => {
    const ed = folderEditorRef.current;
    if (!ed || isExporting || nav.view !== 'folder') return;
    setIsExporting(true);
    try {
      const name = (nav as any).folder.name ?? 'folder';
      await exportCanvasToPng(ed, name);
    } finally {
      setIsExporting(false);
    }
  }, [isExporting, nav]);

  const navRef = useRef(nav);
  navRef.current = nav;

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
      setUiError(null);
      const folder = await api.createFolder('New Folder');
      if (mainEditorRef.current) placeFolderShape(mainEditorRef.current, folder);
      setNav({ view: 'folder', folder });
    } catch (err) {
      console.error('createFolder:', err);
      const details = err instanceof Error ? err.message : String(err);
      setUiError(`Unable to create folder. ${details}`);
    }
  }, []);

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

  // Add individual files
  const handlePickerFiles = useCallback(async (e: ChangeEvent<HTMLInputElement>) => {
    const ed      = folderEditorRef.current;
    const current = navRef.current;
    if (!ed || current.view !== 'folder') return;

    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;

    const vp     = ed.getViewportPageBounds();
    const startX = vp.x + Math.max(36, vp.w * 0.15);
    const startY = vp.y + Math.max(36, vp.h * 0.15);

    for (let i = 0; i < files.length; i++) {
      await uploadAndAddToFolder(
        ed, files[i], current.folder.id,
        startX + i * (CARD_WIDTH + 24), startY,
        `folder:${current.folder.id}`, handleFilesChanged,
      );
    }
    e.target.value = '';
  }, [handleFilesChanged]);

  // Bulk folder import
  const handleFolderImport = useCallback(async (e: ChangeEvent<HTMLInputElement>) => {
    const ed      = folderEditorRef.current;
    const current = navRef.current;
    if (!ed || current.view !== 'folder') return;

    const allFiles   = Array.from(e.target.files ?? []);
    // Skip hidden files and OS artifacts
    const validFiles = allFiles.filter(
      (f) => !f.name.startsWith('.') && f.name !== 'Thumbs.db' && f.size > 0
    );
    if (!validFiles.length) return;

    const vp     = ed.getViewportPageBounds();
    const cols   = Math.min(5, validFiles.length);
    const startX = vp.x + Math.max(36, vp.w * 0.1);
    const startY = vp.y + Math.max(36, vp.h * 0.1);

    setImportProgress({ done: 0, total: validFiles.length });

    for (let i = 0; i < validFiles.length; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      await uploadAndAddToFolder(
        ed, validFiles[i], current.folder.id,
        startX + col * (CARD_WIDTH + 24),
        startY + row * (CARD_HEIGHT + 32),
        `folder:${current.folder.id}`, handleFilesChanged,
      );
      setImportProgress({ done: i + 1, total: validFiles.length });
    }

    setImportProgress(null);
    e.target.value = '';
  }, [handleFilesChanged]);

  const handleRename = useCallback(async (name: string) => {
    if (nav.view !== 'folder') return;
    try {
      const updated = await api.updateFolder(nav.folder.id, { name });
      setNav({ view: 'folder', folder: updated });
      if (mainEditorRef.current) refreshFolderShape(mainEditorRef.current, updated);
    } catch (err) { console.error('rename:', err); }
  }, [nav]);

  const isFolder    = nav.view === 'folder';
  const getActiveEditor = useCallback(
    () => (nav.view === 'folder' ? folderEditorRef.current : mainEditorRef.current),
    [nav.view]
  );
  const chatSessionId = isFolder ? `folder:${(nav as any).folder.id}` : 'main';

  // Zoom percent polling
  useEffect(() => {
    const timer = setInterval(() => {
      const editor = getActiveEditor();
      if (!editor) return;
      setZoomPercent(Math.round(editor.getZoomLevel() * 100));
    }, 120);
    return () => clearInterval(timer);
  }, [getActiveEditor]);

  // Close zoom menu on outside click
  useEffect(() => {
    if (!isZoomMenuOpen) return;
    function onPointerDown(e: MouseEvent) {
      if (!zoomMenuRef.current?.contains(e.target as Node)) setZoomMenuOpen(false);
    }
    window.addEventListener('mousedown', onPointerDown);
    return () => window.removeEventListener('mousedown', onPointerDown);
  }, [isZoomMenuOpen]);

  // Global keyboard shortcuts
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey;
      // Cmd/Ctrl+K opens search; Cmd/Ctrl+Shift+K toggles chat.
      if (mod && e.key.toLowerCase() === 'k') {
        // SearchBar handles focus itself; if nothing is focused in SearchBar, open chat
        // Actually search bar already handles Cmd+K; we handle Cmd+Shift+K for chat
      }

      if (mod && e.shiftKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setChatOpen((v) => !v);
      }
      // Escape closes chat when focus is not on an input.
      if (e.key === 'Escape') {
        const active = document.activeElement;
        const isInput = active?.tagName === 'INPUT' || active?.tagName === 'TEXTAREA';
        if (!isInput && isChatOpen) setChatOpen(false);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isChatOpen]);

  const handleMainCanvasMount   = useCallback((ed: Editor) => { mainEditorRef.current   = ed; }, []);
  const handleFolderCanvasMount = useCallback((ed: Editor) => { folderEditorRef.current = ed; }, []);

  return (
    <div className="app-layout">
      <Sidebar
        isOpen={isSidebarOpen}
        onToggle={() => setSidebar((v) => !v)}
        onOpenFolder={openFolder}
        onNewFolder={handleNewFolder}
      />

      <div className="workspace">

        {/* Folder toolbar - folder view only */}
        {isFolder && (
          <FolderToolbar
            folderId={(nav as any).folder.id}
            folderName={(nav as any).folder.name}
            onBack={goBack}
            onRename={handleRename}
            onAddFiles={() => fileInputRef.current?.click()}
            onImportFolder={() => folderInputRef.current?.click()}
            onExportPng={() => { void handleExportFolder(); }}
            isExporting={isExporting}
            getEditor={() => folderEditorRef.current}
          />
        )}

        {/* Hidden file pickers */}
        <input ref={fileInputRef} type="file" multiple onChange={handlePickerFiles} style={{ display: 'none' }} />
        <input
          ref={folderInputRef}
          type="file"
          // @ts-expect-error - webkitdirectory is non-standard but widely supported
          webkitdirectory=""
          multiple
          onChange={handleFolderImport}
          style={{ display: 'none' }}
        />

        {/* Top bar - main canvas only */}
        {!isFolder && (
          <div className="topbar">
            <TopBar
              getEditor={() => mainEditorRef.current}
              onNewFolder={handleNewFolder}
              onOpenFolder={openFolder}
            />
          </div>
        )}

        {/* Canvases */}
        <div className="canvas-layer" style={{ display: isFolder ? 'none' : 'block' }}>
          <MainCanvas onOpenFolder={openFolder} onMount={handleMainCanvasMount} />
        </div>

        {isFolder && (
          <div className="canvas-layer">
            <FolderCanvas
              key={(nav as any).folder.id}
              folder={(nav as any).folder}
              onFilesChanged={handleFilesChanged}
              onMount={handleFolderCanvasMount}
            />
          </div>
        )}

        {/* Import progress toast */}
        {importProgress && (
          <ImportProgressToast done={importProgress.done} total={importProgress.total} />
        )}

        {/* Zoom controls */}
        <div className="zoom-controls" ref={zoomMenuRef}>
          {isZoomMenuOpen && (
            <div className="zoom-menu">
              <button className="zoom-menu-item" onClick={() => { getActiveEditor()?.zoomToFit({ animation: { duration: 220 } }); setZoomMenuOpen(false); }}>
                Zoom to fit
              </button>
              <button className="zoom-menu-item" onClick={() => { getActiveEditor()?.zoomToSelection({ animation: { duration: 220 } }); setZoomMenuOpen(false); }}>
                Zoom to selection
              </button>
              <button className="zoom-menu-item" onClick={() => { getActiveEditor()?.resetZoom(undefined, { animation: { duration: 220 } }); setZoomMenuOpen(false); }}>
                Reset to 100%
              </button>
            </div>
          )}
          <button className="zoom-btn" onClick={() => getActiveEditor()?.zoomIn(undefined, { animation: { duration: 160 } })} title="Zoom in">+</button>
          <button className="zoom-btn" onClick={() => getActiveEditor()?.zoomOut(undefined, { animation: { duration: 160 } })} title="Zoom out">-</button>
          <button className="zoom-btn zoom-value" onClick={() => setZoomMenuOpen((v) => !v)} title="Zoom options">
            {zoomPercent}%
          </button>
        </div>

        {/* Chat panel */}
        <div className={`chat-floating ${isChatOpen ? 'open' : ''}`}>
          <div className="chat-panel-wrap">
            <ChatPanel
              sessionId={chatSessionId}
              isOpen={true}
              onToggle={() => setChatOpen(false)}
              getEditor={getActiveEditor}
              panelStyle={{
                width: '100%', height: '100%',
                borderLeft: 'none',
                border: '1px solid var(--border)',
                borderRadius: 14,
                boxShadow: '0 12px 28px rgba(20,15,10,0.14), 0 2px 6px rgba(20,15,10,0.08)',
              }}
            />
          </div>
        </div>

        {!isChatOpen && (
          <button className="chat-fab" onClick={() => setChatOpen(true)} title="Open AI chat (Ctrl/Cmd+Shift+K)">
            <ChatBubbleIcon />
            <span>AI Chat</span>
          </button>
        )}

        {uiError && (
          <div
            style={{
              position: 'fixed',
              right: 16,
              top: 16,
              zIndex: 700,
              background: '#7f1d1d',
              color: '#fee2e2',
              border: '1px solid #ef4444',
              borderRadius: 10,
              padding: '10px 12px',
              fontSize: 12,
              fontWeight: 600,
              maxWidth: 440,
              boxShadow: '0 6px 20px rgba(0,0,0,0.2)',
            }}
          >
            {uiError}
          </div>
        )}
      </div>
    </div>
  );
}

function ImportProgressToast({ done, total }: { done: number; total: number }) {
  const pct = Math.round((done / total) * 100);
  return (
    <div style={{
      position: 'fixed',
      bottom: 80,
      left: '50%',
      transform: 'translateX(-50%)',
      background: 'rgba(28,25,23,0.88)',
      backdropFilter: 'blur(12px)',
      WebkitBackdropFilter: 'blur(12px)',
      color: '#F5F3EF',
      borderRadius: 12,
      padding: '10px 18px',
      zIndex: 9999,
      fontFamily: "'Inter', system-ui, sans-serif",
      fontSize: 12,
      fontWeight: 500,
      display: 'flex',
      flexDirection: 'column',
      gap: 6,
      minWidth: 220,
      boxShadow: '0 4px 16px rgba(0,0,0,0.24)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>Importing files...</span>
        <span style={{ opacity: 0.7 }}>{done} / {total}</span>
      </div>
      <div style={{ height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.15)', overflow: 'hidden' }}>
        <div style={{
          height: '100%', borderRadius: 2,
          background: '#60A5FA',
          width: `${pct}%`,
          transition: 'width 200ms ease',
        }} />
      </div>
    </div>
  );
}

function ChatBubbleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
    </svg>
  );
}

