/**
 * G-Code Parser for Wire EDM G-Code Viewer
 * Parses G-Code text and extracts path data for visualization
 * Supports linear moves (G0/G1) and arc moves (G2/G3)
 */

import { GCODE, COORDINATES } from '../utils/Constants.js';
import { 
  BoundsUtils, 
  ArcUtils, 
  ValidationUtils, 
  PrecisionUtils 
} from '../utils/MathUtils.js';

/**
 * G-Code Parser Class
 * Handles parsing of G-Code text into path data and bounds information
 */
export class GCodeParser {
  /**
   * Parser version for compatibility tracking
   */
  static VERSION = '1.0.0';

  /**
   * Supported G-Code commands
   */
  static SUPPORTED_COMMANDS = {
    LINEAR: ['G0', 'G1'],
    ARC: ['G2', 'G3']
  };

  /**
   * Regular expressions for parsing G-Code parameters
   */
  static REGEX = {
    COORDINATE: /([XYZ])(-?\d+\.?\d*)/g,
    ARC_CENTER: /([IJ])(-?\d+\.?\d*)/g,
    COMMENT: /[;(].*$/
  };

  /**
   * Create a new G-Code parser instance
   * @param {Object} options - Parser configuration options
   * @param {number} options.precision - Coordinate precision (default from constants)
   * @param {boolean} options.strictMode - Enable strict validation (default: false)
   * @param {boolean} options.ignoreErrors - Continue parsing on errors (default: true)
   */
  constructor(options = {}) {
    this.options = {
      precision: COORDINATES.PRECISION,
      strictMode: false,
      ignoreErrors: true,
      ...options
    };

    // Parser state
    this._reset();
  }

  /**
   * Reset parser state
   * @private
   */
  _reset() {
    this.currentPosition = { x: 0, y: 0 };
    this.path = [];
    this.bounds = BoundsUtils.createEmptyBounds();
    this.errors = [];
    this.warnings = [];
    this.stats = {
      totalLines: 0,
      processedLines: 0,
      linearMoves: 0,
      arcMoves: 0,
      comments: 0,
      errors: 0
    };
  }

  /**
   * Parse G-Code text and return path data with bounds
   * @param {string} gcodeText - The G-Code text to parse
   * @returns {Object} Parsed result {path, bounds, stats, errors, warnings}
   * @throws {Error} If parsing fails in strict mode
   */
  parse(gcodeText) {
    if (typeof gcodeText !== 'string') {
      throw new Error('G-Code input must be a string');
    }

    // Reset parser state
    this._reset();

    // Split into lines and process
    const lines = gcodeText.split(/\r?\n/);
    this.stats.totalLines = lines.length;

    for (let lineNumber = 0; lineNumber < lines.length; lineNumber++) {
      try {
        this._parseLine(lines[lineNumber], lineNumber + 1);
      } catch (error) {
        this._handleError(error, lineNumber + 1);
        
        if (this.options.strictMode) {
          throw error;
        }
      }
    }

    // Validate final result
    this._validateResult();

    return {
      path: this.path,
      bounds: this.bounds,
      stats: this.stats,
      errors: this.errors,
      warnings: this.warnings
    };
  }

  /**
   * Parse a single line of G-Code
   * @param {string} line - The line to parse
   * @param {number} lineNumber - Line number for error reporting
   * @private
   */
  _parseLine(line, lineNumber) {
    // Clean and normalize line
    line = line.trim().toUpperCase();
    
    // Skip empty lines
    if (line === '') {
      return;
    }

    // Handle comments
    if (this._isComment(line)) {
      this.stats.comments++;
      return;
    }

    // Remove inline comments
    line = this._removeInlineComments(line);
    
    if (line === '') {
      return;
    }

    this.stats.processedLines++;

    // Parse G-Code commands
    if (this._isLinearMove(line)) {
      this._parseLinearMove(line, lineNumber);
    } else if (this._isArcMove(line)) {
      this._parseArcMove(line, lineNumber);
    } else {
      // Unknown command - issue warning
      this._addWarning(`Unknown G-Code command: ${line}`, lineNumber);
    }
  }

  /**
   * Check if line is a comment
   * @param {string} line - Line to check
   * @returns {boolean} True if line is a comment
   * @private
   */
  _isComment(line) {
    return GCODE.COMMENT_PREFIXES.some(prefix => line.startsWith(prefix));
  }

  /**
   * Remove inline comments from line
   * @param {string} line - Line to clean
   * @returns {string} Line without comments
   * @private
   */
  _removeInlineComments(line) {
    return line.replace(GCodeParser.REGEX.COMMENT, '').trim();
  }

  /**
   * Check if line contains linear move command
   * @param {string} line - Line to check
   * @returns {boolean} True if line contains G0 or G1
   * @private
   */
  _isLinearMove(line) {
    return GCODE.LINEAR_MOVES.some(cmd => line.startsWith(cmd));
  }

  /**
   * Check if line contains arc move command
   * @param {string} line - Line to check
   * @returns {boolean} True if line contains G2 or G3
   * @private
   */
  _isArcMove(line) {
    return GCODE.ARC_MOVES.some(cmd => line.startsWith(cmd));
  }

  /**
   * Parse linear move command (G0/G1)
   * @param {string} line - Line containing linear move
   * @param {number} lineNumber - Line number for error reporting
   * @private
   */
  _parseLinearMove(line, lineNumber) {
    const moveType = line.startsWith('G0') ? 'rapid' : 'cut';
    const coordinates = this._extractCoordinates(line);

    // Update current position with new coordinates
    if (coordinates.x !== undefined) {
      this.currentPosition.x = coordinates.x;
    }
    if (coordinates.y !== undefined) {
      this.currentPosition.y = coordinates.y;
    }

    // Validate coordinates
    if (!ValidationUtils.isValidPoint(this.currentPosition)) {
      throw new Error(`Invalid coordinates at line ${lineNumber}: ${JSON.stringify(this.currentPosition)}`);
    }

    // Create path point
    const pathPoint = {
      type: moveType,
      x: this.currentPosition.x,
      y: this.currentPosition.y
    };

    // Add to path and update bounds
    this.path.push(pathPoint);
    this.bounds = BoundsUtils.updateBounds(this.bounds, this.currentPosition.x, this.currentPosition.y);
    
    this.stats.linearMoves++;
  }

  /**
   * Parse arc move command (G2/G3)
   * @param {string} line - Line containing arc move
   * @param {number} lineNumber - Line number for error reporting
   * @private
   */
  _parseArcMove(line, lineNumber) {
    const clockwise = line.startsWith('G2');
    const coordinates = this._extractCoordinates(line);
    const arcCenter = this._extractArcCenter(line);

    // Store start position
    const startX = this.currentPosition.x;
    const startY = this.currentPosition.y;

    // Calculate end position
    const endX = coordinates.x !== undefined ? coordinates.x : this.currentPosition.x;
    const endY = coordinates.y !== undefined ? coordinates.y : this.currentPosition.y;

    // Calculate center position
    const centerX = startX + (arcCenter.i || 0);
    const centerY = startY + (arcCenter.j || 0);

    // Validate all coordinates
    if (!ValidationUtils.isValidCoordinate(endX) || !ValidationUtils.isValidCoordinate(endY) ||
        !ValidationUtils.isValidCoordinate(centerX) || !ValidationUtils.isValidCoordinate(centerY)) {
      throw new Error(`Invalid arc coordinates at line ${lineNumber}`);
    }

    // Create arc path point
    const arcPoint = {
      type: 'arc',
      startX: startX,
      startY: startY,
      endX: endX,
      endY: endY,
      centerX: centerX,
      centerY: centerY,
      clockwise: clockwise
    };

    // Add to path
    this.path.push(arcPoint);

    // Update position
    this.currentPosition.x = endX;
    this.currentPosition.y = endY;

    // Update bounds using arc bounds calculation
    const arcBounds = ArcUtils.calculateArcBounds(startX, startY, endX, endY, centerX, centerY, clockwise);
    this.bounds.minX = Math.min(this.bounds.minX, arcBounds.minX);
    this.bounds.maxX = Math.max(this.bounds.maxX, arcBounds.maxX);
    this.bounds.minY = Math.min(this.bounds.minY, arcBounds.minY);
    this.bounds.maxY = Math.max(this.bounds.maxY, arcBounds.maxY);

    this.stats.arcMoves++;
  }

  /**
   * Extract coordinate values from G-Code line
   * @param {string} line - G-Code line
   * @returns {Object} Extracted coordinates {x?, y?, z?}
   * @private
   */
  _extractCoordinates(line) {
    const coordinates = {};
    let match;

    // Reset regex
    GCodeParser.REGEX.COORDINATE.lastIndex = 0;

    while ((match = GCodeParser.REGEX.COORDINATE.exec(line)) !== null) {
      const axis = match[1].toLowerCase();
      const value = ValidationUtils.sanitizeCoordinate(match[2]);
      
      if (ValidationUtils.isValidCoordinate(value)) {
        coordinates[axis] = PrecisionUtils.round(value, this.options.precision);
      }
    }

    return coordinates;
  }

  /**
   * Extract arc center parameters (I, J) from G-Code line
   * @param {string} line - G-Code line
   * @returns {Object} Arc center parameters {i?, j?}
   * @private
   */
  _extractArcCenter(line) {
    const arcCenter = {};
    let match;

    // Reset regex
    GCodeParser.REGEX.ARC_CENTER.lastIndex = 0;

    while ((match = GCodeParser.REGEX.ARC_CENTER.exec(line)) !== null) {
      const param = match[1].toLowerCase();
      const value = ValidationUtils.sanitizeCoordinate(match[2]);
      
      if (ValidationUtils.isValidCoordinate(value)) {
        arcCenter[param] = PrecisionUtils.round(value, this.options.precision);
      }
    }

    return arcCenter;
  }

  /**
   * Add error to error list
   * @param {Error} error - Error object
   * @param {number} lineNumber - Line number where error occurred
   * @private
   */
  _handleError(error, lineNumber) {
    this.errors.push({
      line: lineNumber,
      message: error.message,
      type: 'error'
    });
    this.stats.errors++;
  }

  /**
   * Add warning to warning list
   * @param {string} message - Warning message
   * @param {number} lineNumber - Line number where warning occurred
   * @private
   */
  _addWarning(message, lineNumber) {
    this.warnings.push({
      line: lineNumber,
      message: message,
      type: 'warning'
    });
  }

  /**
   * Validate parsing result
   * @private
   */
  _validateResult() {
    // Check if any valid path data was found
    if (this.path.length === 0) {
      this._addWarning('No valid G-Code commands found in input', 0);
    }

    // Check bounds validity
    if (!BoundsUtils.isValidBounds(this.bounds)) {
      this._addWarning('No valid coordinate bounds found', 0);
      this.bounds = BoundsUtils.createEmptyBounds();
    }
  }

  /**
   * Get parser statistics
   * @returns {Object} Parser statistics
   */
  getStats() {
    return { ...this.stats };
  }

  /**
   * Get parsing errors
   * @returns {Array} Array of error objects
   */
  getErrors() {
    return [...this.errors];
  }

  /**
   * Get parsing warnings
   * @returns {Array} Array of warning objects
   */
  getWarnings() {
    return [...this.warnings];
  }

  /**
   * Check if parsing had errors
   * @returns {boolean} True if errors occurred
   */
  hasErrors() {
    return this.errors.length > 0;
  }

  /**
   * Check if parsing had warnings
   * @returns {boolean} True if warnings occurred
   */
  hasWarnings() {
    return this.warnings.length > 0;
  }
}

/**
 * Convenience function for quick G-Code parsing
 * @param {string} gcodeText - G-Code text to parse
 * @param {Object} options - Parser options
 * @returns {Object} Parse result
 */
export function parseGCode(gcodeText, options = {}) {
  const parser = new GCodeParser(options);
  return parser.parse(gcodeText);
}

// Export parser class as default
export default GCodeParser;