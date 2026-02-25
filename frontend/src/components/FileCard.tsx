import {
  BaseBoxShapeUtil,
  HTMLContainer,
  Rectangle2d,
  type TLBaseShape,
  type ShapeProps,
  T,
} from '@tldraw/tldraw';
import type { FileRecord } from '../api';

// ── Shape type definition ──────────────────────────────────────────────────────

export type FileCardShapeProps = {
  w: number;
  h: number;
  fileId: string;
};

export type FileCardShape = TLBaseShape<'file-card', FileCardShapeProps>;

// Shape registry entry for tldraw
export const fileCardShapeProps: ShapeProps<FileCardShapeProps> = {
  w: T.number,
  h: T.number,
  fileId: T.string,
};

// ── File icon map ──────────────────────────────────────────────────────────────

const FILE_ICONS: Record<FileRecord['file_type'], string> = {
  pdf:   '📄',
  image: '🖼️',
  video: '🎬',
  audio: '🎵',
  code:  '💻',
  text:  '📝',
  other: '📁',
};

const FILE_COLORS: Record<FileRecord['file_type'], string> = {
  pdf:   '#e74c3c',
  image: '#3498db',
  video: '#9b59b6',
  audio: '#2980b9',
  code:  '#27ae60',
  text:  '#34495e',
  other: '#95a5a6',
};

// ── Component ─────────────────────────────────────────────────────────────────

interface FileCardComponentProps {
  file: FileRecord;
  width: number;
  height: number;
  isSelected: boolean;
}

export function FileCardComponent({ file, width, height, isSelected }: FileCardComponentProps) {
  const title = file.metadata?.ai_title ?? file.filename;
  const summary = file.metadata?.ai_summary ?? null;
  const tags = file.tags ?? [];
  const icon = FILE_ICONS[file.file_type] ?? '📁';
  const accentColor = FILE_COLORS[file.file_type] ?? '#95a5a6';

  const thumbnailUrl = file.thumbnail_path
    ? `http://127.0.0.1:3001/api/thumbnail?path=${encodeURIComponent(file.thumbnail_path)}`
    : null;

  return (
    <div
      style={{
        width,
        height,
        borderRadius: 10,
        overflow: 'hidden',
        background: '#ffffff',
        boxShadow: isSelected
          ? `0 0 0 2px ${accentColor}, 0 4px 20px rgba(0,0,0,0.18)`
          : '0 2px 8px rgba(0,0,0,0.12)',
        display: 'flex',
        flexDirection: 'column',
        fontFamily: 'system-ui, sans-serif',
        userSelect: 'none',
        cursor: 'default',
        border: `1px solid ${isSelected ? accentColor : '#e2e8f0'}`,
        transition: 'box-shadow 0.15s ease',
        pointerEvents: 'all',
      }}
    >
      {/* Thumbnail area */}
      <div
        style={{
          height: 140,
          background: thumbnailUrl ? `url(${thumbnailUrl}) center/cover` : accentColor,
          flexShrink: 0,
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {!thumbnailUrl && (
          <span style={{ fontSize: 48, opacity: 0.9 }}>{icon}</span>
        )}

        {/* Status badge */}
        <StatusBadge status={file.status} accentColor={accentColor} />

        {/* File type chip */}
        <div
          style={{
            position: 'absolute',
            bottom: 6,
            left: 6,
            background: 'rgba(0,0,0,0.55)',
            color: '#fff',
            fontSize: 10,
            fontWeight: 600,
            padding: '2px 6px',
            borderRadius: 4,
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
          }}
        >
          {file.file_type}
        </div>
      </div>

      {/* Info area */}
      <div style={{ padding: '8px 10px', flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', gap: 4 }}>
        {/* Title */}
        <div
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: '#1a202c',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            lineHeight: '1.3',
          }}
          title={title}
        >
          {title}
        </div>

        {/* Summary (only if complete) */}
        {summary && file.status === 'complete' && (
          <div
            style={{
              fontSize: 10,
              color: '#718096',
              overflow: 'hidden',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              lineHeight: '1.4',
            }}
          >
            {summary}
          </div>
        )}

        {/* Tags */}
        {tags.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginTop: 'auto' }}>
            {tags.slice(0, 4).map((tag) => (
              <span
                key={tag}
                style={{
                  fontSize: 9,
                  background: `${accentColor}1a`,
                  color: accentColor,
                  border: `1px solid ${accentColor}40`,
                  borderRadius: 3,
                  padding: '1px 5px',
                  fontWeight: 500,
                }}
              >
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ status, accentColor }: { status: FileRecord['status']; accentColor: string }) {
  if (status === 'complete') return null;

  const badges: Record<string, { label: string; bg: string }> = {
    pending:    { label: '⏳', bg: 'rgba(0,0,0,0.55)' },
    processing: { label: '⚙️', bg: 'rgba(0,0,0,0.55)' },
    error:      { label: '⚠️', bg: 'rgba(231,76,60,0.85)' },
  };

  const badge = badges[status];
  if (!badge) return null;

  return (
    <div
      style={{
        position: 'absolute',
        top: 6,
        right: 6,
        background: badge.bg,
        color: '#fff',
        fontSize: 14,
        width: 28,
        height: 28,
        borderRadius: '50%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
      title={status}
    >
      {badge.label}
    </div>
  );
}

// ── Shape Util (tldraw integration) ──────────────────────────────────────────

// This map is managed externally (by Canvas.tsx) and injected here
// so the ShapeUtil can look up live file data without prop drilling.
export const fileStore = new Map<string, FileRecord>();

export class FileCardShapeUtil extends BaseBoxShapeUtil<FileCardShape> {
  static override type = 'file-card' as const;
  static override props = fileCardShapeProps;

  override getDefaultProps(): FileCardShapeProps {
    return { w: 200, h: 250, fileId: '' };
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
          <div style={{
            width: shape.props.w,
            height: shape.props.h,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: '#f7f8fa',
            borderRadius: 10,
            color: '#aaa',
            fontSize: 12,
          }}>
            Loading...
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
          isSelected={false}
        />
      </HTMLContainer>
    );
  }

  override indicator(shape: FileCardShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={10} />;
  }
}
