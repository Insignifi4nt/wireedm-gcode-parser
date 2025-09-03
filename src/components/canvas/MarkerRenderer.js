/**
 * MarkerRenderer - Clicked points and generic marker rendering
 * Extracted from Canvas.js to isolate point/label drawing.
 */

import { MARKERS } from '../../utils/Constants.js';

/**
 * Render a point marker with optional label.
 * Screen-space marker sizing preserved via devicePixelRatio and viewport zoom.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {Viewport} viewport
 * @param {{x:number,y:number}} point
 * @param {Object} config - Marker configuration from MARKERS
 * @param {number} devicePixelRatio
 */
export function renderMarker(ctx, viewport, point, config, devicePixelRatio = 1) {
  const cssToWorld = (px) => (px * (devicePixelRatio || 1)) / viewport.zoom;
  const scaledRadius = cssToWorld(config.RADIUS_PX ?? 3);
  const scaledOffsetX = config.OFFSET?.X ?? 0;
  const scaledOffsetY = config.OFFSET?.Y ?? 0;

  // Draw circle in world space (Y-axis flip handled by viewport transform)
  ctx.fillStyle = config.COLOR;
  ctx.beginPath();
  ctx.arc(point.x, point.y, scaledRadius, 0, Math.PI * 2);
  ctx.fill();

  if (config.LABEL) {
    ctx.save();
    _applyTextTransform(ctx, viewport, devicePixelRatio || 1);
    const screen = viewport.worldToScreen(point.x, point.y);
    ctx.fillStyle = config.COLOR;
    ctx.font = config.FONT || '10px Arial';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(config.LABEL, screen.x + scaledOffsetX, screen.y + scaledOffsetY);
    ctx.restore();
  }
}

/**
 * Render the list of clicked measurement points.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {Viewport} viewport
 * @param {Array<{x:number,y:number}>} points
 * @param {Object} opts - { devicePixelRatio?: number }
 */
export function renderClickedPoints(ctx, viewport, points, opts = {}) {
  const dpr = opts.devicePixelRatio || 1;
  points.forEach((point, index) => {
    if (!point || !isFinite(point.x) || !isFinite(point.y)) return;
    const cfg = { ...MARKERS.CLICKED_POINT, LABEL: `P${index + 1}` };
    renderMarker(ctx, viewport, point, cfg, dpr);
  });
}

// Internal: apply text-safe transform (no Y flip), DPI aware
function _applyTextTransform(ctx, viewport, devicePixelRatio) {
  const state = viewport.getState();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (devicePixelRatio > 1) {
    ctx.scale(devicePixelRatio, devicePixelRatio);
  }
  ctx.translate(state.offsetX, state.offsetY);
  ctx.scale(state.zoom, state.zoom);
}

