import { DefaultStylePanel, useBreakpoint } from '@tldraw/tldraw';
import { useState } from 'react';

export function CustomStylePanel() {
  const [isOpen, setIsOpen] = useState(false);
  const breakpoint = useBreakpoint();
  const isMobile = breakpoint < 5; // tldraw mobile breakpoint is usually < 5

  // On mobile, the default behavior is usually fine or handled differently.
  if (isMobile) return <DefaultStylePanel />;

  return (
    <div 
      className="custom-style-panel" 
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-end',
        gap: '8px',
        pointerEvents: 'all',
      }}
    >
      <button
        className="style-panel-toggle"
        onClick={() => setIsOpen(!isOpen)}
        title={isOpen ? "Hide Styles" : "Show Styles"}
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
          transition: 'all 0.2s ease',
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
          style={{ transform: isOpen ? 'rotate(45deg)' : 'none', transition: 'transform 0.2s ease' }}
        >
          <circle cx="12" cy="12" r="9" />
        </svg>
      </button>
      {isOpen && (
        <div 
          className="style-panel-wrapper"
          style={{
            background: 'var(--bg-surface)',
            border: '1px solid var(--border)',
            borderRadius: '12px',
            boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
            padding: '4px',
            maxWidth: '240px',
            animation: 'slide-in 0.2s ease-out',
          }}
        >
          <DefaultStylePanel />
        </div>
      )}
    </div>
  );
}
