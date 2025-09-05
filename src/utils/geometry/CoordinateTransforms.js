/**
 * Coordinate Transformations and Grid Utilities
 * Screen/world conversions, measurements, grid operations, precision utilities
 */

import { COORDINATES, VIEWPORT } from '../Constants.js';

/**
 * Coordinate transformation utilities
 */
export class CoordinateTransform {
  /**
   * Convert screen coordinates to world coordinates
   * @param {number} screenX - Screen X coordinate (pixels)
   * @param {number} screenY - Screen Y coordinate (pixels)
   * @param {number} zoom - Current zoom level
   * @param {number} offsetX - Viewport X offset
   * @param {number} offsetY - Viewport Y offset
   * @param {number} canvasHeight - Canvas height for Y-axis flip
   * @returns {Object} World coordinates {x, y}
   */
  static screenToWorld(screenX, screenY, zoom, offsetX, offsetY, canvasHeight) {
    // Validate inputs to prevent coordinate errors
    if (!isFinite(screenX) || !isFinite(screenY) || !isFinite(zoom) || zoom === 0) {
      return { x: 0, y: 0 };
    }
    
    // High-precision coordinate conversion
    // Canvas transform: translate(offsetX, canvasHeight - offsetY) + scale(zoom, -zoom)
    // So: screenX = worldX * zoom + offsetX
    //     screenY = canvasHeight - offsetY - worldY * zoom
    // Solving for world coordinates:
    const worldX = (screenX - offsetX) / zoom;
    const worldY = (canvasHeight - screenY - offsetY) / zoom;
    
    // Apply precision rounding to prevent floating point drift
    return { 
      x: PrecisionUtils.round(worldX, COORDINATES.PRECISION), 
      y: PrecisionUtils.round(worldY, COORDINATES.PRECISION)
    };
  }

  /**
   * Convert world coordinates to screen coordinates
   * @param {number} worldX - World X coordinate
   * @param {number} worldY - World Y coordinate
   * @param {number} zoom - Current zoom level
   * @param {number} offsetX - Viewport X offset
   * @param {number} offsetY - Viewport Y offset
   * @param {number} canvasHeight - Canvas height for Y-axis flip
   * @returns {Object} Screen coordinates {x, y}
   */
  static worldToScreen(worldX, worldY, zoom, offsetX, offsetY, canvasHeight) {
    // Validate inputs to prevent coordinate errors
    if (!isFinite(worldX) || !isFinite(worldY) || !isFinite(zoom) || zoom === 0) {
      return { x: 0, y: 0 };
    }
    
    // High-precision coordinate conversion
    // Canvas transform: translate(offsetX, canvasHeight - offsetY) + scale(zoom, -zoom)
    // So: screenX = worldX * zoom + offsetX
    //     screenY = canvasHeight - offsetY - worldY * zoom
    const screenX = worldX * zoom + offsetX;
    const screenY = canvasHeight - (worldY * zoom + offsetY);
    
    // Round to prevent sub-pixel positioning issues
    return { 
      x: Math.round(screenX * 100) / 100, // Round to 0.01 pixel precision
      y: Math.round(screenY * 100) / 100
    };
  }

  /**
   * Apply transformation to canvas context (simplified)
   * @param {CanvasRenderingContext2D} ctx - Canvas context
   * @param {number} zoom - Current zoom level
   * @param {number} offsetX - Viewport X offset
   * @param {number} offsetY - Viewport Y offset
   * @param {number} canvasHeight - Canvas height for Y-axis flip
   */
  static applyTransform(ctx, zoom, offsetX, offsetY, canvasHeight) {
    // Reset transform
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    
    // Apply translation and scaling with Y-axis flip for CNC coordinates
    ctx.translate(offsetX, canvasHeight - offsetY);
    ctx.scale(zoom, -zoom);
  }
}

/**
 * Distance and measurement utilities
 */
export class MeasurementUtils {
  /**
   * Calculate Euclidean distance between two points
   * @param {number} x1 - First point X coordinate
   * @param {number} y1 - First point Y coordinate
   * @param {number} x2 - Second point X coordinate
   * @param {number} y2 - Second point Y coordinate
   * @returns {number} Distance between points
   */
  static distance(x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    return Math.sqrt(dx * dx + dy * dy);
  }

  /**
   * Calculate angle between two points in radians
   * @param {number} x1 - First point X coordinate
   * @param {number} y1 - First point Y coordinate
   * @param {number} x2 - Second point X coordinate
   * @param {number} y2 - Second point Y coordinate
   * @returns {number} Angle in radians
   */
  static angleRadians(x1, y1, x2, y2) {
    return Math.atan2(y2 - y1, x2 - x1);
  }

