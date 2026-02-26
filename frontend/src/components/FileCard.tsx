import {
  BaseBoxShapeUtil,
  HTMLContainer,
  Rectangle2d,
  type TLBaseShape,
  type RecordProps,
  T,
} from '@tldraw/tldraw';
import type { FileRecord } from '../api';

// ── Shape type definition ──────────────────────────────────────────────────────

export type FileCardShapeProps = {
  w: number;
  h: number;
  fileId: string;
  _v: number;
};

export type FileCardShape = TLBaseShape<'file-card', FileCardShapeProps>;

export const fileCardShapeProps: RecordProps<FileCardShape> = {
  w: T.number,
  h: T.number,
  fileId: T.string,
  _v: T.number,
};

// ── Uniform card dimensions ────────────────────────────────────────────────────

export const CARD_WIDTH = 220;
export const CARD_HEIGHT = 260;

// ── Constants ──────────────────────────────────────────────────────────────────

const FILE_ICONS: Record<FileRecord['file_type'], string> = {
  pdf: '📄',
  image: '🖼️',
  video: '🎬',
  audio: '🎵',
  code: '💻',
  text: '📝',
  other: '📁',
};

const FILE_COLORS: Record<FileRecord['file_type'], string> = {
  pdf: '#ef4444',
  image: '#3b82f6',
  video: '#8b5cf6',
  audio: '#06b6d4',
  code: '#10b981',
  text: '#6366f1',
  other: '#94a3b8',
};

const FILE_GRADIENTS: Record<FileRecord['file_type'], string> = {
  pdf: 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)',
  image: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
  video: 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)',
  audio: 'linear-gradient(135deg, #06b6d4 0%, #0891b2 100%)',
  code: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
  text: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)',
  other: 'linear-gradient(135deg, #94a3b8 0%, #64748b 100%)',
};

// ── FileCard Component ────────────────────────────────────────────────────────

interface FileCardComponentProps {
  file: FileRecord;
  width: number;
  height: number;
}

