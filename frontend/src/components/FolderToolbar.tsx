import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { Editor } from '@tldraw/tldraw';
import { SearchBar } from './SearchBar';

interface FolderToolbarProps {
  folderId: string;
  folderName: string;
  onBack: () => void;
  onRename: (name: string) => void;
  onAddFiles: () => void;
  onImportFolder: () => void;
  getEditor: () => Editor | null;
  onExportPng?: () => void;
  isExporting?: boolean;
}

export function FolderToolbar({
  folderId,
  folderName,
  onBack,
  onRename,
  onAddFiles,
  onImportFolder,
  getEditor,
  onExportPng,
  isExporting = false,
}: FolderToolbarProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const menuId = useId();

  useEffect(() => {
    if (!menuOpen) return;

    const onPointerDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };

    window.addEventListener('mousedown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [menuOpen]);

  return (
    <div className="folder-toolbar">
      <div className="folder-toolbar-left">
        <button className="back-btn" onClick={onBack} type="button">
          <BackArrow />
          <span>Library</span>
        </button>
        <InlineRename value={folderName} onCommit={onRename} />
      </div>

      <div className="folder-toolbar-right">
        <SearchBar
          className="folder-toolbar-search"
          getEditor={getEditor}
          folderId={folderId}
          placeholder="Search inside this book..."
        />

        <button className="toolbar-primary-btn" type="button" onClick={onAddFiles}>
          Add Files
        </button>

        <div className="toolbar-menu-wrap" ref={menuRef}>
          <button
            type="button"
            className="toolbar-icon-btn"
            aria-label="More actions"
            aria-controls={menuId}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
          >
            <MoreIcon />
          </button>

          {menuOpen && (
            <div className="toolbar-menu" id={menuId} role="menu">
              <button
                type="button"
                role="menuitem"
                className="toolbar-menu-item"
                onClick={() => {
                  onImportFolder();
                  setMenuOpen(false);
                }}
              >
                <FolderIcon />
                Import Folder
              </button>

              {onExportPng && (
                <button
                  type="button"
                  role="menuitem"
                  className="toolbar-menu-item"
                  onClick={() => {
                    onExportPng();
                    setMenuOpen(false);
                  }}
                  disabled={isExporting}
                >
                  <ExportIcon />
                  {isExporting ? 'Exporting...' : 'Export PNG'}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function InlineRename({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  const startEdit = () => {
    setDraft(value);
    setEditing(true);
    setTimeout(() => inputRef.current?.select(), 10);
  };

  const commit = () => {
    setEditing(false);
    const trimmed = draft.trim();
    if (trimmed && trimmed !== value) onCommit(trimmed);
    else setDraft(value);
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') commit();
    if (e.key === 'Escape') {
      setEditing(false);
      setDraft(value);
    }
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
        onKeyDown={onKeyDown}
        className="folder-title-input"
        autoFocus
      />
    );
  }

  return (
    <button
      type="button"
      className="folder-title-chip"
      onClick={startEdit}
      title="Click to rename"
    >
      <span className="folder-title-text">{value}</span>
    </button>
  );
}

function BackArrow() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 12H5M12 5l-7 7 7 7" />
    </svg>
  );
}

function FolderIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function ExportIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

function MoreIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <circle cx="5" cy="12" r="1.8" />
      <circle cx="12" cy="12" r="1.8" />
      <circle cx="19" cy="12" r="1.8" />
    </svg>
  );
}
