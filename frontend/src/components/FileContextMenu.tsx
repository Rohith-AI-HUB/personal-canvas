import { useEffect, useRef, type CSSProperties } from 'react';

export interface ContextMenuAction {
  label: string;
  icon:  React.ReactNode;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}

interface FileContextMenuProps {
  x:       number;
  y:       number;
  actions: ContextMenuAction[];
  onClose: () => void;
}

/**
 * A lightweight floating context menu.
 * Positioned absolutely in the viewport. Closes on outside click or Escape.
 * Repositions itself to stay within viewport bounds.
 */
export function FileContextMenu({ x, y, actions, onClose }: FileContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on outside click or Escape
  useEffect(() => {
    function onPointerDown(e: MouseEvent) {
      if (!menuRef.current?.contains(e.target as Node)) onClose();
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('pointerdown', onPointerDown, { capture: true });
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, { capture: true });
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose]);

  // Reposition if near viewport edge
  const menuW = 200;
  const menuH = actions.length * 36 + 16;
  const safeX  = Math.min(x, window.innerWidth  - menuW - 8);
  const safeY  = Math.min(y, window.innerHeight - menuH - 8);

  return (
    <div
      ref={menuRef}
      style={{
        position: 'fixed',
        left:     safeX,
        top:      safeY,
        width:    menuW,
        background: 'rgba(254, 252, 249, 0.97)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        border: '1px solid rgba(28, 25, 23, 0.10)',
        borderRadius: 12,
        boxShadow: '0 8px 28px rgba(20,15,10,0.14), 0 2px 6px rgba(20,15,10,0.08)',
        padding: '6px',
        zIndex: 9999,
        fontFamily: "'Inter', system-ui, sans-serif",
        userSelect: 'none',
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {actions.map((action, i) => (
        <ContextMenuItem key={i} action={action} onClose={onClose} />
      ))}
    </div>
  );
}

function ContextMenuItem({ action, onClose }: { action: ContextMenuAction; onClose: () => void }) {
  const handleClick = () => {
    if (action.disabled) return;
    onClose();
    action.onClick();
  };

  const itemStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 9,
    width: '100%',
    padding: '7px 10px',
    borderRadius: 8,
    border: 'none',
    background: 'transparent',
    cursor: action.disabled ? 'default' : 'pointer',
    fontSize: 12,
    fontWeight: 500,
    fontFamily: 'inherit',
    color: action.danger ? '#DC2626' : action.disabled ? '#A8A29E' : '#1C1917',
    textAlign: 'left',
    letterSpacing: '-0.01em',
    transition: 'background 120ms ease',
    opacity: action.disabled ? 0.5 : 1,
  };

  return (
    <button
      style={itemStyle}
      onClick={handleClick}
      onMouseEnter={(e) => {
        if (!action.disabled) {
          (e.target as HTMLElement).style.background = action.danger
            ? 'rgba(220,38,38,0.06)'
            : 'rgba(28,25,23,0.05)';
        }
      }}
      onMouseLeave={(e) => {
        (e.target as HTMLElement).style.background = 'transparent';
      }}
    >
      <span style={{ color: action.danger ? '#DC2626' : '#78716C', display: 'flex', flexShrink: 0 }}>
        {action.icon}
      </span>
      {action.label}
    </button>
  );
}