export function FileCardComponent({ file, width, height }: FileCardComponentProps) {
  const title = file.metadata?.ai_title ?? file.filename;
  const summary = file.metadata?.ai_summary ?? null;
  const tags = file.tags ?? [];
  const icon = FILE_ICONS[file.file_type] ?? '📁';
  const accentColor = FILE_COLORS[file.file_type] ?? '#94a3b8';
  const gradient = FILE_GRADIENTS[file.file_type] ?? FILE_GRADIENTS.other;

  // Build the thumbnail URL — served via backend route
  const thumbnailUrl = file.thumbnail_path
    ? `http://127.0.0.1:3001/api/thumbnail?path=${encodeURIComponent(file.thumbnail_path)}`
    : null;

  return (
    <div
      style={{
        width,
        height,
        borderRadius: 14,
        overflow: 'hidden',
        background: '#ffffff',
        boxShadow: '0 1px 3px rgba(0,0,0,0.06), 0 4px 12px rgba(0,0,0,0.08)',
        display: 'flex',
        flexDirection: 'column',
        fontFamily: "'Inter', 'SF Pro Display', system-ui, sans-serif",
        userSelect: 'none',
        border: '1px solid rgba(0,0,0,0.06)',
        pointerEvents: 'all',
        transition: 'box-shadow 0.2s ease, transform 0.2s ease',
      }}
    >
      {/* ── Thumbnail area ── */}
      <div
        style={{
          height: Math.round(height * 0.52),
          flexShrink: 0,
          position: 'relative',
          overflow: 'hidden',
          background: gradient,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {/* FIX: Use <img> WITHOUT crossOrigin to avoid CORS issues in tldraw HTMLContainer */}
        {thumbnailUrl ? (
          <img
            src={thumbnailUrl}
            alt={file.filename}
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              objectPosition: 'center',
              display: 'block',
            }}
            onError={(e) => {
              // On load failure, hide the img and show the icon fallback
              (e.target as HTMLImageElement).style.display = 'none';
            }}
          />
        ) : null}

        {/* Icon fallback — always shown behind the image */}
        <span style={{
          fontSize: 40,
          opacity: 0.95,
          position: 'relative',
          zIndex: 1,
          filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.15))',
        }}>
          {icon}
        </span>

        {/* Status badge */}
        <StatusBadge status={file.status} />

        {/* File type chip */}
        <div
          style={{
            position: 'absolute',
            bottom: 8,
            left: 8,
            background: 'rgba(0,0,0,0.45)',
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)',
            color: '#fff',
            fontSize: 9,
            fontWeight: 700,
            padding: '3px 8px',
            borderRadius: 6,
            textTransform: 'uppercase',
            letterSpacing: '0.8px',
            zIndex: 2,
          }}
        >
          {file.file_type}
        </div>
      </div>

      {/* ── Info area ── */}
      <div
        style={{
          padding: '10px 12px',
          flex: 1,
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
        }}
      >
        <div
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: '#1e293b',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            lineHeight: '1.3',
            letterSpacing: '-0.01em',
          }}
          title={title}
        >
          {title}
        </div>

        {summary && file.status === 'complete' && (
          <div
            style={{
              fontSize: 10,
              color: '#64748b',
              overflow: 'hidden',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              lineHeight: '1.45',
            }}
          >
            {summary}
          </div>
        )}

        {tags.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginTop: 'auto' }}>
            {tags.slice(0, 3).map((tag) => (
              <span
                key={tag}
                style={{
                  fontSize: 9,
                  background: `${accentColor}14`,
                  color: accentColor,
                  border: `1px solid ${accentColor}30`,
                  borderRadius: 4,
                  padding: '1px 6px',
                  fontWeight: 600,
                  letterSpacing: '0.02em',
                }}
              >
                {tag}
              </span>
            ))}
          </div>
        )}

        {/* File size footer */}
        {file.file_size && (
          <div style={{
            fontSize: 9,
            color: '#94a3b8',
            marginTop: 'auto',
            fontWeight: 500,
          }}>
            {formatFileSize(file.file_size)}
          </div>
        )}
      </div>
    </div>
  );
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function StatusBadge({ status }: { status: FileRecord['status'] }) {
  if (status === 'complete') return null;

  const badges: Record<string, { label: string; bg: string }> = {
    pending: { label: '⏳', bg: 'rgba(255,255,255,0.25)' },
    processing: { label: '⚙️', bg: 'rgba(255,255,255,0.25)' },
    error: { label: '⚠️', bg: 'rgba(239,68,68,0.85)' },
  };

  const badge = badges[status];
  if (!badge) return null;

  return (
    <div
      style={{
        position: 'absolute',
        top: 8,
        right: 8,
        background: badge.bg,
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        color: '#fff',
        fontSize: 14,
        width: 28,
        height: 28,
        borderRadius: '50%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 2,
      }}
      title={status}
    >
      {badge.label}
    </div>
  );
}

// ── Shape Util ────────────────────────────────────────────────────────────────

// Mutable map: fileId → FileRecord. Managed by Canvas.tsx.
// On any mutation, call forceShapeUpdate(editor, fileId) to re-render.
export const fileStore = new Map<string, FileRecord>();

export class FileCardShapeUtil extends BaseBoxShapeUtil<any> {
  static override type = 'file-card' as const;
  static override props = fileCardShapeProps;

  override getDefaultProps(): FileCardShapeProps {
    return { w: CARD_WIDTH, h: CARD_HEIGHT, fileId: '', _v: 0 };
  }

  override getGeometry(shape: FileCardShape) {
    return new Rectangle2d({
      width: shape.props.w,
      height: shape.props.h,
      isFilled: true,
    });
  }

  override component(shape: FileCardShape) {
    const file = fileStore.get(shape.props.fileId);

    if (!file) {
      return (
        <HTMLContainer>
          <div
            style={{
              width: shape.props.w,
              height: shape.props.h,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: '#f8fafc',
              borderRadius: 14,
              color: '#94a3b8',
              fontSize: 12,
              border: '1px solid #e2e8f0',
              fontFamily: "'Inter', system-ui, sans-serif",
            }}
          >
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 24, marginBottom: 6 }}>⏳</div>
              <div>Loading…</div>
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
        />
      </HTMLContainer>
    );
  }

  override indicator(shape: FileCardShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={14} />;
  }
}
