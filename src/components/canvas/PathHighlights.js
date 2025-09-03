/**
 * PathHighlights - Render G-code path, start/end points, and hover/persistent highlights
 * Extracted from Canvas.js for focused responsibilities.
 */

import { PATH_STYLES, MARKERS, DEBUG } from '../../utils/Constants.js';
import { ValidationUtils } from '../../utils/MathUtils.js';

/**
 * Render G-code path segments and highlight endpoint markers.
 *
 * @param {CanvasRenderingContext2D} ctx - Canvas 2D context
 * @param {Viewport} viewport - Viewport instance
 * @param {Array} gcodePath - Array of path moves
 * @param {Object} opts - Options
 *   - devicePixelRatio: number
 *   - hoverHighlight: { type: 'point'|'segment', index } | null
 *   - persistentHighlights: Set<number>
 *   - markerRenderer: function(point, config)
 */
export function renderPath(ctx, viewport, gcodePath, opts = {}) {
  if (!Array.isArray(gcodePath) || gcodePath.length === 0) return;

  const devicePixelRatio = opts.devicePixelRatio || 1;
  const hoverHighlight = opts.hoverHighlight || null;
  const persistentHighlights = opts.persistentHighlights || new Set();
  const markerRenderer = typeof opts.markerRenderer === 'function' ? opts.markerRenderer : null;

  for (let index = 0; index < gcodePath.length; index++) {
    if (index === 0) continue; // Skip first move (no previous endpoint)
    const move = gcodePath[index];
    const prevMove = gcodePath[index - 1];

    if (move?.type === 'arc') {
      _renderArcMove(ctx, viewport, move, devicePixelRatio);
    } else {
      const from = _getMoveEndPoint(prevMove);
      const to = { x: move.x, y: move.y, type: move.type };
      if (from && ValidationUtils.isValidPoint(from) && ValidationUtils.isValidPoint(to)) {
        _renderLinearMove(ctx, viewport, from, to, devicePixelRatio);
      }
    }

    // Highlight hovered/selected endpoints
    const highlight = persistentHighlights.has(index) || (hoverHighlight && hoverHighlight.type === 'point' && hoverHighlight.index === index);
    if (highlight && markerRenderer) {
      const hx = move.type === 'arc' ? move.endX : move.x;
      const hy = move.type === 'arc' ? move.endY : move.y;
      if (hx !== undefined && hy !== undefined) {
        markerRenderer(
          { x: hx, y: hy },
          { ...MARKERS.CLICKED_POINT, COLOR: '#ffa500', RADIUS_PX: 3, FONT: 'bold 10px Arial', LABEL: `L${move.line || index}` }
        );
      }
    }
  }
}

/**
 * Render start and end point markers for the path.
 *
 * @param {CanvasRenderingContext2D} ctx - Canvas 2D context
 * @param {Viewport} viewport - Viewport instance (unused but kept for parity)
 * @param {Array} gcodePath - Path array
 * @param {Object} opts - Options { markerRenderer: function }
 */
export function renderStartEnd(ctx, _viewport, gcodePath, opts = {}) {
  const markerRenderer = typeof opts.markerRenderer === 'function' ? opts.markerRenderer : null;
  if (!Array.isArray(gcodePath) || gcodePath.length === 0 || !markerRenderer) return;

  // Start point
  const startPoint = gcodePath[0];
  if (ValidationUtils.isValidPoint(startPoint)) {
    markerRenderer(startPoint, MARKERS.START_POINT);
  }

  // End point
  if (gcodePath.length > 1) {
    const endPoint = gcodePath[gcodePath.length - 1];
    if (ValidationUtils.isValidPoint(endPoint)) {
      markerRenderer(endPoint, MARKERS.END_POINT);
    }
  }
}

// Internal helpers (moved from Canvas.js)

function _getMoveEndPoint(move) {
  if (!move) return null;
  if (move.type === 'arc') {
    if (ValidationUtils.isValidCoordinate(move.endX) && ValidationUtils.isValidCoordinate(move.endY)) {
      return { x: move.endX, y: move.endY };
    }
    return null;
  }
  if (ValidationUtils.isValidCoordinate(move.x) && ValidationUtils.isValidCoordinate(move.y)) {
    return { x: move.x, y: move.y };
  }
  return null;
}

function _renderLinearMove(ctx, viewport, from, to, devicePixelRatio) {
  if (!ValidationUtils.isValidPoint(from) || !ValidationUtils.isValidPoint(to)) return;
  const style = to.type === 'rapid' ? PATH_STYLES.RAPID : PATH_STYLES.CUT;
  const cssToWorld = (px) => (px * devicePixelRatio) / viewport.zoom;
  ctx.strokeStyle = style.COLOR;
  ctx.lineWidth = cssToWorld(style.LINE_WIDTH_PX ?? 1);
  const dashPx = style.LINE_DASH_PX ?? [];
  ctx.setLineDash(Array.isArray(dashPx) && dashPx.length ? dashPx.map(cssToWorld) : []);
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
}

function _renderArcMove(ctx, viewport, move, devicePixelRatio) {
  if (!_isValidArcMove(move)) return;
  const cssToWorld = (px) => (px * devicePixelRatio) / viewport.zoom;
  ctx.strokeStyle = PATH_STYLES.ARC.COLOR;
  ctx.lineWidth = cssToWorld(PATH_STYLES.ARC.LINE_WIDTH_PX ?? 1);
  const dashPx = PATH_STYLES.ARC.LINE_DASH_PX ?? [];
  ctx.setLineDash(Array.isArray(dashPx) ? dashPx.map(cssToWorld) : []);

  const radius = Math.sqrt(
    Math.pow(move.startX - move.centerX, 2) +
    Math.pow(move.startY - move.centerY, 2)
  );
  const startAngle = Math.atan2(move.startY - move.centerY, move.startX - move.centerX);
  const rawEndAngle = Math.atan2(move.endY - move.centerY, move.endX - move.centerX);
  let delta = rawEndAngle - startAngle;
  if (move.clockwise) {
    if (delta >= 0) delta -= 2 * Math.PI;
  } else {
    if (delta <= 0) delta += 2 * Math.PI;
  }
  const endAngle = startAngle + delta;

  ctx.beginPath();
  ctx.arc(move.centerX, move.centerY, radius, startAngle, endAngle, move.clockwise);
  ctx.stroke();

  if (DEBUG && DEBUG.SHOW_ARC_GEOMETRY) {
    ctx.save();
    ctx.fillStyle = '#ff8800';
    ctx.beginPath();
    ctx.arc(move.centerX, move.centerY, cssToWorld(2.5), 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#ffaa00';
    ctx.lineWidth = cssToWorld(0.8);
    ctx.setLineDash([cssToWorld(3), cssToWorld(2)]);
    ctx.beginPath();
    ctx.moveTo(move.centerX, move.centerY);
    ctx.lineTo(move.startX, move.startY);
    ctx.moveTo(move.centerX, move.centerY);
    ctx.lineTo(move.endX, move.endY);
    ctx.stroke();
    ctx.restore();
  }
}

function _isValidArcMove(move) {
  return move &&
    ValidationUtils.isValidCoordinate(move.startX) &&
    ValidationUtils.isValidCoordinate(move.startY) &&
    ValidationUtils.isValidCoordinate(move.endX) &&
    ValidationUtils.isValidCoordinate(move.endY) &&
    ValidationUtils.isValidCoordinate(move.centerX) &&
    ValidationUtils.isValidCoordinate(move.centerY);
}

