/**
 * Coordinate Transformations and Grid Utilities
 * Screen/world conversions, measurements, grid operations, precision utilities
 * 
 * COORDINATE SYSTEM ARCHITECTURE:
 * 
 * This module implements a dual coordinate system to handle different rendering contexts:
 * 
 * 1. WORLD COORDINATE SYSTEM (Y-axis flipped):
 *    - Used for: G-code paths, geometry rendering, measurements
 *    - Transform: translate(offsetX, canvasHeight - offsetY) + scale(zoom, -zoom)
 *    - Functions: worldToScreen(), screenToWorld(), applyTransform()
 *    - Y-axis is flipped to match CNC coordinate conventions
 * 
 * 2. TEXT COORDINATE SYSTEM (No Y-axis flip):
 *    - Used for: Grid labels, point markers, text overlays  
 *    - Transform: translate(offsetX, offsetY) + scale(zoom, zoom)
 *    - Functions: worldToScreenTextSpace(), screenToWorldTextSpace()
 *    - Y-axis is NOT flipped to prevent text from appearing upside-down
 * 
 * WHY DUAL SYSTEMS?
 * - World system: Matches G-code coordinate conventions (Y+ = up)
 * - Text system: Prevents text mirroring/inversion, ensures readability
 * - Before this fix: Text used world coordinates but text transform -> misalignment
 * - After this fix: Text uses dedicated text-space coordinates -> perfect alignment
 * 
 * IMPLEMENTATION STRATEGY A (CURRENTLY USED):
 * - Text rendering uses identity transform + worldToScreen() coordinate conversion
 * - Grid labels and point markers use viewport.worldToScreen() with screen-space positioning
 * - No custom text transforms applied - text rendered at calculated screen pixel coordinates
 * - Simple, reliable approach that avoids coordinate system confusion
 * 
 * USAGE GUIDELINES:
 * - Use worldToScreen/screenToWorld for: paths, measurements, mouse interactions, text positioning
 * - Use worldToScreenTextSpace/screenToWorldTextSpace for: utility functions, hit-testing
 * - Text rendering: Use identity transform + worldToScreen() for coordinates (Strategy A)
 * - Always match coordinate functions with their corresponding canvas transform
 */

