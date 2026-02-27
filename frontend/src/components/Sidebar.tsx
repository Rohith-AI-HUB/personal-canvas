import { useEffect, useState } from 'react';
import { api, type FolderRecord } from '../api';

interface SidebarProps {
  isOpen?: boolean;
  onToggle?: () => void;
  onOpenFolder?: (folderId: string) => void;
  onNewFolder?: () => void;
}

export function Sidebar({ isOpen = true, onToggle, onOpenFolder, onNewFolder }: SidebarProps) {
  const [folders, setFolders] = useState<FolderRecord[]>([]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const list = await api.listFolders();
        if (!cancelled) setFolders(list);
      } catch {
        // non-fatal
      }
    }
    load();
    const t = setInterval(load, 5000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  return (
    <div
      style={{
        ...css.shell,
        width: isOpen ? 240 : 52,
      }}
    >
      <div
        style={{
          ...css.railLayer,
          opacity: isOpen ? 0 : 1,
          pointerEvents: isOpen ? 'none' : 'auto',
        }}
      >
        <div style={css.logoMark}><LogoMark /></div>
        <div style={css.divider} />
        <button style={css.iconBtn} onClick={onToggle} title="Open sidebar">
          <ChevronRightIcon />
        </button>
        <div style={{ flex: 1 }} />
        {onNewFolder && (
          <button style={css.iconBtn} onClick={onNewFolder} title="New folder">
            <NewFolderIcon />
          </button>
        )}
      </div>

      <div
        style={{
          ...css.panelLayer,
          opacity: isOpen ? 1 : 0,
          transform: isOpen ? 'translateX(0)' : 'translateX(-10px)',
          pointerEvents: isOpen ? 'auto' : 'none',
        }}
      >
        <div style={css.header}>
          <div style={css.logoRow}>
            <div style={css.logoMark}><LogoMark /></div>
            <div>
              <div style={css.appName}>Canvas</div>
              <div style={css.appSub}>
                {folders.length} folder{folders.length !== 1 ? 's' : ''}
              </div>
            </div>
          </div>
          <button style={css.collapseBtn} onClick={onToggle} title="Collapse">
            <ChevronLeftIcon />
          </button>
        </div>

        {onNewFolder && (
          <div style={{ padding: '10px 12px 0' }}>
            <button style={css.newFolderBtn} onClick={onNewFolder}>
              <NewFolderIcon />
              <span>New Folder</span>
            </button>
          </div>
        )}

        <div style={css.sectionLabel}>FOLDERS</div>

        <div style={css.list}>
          {folders.length === 0 ? (
            <div style={css.empty}>
              <FolderEmptyIcon />
              <div style={{ marginTop: 8 }}>No folders yet</div>
              <div style={{ marginTop: 4, fontSize: 11, color: 'var(--text-5)' }}>
                Create a folder to get started
              </div>
            </div>
          ) : (
            folders.map((folder) => (
              <FolderItem
                key={folder.id}
                folder={folder}
                onOpen={() => onOpenFolder?.(folder.id)}
              />
            ))
          )}
        </div>

        <div style={css.footer}>
          <span style={css.footerText}>Personal Knowledge Canvas</span>
        </div>
      </div>
    </div>
  );
}

function FolderItem({ folder, onOpen }: { folder: FolderRecord; onOpen: () => void }) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      style={{
        ...css.folderItem,
        background: hovered ? 'var(--bg-hover)' : 'transparent',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={onOpen}
    >
      <div
        style={{
          width: 30,
          height: 30,
          borderRadius: 8,
          background: `${folder.cover_color}18`,
          border: `1.5px solid ${folder.cover_color}40`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          color: folder.cover_color,
        }}
      >
        <FolderIcon />
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={css.folderName}>{folder.name}</div>
        <div style={css.folderMeta}>
          {folder.file_count === 0 ? 'Empty' : `${folder.file_count} file${folder.file_count !== 1 ? 's' : ''}`}
        </div>
      </div>

      {hovered && (
        <div style={{ color: 'var(--text-4)', flexShrink: 0, display: 'flex' }}>
          <ChevronRightSmIcon />
        </div>
      )}
    </div>
  );
}

