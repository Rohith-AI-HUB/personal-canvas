import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createShapeId, type Editor } from '@tldraw/tldraw';
import { api, type SearchResult } from '../api';

type TypeFilter = 'all' | 'pdf' | 'image' | 'video' | 'audio' | 'code' | 'text';

const FILTERS: Array<{ id: TypeFilter; label: string }> = [
  { id: 'all',   label: 'All' },
  { id: 'pdf',   label: 'PDF' },
  { id: 'image', label: 'Image' },
  { id: 'video', label: 'Video' },
  { id: 'audio', label: 'Audio' },
  { id: 'code',  label: 'Code' },
  { id: 'text',  label: 'Text' },
];

const TYPE_COLORS: Record<string, { color: string; soft: string }> = {
  pdf:   { color: '#D45656', soft: '#FDEAEA' },
  image: { color: '#3A7ED4', soft: '#E8F2FE' },
  video: { color: '#7B5CC4', soft: '#EFEBFE' },
  audio: { color: '#0F9AB0', soft: '#E6F8FC' },
  code:  { color: '#1A9E6E', soft: '#E7F7F0' },
  text:  { color: '#5957C4', soft: '#EEEFFE' },
  other: { color: '#7A8A9A', soft: '#EEF0F4' },
};

interface SearchBarProps {
  getEditor: () => Editor | null;
  folderId?: string;
  placeholder?: string;
  onOpenFolder?: (folderId: string) => void | Promise<void>;
  className?: string;
}