import { COORDINATES, VIEWPORT, DYNAMIC_GRID } from '../Constants.js';

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

  /**
   * Convert world coordinates to screen coordinates for text rendering
   * (NO Y-axis flip - compatible with applyTextTransform)
   * @param {number} worldX - World X coordinate
   * @param {number} worldY - World Y coordinate
   * @param {number} zoom - Current zoom level
   * @param {number} offsetX - Viewport X offset
   * @param {number} offsetY - Viewport Y offset
   * @returns {Object} Screen coordinates {x, y}
   */
  static worldToScreenTextSpace(worldX, worldY, zoom, offsetX, offsetY) {
    // Validate inputs to prevent coordinate errors
    if (!isFinite(worldX) || !isFinite(worldY) || !isFinite(zoom) || zoom === 0) {
      return { x: 0, y: 0 };
    }
    
    // Text-space coordinate conversion (no Y-axis flip)
    // Text transform: translate(offsetX, offsetY) + scale(zoom, zoom)
    // So: screenX = worldX * zoom + offsetX
    //     screenY = worldY * zoom + offsetY
    const screenX = worldX * zoom + offsetX;
    const screenY = worldY * zoom + offsetY;
    
    // Round to prevent sub-pixel positioning issues
    return { 
      x: Math.round(screenX * 100) / 100, // Round to 0.01 pixel precision
      y: Math.round(screenY * 100) / 100
    };
  }

  /**
   * Convert screen coordinates to world coordinates for text rendering
   * (NO Y-axis flip - compatible with applyTextTransform)
   * @param {number} screenX - Screen X coordinate (pixels)
   * @param {number} screenY - Screen Y coordinate (pixels)
   * @param {number} zoom - Current zoom level
   * @param {number} offsetX - Viewport X offset
   * @param {number} offsetY - Viewport Y offset
   * @returns {Object} World coordinates {x, y}
   */
  static screenToWorldTextSpace(screenX, screenY, zoom, offsetX, offsetY) {
    // Validate inputs to prevent coordinate errors
    if (!isFinite(screenX) || !isFinite(screenY) || !isFinite(zoom) || zoom === 0) {
      return { x: 0, y: 0 };
    }
    
    // Text-space coordinate conversion (no Y-axis flip)
    // Text transform: translate(offsetX, offsetY) + scale(zoom, zoom)
    // So: screenX = worldX * zoom + offsetX
    //     screenY = worldY * zoom + offsetY
    // Solving for world coordinates:
    const worldX = (screenX - offsetX) / zoom;
    const worldY = (screenY - offsetY) / zoom;
    
    // Apply precision rounding to prevent floating point drift
    return { 
      x: PrecisionUtils.round(worldX, COORDINATES.PRECISION), 
      y: PrecisionUtils.round(worldY, COORDINATES.PRECISION)
    };
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
   * Pick optimal grid spacing for given zoom level
   * @param {number} zoom - Current zoom level
   * @param {number} targetPx - Target spacing in pixels (default: DYNAMIC_GRID.TARGET_MINOR_PX)
   * @returns {number} Optimal grid spacing in world units
   */
  static pickGridSpacing(zoom, targetPx = DYNAMIC_GRID.TARGET_MINOR_PX) {
    const worldTarget = targetPx / zoom;
    const pow = Math.pow(10, Math.floor(Math.log10(worldTarget)));
    
    // Find smallest step that satisfies s*pow >= worldTarget
    for (const step of DYNAMIC_GRID.STEPS) {
      const spacing = step * pow;
      if (spacing >= worldTarget) {
        return spacing;
      }
    }
    
    // Fallback: bump to next power of 10 when worldTarget > last step * pow
    // Ensures proper 1-2-5 progression (e.g., 7 -> 10)
    return 10 * pow;
  }

  /**
   * Pick optimal label spacing based on minor spacing and zoom level
   * @param {number} minorWorld - Minor grid spacing in world units
   * @param {number} zoom - Current zoom level
   * @param {number} targetPx - Target label spacing in pixels (default: DYNAMIC_GRID.TARGET_LABEL_PX)
   * @returns {number} Optimal label spacing in world units
   */
  static pickLabelSpacing(minorWorld, zoom, targetPx = DYNAMIC_GRID.TARGET_LABEL_PX) {
    const labelWorldTarget = targetPx / zoom;
    const k = Math.ceil(labelWorldTarget / minorWorld);

    // Snap k to the 1-2-5 progression at the appropriate power of 10
    const pow = Math.pow(10, Math.floor(Math.log10(k)));
    const multipliers = [1, 2, 5];
    for (const mult of multipliers) {
      const candidate = mult * pow;
      if (candidate >= k) {
        return candidate * minorWorld;
      }
    }
    // If no multiplier was large enough, bump to next power of 10
    return (10 * pow) * minorWorld;
  }

  /**
   * Calculate grid lines for rendering using index-based iteration
   * @param {number} zoom - Current zoom level
   * @param {number} offsetX - Viewport X offset
   * @param {number} offsetY - Viewport Y offset
   * @param {number} canvasWidth - Canvas width
   * @param {number} canvasHeight - Canvas height
   * @param {number} gridSize - Grid size
   * @returns {Object} Grid lines {vertical, horizontal, verticalIndices, horizontalIndices}
   */
  static calculateGridLines(zoom, offsetX, offsetY, canvasWidth, canvasHeight, gridSize) {
    // Calculate world bounds
    const worldStartX = -offsetX / zoom;
    const worldEndX = (canvasWidth - offsetX) / zoom;
    const worldStartY = -offsetY / zoom;
    const worldEndY = (canvasHeight - offsetY) / zoom;

    // Use index-based iteration to avoid floating point accumulation
    const iStartX = Math.ceil(worldStartX / gridSize);
    const iEndX = Math.floor(worldEndX / gridSize);
    const iStartY = Math.ceil(worldStartY / gridSize);
    const iEndY = Math.floor(worldEndY / gridSize);

    const vertical = [];
    const horizontal = [];
    const verticalIndices = [];
    const horizontalIndices = [];

    // Calculate vertical lines
    for (let i = iStartX; i <= iEndX; i++) {
      vertical.push(i * gridSize);
      verticalIndices.push(i);
    }

    // Calculate horizontal lines
    for (let i = iStartY; i <= iEndY; i++) {
      horizontal.push(i * gridSize);
      horizontalIndices.push(i);
    }

    return { vertical, horizontal, verticalIndices, horizontalIndices };
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
