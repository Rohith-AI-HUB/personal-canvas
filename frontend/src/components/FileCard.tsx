import {
  BaseBoxShapeUtil,
  HTMLContainer,
  Rectangle2d,
  type TLBaseShape,
  type RecordProps,
  T,
} from '@tldraw/tldraw';
import { useState, useEffect, useCallback } from 'react';
import type { FileRecord, FileStatus } from '../api';

// ── Shape types ──────────────────────────────────────────────────────────────

export type FileCardShapeProps = {
  w: number;
  h: number;
  fileId: string;
  _v: number;
};

export type FileCardMeta = {
  fileId: string;
  aiTitle?: string;
  summary?: string;
  tags?: string[];
  status?: FileStatus;
  errorMessage?: string;
  highlightUntil?: number;
};

export type FileCardShape = TLBaseShape<'file-card', FileCardShapeProps>;

export const fileCardShapeProps: RecordProps<FileCardShape> = {
  w: T.number,
  h: T.number,
  fileId: T.string,
  _v: T.number,
};

export const CARD_WIDTH  = 200;
export const CARD_HEIGHT = 260;

// ── Type palette — used for gradient covers when no thumbnail exists ──────────

const TYPE_PALETTE: Record<FileRecord['file_type'], {
  color:     string;     // accent / tag color
  soft:      string;     // lightest bg
  medium:    string;     // tag border
  label:     string;     // display name
  gradFrom:  string;     // gradient start (light)
  gradTo:    string;     // gradient end (slightly deeper)
}> = {
  pdf:   { color: '#C94F4F', soft: '#FDEAEA', medium: '#F6BDBD', label: 'PDF',   gradFrom: '#FFF0F0', gradTo: '#FDDADA' },
  image: { color: '#3070C4', soft: '#E8F2FE', medium: '#B8D4F8', label: 'Image', gradFrom: '#EDF5FF', gradTo: '#D3E8FC' },
  video: { color: '#6B4CC4', soft: '#EFEBFE', medium: '#CFC3F5', label: 'Video', gradFrom: '#F2EEFE', gradTo: '#E0D6FC' },
  audio: { color: '#0A8FA4', soft: '#E6F8FC', medium: '#A5DDE8', label: 'Audio', gradFrom: '#EAFBFE', gradTo: '#C8EEF5' },
  code:  { color: '#1A9460', soft: '#E7F7F0', medium: '#A3DEC9', label: 'Code',  gradFrom: '#EDFAF4', gradTo: '#CBF0DF' },
  text:  { color: '#4D4BB8', soft: '#EEEFFE', medium: '#C4C3F4', label: 'Text',  gradFrom: '#F0EFFF', gradTo: '#DDDCFC' },
  other: { color: '#6B7785', soft: '#EEF0F4', medium: '#C4CBD4', label: 'File',  gradFrom: '#F4F5F7', gradTo: '#E4E8EC' },
};

// ── FileCard Component ───────────────────────────────────────────────────────

interface FileCardProps {
  file:      FileRecord;
  width:     number;
  height:    number;
  shapeMeta?: FileCardMeta;
  onRetry?:  (fileId: string) => void;
}

