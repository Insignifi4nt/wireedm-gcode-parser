/**
 * CanvasRenderer - Core canvas render helpers (clear + transforms)
 */

/**
 * Clear the entire physical canvas buffer.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} physicalWidth
 * @param {number} physicalHeight
 */
export function clearCanvas(ctx, physicalWidth, physicalHeight) {
  ctx.clearRect(0, 0, physicalWidth, physicalHeight);
}

/**
 * Apply world-space transform (with Y-axis flip) and DPI scaling.
 * Uses viewport.displayHeight for consistency with coordinate conversion.
 * @param {CanvasRenderingContext2D} ctx
 * @param {Viewport} viewport
 * @param {number} devicePixelRatio
 */
export function applyWorldTransform(ctx, viewport, devicePixelRatio = 1) {
  const state = viewport.getState();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (devicePixelRatio > 1) {
    ctx.scale(devicePixelRatio, devicePixelRatio);
  }
  ctx.translate(state.offsetX, viewport.displayHeight - state.offsetY);
  ctx.scale(state.zoom, -state.zoom);
}

/**
 * Apply text-safe transform (no Y flip), DPI aware.
 * Provided for future consolidation; not wired yet across all modules.
 * @param {CanvasRenderingContext2D} ctx
 * @param {Viewport} viewport
 * @param {number} devicePixelRatio
 */
export function applyTextTransform(ctx, viewport, devicePixelRatio = 1) {
  const state = viewport.getState();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (devicePixelRatio > 1) {
    ctx.scale(devicePixelRatio, devicePixelRatio);
  }
  ctx.translate(state.offsetX, state.offsetY);
  ctx.scale(state.zoom, state.zoom);
}

