import { useState, useEffect, useRef, type CSSProperties } from 'react';
import type { Editor } from '@tldraw/tldraw';
import {
  alignSelected,
  autoArrangeSelected,
  snapToGrid,
  groupSelected,
} from './canvasHelpers';

interface ArrangeToolbarProps {
  editor: Editor;
}

/**
 * Floating toolbar that appears when 2+ file-card shapes are selected.
 * Provides align, arrange, and group actions.
 */
export function ArrangeToolbar({ editor }: ArrangeToolbarProps) {
  const [selectedCount, setSelectedCount] = useState(0);
  const [showGroupInput, setShowGroupInput] = useState(false);
  const [groupLabel, setGroupLabel] = useState('');
  const labelInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const unsub = editor.store.listen(() => {
      const count = editor.getSelectedShapes().filter((s: any) => s.type === 'file-card').length;
      setSelectedCount(count);
    });
    return unsub;
  }, [editor]);

  if (selectedCount < 2) return null;

  const commitGroup = () => {
    groupSelected(editor, groupLabel.trim() || undefined);
    setGroupLabel('');
    setShowGroupInput(false);
  };

  const btn = (label: string, title: string, onClick: () => void, icon?: React.ReactNode): React.ReactNode => (
    <button
      key={label}
      onClick={onClick}
      title={title}
      style={btnStyle}
      onMouseEnter={(e) => ((e.target as HTMLElement).style.background = 'rgba(28,25,23,0.06)')}
      onMouseLeave={(e) => ((e.target as HTMLElement).style.background = 'transparent')}
    >
      {icon ?? label}
    </button>
  );

  const actions: Array<{ label: string; title: string; icon?: React.ReactNode; onClick: () => void }> = [
    { label: '⬅', title: 'Align left',           onClick: () => alignSelected(editor, 'left') },
    { label: '➡', title: 'Align right',          onClick: () => alignSelected(editor, 'right') },
    { label: '⬆', title: 'Align top',            onClick: () => alignSelected(editor, 'top') },
    { label: '⬇', title: 'Align bottom',         onClick: () => alignSelected(editor, 'bottom') },
    { label: '↔', title: 'Center horizontally',  onClick: () => alignSelected(editor, 'center-h') },
    { label: '↕', title: 'Center vertically',    onClick: () => alignSelected(editor, 'center-v') },
    { label: '⊞', title: 'Auto-arrange in grid', onClick: () => autoArrangeSelected(editor) },
    { label: '⊡', title: 'Snap all to grid',     onClick: () => snapToGrid(editor) },
    { label: '⬡', title: 'Group selected',        onClick: () => { setShowGroupInput((v) => !v); setTimeout(() => labelInputRef.current?.focus(), 30); } },
  ];

  return (
    <div style={toolbarStyle}>
      <span style={{ fontSize: 10, color: '#78716C', fontWeight: 600, padding: '0 4px', letterSpacing: '0.02em' }}>
        {selectedCount} selected
      </span>
      <div style={{ width: 1, height: 16, background: 'rgba(28,25,23,0.1)', margin: '0 2px' }} />
      {actions.map((a) => btn(a.label, a.title, a.onClick, a.icon))}

      {/* Inline group label input */}
      {showGroupInput && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 4, paddingLeft: 4, borderLeft: '1px solid rgba(28,25,23,0.10)' }}>
          <input
            ref={labelInputRef}
            id="group-label-input"
            name="group-label-input"
            value={groupLabel}
            onChange={(e) => setGroupLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitGroup();
              if (e.key === 'Escape') { setShowGroupInput(false); setGroupLabel(''); }
            }}
            placeholder="Label (optional)"
            style={{
              border: '1.5px solid rgba(28,25,23,0.14)', borderRadius: 6,
              padding: '3px 7px', fontSize: 11, width: 120,
              fontFamily: "'Inter', system-ui, sans-serif",
              outline: 'none', background: '#FAFAF9', color: '#1C1917',
            }}
            autoComplete="off"
          />
          <button
            style={{ ...btnStyle, fontSize: 11, fontWeight: 600, color: '#3A6CC4', minWidth: 40 }}
            onClick={commitGroup}
          >
            Group
          </button>
        </div>
      )}
    </div>
  );
}

const toolbarStyle: CSSProperties = {
  position:   'fixed',
  bottom:     16,
  left:       '50%',
  transform:  'translateX(-50%)',
  display:    'flex',
  alignItems: 'center',
  gap:        2,
  background: 'rgba(254,252,249,0.97)',
  backdropFilter:        'blur(16px)',
  WebkitBackdropFilter:  'blur(16px)',
  border:     '1px solid rgba(28,25,23,0.10)',
  borderRadius: 12,
  padding:    '5px 8px',
  boxShadow:  '0 4px 16px rgba(20,15,10,0.12)',
  zIndex:     8000,
  fontFamily: "'Inter', system-ui, sans-serif",
  userSelect: 'none',
};

const btnStyle: CSSProperties = {
  width:   30,
  height:  28,
  borderRadius: 7,
  border:  'none',
  background: 'transparent',
  cursor:  'pointer',
  fontSize: 14,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  transition: 'background 100ms ease',
};