export function FileCardComponent({ file, width, height, shapeMeta, onRetry }: FileCardProps) {
  const title      = shapeMeta?.aiTitle ?? file.metadata?.ai_title ?? file.filename;
  const tags       = (shapeMeta?.tags ?? file.tags ?? []).filter(Boolean);
  const status     = shapeMeta?.status ?? file.status;
  const palette    = TYPE_PALETTE[file.file_type] ?? TYPE_PALETTE.other;
  const isHighlit  = (shapeMeta?.highlightUntil ?? 0) > Date.now();

  const thumbnailUrl = file.thumbnail_path
    ? `http://127.0.0.1:3001/api/thumbnail?path=${encodeURIComponent(file.thumbnail_path)}`
    : null;

  const hasCover = !!thumbnailUrl;

  return (
    <div
      style={{
        width,
        height,
        borderRadius: 12,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        fontFamily: "'Inter', system-ui, sans-serif",
        userSelect: 'none',
        position: 'relative',
        cursor: 'default',
        transition: 'box-shadow 180ms ease, border-color 180ms ease, transform 180ms ease',
        boxShadow: isHighlit
          ? `0 0 0 2.5px ${palette.color}, 0 8px 28px rgba(20,15,10,0.14)`
          : '0 1px 3px rgba(20,15,10,0.05), 0 4px 14px rgba(20,15,10,0.09)',
        border: isHighlit
          ? 'none'
          : '1px solid rgba(28,25,23,0.08)',
      }}
    >
      {/* ── Full-card cover: thumbnail OR gradient ── */}
      <CoverArea
        hasCover={hasCover}
        thumbnailUrl={thumbnailUrl}
        palette={palette}
        fileType={file.file_type}
      />

      {/* ── Bottom overlay: title + tags, always over the cover ── */}
      <div
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          padding: '28px 11px 10px',
          background: hasCover
            ? 'linear-gradient(to top, rgba(12,10,8,0.72) 0%, rgba(12,10,8,0.30) 65%, transparent 100%)'
            : 'linear-gradient(to top, rgba(255,255,255,0.95) 0%, rgba(255,255,255,0.60) 65%, transparent 100%)',
          display: 'flex',
          flexDirection: 'column',
          gap: 5,
        }}
      >
        {/* Title */}
        <div
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: hasCover ? '#FFFFFF' : '#1C1917',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            letterSpacing: '-0.01em',
            lineHeight: 1.3,
            textShadow: hasCover ? '0 1px 4px rgba(0,0,0,0.5)' : 'none',
          }}
          title={title}
        >
          {title}
        </div>

        {/* Tags row */}
        {tags.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'nowrap', gap: 3, overflow: 'hidden' }}>
            {tags.slice(0, 3).map((tag) => (
              <span
                key={tag}
                style={{
                  fontSize: 9,
                  fontWeight: 600,
                  letterSpacing: '0.01em',
                  padding: '2px 6px',
                  borderRadius: 4,
                  whiteSpace: 'nowrap',
                  background: hasCover
                    ? 'rgba(255,255,255,0.18)'
                    : palette.soft,
                  color: hasCover
                    ? 'rgba(255,255,255,0.90)'
                    : palette.color,
                  border: hasCover
                    ? '1px solid rgba(255,255,255,0.22)'
                    : `1px solid ${palette.medium}`,
                  backdropFilter: hasCover ? 'blur(4px)' : 'none',
                  WebkitBackdropFilter: hasCover ? 'blur(4px)' : 'none',
                }}
              >
                {tag}
              </span>
            ))}
            {tags.length > 3 && (
              <span
                style={{
                  fontSize: 9,
                  fontWeight: 600,
                  padding: '2px 6px',
                  borderRadius: 4,
                  background: hasCover ? 'rgba(255,255,255,0.12)' : '#F0EDE7',
                  color: hasCover ? 'rgba(255,255,255,0.70)' : '#78716C',
                  border: hasCover ? '1px solid rgba(255,255,255,0.16)' : '1px solid rgba(28,25,23,0.07)',
                }}
              >
                +{tags.length - 3}
              </span>
            )}
          </div>
        )}
      </div>

      {/* ── Type pill — top left ── */}
      <div
        style={{
          position: 'absolute',
          top: 9,
          left: 9,
          zIndex: 3,
          background: hasCover
            ? 'rgba(12,10,8,0.52)'
            : `${palette.soft}EE`,
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
          color: hasCover ? 'rgba(255,255,255,0.88)' : palette.color,
          fontSize: 8.5,
          fontWeight: 700,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          padding: '3px 8px',
          borderRadius: 5,
          border: hasCover
            ? '1px solid rgba(255,255,255,0.14)'
            : `1px solid ${palette.medium}`,
        }}
      >
        {palette.label}
      </div>

      {/* ── Status badge — top right ── */}
      <StatusBadge status={status} fileId={file.id} onRetry={onRetry} hasCover={hasCover} />
    </div>
  );
}

// ── Cover Area ───────────────────────────────────────────────────────────────

