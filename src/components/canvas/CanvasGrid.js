/**
 * CanvasGrid - Grid lines and labels renderer
 * Extracted from Canvas.js to isolate grid responsibilities
 */

import { GRID, COORDINATES, DYNAMIC_GRID } from '../../utils/Constants.js';
import { GridUtils, PrecisionUtils } from '../../utils/MathUtils.js';

// Persist visibility state to apply hysteresis and prevent flicker
let lastShowMinor;
let lastShowLabels;

/**
 * Draw the grid (minor/major lines and optional labels)
 * Expects that the caller has already applied the correct world transform.
 *
 * @param {CanvasRenderingContext2D} ctx - Canvas 2D context
 * @param {Viewport} viewport - Viewport instance (for zoom/offset/state)
 * @param {Object} opts - Options { displayWidth, displayHeight, devicePixelRatio }
 */
export function drawGrid(ctx, viewport, opts = {}) {
  const displayWidth = opts.displayWidth;
  const displayHeight = opts.displayHeight;
  const devicePixelRatio = opts.devicePixelRatio || 1;

  const state = viewport.getState();

  // Calculate dynamic grid spacing based on zoom level
  const minorSpacing = GridUtils.pickGridSpacing(state.zoom, DYNAMIC_GRID.TARGET_MINOR_PX);
  const labelSpacing = GridUtils.pickLabelSpacing(minorSpacing, state.zoom, DYNAMIC_GRID.TARGET_LABEL_PX);

  // Calculate visibility based on pixel density (CSS pixels)
  const minorPx = minorSpacing * state.zoom;
  const labelPx = labelSpacing * state.zoom;
  const gridH = (DYNAMIC_GRID.HYSTERESIS && DYNAMIC_GRID.HYSTERESIS.GRID_PX) || 0;
  const labelH = (DYNAMIC_GRID.HYSTERESIS && DYNAMIC_GRID.HYSTERESIS.LABEL_PX) || 0;

  // Apply hysteresis: widen the band to avoid flicker near thresholds
  let showMinor;
  if (typeof lastShowMinor === 'boolean') {
    const thresh = DYNAMIC_GRID.MINOR_VISIBILITY_PX;
    showMinor = lastShowMinor
      ? minorPx >= (thresh - gridH)
      : minorPx >= (thresh + gridH);
  } else {
    showMinor = minorPx >= DYNAMIC_GRID.MINOR_VISIBILITY_PX;
  }

  let showLabels;
  if (typeof lastShowLabels === 'boolean') {
    const thresh = DYNAMIC_GRID.LABEL_VISIBILITY_PX;
    showLabels = lastShowLabels
      ? labelPx >= (thresh - labelH)
      : labelPx >= (thresh + labelH);
  } else {
    showLabels = labelPx >= DYNAMIC_GRID.LABEL_VISIBILITY_PX;
  }

  // Persist decisions for next frame
  lastShowMinor = showMinor;
  lastShowLabels = showLabels;

  // Calculate visible grid lines using dynamic spacing
  const gridLines = GridUtils.calculateGridLines(
    state.zoom,
    state.offsetX,
    state.offsetY,
    displayWidth,
    displayHeight,
    minorSpacing
  );

  // Draw minor grid lines if visible
  if (showMinor) {
    _drawGridLines(ctx, viewport, gridLines, false, devicePixelRatio, minorSpacing);
  }

  // Always draw major grid lines (axes)
  _drawGridLines(ctx, viewport, gridLines, true, devicePixelRatio, minorSpacing);

  // Draw grid labels if visible
  if (showLabels) {
    drawGridLabels(ctx, viewport, gridLines, { 
      displayHeight, 
      devicePixelRatio, 
      labelSpacing, 
      minorSpacing 
    });
  }
}

/**
 * Draw grid labels (coordinates along axes)
 * Applies a text-safe transform internally.
 *
 * @param {CanvasRenderingContext2D} ctx - Canvas 2D context
 * @param {Viewport} viewport - Viewport instance
 * @param {Object} gridLines - { vertical: number[], horizontal: number[], verticalIndices: number[], horizontalIndices: number[] }
 * @param {Object} opts - Options { displayHeight, devicePixelRatio, labelSpacing, minorSpacing }
 */
