import { useEffect, useState, type CSSProperties } from 'react';
import { api } from '../api';
import type { FileRecord } from '../api';

interface FileViewerProps {
  file: FileRecord;
  onClose: () => void;
}

const EXT_LANG: Record<string, string> = {
  '.py': 'python', '.js': 'javascript', '.jsx': 'javascript',
  '.ts': 'typescript', '.tsx': 'typescript', '.json': 'json',
  '.html': 'html', '.css': 'css', '.md': 'markdown',
  '.sh': 'bash', '.rs': 'rust', '.go': 'go', '.java': 'java',
  '.cpp': 'cpp', '.c': 'c', '.rb': 'ruby', '.yaml': 'yaml',
  '.yml': 'yaml', '.toml': 'toml', '.sql': 'sql', '.txt': 'text',
};

function getExt(filename: string): string {
  const m = filename.match(/\.[^.]+$/);
  return m ? m[0].toLowerCase() : '';
}

function isMeaningfulContent(text: string | null | undefined, filename: string): boolean {
  const value = (text ?? '').trim();
  if (!value) return false;
  return value.toLowerCase() !== filename.trim().toLowerCase();
}

export function FileViewer({ file, onClose }: FileViewerProps) {
  const ext = getExt(file.filename);
  const rawUrl = api.rawFileUrl(file.id);
  const isPdf = ext === '.pdf';
  const isDocx = ext === '.docx';
  const isLegacyDoc = ext === '.doc';
  const isCode = file.file_type === 'code' || (!!EXT_LANG[ext] && !isPdf && !isDocx && !isLegacyDoc);
  const isText = ext === '.txt' || ext === '.md' || ext === '.csv';

  useEffect(() => {
    const handler = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div style={s.overlay} onClick={onClose}>
      <div style={s.modal} onClick={(e) => e.stopPropagation()}>
        <div style={s.header}>
          <div style={s.headerLeft}>
            <TypeBadge type={file.file_type} />
            <span style={s.filename} title={file.filename}>{file.filename}</span>
          </div>
          <div style={s.headerActions}>
            <a href={rawUrl} download={file.filename} style={s.iconBtn} title="Download">
              <DownloadIcon />
            </a>
            <button style={s.iconBtn} onClick={onClose} title="Close (Esc)">x</button>
          </div>
        </div>
        <div style={s.body}>
          {isPdf && <PdfViewer url={rawUrl} />}
          {isDocx && <DocxViewer rawUrl={rawUrl} />}
          {isLegacyDoc && <LegacyDocViewer file={file} rawUrl={rawUrl} />}
          {(isCode || isText) && <CodeViewer fileId={file.id} ext={ext} />}
          {!isPdf && !isDocx && !isLegacyDoc && !isCode && !isText && (
            <UnsupportedViewer filename={file.filename} rawUrl={rawUrl} />
          )}
        </div>
      </div>
    </div>
  );
}

function PdfViewer({ url }: { url: string }) {
  return (
    <iframe
      src={`${url}#toolbar=1&navpanes=0`}
      style={{ width: '100%', height: '100%', border: 'none', background: '#525659' }}
      title="PDF Viewer"
    />
  );
}

function DocxViewer({ rawUrl }: { rawUrl: string }) {
  const [html, setHtml] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch(rawUrl);
        if (!res.ok) throw new Error(`Failed to fetch file (${res.status})`);
        const arrayBuffer = await res.arrayBuffer();

        const mammoth = await import('mammoth/mammoth.browser');
        const result = await mammoth.convertToHtml({ arrayBuffer });

        if (cancelled) return;

        const rendered = result.value.trim();
        if (!rendered) {
          setError('No readable content found in this .docx file.');
          setHtml('');
        } else {
          setHtml(rendered);
          setError(null);
        }
      } catch {
        if (!cancelled) {
          setError('Failed to render this .docx file.');
          setHtml('');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [rawUrl]);

  if (loading) return <Spinner label="Loading document..." />;
  if (error) return <ErrorMsg msg={error} />;

  return (
    <div style={s.docxBody}>
      <style>{`
        .pc-docx-page p { margin: 0 0 12px; line-height: 1.75; }
        .pc-docx-page h1, .pc-docx-page h2, .pc-docx-page h3 { margin: 18px 0 12px; line-height: 1.35; }
        .pc-docx-page ul, .pc-docx-page ol { margin: 0 0 12px 22px; }
        .pc-docx-page table { border-collapse: collapse; margin: 12px 0; width: 100%; }
        .pc-docx-page td, .pc-docx-page th { border: 1px solid #e7e5e4; padding: 6px 8px; }
      `}</style>
      <div style={s.docxPage} className="pc-docx-page" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}

function LegacyDocViewer({ file, rawUrl }: { file: FileRecord; rawUrl: string }) {
  const [text, setText] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const content = await api.getFileContent(file.id);
        if (cancelled) return;
        const extracted = content.extracted_text?.trim() || content.ai_summary?.trim() || '';

        if (isMeaningfulContent(extracted, file.filename)) {
          setText(extracted);
          setError(null);
        } else {
          setText(null);
          setError('Legacy .doc preview is limited. Please convert to .docx or PDF for full in-app preview.');
        }
      } catch {
        if (!cancelled) {
          setText(null);
          setError('Legacy .doc preview is not available for this file.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [file.id, file.filename]);

  if (loading) return <Spinner label="Loading document..." />;

  if (!error && text) {
    return (
      <div style={s.docxBody}>
        <div style={s.docxPage}>
          {text.split('\n').map((line, i) => (
            line.trim()
              ? <p key={i} style={s.docxPara}>{line}</p>
              : <div key={i} style={{ height: 8 }} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div style={s.unsupported}>
      <div style={{ fontSize: 14, fontWeight: 600, color: '#1C1917', marginBottom: 6 }}>Preview not available</div>
      <div style={{ fontSize: 12, color: '#78716C', marginBottom: 20 }}>{error}</div>
      <a href={rawUrl} download={file.filename} style={s.downloadLarge}>Download file</a>
    </div>
  );
}

function CodeViewer({ fileId, ext }: { fileId: string; ext: string }) {
  const [code, setCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const lang = EXT_LANG[ext] ?? 'text';

  useEffect(() => {
    fetch(api.rawFileUrl(fileId))
      .then((r) => r.text())
      .then((t) => {
        setCode(t);
        setLoading(false);
      })
      .catch(() => {
        setError('Failed to load file');
        setLoading(false);
      });
  }, [fileId]);

  if (loading) return <Spinner label="Loading file..." />;
  if (error) return <ErrorMsg msg={error} />;

  const lines = (code ?? '').split('\n');

  return (
    <div style={s.codeWrap}>
      <div style={s.codeLangBar}>
        <span style={s.codeLangBadge}>{lang}</span>
        <span style={s.codeLineCount}>{lines.length} lines</span>
      </div>
      <div style={s.codeScroll}>
        <table style={s.codeTable}>
          <tbody>
            {lines.map((line, i) => (
              <tr key={i}>
                <td style={s.lineNum}>{i + 1}</td>
                <td style={s.lineCode}>{line || '\u00A0'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function UnsupportedViewer({ filename, rawUrl }: { filename: string; rawUrl: string }) {
  return (
    <div style={s.unsupported}>
      <div style={{ fontSize: 14, fontWeight: 600, color: '#1C1917', marginBottom: 6 }}>Preview not available</div>
      <div style={{ fontSize: 12, color: '#78716C', marginBottom: 20 }}>{filename} cannot be previewed in the app yet.</div>
      <a href={rawUrl} download={filename} style={s.downloadLarge}>Download file</a>
    </div>
  );
}

function Spinner({ label }: { label: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 12, color: '#78716C', fontSize: 13 }}>
      <svg width="28" height="28" viewBox="0 0 36 36" fill="none" style={{ animation: 'spin 0.8s linear infinite' }}>
        <style>{'@keyframes spin{to{transform:rotate(360deg)}}'}</style>
        <circle cx="18" cy="18" r="14" stroke="#E8E5DF" strokeWidth="3" />
        <path d="M18 4 A14 14 0 0 1 32 18" stroke="#5B5BD6" strokeWidth="3" strokeLinecap="round" />
      </svg>
      {label}
    </div>
  );
}

function ErrorMsg({ msg }: { msg: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#C9403C', fontSize: 13 }}>
      ! {msg}
    </div>
  );
}

const TYPE_COLOR: Record<string, string> = { pdf: '#C94F4F', image: '#3070C4', video: '#6B4CC4', audio: '#0A8FA4', code: '#1A9460', text: '#4D4BB8', other: '#6B7785' };
const TYPE_BG: Record<string, string> = { pdf: '#FDEAEA', image: '#E8F2FE', video: '#EFEBFE', audio: '#E6F8FC', code: '#E7F7F0', text: '#EEEFFE', other: '#EEF0F4' };

function TypeBadge({ type }: { type: string }) {
  return (
    <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase' as const, padding: '3px 8px', borderRadius: 5, background: TYPE_BG[type] ?? TYPE_BG.other, color: TYPE_COLOR[type] ?? TYPE_COLOR.other }}>
      {type}
    </span>
  );
}

function DownloadIcon() {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>;
}

const s: Record<string, CSSProperties> = {
  overlay: { position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(12,10,8,0.62)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Inter,system-ui,sans-serif', animation: 'fade-in 160ms ease forwards' },
  modal: { width: 'min(900px, 92vw)', height: 'min(82vh, 700px)', background: '#FEFCF9', borderRadius: 16, boxShadow: '0 24px 80px rgba(0,0,0,0.28)', display: 'flex', flexDirection: 'column', overflow: 'hidden', border: '1px solid rgba(28,25,23,0.08)', animation: 'scale-in 200ms cubic-bezier(0.16, 1, 0.3, 1) forwards' },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid rgba(28,25,23,0.07)', background: '#F9F7F4', flexShrink: 0 },
  headerLeft: { display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 },
  filename: { fontSize: 13, fontWeight: 600, color: '#1C1917', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const, letterSpacing: '-0.01em' },
  headerActions: { display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 },
  iconBtn: { width: 30, height: 30, borderRadius: 8, background: '#F0EDE7', border: '1px solid rgba(28,25,23,0.09)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#57534E', cursor: 'pointer', textDecoration: 'none', fontSize: 13 },
  body: { flex: 1, overflow: 'hidden', position: 'relative' as const },

  docxBody: { height: '100%', overflowY: 'auto', background: '#F4F2EE', padding: '24px 16px' },
  docxPage: { maxWidth: 680, margin: '0 auto', background: '#FFFFFF', padding: '48px 56px', borderRadius: 4, boxShadow: '0 2px 12px rgba(0,0,0,0.08)', minHeight: 400, fontSize: 13.5, lineHeight: 1.75, color: '#1C1917' },
  docxPara: { margin: '0 0 8px', fontSize: 13.5, lineHeight: 1.75, color: '#1C1917' },

  codeWrap: { height: '100%', display: 'flex', flexDirection: 'column', background: '#1C1917' },
  codeLangBar: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 14px', background: '#2C2825', borderBottom: '1px solid #3C3632', flexShrink: 0 },
  codeLangBadge: { fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' as const, color: '#A8A29E', fontFamily: "'JetBrains Mono',monospace" },
  codeLineCount: { fontSize: 10, color: '#57534E', fontFamily: "'JetBrains Mono',monospace" },
  codeScroll: { flex: 1, overflowY: 'auto', overflowX: 'auto' },
  codeTable: { borderCollapse: 'collapse', width: '100%', fontFamily: "'JetBrains Mono','Fira Code',monospace", fontSize: 12.5 },
  lineNum: { padding: '0 16px 0 14px', textAlign: 'right' as const, color: '#4A4540', userSelect: 'none' as const, verticalAlign: 'top', lineHeight: '1.7', borderRight: '1px solid #2C2825', minWidth: 42, width: 42 },
  lineCode: { padding: '0 16px', color: '#D4CFC8', lineHeight: '1.7', whiteSpace: 'pre', verticalAlign: 'top' },

  unsupported: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%' },
  downloadLarge: { padding: '9px 20px', borderRadius: 8, background: '#5B5BD6', color: '#fff', textDecoration: 'none', fontSize: 13, fontWeight: 600 },
};
