import {
  BaseBoxShapeUtil,
  HTMLContainer,
  Rectangle2d,
  type TLBaseShape,
  type RecordProps,
  T,
} from '@tldraw/tldraw';
import type { FolderRecord } from '../api';

// ── Shape definition ──────────────────────────────────────────────────────────

export type FolderCardShapeProps = {
  w:        number;
  h:        number;
  folderId: string;
  _v:       number;
};

export type FolderCardShape = TLBaseShape<'folder-card', FolderCardShapeProps>;

export const folderCardShapeProps: RecordProps<FolderCardShape> = {
  w:        T.number,
  h:        T.number,
  folderId: T.string,
  _v:       T.number,
};

export const FOLDER_WIDTH  = 160;
export const FOLDER_HEIGHT = 210;

// ── Global store ──────────────────────────────────────────────────────────────

export const folderStore = new Map<string, FolderRecord>();

let _onOpenFolder: ((folderId: string) => void) | null = null;
export function setOpenFolderHandler(fn: (folderId: string) => void) {
  _onOpenFolder = fn;
}

// ── Thumbnail URL helper ──────────────────────────────────────────────────────

function thumbUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  return `http://127.0.0.1:3001/api/thumbnail?path=${encodeURIComponent(path)}`;
}

// ── Color helpers ─────────────────────────────────────────────────────────────

