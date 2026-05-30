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
    const toolpaths = [];
    const tracker = new CoordinateTracker();

    let currentToolpath = null;
    let modalMotion = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const motionData = ContourDetector._parseMotion(line, modalMotion);
      if (motionData && ['G0', 'G1', 'G2', 'G3'].includes(motionData.command)) {
        modalMotion = motionData.command;
      }

      // Always update tracker position
      const prevPosition = { ...tracker.currentPosition };
      if (motionData) {
        tracker.processMotion(motionData);
      }

      // Check if this is a cutting motion command (G1/G2/G3)
      if (motionData && ['G1', 'G2', 'G3'].includes(motionData.command)) {
        if (!currentToolpath) {
          // Start new toolpath
          currentToolpath = {
            startIndex: i,
            endIndex: i,
            startCoord: { ...prevPosition },
            endCoord: { ...tracker.currentPosition },
            lines: [line],
            type: 'toolpath' // Will be refined to open/closed later
          };
        } else {
          // Extend current toolpath
          currentToolpath.endIndex = i;
          currentToolpath.endCoord = { ...tracker.currentPosition };
          currentToolpath.lines.push(line);
        }
      } else if (motionData && motionData.command === 'G0') {
        // Rapid move - ends the current toolpath
        if (currentToolpath) {
          toolpaths.push(ContourDetector._finalizeToolpath(currentToolpath, lines, tolerance));
          currentToolpath = null;
        }
      } else if (ContourDetector._isProgramControlCommand(line)) {
        if (currentToolpath) {
          toolpaths.push(ContourDetector._finalizeToolpath(currentToolpath, lines, tolerance));
          currentToolpath = null;
        }
      } else {
        // Other commands (comments, M-codes, etc.) - if we are in a toolpath, do we break it?
        // For now, let's say non-motion commands don't break a toolpath unless they are explicit stops.
        // But usually, toolpaths are contiguous motions.
        // If we encounter a non-motion line inside a toolpath (like a comment), we can include it?
        // For simplicity, let's stick to: Toolpath = contiguous G1/G2/G3.
        // So any non-G1/G2/G3 breaks it?
        // Actually, comments often appear inside. Let's include them if they are not G0.
        if (currentToolpath) {
          currentToolpath.endIndex = i;
          currentToolpath.lines.push(line);
        }
      }
    }

    // Close any remaining toolpath
    if (currentToolpath) {
      toolpaths.push(ContourDetector._finalizeToolpath(currentToolpath, lines, tolerance));
    }

    return toolpaths;
  }

  static _finalizeToolpath(toolpath, allLines, tolerance) {
    const isClosed = ContourDetector._coordinatesEqual(toolpath.startCoord, toolpath.endCoord, tolerance);

    // Calculate length and direction
    const slice = allLines.slice(toolpath.startIndex, toolpath.endIndex + 1);

    return {
      startIndex: toolpath.startIndex,
      endIndex: toolpath.endIndex,
      startCoord: toolpath.startCoord,
      endCoord: toolpath.endCoord,
      length: ContourDetector._calculateContourLength(slice),
      direction: ContourDetector._determineDirection(slice),
      type: isClosed ? 'toolpath-closed' : 'toolpath-open',
      lines: toolpath.lines
    };
  }

  /**
   * Parse motion command from G-code line
   * @param {string} line - G-code line
   * @returns {Object|null} Motion data or null if not a motion command
   * @private
   */
  static _parseMotion(line, modalMotion = null) {
    if (!line || typeof line !== 'string') return null;

    const normalized = line.replace(/^N\d+(?:\s+|$)/i, '').trim().toUpperCase()
      .replace(/\bG0+([0-3])(?!\d)/g, 'G$1');

    // Recognize motions (G0–G3) and coordinate mode changes (G90/G91 and G90.1/G91.1)
    const motionMatch = normalized.match(/^(G(?:0|1|2|3|90(?:\.1)?|91(?:\.1)?))(?=\D|$)/);
    if (!motionMatch && (!modalMotion || !ContourDetector._hasMotionParameters(normalized))) {
      return null;
    }

    const command = motionMatch ? motionMatch[1] : modalMotion;

    return {
      command,
      x: ContourDetector._parseParam(normalized, 'X'),
      y: ContourDetector._parseParam(normalized, 'Y'),
      i: ContourDetector._parseParam(normalized, 'I'),
      j: ContourDetector._parseParam(normalized, 'J')
    };
  }

  static _parseParam(line, axis) {
    const num = '[-+]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[Ee][-+]?\\d+)?';
    const match = line.match(new RegExp(`${axis}\\s*(${num})`));
    return match ? parseFloat(match[1]) : null;
  }

  static _hasMotionParameters(line) {
    return ['X', 'Y', 'I', 'J'].some(axis => ContourDetector._parseParam(line, axis) !== null);
  }

  static _isProgramControlCommand(line) {
    if (!line || typeof line !== 'string') return false;
    const normalized = line.replace(/^N\d+(?:\s+|$)/i, '').trim().toUpperCase();
    return /^M\d+(?=\D|$)/.test(normalized);
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
