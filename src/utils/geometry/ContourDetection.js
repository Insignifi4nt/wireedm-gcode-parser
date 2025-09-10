/**
 * Contour Detection for G-Code Analysis
 * Identifies closed toolpaths and contour boundaries for Wire EDM operations
 */

import { MeasurementUtils } from './CoordinateTransforms.js';

/**
 * Closed contour detection utilities for G-code analysis
 */
export class ContourDetector {
  /**
   * Default tolerance for coordinate matching (Wire EDM precision: 0.1μm)
   */
  static DEFAULT_TOLERANCE = 1e-4;

  /**
   * Detect closed contours in G-code lines
   * @param {Array<string>} lines - Array of G-code text lines
   * @param {Object} options - Configuration options
   * @param {number} options.tolerance - Coordinate matching tolerance
   * @returns {Array<Object>} Array of contour objects
   */
  static detectContours(lines, options = {}) {
    const { tolerance = ContourDetector.DEFAULT_TOLERANCE } = options;
    const contours = [];
    const tracker = new CoordinateTracker();
    
    let contourStartIndex = -1;
    let contourStartPosition = null;
    let hasMotionInContour = false;
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const motionData = ContourDetector._parseMotion(line);
      
      if (!motionData) continue;
      
      // Check if this is a cutting motion command (G1/G2/G3)
      if (ContourDetector._isMotionCommand(line)) {
        if (contourStartIndex === -1) {
          // Start new potential contour - record position BEFORE this move
          contourStartPosition = { ...tracker.currentPosition };
          contourStartIndex = i;
          hasMotionInContour = true;
        } else {
          hasMotionInContour = true;
        }
        
        // Always update tracker position first
        tracker.processMotion(motionData);
        
        // Then check for contour closure (after position update)
        if (contourStartIndex !== -1 && i > contourStartIndex + 2 && 
            ContourDetector._coordinatesEqual(tracker.currentPosition, contourStartPosition, tolerance)) {
          contours.push({
            startIndex: contourStartIndex,
            endIndex: i,
            startCoord: { ...contourStartPosition },
            endCoord: { ...tracker.currentPosition },
            length: ContourDetector._calculateContourLength(lines.slice(contourStartIndex, i + 1)),
            direction: ContourDetector._determineDirection(lines.slice(contourStartIndex, i + 1))
          });
          
          // Reset for next contour
          contourStartIndex = -1;
          contourStartPosition = null;
          hasMotionInContour = false;
        }
      } else if (motionData.command === 'G0') {
        // Rapid move - end current contour if it was open (but don't prevent future contours)
        if (contourStartIndex !== -1 && hasMotionInContour) {
          // End current open contour (not closed)
          contourStartIndex = -1;
          contourStartPosition = null;
          hasMotionInContour = false;
        }
        
        // Update tracker position (G0 moves set position for potential future contours)
        tracker.processMotion(motionData);
      } else {
        // Other commands (coordinate mode changes, etc.)
        tracker.processMotion(motionData);
      }
    }
    
