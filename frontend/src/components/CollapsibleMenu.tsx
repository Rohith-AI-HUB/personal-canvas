import { 
  DefaultQuickActions, 
  DefaultMainMenu, 
  DefaultPageMenu, 
  DefaultActionsMenu, 
  DefaultToolbar,
  useBreakpoint 
} from '@tldraw/tldraw';
import { useState } from 'react';

export function CollapsibleMenu() {
  const [isOpen, setIsOpen] = useState(false);
  const breakpoint = useBreakpoint();
  const isMobile = breakpoint < 5;

  // On mobile, keep default behavior or adjust as needed.
  if (isMobile) return <DefaultQuickActions />;

  return (
    <div 
      className="collapsible-menu" 
      style={{
        position: 'relative',
        pointerEvents: 'all',
      }}
    >
      <button
        className="menu-toggle"
        onClick={() => setIsOpen(!isOpen)}
        title={isOpen ? "Hide UI" : "Show UI"}
        style={{
          width: '36px',
          height: '36px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--bg-surface)',
          border: '1px solid var(--border)',
          borderRadius: '10px',
          cursor: 'pointer',
          boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
          color: 'var(--text-2)',
          transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
          position: 'relative',
          zIndex: 2,
        }}
      >
        <svg 
          width="20" 
          height="20" 
          viewBox="0 0 24 24" 
          fill="none" 
          stroke="currentColor" 
          strokeWidth="2" 
          strokeLinecap="round" 
          strokeLinejoin="round"
          style={{ transform: isOpen ? 'rotate(90deg)' : 'none', transition: 'transform 0.25s cubic-bezier(0.4, 0, 0.2, 1)' }}
        >
          {/* Box icon (Package icon) */}
          <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
          <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
          <line x1="12" y1="22.08" x2="12" y2="12" />
        </svg>
      </button>
      <div 
        className={`menu-wrapper ${isOpen ? 'open' : ''}`}
        style={{
          background: 'var(--bg-surface)',
          border: '1px solid var(--border)',
          borderRadius: '12px',
          boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
          padding: '4px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '0px',
          pointerEvents: isOpen ? 'all' : 'none',
        }}
      >
        <DefaultMainMenu />
        <div style={{ width: 20, height: 1, background: 'var(--border)' }} />
        <DefaultPageMenu />
        <div style={{ width: 20, height: 1, background: 'var(--border)' }} />
        <DefaultActionsMenu />
        <div style={{ width: 20, height: 1, background: 'var(--border)' }} />
        <DefaultToolbar />
        <div style={{ width: 20, height: 1, background: 'var(--border)' }} />
        <DefaultQuickActions />
      </div>
    </div>
  );
}