function CoverArea({
  hasCover,
  thumbnailUrl,
  palette,
  fileType,
}: {
  hasCover:     boolean;
  thumbnailUrl: string | null;
  palette:      typeof TYPE_PALETTE[keyof typeof TYPE_PALETTE];
  fileType:     FileRecord['file_type'];
}) {
  const [imgFailed, setImgFailed] = useState(false);
  const [retryKey, setRetryKey] = useState(0);

  // Reset failure state when the thumbnail URL changes (new file or re-upload)
  useEffect(() => {
    setImgFailed(false);
    setRetryKey(k => k + 1);
  }, [thumbnailUrl]);

  const handleError = useCallback(() => {
    setImgFailed(true);
    // Auto-retry after 4 seconds — backend might still be starting up
    const timer = setTimeout(() => {
      setImgFailed(false);
      setRetryKey(k => k + 1);
    }, 4000);
    return () => clearTimeout(timer);
  }, []);

  if (hasCover && !imgFailed) {
    // Real cover: thumbnail fills the entire card
    return (
      <img
        key={retryKey}
        src={thumbnailUrl!}
        alt=""
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          objectPosition: 'center top',
          display: 'block',
        }}
        onError={handleError}
      />
    );
  }

  // No cover or failed load: light gradient fill + centered icon
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        background: `linear-gradient(135deg, ${palette.gradFrom} 0%, ${palette.gradTo} 100%)`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {/* Subtle texture overlay */}
      <div style={{
        position: 'absolute',
        inset: 0,
        backgroundImage: `radial-gradient(circle at 70% 25%, rgba(255,255,255,0.55) 0%, transparent 60%)`,
        pointerEvents: 'none',
      }} />

      {/* Center icon */}
      <div
        style={{
          position: 'relative',
          zIndex: 1,
          width: 52,
          height: 52,
          borderRadius: 14,
          background: 'rgba(255,255,255,0.70)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: `0 2px 12px ${palette.medium}80`,
        }}
      >
        <LargeIcon type={fileType} color={palette.color} />
      </div>
    </div>
  );
}

// ── Status Badge ─────────────────────────────────────────────────────────────

function StatusBadge({
  status,
  fileId,
  onRetry,
  hasCover,
}: {
  status:   FileStatus;
  fileId:   string;
  onRetry?: (id: string) => void;
  hasCover: boolean;
}) {
  if (status === 'complete') return null;

  const config: Record<Exclude<FileStatus, 'complete'>, {
    color:     string;
    icon:      React.ReactNode;
    title:     string;
    clickable?: boolean;
    spin?:     boolean;
  }> = {
    pending: {
      color: '#C27832',
      icon: <ClockIcon />,
      title: 'Queued for processing',
    },
    processing: {
      color: '#C27832',
      icon: <SpinSmIcon />,
      title: 'Processing…',
      spin: true,
    },
    error: {
      color: '#C9403C',
      icon: <WarnIcon />,
      title: 'Processing failed — click to retry',
      clickable: true,
    },
  };

  const c = config[status as Exclude<FileStatus, 'complete'>];
  if (!c) return null;

  return (
    <div
      className={c.spin ? 'file-status-spin' : undefined}
      style={{
        position: 'absolute',
        top: 8,
        right: 8,
        zIndex: 4,
        width: 26,
        height: 26,
        borderRadius: '50%',
        background: hasCover ? 'rgba(12,10,8,0.55)' : 'rgba(255,255,255,0.90)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: hasCover ? 'rgba(255,255,255,0.90)' : c.color,
        boxShadow: '0 1px 4px rgba(0,0,0,0.12)',
        cursor: c.clickable ? 'pointer' : 'default',
        border: hasCover
          ? '1px solid rgba(255,255,255,0.16)'
          : `1px solid ${c.color}28`,
      }}
      title={c.title}
      onClick={
        c.clickable && onRetry
          ? (e) => { e.stopPropagation(); onRetry(fileId); }
          : undefined
      }
    >
      {c.icon}
    </div>
  );
}

// ── Icons ─────────────────────────────────────────────────────────────────────

