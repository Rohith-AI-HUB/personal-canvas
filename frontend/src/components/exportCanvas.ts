/**
 * exportCanvas
 * Exports the current tldraw canvas to a PNG file and triggers a download.
 *
 * Uses tldraw's built-in SVG export, converts to PNG via Canvas API.
 * Falls back to exporting only selected shapes if selection is non-empty,
 * otherwise exports all shapes on the current page.
 */

import type { Editor, TLShapeId } from '@tldraw/tldraw';

export async function exportCanvasToPng(editor: Editor, filename = 'canvas-export'): Promise<void> {
  const selectedIdsRaw = editor.getSelectedShapeIds() as TLShapeId[] | Set<TLShapeId>;
  const selectedIds = Array.isArray(selectedIdsRaw) ? selectedIdsRaw : [...selectedIdsRaw];
  const pageIdsRaw = editor.getCurrentPageShapeIds() as TLShapeId[] | Set<TLShapeId>;
  const pageIds = Array.isArray(pageIdsRaw) ? pageIdsRaw : [...pageIdsRaw];
  const shapeIds = selectedIds.length > 0 ? selectedIds : pageIds;

  if (shapeIds.length === 0) {
    console.warn('exportCanvas: no shapes to export');
    return;
  }

  const ids = [...shapeIds];

  // tldraw v4: getSvgElement returns an SVG DOM element
  let svgEl: SVGSVGElement | null = null;
  try {
    // @ts-expect-error — getSvgElement may not be in typedefs for all v4 builds
    svgEl = await editor.getSvgElement(ids, { padding: 32, background: true });
  } catch {
    try {
      // Fallback: getSvg() returns an SVG string in some v4 builds
      // @ts-expect-error
      const svgStr: string | undefined = await editor.getSvg(ids, { padding: 32, background: true });
      if (svgStr) {
        const parser = new DOMParser();
        const doc    = parser.parseFromString(svgStr, 'image/svg+xml');
        svgEl = doc.querySelector('svg') as SVGSVGElement;
      }
    } catch (err) {
      console.error('exportCanvas: failed to get SVG from tldraw', err);
      return;
    }
  }

  if (!svgEl) {
    console.error('exportCanvas: getSvgElement returned null');
    return;
  }

  // Serialize SVG to string
  const serializer = new XMLSerializer();
  const svgString  = serializer.serializeToString(svgEl);
  const svgBlob    = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
  const svgUrl     = URL.createObjectURL(svgBlob);

  // Get dimensions from SVG
  const svgWidth  = parseFloat(svgEl.getAttribute('width')  ?? '1200');
  const svgHeight = parseFloat(svgEl.getAttribute('height') ?? '900');

  // Render SVG to PNG via an offscreen Canvas
  const scale   = 2; // 2× for retina quality
  const canvas  = document.createElement('canvas');
  canvas.width  = svgWidth  * scale;
  canvas.height = svgHeight * scale;

  const ctx = canvas.getContext('2d')!;
  ctx.scale(scale, scale);

  const img = new Image();
  img.src   = svgUrl;

  await new Promise<void>((resolve, reject) => {
    img.onload = () => {
      try {
        ctx.drawImage(img, 0, 0, svgWidth, svgHeight);
        resolve();
      } catch (e) {
        reject(e);
      }
    };
    img.onerror = reject;
  });

  URL.revokeObjectURL(svgUrl);

  // Trigger download
  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a   = document.createElement('a');
    a.href     = url;
    a.download = `${filename}-${new Date().toISOString().slice(0, 10)}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 'image/png');
}
