import { useEffect, useRef, useState } from 'react';
import { api, type FileRecord } from '../api';

// ── File type metadata ──────────────────────────────────────────────────────

const TYPE_META: Record<FileRecord['file_type'], { label: string; color: string; soft: string; icon: React.ReactNode }> = {
  pdf:   { label: 'PDF',   color: 'var(--type-pdf)',   soft: 'var(--type-pdf-soft)',   icon: <PdfIcon /> },
  image: { label: 'Image', color: 'var(--type-image)', soft: 'var(--type-image-soft)', icon: <ImageIcon /> },
  video: { label: 'Video', color: 'var(--type-video)', soft: 'var(--type-video-soft)', icon: <VideoIcon /> },
  audio: { label: 'Audio', color: 'var(--type-audio)', soft: 'var(--type-audio-soft)', icon: <AudioIcon /> },
  code:  { label: 'Code',  color: 'var(--type-code)',  soft: 'var(--type-code-soft)',  icon: <CodeIcon /> },
  text:  { label: 'Text',  color: 'var(--type-text)',  soft: 'var(--type-text-soft)',  icon: <TextIcon /> },
  other: { label: 'Other', color: 'var(--type-other)', soft: 'var(--type-other-soft)', icon: <OtherIcon /> },
};

// ── Sidebar Component ──────────────────────────────────────────────────────

interface SidebarProps {
  onUpload?: (file: FileRecord) => void;
  isOpen?: boolean;
  onToggle?: () => void;
}

