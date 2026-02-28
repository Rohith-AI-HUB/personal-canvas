import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import type { Editor } from '@tldraw/tldraw';
import { api, type FolderRecord } from './api';
import { MainCanvas, placeFolderShape, refreshFolderShape } from './components/MainCanvas';
import { FolderCanvas, uploadAndAddToFolder } from './components/FolderCanvas';
import { CARD_WIDTH, CARD_HEIGHT } from './components/FileCard';
import { ChatPanel } from './components/ChatPanel';
import { FileViewer } from './components/FileViewer';
import { Sidebar } from './components/Sidebar';
import { TopBar } from './components/TopBar';
import { FolderToolbar } from './components/FolderToolbar';
import { exportCanvasToPng } from './components/exportCanvas';
import { LoadingScreen } from './components/LoadingScreen';
import './App.css';

type NavState =
  | { view: 'main' }
  | { view: 'folder'; folder: FolderRecord };

interface ChatThreadMeta {
  id: string;
  title: string;
  updatedAt: number;
}

interface BackendStatus {
  qdrant: 'ok' | 'offline' | 'unknown';
  groq_configured: boolean;
}

// Outer shell: shows loading screen until backend is ready, then renders the main app.
export default function App() {
  const [backendReady, setBackendReady] = useState(false);
  const [backendStatus, setBackendStatus] = useState<BackendStatus | null>(null);

  const handleBackendReady = useCallback((status: BackendStatus) => {
    setBackendStatus(status);
    setBackendReady(true);
  }, []);

  if (!backendReady) {
    return <LoadingScreen onReady={handleBackendReady} />;
  }

  return <AppContent backendStatus={backendStatus} />;
}

