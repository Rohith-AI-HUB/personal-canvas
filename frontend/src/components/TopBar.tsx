import type { Editor } from '@tldraw/tldraw';
import { SearchBar } from './SearchBar';

interface TopBarProps {
  getEditor:     () => Editor | null;
  onNewFolder?:  () => void;
}

export function TopBar({ getEditor, onNewFolder }: TopBarProps) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'flex-start',
      gap: 8,
      width: '100%',
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <SearchBar getEditor={getEditor} />
      </div>

      {onNewFolder && (
        <button
          onClick={onNewFolder}
          title="New Folder"
          style={{
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            height: 38,
            padding: '0 14px',
            borderRadius: 10,
            border: '1px solid rgba(28,25,23,0.12)',
            background: 'rgba(254,252,249,0.92)',
            backdropFilter: 'blur(16px)',
            WebkitBackdropFilter: 'blur(16px)',
            boxShadow: '0 1px 3px rgba(20,15,10,0.06)',
            cursor: 'pointer',
            fontFamily: "'Inter', system-ui, sans-serif",
            fontSize: 12,
            fontWeight: 600,
            color: '#1C1917',
            letterSpacing: '-0.01em',
            whiteSpace: 'nowrap',
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
            <line x1="12" y1="11" x2="12" y2="17"/>
            <line x1="9" y1="14" x2="15" y2="14"/>
          </svg>
          New Folder
        </button>
      )}
    </div>
  );
}
