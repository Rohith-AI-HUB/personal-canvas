import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createShapeId, type Editor } from '@tldraw/tldraw';
import { api, type SearchResult } from '../api';

type FileFilter = 'all' | 'pdf' | 'image' | 'video' | 'code' | 'text';

const FILTERS: Array<{ id: FileFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'pdf', label: 'PDF' },
  { id: 'image', label: 'Image' },
  { id: 'video', label: 'Video' },
  { id: 'code', label: 'Code' },
  { id: 'text', label: 'Text' },
];

const TYPE_ICONS: Record<string, string> = {
  pdf: '📄',
  image: '🖼️',
  video: '🎬',
  code: '💻',
  text: '📝',
  audio: '🎵',
  other: '📁',
};

interface SearchBarProps {
  getEditor: () => Editor | null;
}

export function SearchBar({ getEditor }: SearchBarProps) {
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [filter, setFilter] = useState<FileFilter>('all');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [loadingSemantic, setLoadingSemantic] = useState(false);
  const latestRequestId = useRef(0);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query.trim()), 300);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setQuery('');
      setDebouncedQuery('');
      setResults([]);
      setOpen(false);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    const q = debouncedQuery;
    if (!q) {
      setResults([]);
      setOpen(false);
      setLoadingSemantic(false);
      return;
    }

    const requestId = ++latestRequestId.current;
    const type = filter === 'all' ? undefined : filter;

    setOpen(true);
    setLoadingSemantic(true);

    api.searchFiles(q, { type, semantic: false, topN: 20 })
      .then((fast) => {
        if (latestRequestId.current !== requestId) return;
        setResults(fast.keyword_results);
      })
      .catch((err) => {
        console.error('Keyword search failed:', err);
      });

    api.searchFiles(q, { type, semantic: true, topN: 20 })
      .then((full) => {
        if (latestRequestId.current !== requestId) return;
        setResults(full.results);
      })
      .catch((err) => {
        console.error('Semantic search failed:', err);
      })
      .finally(() => {
        if (latestRequestId.current !== requestId) return;
        setLoadingSemantic(false);
      });
  }, [debouncedQuery, filter]);

  const resultCountLabel = useMemo(() => {
    if (!debouncedQuery) return '';
    return `${results.length} result${results.length === 1 ? '' : 's'}`;
  }, [debouncedQuery, results.length]);

  const handleSelectResult = (result: SearchResult) => {
    const editor = getEditor();
    if (!editor) return;

    const shapeId = createShapeId(result.file_id);
    const shape = editor.getShape(shapeId);
    if (!shape) return;

    editor.select(shapeId);
    (editor as any).zoomToFit?.([shapeId], { duration: 350 });
    (editor as any).zoomToSelection?.({ animation: { duration: 350 } });

    editor.updateShape({
      id: shapeId,
      type: 'file-card',
      meta: {
        ...(shape as any).meta,
        highlightUntil: Date.now() + 1000,
      },
      props: {
        ...(shape as any).props,
        _v: (((shape as any).props?._v as number | undefined) ?? 0) + 1,
      },
    } as any);

    setTimeout(() => {
      const next = editor.getShape(shapeId);
      if (!next) return;
      editor.updateShape({
        id: shapeId,
        type: 'file-card',
        meta: {
          ...(next as any).meta,
          highlightUntil: 0,
        },
        props: {
          ...(next as any).props,
          _v: (((next as any).props?._v as number | undefined) ?? 0) + 1,
        },
      } as any);
    }, 1050);
  };

  return (
    <div style={styles.root}>
      <div style={styles.panel}>
        <input
          type="text"
          value={query}
          placeholder="Search your knowledge base"
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => {
            if (debouncedQuery) setOpen(true);
          }}
          style={styles.input}
        />

        <div style={styles.filters}>
          {FILTERS.map((item) => (
            <button
              key={item.id}
              onClick={() => setFilter(item.id)}
              style={{
                ...styles.filterBtn,
                ...(filter === item.id ? styles.filterBtnActive : {}),
              }}
            >
              {item.label}
            </button>
          ))}
        </div>

        {open && (
          <div style={styles.results}>
            <div style={styles.resultsMeta}>
              <span>{resultCountLabel}</span>
              {loadingSemantic ? <span>Refining with semantic...</span> : <span>Hybrid ranking ready</span>}
            </div>

            {results.length === 0 ? (
              <div style={styles.empty}>No matching files</div>
            ) : (
              results.map((result) => {
                const title = result.ai_title?.trim() || result.filename;
                const tags = (result.tags ?? '').trim().split(/\s+/).filter(Boolean).slice(0, 3);
                return (
                  <button
                    key={result.file_id}
                    style={styles.resultRow}
                    onClick={() => handleSelectResult(result)}
                    title={title}
                  >
                    <span style={styles.icon}>{TYPE_ICONS[result.file_type] ?? '📁'}</span>
                    <span style={styles.resultBody}>
                      <span style={styles.resultTitle}>{title}</span>
                      <span style={styles.resultMeta}>
                        <span>{result.ai_category ?? 'Other'}</span>
                        {tags.length > 0 ? <span>{tags.join(' · ')}</span> : null}
                      </span>
                    </span>
                  </button>
                );
              })
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  root: {
    width: '100%',
    maxWidth: 920,
    pointerEvents: 'all',
  },
  panel: {
    background: 'rgba(255,255,255,0.96)',
    border: '1px solid #e2e8f0',
    borderRadius: 14,
    boxShadow: '0 18px 32px rgba(15,23,42,0.14)',
    padding: 10,
    backdropFilter: 'blur(10px)',
  },
  input: {
    width: '100%',
    height: 42,
    borderRadius: 10,
    border: '1px solid #d7dee8',
    padding: '0 12px',
    fontSize: 14,
    color: '#0f172a',
    outline: 'none',
    background: '#fff',
  },
  filters: {
    marginTop: 8,
    display: 'flex',
    gap: 6,
    flexWrap: 'wrap',
  },
  filterBtn: {
    border: '1px solid #d8e0ea',
    background: '#f8fafc',
    color: '#334155',
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 600,
    padding: '4px 10px',
    cursor: 'pointer',
  },
  filterBtnActive: {
    background: '#e0f2fe',
    borderColor: '#7dd3fc',
    color: '#0c4a6e',
  },
  results: {
    marginTop: 8,
    maxHeight: 360,
    overflow: 'auto',
    borderTop: '1px solid #eef2f7',
    paddingTop: 8,
  },
  resultsMeta: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: 11,
    color: '#64748b',
    padding: '0 4px 8px',
  },
  empty: {
    textAlign: 'center',
    color: '#94a3b8',
    fontSize: 13,
    padding: '14px 6px',
  },
  resultRow: {
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    border: '1px solid #edf2f7',
    background: '#fff',
    borderRadius: 10,
    marginBottom: 6,
    padding: '8px 10px',
    textAlign: 'left',
    cursor: 'pointer',
  },
  icon: {
    fontSize: 16,
    width: 22,
    textAlign: 'center',
    flexShrink: 0,
  },
  resultBody: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    minWidth: 0,
  },
  resultTitle: {
    fontSize: 13,
    color: '#0f172a',
    fontWeight: 600,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  resultMeta: {
    fontSize: 11,
    color: '#64748b',
    display: 'flex',
    gap: 8,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
};

