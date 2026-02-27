/**
 * FileInspector
 * A floating panel for viewing and editing a file's title and tags.
 * Appears on right-click → "Edit" from FileContextMenu, or double-click on a card.
 *
 * Saves on blur / Enter for title, and on tag chip delete / tag add.
 */

import { useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { api, type FileRecord } from '../api';

interface FileInspectorProps {
  file:    FileRecord;
  x:       number;
  y:       number;
  onClose: () => void;
  onSaved: (updated: FileRecord) => void;
}

const TYPE_COLORS: Record<string, { color: string; soft: string }> = {
  pdf:   { color: '#C94F4F', soft: '#FDEAEA' },
  image: { color: '#3070C4', soft: '#E8F2FE' },
  video: { color: '#6B4CC4', soft: '#EFEBFE' },
  audio: { color: '#0A8FA4', soft: '#E6F8FC' },
  code:  { color: '#1A9460', soft: '#E7F7F0' },
  text:  { color: '#4D4BB8', soft: '#EEEFFE' },
  other: { color: '#6B7785', soft: '#EEF0F4' },
};

export function FileInspector({ file, x, y, onClose, onSaved }: FileInspectorProps) {
  const panelRef   = useRef<HTMLDivElement>(null);
  const titleRef   = useRef<HTMLInputElement>(null);
  const tagInputRef = useRef<HTMLInputElement>(null);

  const initialTitle = file.metadata?.ai_title?.trim() || file.filename;
  const initialTags  = file.tags ?? [];

  const [title, setTitle]     = useState(initialTitle);
  const [tags,  setTags]      = useState<string[]>(initialTags);
  const [tagDraft, setTagDraft] = useState('');
  const [saving,  setSaving]  = useState(false);

  const tc = TYPE_COLORS[file.file_type] ?? TYPE_COLORS.other;

  // Reposition to stay within viewport
  const PANEL_W = 300;
  const PANEL_H = 320;
  const safeX   = Math.min(x, window.innerWidth  - PANEL_W - 12);
  const safeY   = Math.min(y, window.innerHeight - PANEL_H - 12);

  // Close on outside click or Escape
  useEffect(() => {
    function onPointerDown(e: MouseEvent) {
      if (!panelRef.current?.contains(e.target as Node)) onClose();
    }
    function onKeyDown(e: globalThis.KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('pointerdown', onPointerDown, { capture: true });
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, { capture: true });
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose]);

  const save = useCallback(async (newTitle?: string, newTags?: string[]) => {
    const patch: { title?: string; tags?: string[] } = {};
    if (newTitle !== undefined) patch.title = newTitle;
    if (newTags  !== undefined) patch.tags  = newTags;
    if (!Object.keys(patch).length) return;

    setSaving(true);
    try {
      const updated = await api.patchFile(file.id, patch);
      onSaved(updated);
    } catch (err) {
      console.error('FileInspector save failed:', err);
    } finally {
      setSaving(false);
    }
  }, [file.id, onSaved]);

  const handleTitleBlur = () => {
    const trimmed = title.trim() || initialTitle;
    setTitle(trimmed);
    if (trimmed !== initialTitle) save(trimmed, undefined);
  };

  const handleTitleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.currentTarget.blur();
    }
  };

  const removeTag = (tag: string) => {
    const next = tags.filter((t) => t !== tag);
    setTags(next);
    void save(undefined, next);
  };

  const addTag = () => {
    const clean = tagDraft.trim().toLowerCase().replace(/\s+/g, '-');
    if (!clean || tags.includes(clean) || tags.length >= 15) {
      setTagDraft('');
      return;
    }
    const next = [...tags, clean];
    setTags(next);
    setTagDraft('');
    void save(undefined, next);
  };

  const handleTagKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addTag();
    }
    if (e.key === 'Backspace' && tagDraft === '' && tags.length > 0) {
      removeTag(tags[tags.length - 1]);
    }
  };

  return (
    <div
      ref={panelRef}
      style={{
        position:   'fixed',
        left:        safeX,
        top:         safeY,
        width:       PANEL_W,
        background: 'rgba(254,252,249,0.97)',
        backdropFilter:       'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        border:     '1px solid rgba(28,25,23,0.10)',
        borderRadius: 14,
        boxShadow:  '0 12px 36px rgba(20,15,10,0.16), 0 2px 8px rgba(20,15,10,0.07)',
        padding:    '14px',
        zIndex:     10000,
        fontFamily: "'Inter', system-ui, sans-serif",
        userSelect: 'none',
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <div style={{
            background: tc.soft, color: tc.color,
            fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
            padding: '3px 7px', borderRadius: 5, border: `1px solid ${tc.color}30`,
          }}>
            {file.file_type}
          </div>
          {saving && <span style={{ fontSize: 10, color: '#A8A29E' }}>Saving…</span>}
        </div>
        <button
          style={closeBtn}
          onClick={onClose}
          title="Close"
        >
          <CloseIcon />
        </button>
      </div>

      {/* Title field */}
      <label style={labelStyle}>Title</label>
      <input
        ref={titleRef}
        id={`inspector-title-${file.id}`}
        name={`inspector-title-${file.id}`}
        value={title}
        onChange={(e) => { setTitle(e.target.value); }}
        onBlur={handleTitleBlur}
        onKeyDown={handleTitleKeyDown}
        style={titleInputStyle}
        placeholder="Enter a title…"
        autoComplete="off"
      />

      {/* Summary (read-only) */}
      {file.metadata?.ai_summary && (
        <>
          <label style={{ ...labelStyle, marginTop: 11 }}>AI Summary</label>
          <p style={summaryStyle}>{file.metadata.ai_summary}</p>
        </>
      )}

      {/* Category (read-only) */}
      {file.metadata?.ai_category && (
        <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
          <label style={{ ...labelStyle, margin: 0 }}>Category</label>
          <span style={{
            fontSize: 10, fontWeight: 600, color: tc.color,
            background: tc.soft, padding: '2px 7px', borderRadius: 5,
            border: `1px solid ${tc.color}25`,
          }}>
            {file.metadata.ai_category}
          </span>
        </div>
      )}

      {/* Tags */}
      <label style={{ ...labelStyle, marginTop: 12 }}>Tags</label>
      <div style={tagArea}>
        {tags.map((tag) => (
          <span key={tag} style={{ ...tagChip, background: tc.soft, color: tc.color, border: `1px solid ${tc.color}30` }}>
            {tag}
            <button
              style={tagRemoveBtn}
              onClick={() => removeTag(tag)}
              title={`Remove #${tag}`}
            >×</button>
          </span>
        ))}
        <input
          ref={tagInputRef}
          value={tagDraft}
          onChange={(e) => setTagDraft(e.target.value)}
          onKeyDown={handleTagKeyDown}
          onBlur={() => { if (tagDraft.trim()) addTag(); }}
          placeholder={tags.length < 15 ? 'Add tag…' : ''}
          disabled={tags.length >= 15}
          style={tagInput}
          autoComplete="off"
          spellCheck={false}
        />
      </div>
      <div style={{ fontSize: 10, color: '#A8A29E', marginTop: 4 }}>
        Enter or comma to add · Backspace to remove last
      </div>
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const labelStyle: CSSProperties = {
  display: 'block', fontSize: 10, fontWeight: 700,
  letterSpacing: '0.06em', textTransform: 'uppercase', color: '#78716C',
  marginBottom: 5,
};

const titleInputStyle: CSSProperties = {
  width: '100%', boxSizing: 'border-box',
  border: '1.5px solid rgba(28,25,23,0.12)',
  borderRadius: 8, padding: '6px 9px',
  fontSize: 12.5, fontWeight: 500, color: '#1C1917',
  background: '#FAFAF9', outline: 'none',
  fontFamily: "'Inter', system-ui, sans-serif",
  letterSpacing: '-0.01em',
  transition: 'border-color 150ms ease',
};

const summaryStyle: CSSProperties = {
  margin: 0, fontSize: 11.5, color: '#57534E',
  lineHeight: 1.6, background: '#F5F4F2',
  border: '1px solid rgba(28,25,23,0.07)',
  borderRadius: 7, padding: '6px 9px',
};

const tagArea: CSSProperties = {
  display: 'flex', flexWrap: 'wrap', gap: 5,
  background: '#FAFAF9', border: '1.5px solid rgba(28,25,23,0.12)',
  borderRadius: 8, padding: '6px 8px', minHeight: 34,
  alignItems: 'center',
};

const tagChip: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 3,
  fontSize: 10, fontWeight: 600, letterSpacing: '0.01em',
  padding: '2px 6px', borderRadius: 5, whiteSpace: 'nowrap',
};

const tagRemoveBtn: CSSProperties = {
  border: 'none', background: 'transparent',
  cursor: 'pointer', padding: 0, marginLeft: 1,
  fontSize: 12, lineHeight: 1, color: 'inherit', opacity: 0.6,
  fontFamily: 'inherit',
};

const tagInput: CSSProperties = {
  border: 'none', outline: 'none', background: 'transparent',
  fontSize: 10.5, fontFamily: "'Inter', system-ui, sans-serif",
  color: '#1C1917', minWidth: 60, flex: 1,
};

const closeBtn: CSSProperties = {
  width: 24, height: 24, borderRadius: 6,
  border: 'none', background: 'transparent',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  cursor: 'pointer', color: '#A8A29E',
  transition: 'background 120ms ease',
};

function CloseIcon() {
  return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6L6 18M6 6l12 12"/></svg>;
}