  /**
   * Calculate angle between two points in degrees
   * @param {number} x1 - First point X coordinate
   * @param {number} y1 - First point Y coordinate
   * @param {number} x2 - Second point X coordinate
   * @param {number} y2 - Second point Y coordinate
   * @returns {number} Angle in degrees
   */
  static angleDegrees(x1, y1, x2, y2) {
    return MeasurementUtils.angleRadians(x1, y1, x2, y2) * (180 / Math.PI);
  }

  /**
   * Calculate the midpoint between two points
   * @param {number} x1 - First point X coordinate
   * @param {number} y1 - First point Y coordinate
   * @param {number} x2 - Second point X coordinate
   * @param {number} y2 - Second point Y coordinate
   * @returns {Object} Midpoint coordinates {x, y}
   */
  static midpoint(x1, y1, x2, y2) {
    return {
      x: (x1 + x2) / 2,
      y: (y1 + y2) / 2
    };
  }
}

/**
 * Grid and snapping utilities
 */
export class GridUtils {
  /**
   * Snap coordinate to grid
   * @param {number} value - Coordinate value to snap
   * @param {number} gridSize - Grid size for snapping
   * @returns {number} Snapped coordinate
   */
  static snapToGrid(value, gridSize) {
    return Math.round(value / gridSize) * gridSize;
  }

  /**
   * Snap point to grid
   * @param {number} x - X coordinate
   * @param {number} y - Y coordinate
   * @param {number} gridSize - Grid size for snapping
   * @returns {Object} Snapped point {x, y}
   */
  static snapPointToGrid(x, y, gridSize) {
    return {
      x: GridUtils.snapToGrid(x, gridSize),
      y: GridUtils.snapToGrid(y, gridSize)
    };
  }

  /**
   * Calculate grid lines for rendering
   * @param {number} zoom - Current zoom level
   * @param {number} offsetX - Viewport X offset
   * @param {number} offsetY - Viewport Y offset
   * @param {number} canvasWidth - Canvas width
   * @param {number} canvasHeight - Canvas height
   * @param {number} gridSize - Grid size
   * @returns {Object} Grid lines {vertical, horizontal}
   */
  static calculateGridLines(zoom, offsetX, offsetY, canvasWidth, canvasHeight, gridSize) {
    const startX = Math.floor((-offsetX) / (gridSize * zoom)) * gridSize;
    const endX = Math.ceil((-offsetX + canvasWidth) / zoom) / gridSize * gridSize;
    const startY = Math.floor((-offsetY) / (gridSize * zoom)) * gridSize;
    const endY = Math.ceil((-offsetY + canvasHeight) / zoom) / gridSize * gridSize;

    const vertical = [];
    const horizontal = [];

    // Calculate vertical lines
    for (let x = startX; x <= endX; x += gridSize) {
      vertical.push(x);
    }

    // Calculate horizontal lines
    for (let y = startY; y <= endY; y += gridSize) {
      horizontal.push(y);
    }

    return { vertical, horizontal };
  }
}

/**
 * Numerical precision utilities
 */
export class PrecisionUtils {
  /**
   * Round number to specified decimal places
   * @param {number} value - Value to round
   * @param {number} precision - Number of decimal places
   * @returns {number} Rounded value
   */
  static round(value, precision = COORDINATES.PRECISION) {
    const factor = Math.pow(10, precision);
    return Math.round(value * factor) / factor;
  }

  /**
   * Format number for display
   * @param {number} value - Value to format
   * @param {number} precision - Number of decimal places
   * @returns {string} Formatted value
   */
  static format(value, precision = COORDINATES.PRECISION) {
    return PrecisionUtils.round(value, precision).toFixed(precision);
  }

  /**
   * Check if two numbers are approximately equal
   * @param {number} a - First number
   * @param {number} b - Second number
   * @param {number} epsilon - Tolerance for comparison
   * @returns {boolean} True if numbers are approximately equal
   */
  static approximately(a, b, epsilon = 1e-10) {
    return Math.abs(a - b) < epsilon;
  }
}

/**
 * Validation utilities
 */
export class ValidationUtils {
  /**
   * Check if coordinate is valid (finite number)
   * @param {number} value - Coordinate value to validate
   * @returns {boolean} True if coordinate is valid
   */
  static isValidCoordinate(value) {
    return typeof value === 'number' && isFinite(value) && !isNaN(value);
  }

  /**
   * Check if point has valid coordinates
   * @param {Object} point - Point object {x, y}
   * @returns {boolean} True if point is valid
   */
  static isValidPoint(point) {
    return point && 
           ValidationUtils.isValidCoordinate(point.x) && 
           ValidationUtils.isValidCoordinate(point.y);
  }

  /**
   * Sanitize coordinate value
   * @param {*} value - Value to sanitize
   * @param {number} defaultValue - Default value if invalid
   * @returns {number} Sanitized coordinate
   */
  static sanitizeCoordinate(value, defaultValue = 0) {
    const parsed = parseFloat(value);
    return ValidationUtils.isValidCoordinate(parsed) ? parsed : defaultValue;
  }
}