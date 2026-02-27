import type { Editor, TLShape, TLGroupShape } from '@tldraw/tldraw';
import { createShapeId } from '@tldraw/tldraw';
import { CARD_WIDTH, CARD_HEIGHT } from './FileCard';

function runInBatch(editor: Editor, fn: () => void): void {
  const batch = (editor as any).batch as undefined | ((cb: () => void) => void);
  if (batch) batch(fn);
  else fn();
}

/**
 * Snap all file-card shapes to a grid aligned to their top-left corners.
 * Grid size defaults to CARD_WIDTH + 24px gap.
 */
export function snapToGrid(editor: Editor, gridX = CARD_WIDTH + 24, gridY = CARD_HEIGHT + 32): void {
  const shapes = getFileCardShapes(editor);
  if (!shapes.length) return;

  runInBatch(editor, () => {
    for (const shape of shapes) {
      const snappedX = Math.round(shape.x / gridX) * gridX;
      const snappedY = Math.round(shape.y / gridY) * gridY;
      if (snappedX !== shape.x || snappedY !== shape.y) {
        editor.updateShape({ id: shape.id, type: shape.type, x: snappedX, y: snappedY });
      }
    }
  });
}

/**
 * Align selected file-card shapes along a given axis.
 * - 'left': align all to the leftmost shape's x
 * - 'top': align all to the topmost shape's y
 * - 'right': align all so their right edges match the rightmost
 * - 'bottom': align all so their bottom edges match the bottommost
 * - 'center-h': center horizontally around the group's midpoint
 * - 'center-v': center vertically around the group's midpoint
 */
export type AlignAxis = 'left' | 'top' | 'right' | 'bottom' | 'center-h' | 'center-v';

export function alignSelected(editor: Editor, axis: AlignAxis): void {
  const selected = editor.getSelectedShapes().filter(isFileCard);
  if (selected.length < 2) return;

  const w = CARD_WIDTH;
  const h = CARD_HEIGHT;

  const xs    = selected.map((s) => s.x);
  const ys    = selected.map((s) => s.y);
  const xRs   = selected.map((s) => s.x + w);
  const yBs   = selected.map((s) => s.y + h);
  const minX  = Math.min(...xs);
  const minY  = Math.min(...ys);
  const maxXR = Math.max(...xRs);
  const maxYB = Math.max(...yBs);
  const midX  = (minX + maxXR) / 2;
  const midY  = (minY + maxYB) / 2;

  runInBatch(editor, () => {
    for (const shape of selected) {
      let nx = shape.x;
      let ny = shape.y;
      switch (axis) {
        case 'left':     nx = minX; break;
        case 'top':      ny = minY; break;
        case 'right':    nx = maxXR - w; break;
        case 'bottom':   ny = maxYB - h; break;
        case 'center-h': nx = midX - w / 2; break;
        case 'center-v': ny = midY - h / 2; break;
      }
      if (nx !== shape.x || ny !== shape.y) {
        editor.updateShape({ id: shape.id, type: shape.type, x: nx, y: ny });
      }
    }
  });
}

/**
 * Arrange selected file-card shapes into a clean grid layout.
 * Starts at the position of the topmost-leftmost selected shape.
 */
export function autoArrangeSelected(editor: Editor, cols = 5): void {
  const selected = editor.getSelectedShapes().filter(isFileCard);
  if (!selected.length) return;

  // Sort by current position (top-to-bottom, left-to-right)
  const sorted = [...selected].sort((a, b) =>
    a.y !== b.y ? a.y - b.y : a.x - b.x
  );

  const startX = Math.min(...sorted.map((s) => s.x));
  const startY = Math.min(...sorted.map((s) => s.y));
  const gapX   = CARD_WIDTH  + 24;
  const gapY   = CARD_HEIGHT + 32;

  runInBatch(editor, () => {
    sorted.forEach((shape, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const nx  = startX + col * gapX;
      const ny  = startY + row * gapY;
      if (nx !== shape.x || ny !== shape.y) {
        editor.updateShape({ id: shape.id, type: shape.type, x: nx, y: ny });
      }
    });
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getFileCardShapes(editor: Editor): TLShape[] {
  return editor.getCurrentPageShapes().filter(isFileCard);
}

function isFileCard(shape: TLShape): boolean {
  return (shape as any).type === 'file-card';
}

/**
 * Group selected file-card shapes using tldraw's native group mechanism.
 * Then places a labeled frame behind the group so the label is visible on canvas.
 *
 * If label is not provided, uses the default tldraw group (no label).
 */
export function groupSelected(editor: Editor, label?: string): void {
  const selected = editor.getSelectedShapes().filter(isFileCard);
  if (selected.length < 2) return;

  // tldraw native groupShapes — creates a TLGroupShape that handles selection/move/resize
  editor.groupShapes(selected.map((s) => s.id));

  if (!label?.trim()) return;

  // Find the newly created group
  const newGroup = editor.getCurrentPageShapes().find(
    (s): s is TLGroupShape => s.type === 'group' &&
      selected.every((child) =>
        editor.getSortedChildIdsForParent(s.id).includes(child.id)
      )
  );
  if (!newGroup) return;

  // Add a text annotation just above the group bounds as a visual label
  const bounds = editor.getShapeMaskedPageBounds(newGroup.id);
  if (!bounds) return;

  const labelId = createShapeId();
  editor.createShape({
    id: labelId,
    type: 'text',
    x: bounds.x,
    y: bounds.y - 28,
    props: {
      text: label.trim(),
      font: 'sans',
      size: 'm',
      align: 'start',
      color: 'grey',
      autoSize: true,
      w: 200,
    },
  } as any);
}
