/**
 * Bounds and Viewport Calculations
 * Bounds operations, zoom calculations, viewport mathematics
 */

import { VIEWPORT } from '../Constants.js';

/**
 * Bounds calculation and validation utilities
 */
export class BoundsUtils {
  /**
   * Create empty bounds object
   * @returns {Object} Empty bounds {minX, maxX, minY, maxY}
   */
  static createEmptyBounds() {
    return {
      minX: Infinity,
      maxX: -Infinity,
      minY: Infinity,
      maxY: -Infinity
    };
  }

  /**
   * Update bounds with a point
   * @param {Object} bounds - Current bounds object
   * @param {number} x - Point X coordinate
   * @param {number} y - Point Y coordinate
   * @returns {Object} Updated bounds
   */
  static updateBounds(bounds, x, y) {
    return {
      minX: Math.min(bounds.minX, x),
      maxX: Math.max(bounds.maxX, x),
      minY: Math.min(bounds.minY, y),
      maxY: Math.max(bounds.maxY, y)
    };
  }

  /**
   * Check if bounds are valid (not infinite)
   * @param {Object} bounds - Bounds object to validate
   * @returns {boolean} True if bounds are valid
   */
  static isValidBounds(bounds) {
    return isFinite(bounds.minX) && isFinite(bounds.maxX) && 
           isFinite(bounds.minY) && isFinite(bounds.maxY);
  }

  /**
   * Calculate bounds dimensions
   * @param {Object} bounds - Bounds object
   * @returns {Object} Dimensions {width, height, centerX, centerY}
   */
  static getBoundsDimensions(bounds) {
    if (!BoundsUtils.isValidBounds(bounds)) {
      return { width: 0, height: 0, centerX: 0, centerY: 0 };
    }

    const width = bounds.maxX - bounds.minX;
    const height = bounds.maxY - bounds.minY;
    const centerX = (bounds.minX + bounds.maxX) / 2;
    const centerY = (bounds.minY + bounds.maxY) / 2;

    return { width, height, centerX, centerY };
  }

  /**
   * Expand bounds by a margin
   * @param {Object} bounds - Original bounds
   * @param {number} margin - Margin to add (in world units)
   * @returns {Object} Expanded bounds
   */
  static expandBounds(bounds, margin) {
    return {
      minX: bounds.minX - margin,
      maxX: bounds.maxX + margin,
      minY: bounds.minY - margin,
      maxY: bounds.maxY + margin
    };
  }
}

/**
 * Zoom and viewport utilities
 */
export class ZoomUtils {
  /**
   * Calculate zoom level to fit bounds in viewport
   * @param {Object} bounds - Content bounds
   * @param {number} canvasWidth - Canvas width
   * @param {number} canvasHeight - Canvas height
   * @param {number} padding - Padding in pixels
   * @returns {number} Calculated zoom level
   */
  static calculateFitToScreenZoom(bounds, canvasWidth, canvasHeight, padding = VIEWPORT.FIT_PADDING) {
    const { width, height } = BoundsUtils.getBoundsDimensions(bounds);
    
    if (width === 0 || height === 0) {
      return VIEWPORT.DEFAULT_ZOOM;
    }

    const availableWidth = canvasWidth - 2 * padding;
    const availableHeight = canvasHeight - 2 * padding;
    
    const scaleX = availableWidth / width;
    const scaleY = availableHeight / height;
    
    return Math.max(VIEWPORT.MIN_ZOOM, Math.min(VIEWPORT.MAX_ZOOM, Math.min(scaleX, scaleY)));
  }

  /**
   * Calculate viewport offset to center content
   * @param {Object} bounds - Content bounds
   * @param {number} zoom - Zoom level
   * @param {number} canvasWidth - Canvas width
   * @param {number} canvasHeight - Canvas height
   * @returns {Object} Viewport offset {offsetX, offsetY}
   */
  static calculateCenterOffset(bounds, zoom, canvasWidth, canvasHeight) {
    const { centerX, centerY } = BoundsUtils.getBoundsDimensions(bounds);
    
    return {
      offsetX: canvasWidth / 2 - centerX * zoom,
      offsetY: canvasHeight / 2 + centerY * zoom
    };
  }

  /**
   * Clamp zoom level to valid range
   * @param {number} zoom - Zoom level to clamp
   * @returns {number} Clamped zoom level
   */
  static clampZoom(zoom) {
    return Math.max(VIEWPORT.MIN_ZOOM, Math.min(VIEWPORT.MAX_ZOOM, zoom));
  }
}