function LargeIcon({ type, color }: { type: FileRecord['file_type']; color: string }) {
  const s: React.CSSProperties = { color };
  const w = 24, h = 24;
  switch (type) {
    case 'pdf':   return <svg style={s} width={w} height={h} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="15" x2="15" y2="15"/><line x1="9" y1="11" x2="15" y2="11"/></svg>;
    case 'image': return <svg style={s} width={w} height={h} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>;
    case 'video': return <svg style={s} width={w} height={h} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>;
    case 'audio': return <svg style={s} width={w} height={h} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>;
    case 'code':  return <svg style={s} width={w} height={h} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>;
    case 'text':  return <svg style={s} width={w} height={h} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><line x1="17" y1="10" x2="3" y2="10"/><line x1="21" y1="6" x2="3" y2="6"/><line x1="21" y1="14" x2="3" y2="14"/><line x1="17" y1="18" x2="3" y2="18"/></svg>;
    default:      return <svg style={s} width={w} height={h} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>;
  }
}

// Small icons for inline use
function PdfSvg()   { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="15" x2="15" y2="15"/><line x1="9" y1="11" x2="15" y2="11"/></svg>; }
function ImageSvg() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>; }
function VideoSvg() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>; }
function AudioSvg() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>; }
function CodeSvg()  { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>; }
function TextSvg()  { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><line x1="17" y1="10" x2="3" y2="10"/><line x1="21" y1="6" x2="3" y2="6"/><line x1="21" y1="14" x2="3" y2="14"/><line x1="17" y1="18" x2="3" y2="18"/></svg>; }
function OtherSvg() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>; }

function ClockIcon()  { return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>; }
function SpinSmIcon() { return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" strokeLinecap="round"/></svg>; }
function WarnIcon()   { return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>; }

// ── Exports not used internally but referenced by SVG imports elsewhere ──────
export { PdfSvg, ImageSvg, VideoSvg, AudioSvg, CodeSvg, TextSvg, OtherSvg };

// ── Shared fileStore ─────────────────────────────────────────────────────────

export const fileStore = new Map<string, FileRecord>();

export let onFileRetry: ((fileId: string) => void) | undefined;
export function setRetryHandler(fn: (fileId: string) => void) {
  onFileRetry = fn;
}

export let onOpenFile: ((file: FileRecord) => void) | undefined;
export function setOpenFileHandler(fn?: (file: FileRecord) => void) {
  onOpenFile = fn;
}

// ── tldraw Shape Util ────────────────────────────────────────────────────────

export class FileCardShapeUtil extends BaseBoxShapeUtil<any> {
  static override type  = 'file-card' as const;
  static override props = fileCardShapeProps;

  override canEdit = () => false;

  override getDefaultProps(): FileCardShapeProps {
    return { w: CARD_WIDTH, h: CARD_HEIGHT, fileId: '', _v: 0 };
  }

  override getGeometry(shape: FileCardShape) {
    return new Rectangle2d({
      width:    shape.props.w,
      height:   shape.props.h,
      isFilled: true,
    });
  }

  override component(shape: FileCardShape) {
    const file = fileStore.get(shape.props.fileId);

    if (!file) {
      // Ghost skeleton while file loads
      return (
        <HTMLContainer>
          <div
            style={{
              width: shape.props.w,
              height: shape.props.h,
              borderRadius: 12,
              background: 'linear-gradient(135deg, #F5F4F2 0%, #ECEAE6 100%)',
              border: '1px solid rgba(28,25,23,0.07)',
              boxShadow: '0 1px 3px rgba(20,15,10,0.05), 0 4px 14px rgba(20,15,10,0.09)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontFamily: "'Inter', system-ui, sans-serif",
            }}
          >
            <div style={{ textAlign: 'center', color: '#A8A29E', opacity: 0.7 }}>
              <div style={{ fontSize: 22, marginBottom: 6 }}>⏳</div>
              <div style={{ fontSize: 10, fontWeight: 500 }}>Loading…</div>
            </div>
          </div>
        </HTMLContainer>
      );
    }

    return (
      <HTMLContainer>
        <FileCardComponent
          file={file}
          width={shape.props.w}
          height={shape.props.h}
          shapeMeta={(shape as any).meta as FileCardMeta | undefined}
          onRetry={onFileRetry}
        />
      </HTMLContainer>
    );
  }

  override indicator(shape: FileCardShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={12} />;
  }

  override onDoubleClick(shape: FileCardShape) {
    const file = fileStore.get(shape.props.fileId);
    if (file) onOpenFile?.(file);
    return undefined;
  }
}