const css: Record<string, React.CSSProperties> = {
  shell: {
    height: '100%',
    flexShrink: 0,
    position: 'relative',
    background: 'var(--bg-surface)',
    borderRight: '1px solid var(--border)',
    fontFamily: "'Inter', system-ui, sans-serif",
    overflow: 'hidden',
    zIndex: 10,
    boxShadow: '2px 0 12px rgba(20,15,10,0.04)',
    transition: 'width 220ms cubic-bezier(0.22, 1, 0.36, 1)',
  },
  railLayer: {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: '12px 0',
    gap: 6,
    transition: 'opacity 150ms ease',
  },
  panelLayer: {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    flexDirection: 'column',
    transition: 'opacity 150ms ease, transform 220ms cubic-bezier(0.22, 1, 0.36, 1)',
  },
  header: {
    padding: '14px 12px 12px',
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
  logoMark: {
    width: 32,
    height: 32,
    borderRadius: 8,
    background: 'var(--accent-soft)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: 'var(--accent)',
    flexShrink: 0,
  },
  appName: {
    fontSize: 13,
    fontWeight: 700,
    color: 'var(--text-1)',
    letterSpacing: '-0.02em',
  },
  appSub: {
    fontSize: 11,
    color: 'var(--text-4)',
    marginTop: 1,
  },
  collapseBtn: {
    width: 28,
    height: 28,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 6,
    background: 'transparent',
    color: 'var(--text-4)',
    cursor: 'pointer',
  },
  iconBtn: {
    width: 32,
    height: 32,
    borderRadius: 7,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'transparent',
    color: 'var(--text-3)',
    cursor: 'pointer',
  },
  divider: {
    width: 28,
    height: 1,
    background: 'var(--border)',
    margin: '2px 0',
  },
  newFolderBtn: {
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    gap: 7,
    padding: '8px 12px',
    borderRadius: 8,
    border: '1.5px dashed var(--border-medium)',
    background: 'transparent',
    color: 'var(--accent)',
    fontSize: 12,
    fontWeight: 600,
    fontFamily: 'inherit',
    cursor: 'pointer',
    letterSpacing: '-0.01em',
    transition: 'all 120ms ease',
  },
  sectionLabel: {
    padding: '12px 14px 4px',
    fontSize: 9.5,
    fontWeight: 700,
    letterSpacing: '0.08em',
    color: 'var(--text-5)',
    flexShrink: 0,
  },
  list: {
    flex: 1,
    overflowY: 'auto',
    padding: '2px 6px',
  },
  empty: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: '32px 12px',
    color: 'var(--text-4)',
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 1.4,
  },
  folderItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 9,
    padding: '7px 8px',
    borderRadius: 8,
    cursor: 'pointer',
    transition: 'background 100ms ease',
    userSelect: 'none',
  },
  folderName: {
    fontSize: 12,
    fontWeight: 500,
    color: 'var(--text-1)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    lineHeight: 1.3,
  },
  folderMeta: {
    fontSize: 10,
    color: 'var(--text-4)',
    marginTop: 1,
  },
  footer: {
    padding: '9px 14px',
    borderTop: '1px solid var(--border)',
    flexShrink: 0,
  },
  footerText: {
    fontSize: 10,
    color: 'var(--text-5)',
    fontWeight: 500,
  },
};

function LogoMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 18 18" fill="none">
      <rect x="1" y="1" width="6.5" height="6.5" rx="1.5" fill="currentColor" opacity="0.9" />
      <rect x="10.5" y="1" width="6.5" height="6.5" rx="1.5" fill="currentColor" opacity="0.6" />
      <rect x="1" y="10.5" width="6.5" height="6.5" rx="1.5" fill="currentColor" opacity="0.6" />
      <rect x="10.5" y="10.5" width="6.5" height="6.5" rx="1.5" fill="currentColor" opacity="0.4" />
    </svg>
  );
}

function FolderIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function FolderEmptyIcon() {
  return (
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-5)' }}>
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function NewFolderIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
      <line x1="12" y1="11" x2="12" y2="17" />
      <line x1="9" y1="14" x2="15" y2="14" />
    </svg>
  );
}

function ChevronLeftIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M15 18l-6-6 6-6" />
    </svg>
  );
}

function ChevronRightIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M9 18l6-6-6-6" />
    </svg>
  );
}

function ChevronRightSmIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M9 18l6-6-6-6" />
    </svg>
  );
}
