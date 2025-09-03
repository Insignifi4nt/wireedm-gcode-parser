/**
 * CanvasGrid - Grid lines and labels renderer
 * Extracted from Canvas.js to isolate grid responsibilities
 */

import { GRID, COORDINATES } from '../../utils/Constants.js';
import { GridUtils, PrecisionUtils } from '../../utils/MathUtils.js';

/**
 * Draw the grid (minor/major lines and optional labels)
 * Expects that the caller has already applied the correct world transform.
 *
 * @param {CanvasRenderingContext2D} ctx - Canvas 2D context
 * @param {Viewport} viewport - Viewport instance (for zoom/offset/state)
 * @param {Object} opts - Options { gridSize, displayWidth, displayHeight, devicePixelRatio }
 */
export function drawGrid(ctx, viewport, opts = {}) {
  const gridSize = opts.gridSize ?? GRID.SIZE;
  const displayWidth = opts.displayWidth;
  const displayHeight = opts.displayHeight;
  const devicePixelRatio = opts.devicePixelRatio || 1;

  const state = viewport.getState();

  // Calculate visible grid lines using logical display dimensions
  const gridLines = GridUtils.calculateGridLines(
    state.zoom,
    state.offsetX,
    state.offsetY,
    displayWidth,
    displayHeight,
    gridSize
  );

  // Only draw minor grid lines if zoomed in enough
  if (state.zoom > 0.5) {
    _drawGridLines(ctx, viewport, gridLines, false, devicePixelRatio);
  }

  // Always draw major grid lines (axes)
  _drawGridLines(ctx, viewport, gridLines, true, devicePixelRatio);

  // Draw grid labels only if zoomed in enough
  if (state.zoom > 0.3) {
    drawGridLabels(ctx, viewport, gridLines, { displayHeight, devicePixelRatio });
  }
}

/**
 * Draw grid labels (coordinates along axes)
 * Applies a text-safe transform internally.
 *
 * @param {CanvasRenderingContext2D} ctx - Canvas 2D context
 * @param {Viewport} viewport - Viewport instance
 * @param {Object} gridLines - { vertical: number[], horizontal: number[] }
 * @param {Object} opts - Options { displayHeight, devicePixelRatio }
 */
export function drawGridLabels(ctx, viewport, gridLines, opts = {}) {
  const { vertical, horizontal } = gridLines;
  const displayHeight = opts.displayHeight;

  const majorInterval = GRID.MAJOR_LINES_INTERVAL;
  // Larger interval for labels to reduce crowding
  const labelInterval = majorInterval * 4;

  // Save current transform and apply text-safe transform (no Y flip)
  ctx.save();
  _applyTextTransform(ctx, viewport, opts.devicePixelRatio || 1);

  ctx.fillStyle = GRID.COLORS.LABELS;
  ctx.font = '9px Arial';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';

  // Draw X-axis labels (only at larger intervals)
  vertical.forEach((x) => {
    if (x % labelInterval === 0 && x !== 0) {
      const screenCoords = viewport.worldToScreen(x, 0);
      ctx.fillText(
        PrecisionUtils.format(x, COORDINATES.PRECISION),
        screenCoords.x + 2,
        displayHeight - 15
      );
    }
  });

  // Draw Y-axis labels (only at larger intervals)
  horizontal.forEach((y) => {
    if (y % labelInterval === 0 && y !== 0) {
      const screenCoords = viewport.worldToScreen(0, y);
      ctx.fillText(
        PrecisionUtils.format(y, COORDINATES.PRECISION),
        5,
        screenCoords.y - 2
      );
    }
  });

  ctx.restore();
}

// Internal: draw grid lines with screen-space widths
function _drawGridLines(ctx, viewport, gridLines, major, devicePixelRatio) {
  const { vertical, horizontal } = gridLines;

  // Screen-space stroke widths for consistent appearance
  const cssToWorld = (valuePx) => (valuePx * devicePixelRatio) / viewport.zoom;
  if (major) {
    ctx.strokeStyle = GRID.COLORS.MAJOR;
    ctx.lineWidth = cssToWorld(GRID.LINE_WIDTH.MAJOR);
  } else {
    ctx.strokeStyle = GRID.COLORS.MINOR;
    ctx.lineWidth = cssToWorld(GRID.LINE_WIDTH.MINOR);
  }
  ctx.setLineDash([]);

  // Draw vertical lines
  vertical.forEach((x) => {
    if (!major || x === 0) {
      if (major && x !== 0) return;
      ctx.beginPath();
      ctx.moveTo(x, -10000);
      ctx.lineTo(x, 10000);
      ctx.stroke();
    }
  });

  // Draw horizontal lines
  horizontal.forEach((y) => {
    if (!major || y === 0) {
      if (major && y !== 0) return;
      ctx.beginPath();
      ctx.moveTo(-10000, y);
      ctx.lineTo(10000, y);
      ctx.stroke();
    }
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

