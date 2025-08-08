/**
 * Mathematical Utilities for Wire EDM G-Code Viewer
 * Coordinate transformations, distance calculations, and geometric utilities
 */

import { COORDINATES, VIEWPORT } from './Constants.js';

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
 * Arc geometry utilities for G2/G3 commands
 */
export class ArcUtils {
  /**
   * Calculate arc parameters
   * @param {number} startX - Arc start X coordinate
   * @param {number} startY - Arc start Y coordinate
   * @param {number} endX - Arc end X coordinate
   * @param {number} endY - Arc end Y coordinate
   * @param {number} centerX - Arc center X coordinate
   * @param {number} centerY - Arc center Y coordinate
   * @param {boolean} clockwise - True for clockwise (G2), false for counterclockwise (G3)
   * @returns {Object} Arc parameters {radius, startAngle, endAngle, angleSpan}
   */
  static calculateArcParameters(startX, startY, endX, endY, centerX, centerY, clockwise) {
    const radius = MeasurementUtils.distance(startX, startY, centerX, centerY);
    const startAngle = Math.atan2(startY - centerY, startX - centerX);
    const endAngle = Math.atan2(endY - centerY, endX - centerX);
    
    let angleSpan = endAngle - startAngle;
    
    // Normalize angle span based on direction
    if (clockwise) {
      if (angleSpan > 0) angleSpan -= 2 * Math.PI;
    } else {
      if (angleSpan < 0) angleSpan += 2 * Math.PI;
    }

    return {
      radius,
      startAngle,
      endAngle,
      angleSpan: Math.abs(angleSpan)
    };
  }

  /**
   * Calculate point on arc at given angle
   * @param {number} centerX - Arc center X coordinate
   * @param {number} centerY - Arc center Y coordinate
   * @param {number} radius - Arc radius
   * @param {number} angle - Angle in radians
   * @returns {Object} Point on arc {x, y}
   */
  static pointOnArc(centerX, centerY, radius, angle) {
    return {
      x: centerX + radius * Math.cos(angle),
      y: centerY + radius * Math.sin(angle)
    };
  }

  /**
   * Calculate arc bounds
   * @param {number} startX - Arc start X coordinate
   * @param {number} startY - Arc start Y coordinate
   * @param {number} endX - Arc end X coordinate
   * @param {number} endY - Arc end Y coordinate
   * @param {number} centerX - Arc center X coordinate
   * @param {number} centerY - Arc center Y coordinate
   * @param {boolean} clockwise - Arc direction
   * @returns {Object} Arc bounds {minX, maxX, minY, maxY}
   */
  static calculateArcBounds(startX, startY, endX, endY, centerX, centerY, clockwise) {
    const { radius, startAngle, endAngle } = ArcUtils.calculateArcParameters(
      startX, startY, endX, endY, centerX, centerY, clockwise
    );

    let bounds = BoundsUtils.createEmptyBounds();
    
    // Include start and end points
    bounds = BoundsUtils.updateBounds(bounds, startX, startY);
    bounds = BoundsUtils.updateBounds(bounds, endX, endY);

    // Check if arc crosses axis extremes (0, π/2, π, 3π/2)
    const extremeAngles = [0, Math.PI / 2, Math.PI, 3 * Math.PI / 2];
    
    for (const angle of extremeAngles) {
      if (ArcUtils.angleInArcSpan(angle, startAngle, endAngle, clockwise)) {
        const point = ArcUtils.pointOnArc(centerX, centerY, radius, angle);
        bounds = BoundsUtils.updateBounds(bounds, point.x, point.y);
      }
    }

    return bounds;
  }

  /**
   * Check if angle is within arc span
   * @param {number} angle - Angle to check
   * @param {number} startAngle - Arc start angle
   * @param {number} endAngle - Arc end angle
   * @param {boolean} clockwise - Arc direction
   * @returns {boolean} True if angle is in arc span
   */
  static angleInArcSpan(angle, startAngle, endAngle, clockwise) {
    // Normalize angles to [0, 2π]
    const normalizeAngle = (a) => {
      while (a < 0) a += 2 * Math.PI;
      while (a >= 2 * Math.PI) a -= 2 * Math.PI;
      return a;
    };

    const normStart = normalizeAngle(startAngle);
    const normEnd = normalizeAngle(endAngle);
    const normAngle = normalizeAngle(angle);

    if (clockwise) {
      return normStart >= normEnd 
        ? (normAngle <= normStart && normAngle >= normEnd)
        : (normAngle <= normStart || normAngle >= normEnd);
    } else {
      return normStart <= normEnd 
        ? (normAngle >= normStart && normAngle <= normEnd)
        : (normAngle >= normStart || normAngle <= normEnd);
    }
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