/**
 * Arc Geometry Calculations
 * Mathematical operations for G2/G3 arc commands
 */

import { MeasurementUtils } from './CoordinateTransforms.js';
import { BoundsUtils } from './BoundsCalculations.js';

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