export function SearchBar({ getEditor, folderId, placeholder, onOpenFolder, className }: SearchBarProps) {
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [filter, setFilter] = useState<TypeFilter>('all');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [loadingSemantic, setLoadingSemantic] = useState(false);
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const latestReqId = useRef(0);

  // Debounce
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query.trim()), 280);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    setQuery('');
    setDebouncedQuery('');
    setResults([]);
    setOpen(false);
    setLoadingSemantic(false);
  }, [folderId]);

  // Escape key to clear
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && (focused || open || query)) {
        setQuery('');
        setDebouncedQuery('');
        setResults([]);
        setOpen(false);
        inputRef.current?.blur();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [focused, open, query]);

  // Ctrl/Cmd+K to focus search
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Search execution
  useEffect(() => {
    const q = debouncedQuery;
    if (!q || q.length < 2) {
      setResults([]);
      setOpen(false);
      setLoadingSemantic(false);
      return;
    }

    const reqId = ++latestReqId.current;
    const type = filter === 'all' ? undefined : filter;

    setOpen(true);
    setLoadingSemantic(true);

    // Fast keyword pass first
    api.searchFiles(q, { type, folderId, semantic: false, topN: 20 })
      .then((r) => {
        if (latestReqId.current !== reqId) return;
        setResults(r.keyword_results);
      })
      .catch(console.error);

    // Full semantic pass
    api.searchFiles(q, { type, folderId, semantic: true, topN: 20 })
      .then((r) => {
        if (latestReqId.current !== reqId) return;
        setResults(r.results);
      })
      .catch(console.error)
      .finally(() => {
        if (latestReqId.current !== reqId) return;
        setLoadingSemantic(false);
      });
  }, [debouncedQuery, filter, folderId]);

  const resultLabel = useMemo(() => {
    if (!debouncedQuery) return '';
    if (results.length === 0) return 'No results';
    return `${results.length} match${results.length !== 1 ? 'es' : ''}`;
  }, [debouncedQuery, results.length]);

  const handleSelect = async (result: SearchResult) => {
    const editor = getEditor();
    if (!editor) return;

    const shapeId = createShapeId(result.file_id);
    const shape = editor.getShape(shapeId);
    if (!shape) {
      if (!folderId && result.folder_id && onOpenFolder) {
        await onOpenFolder(result.folder_id);
        setOpen(false);
      }
      return;
    }

    editor.select(shapeId);
    (editor as any).zoomToSelection?.({ animation: { duration: 320 } });

    // Highlight the card
    editor.updateShape({
      id: shapeId,
      type: 'file-card',
      meta: { ...(shape as any).meta, highlightUntil: Date.now() + 1200 },
      props: { ...(shape as any).props, _v: ((shape as any).props?._v ?? 0) + 1 },
    } as any);

    // Remove highlight after
    setTimeout(() => {
      const next = editor.getShape(shapeId);
      if (!next) return;
      editor.updateShape({
        id: shapeId,
        type: 'file-card',
        meta: { ...(next as any).meta, highlightUntil: 0 },
        props: { ...(next as any).props, _v: ((next as any).props?._v ?? 0) + 1 },
      } as any);
    }, 1250);

    setOpen(false);
  };

  const isActive = focused || open;

  return (
    <div style={s.root} className={className}>
      <div
        style={{
          ...s.panel,
          boxShadow: isActive
            ? '0 8px 32px rgba(20,15,10,0.12), 0 2px 8px rgba(20,15,10,0.06)'
            : '0 2px 8px rgba(20,15,10,0.07), 0 1px 3px rgba(20,15,10,0.04)',
          border: isActive
            ? '1px solid rgba(91,91,214,0.30)'
            : '1px solid rgba(28,25,23,0.09)',
        }}
      >
        {/* ── Input row ── */}
        <div style={s.inputRow}>
          <span style={{ color: 'var(--text-4)', display: 'flex', flexShrink: 0 }}>
            {loadingSemantic
              ? <span className="spin"><SpinnerIcon /></span>
              : <SearchIcon />
            }
          </span>

          <input
            ref={inputRef}
            id="search-input"
            name="search-input"
            type="text"
            value={query}
            placeholder={placeholder ?? 'Search your knowledge base…'}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => {
              setFocused(true);
              if (debouncedQuery) setOpen(true);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && results.length > 0) {
                e.preventDefault();
                void handleSelect(results[0]);
              }
            }}
            onBlur={() => setFocused(false)}
            style={s.input}
            autoComplete="off"
            spellCheck={false}
          />

          {/* Keyboard hint / clear button */}
          {query ? (
            <button
              style={s.clearBtn}
              onClick={() => {
                setQuery('');
                setResults([]);
                setOpen(false);
                inputRef.current?.focus();
              }}
              tabIndex={-1}
              aria-label="Clear"
            >
              <CloseIcon />
            </button>
          ) : (
            <kbd style={s.kbdHint}>Ctrl/⌘K</kbd>
          )}
        </div>

        {/* ── Filter chips — only when input has focus or results open ── */}
        {(focused || open) && (
          <div style={s.filters} className="fade-in">
            {FILTERS.map((f) => {
              const tc = TYPE_COLORS[f.id];
              const isActive = filter === f.id;
              return (
                <button
                  key={f.id}
                  tabIndex={-1}
                  style={{
                    ...s.chip,
                    ...(isActive && f.id !== 'all' ? {
                      background: tc.soft,
                      color: tc.color,
                      borderColor: `${tc.color}30`,
                    } : {}),
                    ...(isActive && f.id === 'all' ? {
                      background: 'var(--accent-soft)',
                      color: 'var(--accent)',
                      borderColor: 'var(--accent-medium)',
                    } : {}),
                  }}
                  onClick={() => setFilter(f.id)}
                >
                  {f.label}
                </button>
              );
            })}
          </div>
        )}

        {/* ── Results dropdown ── */}
        {open && (
          <div style={s.results} className="fade-in">
            {/* Meta row */}
            <div style={s.metaRow}>
              <span style={s.metaCount}>{resultLabel}</span>
              {loadingSemantic && (
                <span style={s.metaSemantic}>
                  <span className="spin" style={{ display: 'inline-flex' }}><SpinnerTinyIcon /></span>
                  Refining semantically…
                </span>
              )}
            </div>

            {/* Empty state */}
            {results.length === 0 && !loadingSemantic && (
              <div style={s.empty}>
                <span style={{ fontSize: 18, opacity: 0.5 }}>🔍</span>
                <span>No files match "{query}"</span>
              </div>
            )}

            {/* Result rows */}
            {results.map((result) => (
              <ResultRow
                key={result.file_id}
                result={result}
                onSelect={(r) => { void handleSelect(r); }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Result Row ───────────────────────────────────────────────────────────────

function ResultRow({
  result,
  onSelect,
}: {
  result: SearchResult;
  onSelect: (r: SearchResult) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const tc = TYPE_COLORS[result.file_type] ?? TYPE_COLORS.other;
  const title = result.ai_title?.trim() || result.filename;
  const tags = (result.tags ?? '').trim().split(/\s+/).filter(Boolean).slice(0, 3);

  return (
    <button
      style={{
        ...s.resultRow,
        background: hovered ? 'var(--bg-hover)' : 'transparent',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={() => onSelect(result)}
      tabIndex={0}
    >
      {/* Type badge */}
      <div style={{
        ...s.resultTypeBadge,
        background: tc.soft,
        color: tc.color,
      }}>
        <TypeLabel type={result.file_type} />
      </div>

      {/* Content */}
      <div style={s.resultContent}>
        <div style={s.resultTitle}>{title}</div>
        <div style={s.resultMeta}>
          {result.ai_category && (
            <span>{result.ai_category}</span>
          )}
          {tags.length > 0 && (
            <span style={{ color: 'var(--text-5)' }}>
              {tags.map(t => `#${t}`).join(' ')}
            </span>
          )}
        </div>
      </div>

      {/* Score / relevance hint */}
      {result.hybrid_score > 0 && (
        <div style={s.scoreBar}>
          <div style={{
            ...s.scoreBarFill,
            width: `${Math.min(Math.round(result.hybrid_score * 100), 100)}%`,
            background: tc.color,
          }} />
        </div>
      )}
    </button>
  );
}

// Type label abbreviation
function TypeLabel({ type }: { type: string }) {
  const labels: Record<string, string> = {
    pdf: 'PDF', image: 'IMG', video: 'VID', audio: 'AUD', code: 'CODE', text: 'TXT', other: 'FILE',
  };
  return <span style={{ fontSize: 8, fontWeight: 700, letterSpacing: '0.06em' }}>{labels[type] ?? 'FILE'}</span>;
}

// ── Icons ────────────────────────────────────────────────────────────────────

function SearchIcon() {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>;
}
function CloseIcon() {
  return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6L6 18M6 6l12 12"/></svg>;
}
function SpinnerIcon() {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" strokeLinecap="round"/></svg>;
}
function SpinnerTinyIcon() {
  return <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" strokeLinecap="round"/></svg>;
}

// ── Styles ───────────────────────────────────────────────────────────────────

const s: Record<string, CSSProperties> = {
  root: {
    width: '100%',
    pointerEvents: 'all',
  },
  panel: {
    background: 'rgba(254, 252, 249, 0.94)',
    borderRadius: 14,
    padding: '9px 10px',
    backdropFilter: 'blur(16px)',
    WebkitBackdropFilter: 'blur(16px)',
    transition: 'box-shadow 200ms ease, border-color 200ms ease',
  },

  // Input row
  inputRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    height: 36,
    padding: '0 4px',
  },
  input: {
    flex: 1,
    border: 'none',
    outline: 'none',
    background: 'transparent',
    fontSize: 13,
    fontWeight: 400,
    color: 'var(--text-1)',
    fontFamily: "'Inter', system-ui, sans-serif",
    letterSpacing: '-0.01em',
  },
  clearBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 22,
    height: 22,
    borderRadius: 6,
    background: 'var(--bg-surface-2)',
    color: 'var(--text-3)',
    cursor: 'pointer',
    flexShrink: 0,
    transition: 'background var(--transition-fast)',
  },
  kbdHint: {
    fontSize: 10,
    color: 'var(--text-5)',
    fontFamily: "'Inter', system-ui, sans-serif",
    background: 'var(--bg-surface-2)',
    border: '1px solid var(--border)',
    borderRadius: 5,
    padding: '2px 5px',
    letterSpacing: '0.02em',
    flexShrink: 0,
  },

  // Filter chips
  filters: {
    display: 'flex',
    gap: 4,
    flexWrap: 'wrap',
    padding: '6px 4px 2px',
    borderTop: '1px solid var(--border)',
    marginTop: 5,
  },
  chip: {
    fontSize: 10,
    fontWeight: 600,
    padding: '3px 9px',
    borderRadius: 'var(--radius-full)',
    border: '1px solid var(--border)',
    background: 'var(--bg-canvas)',
    color: 'var(--text-3)',
    cursor: 'pointer',
    transition: 'all var(--transition-fast)',
    letterSpacing: '0.01em',
    lineHeight: 1.5,
  },

  // Results
  results: {
    marginTop: 6,
    maxHeight: 340,
    overflowY: 'auto',
    overflowX: 'hidden',
    borderTop: '1px solid var(--border)',
    paddingTop: 5,
  },
  metaRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '2px 6px 6px',
    minHeight: 22,
  },
  metaCount: {
    fontSize: 10,
    fontWeight: 600,
    color: 'var(--text-4)',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },
  metaSemantic: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    fontSize: 10,
    color: 'var(--text-4)',
  },
  empty: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 6,
    padding: '20px 12px',
    color: 'var(--text-4)',
    fontSize: 12,
    textAlign: 'center',
  },

  // Result row
  resultRow: {
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '8px 8px',
    borderRadius: 'var(--radius-sm)',
    marginBottom: 2,
    cursor: 'pointer',
    textAlign: 'left',
    transition: 'background var(--transition-fast)',
    border: 'none',
    fontFamily: "'Inter', system-ui, sans-serif",
    position: 'relative',
  },
  resultTypeBadge: {
    flexShrink: 0,
    height: 30,
    minWidth: 36,
    borderRadius: 7,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '0 6px',
  },
  resultContent: {
    flex: 1,
    minWidth: 0,
    overflow: 'hidden',
  },
  resultTitle: {
    fontSize: 12,
    fontWeight: 500,
    color: 'var(--text-1)',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    letterSpacing: '-0.01em',
  },
  resultMeta: {
    display: 'flex',
    gap: 8,
    fontSize: 10,
    color: 'var(--text-3)',
    marginTop: 2,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  scoreBar: {
    flexShrink: 0,
    width: 28,
    height: 3,
    borderRadius: 2,
    background: 'var(--border)',
    overflow: 'hidden',
  },
  scoreBarFill: {
    height: '100%',
    borderRadius: 2,
    opacity: 0.5,
    transition: 'width 300ms ease',
  },
};