export function Sidebar({ onUpload, isOpen = true, onToggle }: SidebarProps) {
  const [files, setFiles] = useState<FileRecord[]>([]);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTypeFilter, setActiveTypeFilter] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Periodic file list refresh
  useEffect(() => {
    let cancelled = false;

    async function loadFiles() {
      try {
        const list = await api.listFiles();
        if (!cancelled) setFiles(list);
      } catch (err) {
        console.error('Sidebar: failed to load files', err);
      }
    }

    loadFiles();
    const timer = setInterval(loadFiles, 5000);
    return () => { cancelled = true; clearInterval(timer); };
  }, []);

  const handleFileInput = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    setUploading(true);
    try {
      for (const file of Array.from(fileList)) {
        const result = await api.uploadFile(file);
        if (!result.duplicate) {
          onUpload?.(result.file);
          setFiles((prev) => [result.file, ...prev]);
        }
      }
    } catch (err) {
      console.error('Upload failed:', err);
    } finally {
      setUploading(false);
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    await handleFileInput(e.dataTransfer.files);
  };

  const handleDelete = async (id: string) => {
    try {
      await api.deleteFile(id);
      setFiles((prev) => prev.filter((f) => f.id !== id));
    } catch (err) {
      console.error('Delete failed:', err);
    }
  };

  // Filtered file list
  const filtered = files.filter((f) => {
    const matchesType = !activeTypeFilter || f.file_type === activeTypeFilter;
    const q = searchQuery.toLowerCase();
    const matchesSearch = !q ||
      f.filename.toLowerCase().includes(q) ||
      (f.metadata?.ai_title ?? '').toLowerCase().includes(q) ||
      (f.metadata?.ai_category ?? '').toLowerCase().includes(q) ||
      f.tags.some((t) => t.toLowerCase().includes(q));
    return matchesType && matchesSearch;
  });

  // Count files per type
  const typeStats = files.reduce((acc, f) => {
    acc[f.file_type] = (acc[f.file_type] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const processingCount = files.filter((f) => f.status === 'processing' || f.status === 'pending').length;
  const errorCount = files.filter((f) => f.status === 'error').length;

  // ── Collapsed rail ────────────────────────────────────────────────────────

  if (!isOpen) {
    return (
      <div style={collapsedStyles.rail}>
        {/* App logo mark */}
        <div style={collapsedStyles.logoMark}>
          <LogoMark />
        </div>

        <div style={collapsedStyles.divider} />

        {/* Expand button */}
        <button style={collapsedStyles.iconBtn} onClick={onToggle} title="Open sidebar">
          <ChevronRightIcon />
        </button>

        {/* File type dots */}
        <div style={collapsedStyles.dotList}>
          {Object.entries(typeStats).map(([type, count]) => {
            const meta = TYPE_META[type as FileRecord['file_type']];
            return (
              <div
                key={type}
                style={{
                  ...collapsedStyles.typeDot,
                  background: meta.soft,
                  color: meta.color,
                }}
                title={`${meta.label} — ${count} file${count !== 1 ? 's' : ''}`}
              >
                {meta.icon}
              </div>
            );
          })}
        </div>

        {/* Status indicators at bottom */}
        {(processingCount > 0 || errorCount > 0) && (
          <div style={collapsedStyles.statusArea}>
            {processingCount > 0 && (
              <div style={{ ...collapsedStyles.statusDot, background: 'var(--color-warning-soft)', color: 'var(--color-warning)' }} title={`${processingCount} processing`}>
                <SpinnerIcon />
              </div>
            )}
            {errorCount > 0 && (
              <div style={{ ...collapsedStyles.statusDot, background: 'var(--color-error-soft)', color: 'var(--color-error)' }} title={`${errorCount} errors`}>
                <WarningIcon />
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  // ── Expanded sidebar ──────────────────────────────────────────────────────

  return (
    <div style={sidebarStyles.root}>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div style={sidebarStyles.header}>
        <div style={sidebarStyles.logoRow}>
          <div style={sidebarStyles.logoWrap}>
            <LogoMark />
          </div>
          <div>
            <div style={sidebarStyles.appName}>Canvas</div>
            <div style={sidebarStyles.appSub}>
              {files.length} file{files.length !== 1 ? 's' : ''}
              {processingCount > 0 && (
                <span style={sidebarStyles.processingBadge}>
                  <span style={{ display: 'inline-block' }} className="spin">
                    <SpinnerMiniIcon />
                  </span>
                  {processingCount}
                </span>
              )}
            </div>
          </div>
        </div>
        <button style={sidebarStyles.collapseBtn} onClick={onToggle} title="Collapse sidebar">
          <ChevronLeftIcon />
        </button>
      </div>

      {/* ── Upload Zone ────────────────────────────────────────────────────── */}
      <div style={sidebarStyles.uploadSection}>
        <div
          style={{
            ...sidebarStyles.dropZone,
            ...(dragOver ? sidebarStyles.dropZoneActive : {}),
          }}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          role="button"
          tabIndex={0}
          aria-label="Upload files"
        >
          <input
            ref={fileInputRef}
            type="file"
            multiple
            style={{ display: 'none' }}
            onChange={(e) => handleFileInput(e.target.files)}
          />
          {uploading ? (
            <div style={sidebarStyles.uploadingRow}>
              <span className="spin" style={{ color: 'var(--accent)', display: 'flex' }}>
                <SpinnerIcon />
              </span>
              <span style={sidebarStyles.uploadingText}>Uploading…</span>
            </div>
          ) : (
            <div style={sidebarStyles.uploadIdleRow}>
              <div style={sidebarStyles.uploadIconWrap}>
                <UploadIcon />
              </div>
              <div>
                <div style={sidebarStyles.uploadPrimary}>Drop files here</div>
                <div style={sidebarStyles.uploadSecondary}>or click to browse</div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Type filter chips ─────────────────────────────────────────────── */}
      {Object.keys(typeStats).length > 0 && (
        <div style={sidebarStyles.filterRow}>
          <button
            style={{
              ...sidebarStyles.chip,
              ...(activeTypeFilter === null ? sidebarStyles.chipActive : {}),
            }}
            onClick={() => setActiveTypeFilter(null)}
          >
            All
          </button>
          {Object.entries(typeStats).map(([type, count]) => {
            const meta = TYPE_META[type as FileRecord['file_type']];
            const isActive = activeTypeFilter === type;
            return (
              <button
                key={type}
                style={{
                  ...sidebarStyles.chip,
                  ...(isActive ? {
                    background: meta.soft,
                    color: meta.color,
                    border: `1px solid ${meta.color}30`,
                  } : {}),
                }}
                onClick={() => setActiveTypeFilter(isActive ? null : type)}
                title={`${meta.label} (${count})`}
              >
                {meta.label} {count}
              </button>
            );
          })}
        </div>
      )}

      {/* ── Search ────────────────────────────────────────────────────────── */}
      <div style={sidebarStyles.searchWrap}>
        <span style={sidebarStyles.searchIcon}>
          <SearchIcon />
        </span>
        <input
          type="text"
          placeholder="Filter files…"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={sidebarStyles.searchInput}
        />
        {searchQuery && (
          <button
            style={sidebarStyles.clearBtn}
            onClick={() => setSearchQuery('')}
            aria-label="Clear search"
          >
            <CloseSmIcon />
          </button>
        )}
      </div>

      {/* ── File List ─────────────────────────────────────────────────────── */}
      <div style={sidebarStyles.listHeader}>
        <span style={sidebarStyles.listHeaderLabel}>
          {filtered.length > 0 ? `${filtered.length} file${filtered.length !== 1 ? 's' : ''}` : ''}
        </span>
        {errorCount > 0 && (
          <span style={sidebarStyles.errorBadge}>
            {errorCount} error{errorCount !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      <div style={sidebarStyles.fileList}>
        {filtered.length === 0 ? (
          <div style={sidebarStyles.emptyState}>
            {searchQuery || activeTypeFilter ? (
              <>
                <div style={sidebarStyles.emptyIcon}><SearchIcon /></div>
                <div>No matches found</div>
              </>
            ) : (
              <>
                <div style={sidebarStyles.emptyIcon}><DropIcon /></div>
                <div>Drop files onto the canvas</div>
                <div style={{ marginTop: 4, fontSize: 11, color: 'var(--text-4)' }}>PDF, images, video, code & more</div>
              </>
            )}
          </div>
        ) : (
          filtered.map((file) => (
            <FileItem key={file.id} file={file} onDelete={handleDelete} />
          ))
        )}
      </div>

      {/* ── Footer ────────────────────────────────────────────────────────── */}
      <div style={sidebarStyles.footer}>
        <div style={sidebarStyles.footerText}>
          Personal Knowledge Canvas
        </div>
      </div>

    </div>
  );
}

// ── File List Item ─────────────────────────────────────────────────────────

function FileItem({ file, onDelete }: { file: FileRecord; onDelete: (id: string) => void }) {
  const [hovered, setHovered] = useState(false);
  const meta = TYPE_META[file.file_type];
  const title = file.metadata?.ai_title?.trim() || file.filename;
  const isProcessing = file.status === 'pending' || file.status === 'processing';
  const isError = file.status === 'error';

  return (
    <div
      style={{
        ...itemStyles.root,
        background: hovered ? 'var(--bg-hover)' : 'transparent',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Type icon badge */}
      <div style={{
        ...itemStyles.iconBadge,
        background: meta.soft,
        color: meta.color,
      }}>
        {meta.icon}
      </div>

      {/* File info */}
      <div style={itemStyles.info}>
        <div style={itemStyles.title} title={title}>
          {title}
        </div>
        <div style={itemStyles.meta}>
          <span style={{ textTransform: 'uppercase', letterSpacing: '0.04em', fontSize: 9, fontWeight: 600 }}>
            {meta.label}
          </span>
          {file.file_size ? (
            <span style={{ marginLeft: 4, color: 'var(--text-5)' }}>· {formatSize(file.file_size)}</span>
          ) : null}
        </div>
      </div>

      {/* Status + actions */}
      <div style={itemStyles.actions}>
        {isProcessing && (
          <span className="spin" style={{ color: 'var(--color-warning)', display: 'flex', alignItems: 'center' }}>
            <SpinnerMiniIcon />
          </span>
        )}
        {isError && (
          <span style={{ color: 'var(--color-error)', display: 'flex', fontSize: 11 }} title={file.error_message ?? 'Error'}>
            <WarningIcon />
          </span>
        )}
        {hovered && (
          <button
            style={itemStyles.deleteBtn}
            onClick={(e) => { e.stopPropagation(); onDelete(file.id); }}
            title="Remove file"
          >
            <TrashIcon />
          </button>
        )}
      </div>
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ── Styles ─────────────────────────────────────────────────────────────────

const sidebarStyles: Record<string, React.CSSProperties> = {
  root: {
    width: 268,
    height: '100%',
    flexShrink: 0,
    display: 'flex',
    flexDirection: 'column',
    background: 'var(--bg-surface)',
    borderRight: '1px solid var(--border)',
    fontFamily: "'Inter', system-ui, sans-serif",
    overflow: 'hidden',
    zIndex: 10,
    // Soft right shadow to lift it above canvas
    boxShadow: '2px 0 12px rgba(20,15,10,0.04)',
  },

  // Header
  header: {
    padding: '16px 14px 12px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottom: '1px solid var(--border)',
    flexShrink: 0,
  },
  logoRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  },
  logoWrap: {
    width: 34,
    height: 34,
    borderRadius: 'var(--radius-sm)',
    background: 'var(--accent-soft)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: 'var(--accent)',
    flexShrink: 0,
  },
  appName: {
    fontSize: 14,
    fontWeight: 600,
    color: 'var(--text-1)',
    letterSpacing: '-0.025em',
    lineHeight: 1.2,
  },
  appSub: {
    fontSize: 11,
    color: 'var(--text-4)',
    display: 'flex',
    alignItems: 'center',
    gap: 5,
    marginTop: 1,
  },
  processingBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 3,
    fontSize: 10,
    color: 'var(--color-warning)',
    background: 'var(--color-warning-soft)',
    padding: '1px 5px',
    borderRadius: 'var(--radius-full)',
  },
  collapseBtn: {
    width: 28,
    height: 28,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 'var(--radius-sm)',
    background: 'transparent',
    color: 'var(--text-4)',
    transition: 'all var(--transition-fast)',
    cursor: 'pointer',
  },

  // Upload zone
  uploadSection: {
    padding: '10px 12px 0',
    flexShrink: 0,
  },
  dropZone: {
    padding: '14px 12px',
    border: '1.5px dashed var(--border-medium)',
    borderRadius: 'var(--radius-md)',
    background: 'var(--bg-canvas)',
    cursor: 'pointer',
    transition: 'all var(--transition-base)',
    userSelect: 'none',
  },
  dropZoneActive: {
    borderColor: 'var(--accent)',
    background: 'var(--accent-soft)',
    borderStyle: 'solid',
  },
  uploadIdleRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  },
  uploadIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 'var(--radius-sm)',
    background: 'var(--bg-surface)',
    border: '1px solid var(--border)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: 'var(--accent)',
    flexShrink: 0,
    boxShadow: 'var(--shadow-xs)',
  },
  uploadPrimary: {
    fontSize: 12,
    fontWeight: 500,
    color: 'var(--text-2)',
    lineHeight: 1.3,
  },
  uploadSecondary: {
    fontSize: 11,
    color: 'var(--text-4)',
    marginTop: 2,
  },
  uploadingRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    justifyContent: 'center',
    padding: '4px 0',
  },
  uploadingText: {
    fontSize: 12,
    fontWeight: 500,
    color: 'var(--accent)',
  },

  // Filter chips
  filterRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 4,
    padding: '10px 12px 0',
    flexShrink: 0,
  },
  chip: {
    fontSize: 10,
    fontWeight: 600,
    padding: '3px 8px',
    borderRadius: 'var(--radius-full)',
    border: '1px solid var(--border)',
    background: 'var(--bg-canvas)',
    color: 'var(--text-3)',
    cursor: 'pointer',
    transition: 'all var(--transition-fast)',
    letterSpacing: '0.01em',
    lineHeight: 1.5,
  },
  chipActive: {
    background: 'var(--accent-soft)',
    color: 'var(--accent)',
    border: '1px solid var(--accent-medium)',
  },

  // Search
  searchWrap: {
    margin: '10px 12px 0',
    display: 'flex',
    alignItems: 'center',
    gap: 7,
    height: 34,
    padding: '0 10px',
    background: 'var(--bg-canvas)',
    borderRadius: 'var(--radius-sm)',
    border: '1px solid var(--border)',
    flexShrink: 0,
  },
  searchIcon: {
    color: 'var(--text-4)',
    display: 'flex',
    flexShrink: 0,
  },
  searchInput: {
    flex: 1,
    border: 'none',
    outline: 'none',
    background: 'transparent',
    fontSize: 12,
    color: 'var(--text-1)',
    fontFamily: 'inherit',
  },
  clearBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: 'var(--text-4)',
    cursor: 'pointer',
    padding: 2,
    borderRadius: 4,
    flexShrink: 0,
  },

  // List header
  listHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '10px 14px 4px',
    flexShrink: 0,
  },
  listHeaderLabel: {
    fontSize: 10,
    fontWeight: 600,
    color: 'var(--text-4)',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
  },
  errorBadge: {
    fontSize: 10,
    color: 'var(--color-error)',
    background: 'var(--color-error-soft)',
    padding: '2px 6px',
    borderRadius: 'var(--radius-full)',
    fontWeight: 600,
  },

  // File list
  fileList: {
    flex: 1,
    overflowY: 'auto',
    overflowX: 'hidden',
    padding: '2px 6px',
  },
  emptyState: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 6,
    padding: '32px 16px',
    color: 'var(--text-4)',
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 1.4,
  },
  emptyIcon: {
    color: 'var(--text-5)',
    marginBottom: 2,
    fontSize: 20,
  },

  // Footer
  footer: {
    padding: '10px 14px',
    borderTop: '1px solid var(--border)',
    flexShrink: 0,
  },
  footerText: {
    fontSize: 10,
    color: 'var(--text-5)',
    fontWeight: 500,
    letterSpacing: '0.02em',
  },
};

const itemStyles: Record<string, React.CSSProperties> = {
  root: {
    display: 'flex',
    alignItems: 'center',
    gap: 9,
    padding: '7px 8px',
    borderRadius: 'var(--radius-sm)',
    cursor: 'default',
    transition: 'background var(--transition-fast)',
    userSelect: 'none',
  },
  iconBadge: {
    width: 30,
    height: 30,
    borderRadius: 'var(--radius-sm)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  info: {
    flex: 1,
    minWidth: 0,
    overflow: 'hidden',
  },
  title: {
    fontSize: 12,
    fontWeight: 500,
    color: 'var(--text-1)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    lineHeight: 1.3,
  },
  meta: {
    fontSize: 10,
    color: 'var(--text-3)',
    marginTop: 1,
  },
  actions: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    flexShrink: 0,
  },
  deleteBtn: {
    width: 24,
    height: 24,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 6,
    background: 'var(--color-error-soft)',
    color: 'var(--color-error)',
    cursor: 'pointer',
    transition: 'background var(--transition-fast)',
  },
};

const collapsedStyles: Record<string, React.CSSProperties> = {
  rail: {
    width: 52,
    height: '100%',
    flexShrink: 0,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    paddingTop: 12,
    paddingBottom: 12,
    background: 'var(--bg-surface)',
    borderRight: '1px solid var(--border)',
    boxShadow: '2px 0 12px rgba(20,15,10,0.04)',
    zIndex: 10,
    gap: 6,
  },
  logoMark: {
    width: 34,
    height: 34,
    borderRadius: 'var(--radius-sm)',
    background: 'var(--accent-soft)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: 'var(--accent)',
    flexShrink: 0,
    marginBottom: 2,
  },
  divider: {
    width: 28,
    height: 1,
    background: 'var(--border)',
    margin: '4px 0',
  },
  iconBtn: {
    width: 32,
    height: 32,
    borderRadius: 'var(--radius-sm)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'transparent',
    color: 'var(--text-4)',
    cursor: 'pointer',
    transition: 'all var(--transition-fast)',
  },
  dotList: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 5,
    marginTop: 4,
    flex: 1,
  },
  typeDot: {
    width: 32,
    height: 32,
    borderRadius: 'var(--radius-sm)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusArea: {
    display: 'flex',
    flexDirection: 'column',
    gap: 5,
    marginTop: 'auto',
  },
  statusDot: {
    width: 30,
    height: 30,
    borderRadius: 'var(--radius-sm)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
};

// ── SVG Icons (inline, no deps) ────────────────────────────────────────────

function LogoMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <rect x="1" y="1" width="6.5" height="6.5" rx="1.5" fill="currentColor" opacity="0.9" />
      <rect x="10.5" y="1" width="6.5" height="6.5" rx="1.5" fill="currentColor" opacity="0.6" />
      <rect x="1" y="10.5" width="6.5" height="6.5" rx="1.5" fill="currentColor" opacity="0.6" />
      <rect x="10.5" y="10.5" width="6.5" height="6.5" rx="1.5" fill="currentColor" opacity="0.4" />
    </svg>
  );
}

function PdfIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="15" x2="15" y2="15"/><line x1="9" y1="11" x2="15" y2="11"/></svg>;
}

function ImageIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>;
}

function VideoIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>;
}

function AudioIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>;
}

function CodeIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>;
}

function TextIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><line x1="17" y1="10" x2="3" y2="10"/><line x1="21" y1="6" x2="3" y2="6"/><line x1="21" y1="14" x2="3" y2="14"/><line x1="17" y1="18" x2="3" y2="18"/></svg>;
}

function OtherIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>;
}

function ChevronLeftIcon() {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6"/></svg>;
}

function ChevronRightIcon() {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18l6-6-6-6"/></svg>;
}

function SearchIcon() {
  return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>;
}

function CloseSmIcon() {
  return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6L6 18M6 6l12 12"/></svg>;
}

function SpinnerIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" strokeLinecap="round"/></svg>;
}

function SpinnerMiniIcon() {
  return <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" strokeLinecap="round"/></svg>;
}

function WarningIcon() {
  return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>;
}

function UploadIcon() {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>;
}

function DropIcon() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M8 17l4-5 4 5"/><path d="M12 12V3"/><rect x="3" y="14" width="18" height="7" rx="2" strokeDasharray="3 2"/></svg>;
}

function TrashIcon() {
  return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>;
}