export function drawGridLabels(ctx, viewport, gridLines, opts = {}) {
  const { vertical, horizontal, verticalIndices, horizontalIndices } = gridLines;
  const displayHeight = opts.displayHeight;
  const labelSpacing = opts.labelSpacing;
  const minorSpacing = opts.minorSpacing;

  // Calculate adaptive precision based on label spacing
  const decimals = Math.max(0, -Math.floor(Math.log10(labelSpacing)));

  // Calculate label interval in terms of minor grid indices
  const labelInterval = Math.round(labelSpacing / minorSpacing);

  // Save current transform for grid labels (Strategy A: screen-space text rendering)
  ctx.save();

  // Reset to identity transform for screen-space text rendering
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  
  // Apply only DPI scaling if needed
  const devicePixelRatio = opts.devicePixelRatio || 1;
  if (devicePixelRatio > 1) {
    ctx.scale(devicePixelRatio, devicePixelRatio);
  }

  ctx.fillStyle = GRID.COLORS.LABELS;
  ctx.font = '9px Arial';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';

  // Draw X-axis labels using index-based logic
  vertical.forEach((x, index) => {
    const i = verticalIndices[index];
    if (i % labelInterval === 0 && x !== 0) {
      const screenCoords = viewport.worldToScreen(x, 0);
      ctx.fillText(
        PrecisionUtils.format(x, decimals),
        screenCoords.x + 2,
        displayHeight - 15
      );
    }
  });

  // Draw Y-axis labels using index-based logic
  horizontal.forEach((y, index) => {
    const i = horizontalIndices[index];
    if (i % labelInterval === 0 && y !== 0) {
      const screenCoords = viewport.worldToScreen(0, y);
      ctx.fillText(
        PrecisionUtils.format(y, decimals),
        5,
        screenCoords.y - 2
      );
    }
  });

  ctx.restore();
}

// Internal: draw grid lines with screen-space widths
function _drawGridLines(ctx, viewport, gridLines, major, devicePixelRatio, gridSpacing) {
  const { vertical, horizontal } = gridLines;

  // Get viewport bounds for infinite axes
  const bounds = viewport.getBounds();
  const { minX, maxX, minY, maxY } = bounds;

  // Screen-space stroke widths for consistent appearance  
  const cssToWorld = (valuePx) => valuePx / (devicePixelRatio * viewport.zoom);
  if (major) {
    ctx.strokeStyle = GRID.COLORS.MAJOR;
    ctx.lineWidth = cssToWorld(GRID.LINE_WIDTH.MAJOR);
  } else {
    ctx.strokeStyle = GRID.COLORS.MINOR;
    ctx.lineWidth = cssToWorld(GRID.LINE_WIDTH.MINOR);
  }
  ctx.setLineDash([]);

  if (major) {
    // Draw only axes (X=0, Y=0) extending to viewport bounds
    ctx.beginPath();
    // X-axis (horizontal line at Y=0)
    ctx.moveTo(minX, 0);
    ctx.lineTo(maxX, 0);
    // Y-axis (vertical line at X=0)
    ctx.moveTo(0, minY);
    ctx.lineTo(0, maxY);
    ctx.stroke();
  } else {
    // Draw minor grid lines extending to viewport bounds
    // Batch vertical lines for better performance
    ctx.beginPath();
    vertical.forEach((x) => {
      if (x !== 0) { // Skip axes (drawn in major pass)
        ctx.moveTo(x, minY);
        ctx.lineTo(x, maxY);
      }
    });
    ctx.stroke();

    // Batch horizontal lines for better performance  
    ctx.beginPath();
    horizontal.forEach((y) => {
      if (y !== 0) { // Skip axes (drawn in major pass)
        ctx.moveTo(minX, y);
        ctx.lineTo(maxX, y);
      }
    });
    ctx.stroke();
  }
}

// (text transform moved to CanvasRenderer.applyTextTransform)