    return contours;
  }

  /**
   * Parse motion command from G-code line
   * @param {string} line - G-code line
   * @returns {Object|null} Motion data or null if not a motion command
   * @private
   */
  static _parseMotion(line) {
    if (!line || typeof line !== 'string') return null;
    
    const normalized = line.replace(/^N\d+\s+/i, '').trim().toUpperCase()
                          .replace(/\bG0+([0-3])(?!\d)/g, 'G$1');
    
    // Recognize motions (G0–G3) and coordinate mode changes (G90/G91 and G90.1/G91.1)
    const motionMatch = normalized.match(/^(G(?:0|1|2|3|90(?:\.1)?|91(?:\.1)?))\b/);
    if (!motionMatch) return null;
    
    const command = motionMatch[1];
    const xMatch = normalized.match(/X([-+]?\d*\.?\d+)/);
    const yMatch = normalized.match(/Y([-+]?\d*\.?\d+)/);
    const iMatch = normalized.match(/I([-+]?\d*\.?\d+)/);
    const jMatch = normalized.match(/J([-+]?\d*\.?\d+)/);
    
    return {
      command,
      x: xMatch ? parseFloat(xMatch[1]) : null,
      y: yMatch ? parseFloat(yMatch[1]) : null,
      i: iMatch ? parseFloat(iMatch[1]) : null,
      j: jMatch ? parseFloat(jMatch[1]) : null
    };
  }

  /**
   * Check if line contains cutting motion command (excludes G0 rapid moves)
   * @param {string} line - G-code line
   * @returns {boolean} True if cutting motion command
   * @private
   */
  static _isMotionCommand(line) {
    const motionData = ContourDetector._parseMotion(line);
    return motionData && ['G1', 'G2', 'G3'].includes(motionData.command);
  }

  /**
   * Compare coordinates with tolerance
   * @param {Object} coord1 - First coordinate {x, y}
   * @param {Object} coord2 - Second coordinate {x, y}
   * @param {number} tolerance - Matching tolerance
   * @returns {boolean} True if coordinates match within tolerance
   * @private
   */
  static _coordinatesEqual(coord1, coord2, tolerance) {
    return Math.abs(coord1.x - coord2.x) <= tolerance && 
           Math.abs(coord1.y - coord2.y) <= tolerance;
  }

  /**
   * Calculate approximate contour length
   * @param {Array<string>} contourLines - G-code lines for contour
   * @returns {number} Approximate contour length
   * @private
   */
  static _calculateContourLength(contourLines) {
    const tracker = new CoordinateTracker();
    let totalLength = 0;
    
    for (const line of contourLines) {
      const motionData = ContourDetector._parseMotion(line);
      if (!motionData) continue;
      
      const prevPosition = { ...tracker.currentPosition };
      tracker.processMotion(motionData);
      
      if (motionData.command === 'G0' || motionData.command === 'G1') {
        totalLength += MeasurementUtils.distance(
          prevPosition.x, prevPosition.y,
          tracker.currentPosition.x, tracker.currentPosition.y
        );
      } else if (motionData.command === 'G2' || motionData.command === 'G3') {
        // Approximate arc length (could be enhanced with arc calculations)
        totalLength += MeasurementUtils.distance(
          prevPosition.x, prevPosition.y,
          tracker.currentPosition.x, tracker.currentPosition.y
        ) * 1.2; // Rough arc approximation
      }
    }
    
    return totalLength;
  }

  /**
   * Determine contour direction (clockwise/counterclockwise)
   * @param {Array<string>} contourLines - G-code lines for contour
   * @returns {string} 'CW', 'CCW', or 'UNKNOWN'
   * @private
   */
  static _determineDirection(contourLines) {
    // Simplified direction detection - could be enhanced
    let cwCount = 0;
    let ccwCount = 0;
    
    for (const line of contourLines) {
      const motionData = ContourDetector._parseMotion(line);
      if (!motionData) continue;
      
      if (motionData.command === 'G2') cwCount++;
      if (motionData.command === 'G3') ccwCount++;
    }
    
    if (cwCount > ccwCount) return 'CW';
    if (ccwCount > cwCount) return 'CCW';
    return 'UNKNOWN';
  }
}

/**
 * Coordinate tracking for G-code parsing
 */
export class CoordinateTracker {
  constructor() {
    this.currentPosition = { x: 0, y: 0 };
    this.absoluteMode = true; // G90/G91
    this.absoluteIJMode = false; // G90.1/G91.1
  }

  /**
   * Process motion command and update current position
   * @param {Object} motionData - Parsed motion command data
   * @returns {Object} New current position
   */
  processMotion(motionData) {
    if (!motionData) return this.currentPosition;

    // Handle coordinate mode changes
    if (motionData.command === 'G90') this.absoluteMode = true;
    if (motionData.command === 'G91') this.absoluteMode = false;
    if (motionData.command === 'G90.1') this.absoluteIJMode = true;
    if (motionData.command === 'G91.1') this.absoluteIJMode = false;

    // Calculate new position based on motion command
    switch (motionData.command) {
      case 'G0':
      case 'G1':
        this._processLinearMove(motionData);
        break;
      case 'G2':
      case 'G3':
        this._processArcMove(motionData);
        break;
    }

    return this.currentPosition;
  }

  /**
   * Process linear move (G0/G1)
   * @param {Object} motionData - Motion command data
   * @private
   */
  _processLinearMove(motionData) {
    if (this.absoluteMode) {
      if (motionData.x !== null) this.currentPosition.x = motionData.x;
      if (motionData.y !== null) this.currentPosition.y = motionData.y;
    } else {
      if (motionData.x !== null) this.currentPosition.x += motionData.x;
      if (motionData.y !== null) this.currentPosition.y += motionData.y;
    }
  }

  /**
   * Process arc move (G2/G3)
   * @param {Object} motionData - Motion command data
   * @private
   */
  _processArcMove(motionData) {
    // For arc moves, we primarily care about the endpoint
    if (this.absoluteMode) {
      if (motionData.x !== null) this.currentPosition.x = motionData.x;
      if (motionData.y !== null) this.currentPosition.y = motionData.y;
    } else {
      if (motionData.x !== null) this.currentPosition.x += motionData.x;
      if (motionData.y !== null) this.currentPosition.y += motionData.y;
    }
    
    // Note: I/J parameters could be used for more precise arc calculations
    // Integration with ArcUtils could enhance this further
  }

  /**
   * Reset tracker to origin
   */
  reset() {
    this.currentPosition = { x: 0, y: 0 };
    this.absoluteMode = true;
    this.absoluteIJMode = false;
  }
}