// Inner app — all hooks live here so they're never called conditionally.
function AppContent({ backendStatus }: { backendStatus: BackendStatus | null }) {
  const mainEditorRef   = useRef<Editor | null>(null);
  const folderEditorRef = useRef<Editor | null>(null);
  const [nav, setNav]   = useState<NavState>({ view: 'main' });
  const [viewerFile, setViewerFile] = useState<import('./api').FileRecord | null>(null);
  const [allFiles, setAllFiles]     = useState<import('./api').FileRecord[]>([]);

  // Keep allFiles in sync — refreshed when canvas loads or files are added
  const refreshAllFiles = useCallback(async () => {
    try { const files = await api.listFiles(); setAllFiles(files); } catch { /* non-fatal */ }
  }, []);
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
  const [serviceStatus, setServiceStatus] = useState<BackendStatus | null>(backendStatus);
  const [chatThreadsByCanvas, setChatThreadsByCanvas] = useState<Record<string, ChatThreadMeta[]>>(() => {
    try {
      const raw = localStorage.getItem('pc.chatThreads.v1');
      return raw ? JSON.parse(raw) as Record<string, ChatThreadMeta[]> : {};
    } catch {
      return {};
    }
  });
  const [activeChatByCanvas, setActiveChatByCanvas] = useState<Record<string, string>>(() => {
    try {
      const raw = localStorage.getItem('pc.chatActive.v1');
      return raw ? JSON.parse(raw) as Record<string, string> : {};
    } catch {
      return {};
    }
  });

  useEffect(() => {
    setServiceStatus(backendStatus);
  }, [backendStatus]);

  // Keep service badges fresh after startup so transient offline states clear automatically.
  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        const res = await fetch('http://127.0.0.1:3001/health');
        if (!res.ok) return;
        const json = await res.json() as BackendStatus;
        if (!cancelled) setServiceStatus(json);
      } catch {
        // ignore: backend may be restarting
      }
    };

    void refresh();
    const timer = setInterval(() => { void refresh(); }, 10000);
    return () => { cancelled = true; clearInterval(timer); };
  }, []);

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
      await refreshAllFiles();
    } catch { /* non-fatal */ }
  }, [refreshAllFiles]);

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
  const chatCanvasId = isFolder ? `folder:${(nav as any).folder.id}` : 'main';
  const chatThreads = (chatThreadsByCanvas[chatCanvasId] ?? []).slice().sort((a, b) => b.updatedAt - a.updatedAt);
  const chatSessionId = activeChatByCanvas[chatCanvasId] ?? chatCanvasId;

  useEffect(() => {
    setChatThreadsByCanvas(prev => {
      if ((prev[chatCanvasId]?.length ?? 0) > 0) return prev;
      return {
        ...prev,
        [chatCanvasId]: [{ id: chatCanvasId, title: 'New chat', updatedAt: Date.now() }],
      };
    });
    setActiveChatByCanvas(prev => (prev[chatCanvasId] ? prev : { ...prev, [chatCanvasId]: chatCanvasId }));
  }, [chatCanvasId]);

  useEffect(() => {
    localStorage.setItem('pc.chatThreads.v1', JSON.stringify(chatThreadsByCanvas));
  }, [chatThreadsByCanvas]);

  useEffect(() => {
    localStorage.setItem('pc.chatActive.v1', JSON.stringify(activeChatByCanvas));
  }, [activeChatByCanvas]);

  useEffect(() => {
    void refreshAllFiles();
  }, [refreshAllFiles, chatCanvasId]);

  const handleSelectChatSession = useCallback((sessionId: string) => {
    setActiveChatByCanvas(prev => ({ ...prev, [chatCanvasId]: sessionId }));
  }, [chatCanvasId]);

  const handleNewChat = useCallback(() => {
    const id = `${chatCanvasId}:${Date.now()}`;
    const next: ChatThreadMeta = { id, title: 'New chat', updatedAt: Date.now() };
    setChatThreadsByCanvas(prev => ({ ...prev, [chatCanvasId]: [next, ...(prev[chatCanvasId] ?? [])] }));
    setActiveChatByCanvas(prev => ({ ...prev, [chatCanvasId]: id }));
  }, [chatCanvasId]);

  const handleDeleteChatSession = useCallback(async (sessionId: string) => {
    try {
      await api.deleteChatSession(sessionId);
    } catch {
      // Keep local state consistent even if backend cleanup fails.
    }

    setChatThreadsByCanvas(prev => {
      const list = prev[chatCanvasId] ?? [];
      const nextList = list.filter(t => t.id !== sessionId);
      if (nextList.length > 0) return { ...prev, [chatCanvasId]: nextList };
      const fallback: ChatThreadMeta = { id: chatCanvasId, title: 'New chat', updatedAt: Date.now() };
      return { ...prev, [chatCanvasId]: [fallback] };
    });

    setActiveChatByCanvas(prev => {
      if (prev[chatCanvasId] !== sessionId) return prev;
      return { ...prev, [chatCanvasId]: chatCanvasId };
    });
  }, [chatCanvasId]);

  const handleChatActivity = useCallback((sessionId: string, firstUserMessage: string) => {
    const trimmed = firstUserMessage.trim();
    const title = trimmed.length > 0
      ? (trimmed.length > 42 ? `${trimmed.slice(0, 42)}...` : trimmed)
      : 'New chat';

    setChatThreadsByCanvas(prev => {
      const list = prev[chatCanvasId] ?? [];
      const idx = list.findIndex(t => t.id === sessionId);
      if (idx === -1) {
        return { ...prev, [chatCanvasId]: [{ id: sessionId, title, updatedAt: Date.now() }, ...list] };
      }
      const current = list[idx]!;
      const nextTitle = current.title === 'New chat' ? title : current.title;
      const updated = { ...current, title: nextTitle, updatedAt: Date.now() };
      const nextList = [updated, ...list.filter(t => t.id !== sessionId)];
      return { ...prev, [chatCanvasId]: nextList };
    });
  }, [chatCanvasId]);

  // Trackpad pinch often arrives as Ctrl+wheel in desktop webviews.
  const handleTrackpadZoom = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    if (!e.ctrlKey) return;

    const target = e.target as HTMLElement | null;
    const tag = target?.tagName?.toLowerCase();
    if (tag === 'input' || tag === 'textarea' || target?.isContentEditable) return;

    e.preventDefault();
    const editor = getActiveEditor();
    if (!editor) return;

    const point = { x: e.clientX, y: e.clientY } as any;
    if (e.deltaY < 0) {
      editor.zoomIn(point, { animation: { duration: 90 } });
    } else if (e.deltaY > 0) {
      editor.zoomOut(point, { animation: { duration: 90 } });
    }
  }, [getActiveEditor]);

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

  const handleMainCanvasMount   = useCallback((ed: Editor) => { mainEditorRef.current   = ed; void refreshAllFiles(); }, [refreshAllFiles]);
  const handleFolderCanvasMount = useCallback((ed: Editor) => { folderEditorRef.current = ed; }, []);

  return (
    <div className="app-layout">
      <Sidebar
        isOpen={isSidebarOpen}
        onToggle={() => setSidebar((v) => !v)}
        onOpenFolder={openFolder}
        onNewFolder={handleNewFolder}
      />

      <div className="workspace" onWheelCapture={handleTrackpadZoom}>

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
          <MainCanvas
            onOpenFolder={openFolder}
            onOpenViewer={(file) => setViewerFile(file)}
            onMount={handleMainCanvasMount}
          />
        </div>

        {isFolder && (
          <div className="canvas-layer">
            <FolderCanvas
              key={(nav as any).folder.id}
              folder={(nav as any).folder}
              onFilesChanged={handleFilesChanged}
              onMount={handleFolderCanvasMount}
              onOpenViewer={(file) => setViewerFile(file)}
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
              canvasId={chatCanvasId}
              isOpen={true}
              onToggle={() => setChatOpen(false)}
              getEditor={getActiveEditor}
              allFiles={allFiles}
              onOpenViewer={(file) => setViewerFile(file)}
              historyThreads={chatThreads}
              activeThreadId={chatSessionId}
              onSelectThread={handleSelectChatSession}
              onNewThread={handleNewChat}
              onDeleteThread={handleDeleteChatSession}
              onThreadActivity={handleChatActivity}
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

        {/* Service status banners (shown after load if something is misconfigured) */}
        {serviceStatus && !serviceStatus.groq_configured && (
          <div style={{
            position: 'fixed', bottom: 16, left: '50%', transform: 'translateX(-50%)',
            zIndex: 800, background: '#FEF4E8', color: '#92400E',
            border: '1px solid rgba(194,120,50,0.25)', borderRadius: 10,
            padding: '8px 16px', fontSize: 12, fontWeight: 500,
            boxShadow: '0 4px 16px rgba(0,0,0,0.08)',
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            ⚠ <strong>GROQ_API_KEY not configured</strong> — AI Chat and file analysis are disabled.
            Set the key in <code style={{ fontSize: 11 }}>backend/.env</code> and restart.
          </div>
        )}
        {serviceStatus?.qdrant === 'offline' && (
          <div style={{
            position: 'fixed', bottom: serviceStatus?.groq_configured ? 16 : 54, left: '50%', transform: 'translateX(-50%)',
            zIndex: 800, background: '#FEECEB', color: '#7C2020',
            border: '1px solid rgba(201,64,60,0.2)', borderRadius: 10,
            padding: '8px 16px', fontSize: 12, fontWeight: 500,
            boxShadow: '0 4px 16px rgba(0,0,0,0.08)',
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            ⚠ <strong>Qdrant offline</strong> — Semantic search disabled. Start Docker Desktop and restart the app.
          </div>
        )}

        {/* File viewer modal */}
        {viewerFile && (
          <FileViewer file={viewerFile} onClose={() => setViewerFile(null)} />
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