function hexToRgb(hex: string): [number, number, number] {
  const h    = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n    = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function hexToSoft(hex: string): string {
  try {
    const [r, g, b] = hexToRgb(hex);
    const mix = (c: number) => Math.round(c * 0.18 + 255 * 0.82);
    return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
  } catch { return '#F4F5F7'; }
}

function lighten(hex: string, amount: number): string {
  try {
    const [r, g, b] = hexToRgb(hex);
    const mix = (c: number) => Math.round(c * (1 - amount) + 255 * amount);
    return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
  } catch { return '#ECEAE6'; }
}

// ── FolderCard Visual Component ───────────────────────────────────────────────
// Pure display — no click handlers here. Opening is handled by the ShapeUtil.

interface FolderCardProps {
  folder: FolderRecord;
  width:  number;
  height: number;
}

export function FolderCardComponent({ folder, width, height }: FolderCardProps) {
  const thumbs  = (folder.preview_thumbnails ?? []).map(thumbUrl).filter(Boolean) as string[];
  const color   = folder.cover_color;
  const softBg  = hexToSoft(color);

  return (
    <div style={{
      width, height,
      display: 'flex',
      flexDirection: 'column',
      borderRadius: 12,
      overflow: 'hidden',
      fontFamily: "'Inter', system-ui, sans-serif",
      userSelect: 'none',
      position: 'relative',
      background: '#FEFCF9',
      boxShadow: '0 1px 3px rgba(20,15,10,0.06), 0 6px 20px rgba(20,15,10,0.10)',
      border: '1px solid rgba(28,25,23,0.07)',
    }}>

      {/* ── Cover (top 62%) ── */}
      <div style={{
        height: Math.round(height * 0.62),
        flexShrink: 0,
        position: 'relative',
        overflow: 'hidden',
        background: softBg,
      }}>
        {folder.file_count > 0 && thumbs.length > 0
          ? <MosaicCover thumbs={thumbs} color={color} />
          : <EmptyCover  color={color}   softBg={softBg} />
        }
        {/* Scrim */}
        <div style={{
          position: 'absolute', bottom: 0, left: 0, right: 0, height: 32,
          background: 'linear-gradient(to top, rgba(0,0,0,0.12), transparent)',
          pointerEvents: 'none',
        }} />
      </div>

      {/* ── Info strip (bottom 38%) ── */}
      <div style={{
        flex: 1,
        padding: '8px 11px 7px',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        background: '#FEFCF9',
        borderTop: `2px solid ${color}`,
        gap: 2,
      }}>
        <div style={{
          fontSize: 12, fontWeight: 600, color: '#1C1917',
          lineHeight: 1.3, letterSpacing: '-0.01em',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {folder.name}
        </div>
        <div style={{ fontSize: 10, color: '#A8A29E', fontWeight: 500 }}>
          {folder.file_count === 0
            ? 'Empty — double-click to open'
            : `${folder.file_count} file${folder.file_count !== 1 ? 's' : ''}`}
        </div>
      </div>

      {/* ── Color dot ── */}
      <div style={{
        position: 'absolute', top: 9, right: 9,
        width: 8, height: 8, borderRadius: '50%',
        background: color, opacity: 0.8,
      }} />
    </div>
  );
}

// ── Mosaic Cover ──────────────────────────────────────────────────────────────

function MosaicCover({ thumbs, color }: { thumbs: string[]; color: string }) {
  if (thumbs.length === 1) {
    return (
      <img src={thumbs[0]} alt="" style={{
        position: 'absolute', inset: 0, width: '100%', height: '100%',
        objectFit: 'cover', objectPosition: 'center top',
      }} onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
    );
  }

  const grid = [...thumbs.slice(0, 4)];
  while (grid.length < 4) grid.push('');

  return (
    <div style={{
      position: 'absolute', inset: 0,
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gridTemplateRows: '1fr 1fr',
      gap: 2, padding: 6,
      background: `${color}18`,
    }}>
      {grid.map((src, i) => (
        <div key={i} style={{ borderRadius: 5, overflow: 'hidden', background: `${color}22` }}>
          {src && (
            <img src={src} alt="" style={{
              width: '100%', height: '100%',
              objectFit: 'cover', objectPosition: 'center top', display: 'block',
            }} onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
          )}
        </div>
      ))}
    </div>
  );
}

// ── Empty Cover ───────────────────────────────────────────────────────────────

function EmptyCover({ color, softBg }: { color: string; softBg: string }) {
  return (
    <div style={{
      position: 'absolute', inset: 0,
      background: `linear-gradient(145deg, ${softBg} 0%, ${lighten(color, 0.86)} 100%)`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        position: 'absolute', top: '15%', right: '15%',
        width: '50%', height: '40%', borderRadius: '50%',
        background: 'rgba(255,255,255,0.32)', filter: 'blur(14px)',
        pointerEvents: 'none',
      }} />
      <div style={{
        width: 46, height: 46, borderRadius: 11,
        background: 'rgba(255,255,255,0.68)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        boxShadow: `0 2px 10px ${color}28`,
        position: 'relative', zIndex: 1,
      }}>
        <FolderSVG color={color} />
      </div>
    </div>
  );
}

function FolderSVG({ color }: { color: string }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"
        fill={color} opacity="0.22" />
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"
        stroke={color} strokeWidth="1.6" fill="none" />
    </svg>
  );
}

// ── Ghost skeleton ────────────────────────────────────────────────────────────

function GhostCard({ w, h }: { w: number; h: number }) {
  return (
    <div style={{
      width: w, height: h, borderRadius: 12,
      background: 'linear-gradient(145deg, #F4F5F7 0%, #ECEAE6 100%)',
      border: '1px solid rgba(28,25,23,0.07)',
      boxShadow: '0 1px 3px rgba(20,15,10,0.06)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: "'Inter', system-ui, sans-serif",
      color: '#A8A29E', fontSize: 10, fontWeight: 500,
    }}>
      Loading…
    </div>
  );
}

// ── tldraw Shape Util ─────────────────────────────────────────────────────────

export class FolderCardShapeUtil extends BaseBoxShapeUtil<any> {
  static override type  = 'folder-card' as const;
  static override props = folderCardShapeProps;

  // Prevent tldraw's built-in text-editing mode on double-click
  override canEdit = () => false;

  override getDefaultProps(): FolderCardShapeProps {
    return { w: FOLDER_WIDTH, h: FOLDER_HEIGHT, folderId: '', _v: 0 };
  }

  override getGeometry(shape: FolderCardShape) {
    return new Rectangle2d({ width: shape.props.w, height: shape.props.h, isFilled: true });
  }

  // ── Double-click = open folder ────────────────────────────────────────────
  override onDoubleClick(shape: FolderCardShape) {
    _onOpenFolder?.(shape.props.folderId);
    // Return undefined — don't start edit mode
    return undefined;
  }

  override component(shape: FolderCardShape) {
    const folder = folderStore.get(shape.props.folderId);
    return (
      <HTMLContainer>
        {folder
          ? <FolderCardComponent folder={folder} width={shape.props.w} height={shape.props.h} />
          : <GhostCard w={shape.props.w} h={shape.props.h} />
        }
      </HTMLContainer>
    );
  }

  override indicator(shape: FolderCardShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={12} />;
  }
}
