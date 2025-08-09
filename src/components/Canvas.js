/**
 * Canvas Rendering Engine for Wire EDM G-Code Viewer
 * Handles all canvas drawing operations including grid, G-code paths, and measurement points
 */

import { CANVAS, GRID, PATH_STYLES, MARKERS, COORDINATES } from '../utils/Constants.js';
import { Viewport } from '../core/Viewport.js';
import { GridUtils, ValidationUtils, PrecisionUtils, CoordinateTransform } from '../utils/MathUtils.js';

/**
 * Canvas rendering component for G-code visualization
 * Extracted from original HTML canvas rendering logic
 */
export class Canvas {
  /**
   * Create Canvas instance
   * @param {HTMLCanvasElement} canvasElement - Canvas DOM element
   * @param {Object} options - Configuration options
   */
  constructor(canvasElement, options = {}) {
    // Validate required parameters
    if (!canvasElement || !(canvasElement instanceof HTMLCanvasElement)) {
      throw new Error('Canvas constructor requires a valid HTMLCanvasElement');
    }

    this.canvas = canvasElement;
    this.ctx = canvasElement.getContext('2d');
    this.options = { ...this._getDefaultOptions(), ...options };

    // Initialize viewport
    this.viewport = new Viewport(this.canvas);

    // State management
    this.isInitialized = false;
    this.isDestroyed = false;
    this.renderRequestId = null;

    // High-DPI support properties (Phase 2A addition)
    this.devicePixelRatio = 1;
    this.enableHighDPI = this.options.enableHighDPI;
    this.physicalWidth = 0;   // Actual canvas buffer size
    this.physicalHeight = 0;  // Actual canvas buffer size  
    this.logicalWidth = 0;    // Logical coordinate space size
    this.logicalHeight = 0;   // Logical coordinate space size

    // Data to render
    this.gcodePath = [];
    this.clickedPoints = [];
    this.hoverHighlight = null; // {type: 'point'|'segment', index, color}
    this.persistentHighlights = new Set(); // store indices of selected points/segments
    this.gridEnabled = this.options.showGrid;
    this.gridSize = this.options.gridSize;

    // Bind methods
    this._bindMethods();
  }

  /**
   * Get default configuration options
   * @returns {Object} Default options
   */
  _getDefaultOptions() {
    return {
      showGrid: true,
      gridSize: GRID.SIZE,
      enableHighDPI: false, // Disabled by default for safe testing (Phase 2A)
      autoResize: true,
      throttleRedraw: true
    };
  }

  /**
   * Bind methods to maintain context
   */
  _bindMethods() {
    this.redraw = this.redraw.bind(this);
    this._handleResize = this._handleResize.bind(this);
  }

  /**
   * Initialize canvas and setup event listeners
   */
  async init() {
    if (this.isInitialized) {
      console.warn('Canvas already initialized');
      return;
    }

    try {
      // Setup canvas
      this._setupCanvas();
      
      // Setup event listeners
      this._setupEventListeners();
      
      // Initial render
      this.redraw();
      
      this.isInitialized = true;
    } catch (error) {
      throw new Error(`Failed to initialize Canvas: ${error.message}`);
    }
  }

  /**
   * Setup canvas properties
   */
  _setupCanvas() {
    // Set cursor
    this.canvas.style.cursor = CANVAS.CURSOR_DEFAULT;

    // Initial resize
    this._resizeCanvas();
  }

  // High-DPI setup temporarily removed for debugging

  /**
   * Setup event listeners
   */
  _setupEventListeners() {
    if (this.options.autoResize) {
      window.addEventListener('resize', this._handleResize);
    }
  }

  /**
   * Handle window resize events
   */
  _handleResize() {
    this._resizeCanvas();
    this.redraw();
  }

  /**
   * Resize canvas to fit container (Phase 2A - High-DPI aware)
   */
  _resizeCanvas() {
    const container = this.canvas.parentElement;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    
    // Logical dimensions (coordinate space - always same as container)
    // Round to integers to prevent canvas buffer mismatch
    this.logicalWidth = Math.round(rect.width);
    this.logicalHeight = Math.round(rect.height);
    
    if (this.enableHighDPI) {
      // High-DPI mode: Separate physical buffer from logical coordinates
      this.devicePixelRatio = window.devicePixelRatio || 1;
      
      // Physical canvas buffer (scaled for device pixels)
      // Round to integers to prevent canvas buffer mismatch
      this.physicalWidth = Math.round(this.logicalWidth * this.devicePixelRatio);
      this.physicalHeight = Math.round(this.logicalHeight * this.devicePixelRatio);
      
      // Set internal canvas size to physical pixels
      this.canvas.width = this.physicalWidth;
      this.canvas.height = this.physicalHeight;
      
      // Set CSS size to logical pixels (actual display size)
      this.canvas.style.width = this.logicalWidth + 'px';
      this.canvas.style.height = this.logicalHeight + 'px';
      
      console.log(`High-DPI: Logical(${this.logicalWidth}x${this.logicalHeight}) Physical(${this.physicalWidth}x${this.physicalHeight}) DPR(${this.devicePixelRatio})`);
    } else {
      // Standard mode (current working approach) 
      this.devicePixelRatio = 1;
      this.physicalWidth = this.logicalWidth;
      this.physicalHeight = this.logicalHeight;
      this.canvas.width = this.logicalWidth;
      this.canvas.height = this.logicalHeight;
      // CSS size is set automatically to match canvas dimensions
    }
    
    // Always use logical dimensions for compatibility (displayWidth/Height)
    this.displayWidth = this.logicalWidth;
    this.displayHeight = this.logicalHeight;

    // Configure canvas quality
    this._configureCanvasQuality();

    // CRITICAL: Set viewport dimensions to match canvas transformation
    // This ensures coordinate conversion uses the SAME height as canvas transformation
    this.viewport.displayWidth = this.logicalWidth;
    this.viewport.displayHeight = this.logicalHeight;
    
    // Update viewport state after setting correct dimensions
    this.viewport.onCanvasResize();
    
    // Validate dimension consistency
    this._validateDimensionConsistency();
  }

  /**
   * Configure canvas for basic rendering quality (Phase 2A - DPI aware)
   */
  _configureCanvasQuality() {
    // Reset context transform first
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    
    // Apply device pixel ratio scaling if in high-DPI mode
    if (this.enableHighDPI && this.devicePixelRatio > 1) {
      this.ctx.scale(this.devicePixelRatio, this.devicePixelRatio);
    }
    
    // Basic quality settings
    this.ctx.imageSmoothingEnabled = true;
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';
  }

  /**
   * Set G-code path data for rendering
   * @param {Array} pathData - Array of path segments
   */
  setGCodePath(pathData) {
    if (!Array.isArray(pathData)) {
      throw new Error('Path data must be an array');
    }

    this.gcodePath = pathData;
    this.redraw();
  }

  /**
   * Set clicked measurement points for rendering
   * @param {Array} points - Array of clicked points
   */
  setClickedPoints(points) {
    if (!Array.isArray(points)) {
      throw new Error('Points data must be an array');
    }

    this.clickedPoints = points;
    this.redraw();
  }

  /**
   * Toggle grid visibility
   * @param {boolean} enabled - Whether to show grid
   */
  setGridEnabled(enabled) {
    this.gridEnabled = !!enabled;
    this.redraw();
  }

  /**
   * Set grid size
   * @param {number} size - Grid size in world units
   */
  setGridSize(size) {
    if (!ValidationUtils.isValidCoordinate(size) || size <= 0) {
      throw new Error('Grid size must be a positive number');
    }

    this.gridSize = size;
    if (this.gridEnabled) {
      this.redraw();
    }
  }

  /**
   * Main redraw method - renders all canvas content
   */
  redraw() {
    if (this.isDestroyed) return;

    // Throttle redraws if enabled
    if (this.options.throttleRedraw) {
      if (this.renderRequestId) {
        return; // Already scheduled
      }
      
      this.renderRequestId = requestAnimationFrame(() => {
        this._performRender();
        this.renderRequestId = null;
      });
    } else {
      this._performRender();
    }
  }

  /**
   * Perform the actual rendering
   */
  _performRender() {
    try {
      // Clear canvas
      this._clearCanvas();

      // Save context state
      this.ctx.save();

      // Apply simple viewport transformation (no complex scaling for now)
      this._applySimpleTransform();

      // Render components in order
      if (this.gridEnabled) {
        this._renderGrid();
      }

      if (this.gcodePath.length > 0) {
        this._renderGCodePath();
        this._renderStartEndPoints();
      }

      if (this.clickedPoints.length > 0) {
        this._renderClickedPoints();
      }

      // Restore context state
      this.ctx.restore();

    } catch (error) {
      console.error('Error during canvas render:', error);
    }
  }

  /**
   * Apply viewport transformation (Phase 2A - DPI aware)
   */
  _applySimpleTransform() {
    const viewport = this.viewport.getState();
    
    // Reset transform first
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    
    // Re-apply DPI scaling if in high-DPI mode (context was reset)
    if (this.enableHighDPI && this.devicePixelRatio > 1) {
      this.ctx.scale(this.devicePixelRatio, this.devicePixelRatio);
    }
    
    // Apply viewport transformation using viewport display height (consistent with coordinate conversion)
    // This must match the height reference used in coordinate conversion
    this.ctx.translate(viewport.offsetX, this.viewport.displayHeight - viewport.offsetY);
    this.ctx.scale(viewport.zoom, -viewport.zoom); // Flip Y axis for CNC coordinates
  }

  /**
   * Apply text-safe viewport transformation (without Y-axis flip)
   */
  _applyTextTransform() {
    const viewport = this.viewport.getState();
    
    // Reset transform first
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    
    // Re-apply DPI scaling if in high-DPI mode (context was reset)
    if (this.enableHighDPI && this.devicePixelRatio > 1) {
      this.ctx.scale(this.devicePixelRatio, this.devicePixelRatio);
    }
    
    // Apply viewport transformation without Y-axis flip for text
    this.ctx.translate(viewport.offsetX, viewport.offsetY);
    this.ctx.scale(viewport.zoom, viewport.zoom); // No Y-axis flip for text
  }

  /**
   * Clear the entire canvas (Phase 2A - DPI aware)
   */
  _clearCanvas() {
    // Clear entire physical canvas buffer
    // Note: clearRect is not affected by current transform, so we use physical dimensions
    this.ctx.clearRect(0, 0, this.physicalWidth, this.physicalHeight);
  }

  /**
   * Render grid lines and labels (simplified for cleaner look)
   */
  _renderGrid() {
    const viewport = this.viewport.getState();
    
    // Calculate visible grid lines
    const gridLines = GridUtils.calculateGridLines(
      viewport.zoom,
      viewport.offsetX,
      viewport.offsetY,
      this.displayWidth,
      this.displayHeight,
      this.gridSize
    );

    // Only draw minor grid lines if zoomed in enough
    if (viewport.zoom > 0.5) {
      this._drawGridLines(gridLines, false);
    }

    // Always draw major grid lines (axes)
    this._drawGridLines(gridLines, true);

    // Draw grid labels only if zoomed in enough
    if (viewport.zoom > 0.3) {
      this._drawGridLabels(gridLines);
    }
  }

  /**
   * Draw grid lines
   * @param {Object} gridLines - Grid line coordinates
   * @param {boolean} major - Whether to draw major lines (axes)
   */
  _drawGridLines(gridLines, major = false) {
    const { vertical, horizontal } = gridLines;

    // Set line style - simplified without complex scaling
    if (major) {
      this.ctx.strokeStyle = GRID.COLORS.MAJOR;
      this.ctx.lineWidth = GRID.LINE_WIDTH.MAJOR;
    } else {
      this.ctx.strokeStyle = GRID.COLORS.MINOR;
      this.ctx.lineWidth = GRID.LINE_WIDTH.MINOR;
    }

    this.ctx.setLineDash([]);

    // Draw vertical lines
    vertical.forEach(x => {
      if (!major || x === 0) { // Only draw axis for major lines
        if (major && x !== 0) return;
        
        this.ctx.beginPath();
        this.ctx.moveTo(x, -10000); // Large range to cover viewport
        this.ctx.lineTo(x, 10000);
        this.ctx.stroke();
      }
    });

    // Draw horizontal lines
    horizontal.forEach(y => {
      if (!major || y === 0) { // Only draw axis for major lines
        if (major && y !== 0) return;
        
        this.ctx.beginPath();
        this.ctx.moveTo(-10000, y);
        this.ctx.lineTo(10000, y);
        this.ctx.stroke();
      }
    });
  }

  /**
   * Draw grid labels (simplified to reduce crowding)
   * @param {Object} gridLines - Grid line coordinates
   */
  _drawGridLabels(gridLines) {
    const { vertical, horizontal } = gridLines;
    const majorInterval = GRID.MAJOR_LINES_INTERVAL;
    
    // Much larger interval for labels to reduce crowding
    const labelInterval = majorInterval * 4; // Show labels every 80 units instead of 20

    // Save current transform and apply text-safe transform
    this.ctx.save();
    this._applyTextTransform();

    this.ctx.fillStyle = GRID.COLORS.LABELS;
    // Smaller font size
    this.ctx.font = '9px Arial';
    this.ctx.textAlign = 'left';
    this.ctx.textBaseline = 'top';

    // Convert coordinates for text rendering (compensate for different coordinate system)
    const viewport = this.viewport.getState();

    // Draw X-axis labels (only at larger intervals)
    vertical.forEach(x => {
      if (x % labelInterval === 0 && x !== 0) {
        // Convert world coordinates to screen coordinates for text
        const screenCoords = this.viewport.worldToScreen(x, 0);
        this.ctx.fillText(
          PrecisionUtils.format(x, COORDINATES.PRECISION),
          screenCoords.x + 2,
          this.logicalHeight - 15 // Position at bottom of screen
        );
      }
    });

    // Draw Y-axis labels (only at larger intervals)
    horizontal.forEach(y => {
      if (y % labelInterval === 0 && y !== 0) {
        // Convert world coordinates to screen coordinates for text
        const screenCoords = this.viewport.worldToScreen(0, y);
        this.ctx.fillText(
          PrecisionUtils.format(y, COORDINATES.PRECISION),
          5,
          screenCoords.y - 2
        );
      }
    });

    // Restore transform
    this.ctx.restore();
  }

  /**
   * Render G-code path segments
   */
  _renderGCodePath() {
    if (this.gcodePath.length === 0) return;

    this.gcodePath.forEach((move, index) => {
      if (index === 0) return; // Skip first move (no previous point)

      const prevMove = this.gcodePath[index - 1];
      
      if (move.type === 'arc') {
        this._renderArcMove(move);
      } else {
        this._renderLinearMove(prevMove, move);
      }
      // Highlight hovered/selected endpoints
      const shouldHighlight = this.persistentHighlights.has(index) || (this.hoverHighlight && this.hoverHighlight.type === 'point' && this.hoverHighlight.index === index);
      if (shouldHighlight) {
        const hx = move.type === 'arc' ? move.endX : move.x;
        const hy = move.type === 'arc' ? move.endY : move.y;
        if (hx !== undefined && hy !== undefined) {
          this._renderMarker({ x: hx, y: hy }, { ...MARKERS.CLICKED_POINT, COLOR: '#ffa500', RADIUS: 2, FONT: 'bold 6px Arial', LABEL: `L${move.line || index}` });
        }
      }
    });
  }

  /**
   * Render linear move (G0/G1)
   * @param {Object} from - Starting point
   * @param {Object} to - Ending point
   */
  _renderLinearMove(from, to) {
    if (!ValidationUtils.isValidPoint(from) || !ValidationUtils.isValidPoint(to)) {
      return;
    }

    // Set style based on move type
    const style = to.type === 'rapid' ? PATH_STYLES.RAPID : PATH_STYLES.CUT;
    
    this.ctx.strokeStyle = style.COLOR;
    // Use fixed line width for now - no complex scaling
    this.ctx.lineWidth = style.LINE_WIDTH;
    
    // Use fixed dash pattern
    this.ctx.setLineDash(style.LINE_DASH);

    // Draw line
    this.ctx.beginPath();
    this.ctx.moveTo(from.x, from.y);
    this.ctx.lineTo(to.x, to.y);
    this.ctx.stroke();
  }

  /**
   * Render arc move (G2/G3)
   * @param {Object} move - Arc move data
   */
  _renderArcMove(move) {
    if (!this._isValidArcMove(move)) {
      return;
    }

    // Set arc style
    this.ctx.strokeStyle = PATH_STYLES.ARC.COLOR;
    // Use fixed line width for now
    this.ctx.lineWidth = PATH_STYLES.ARC.LINE_WIDTH;
    this.ctx.setLineDash([]);

    // Calculate arc parameters
    const radius = Math.sqrt(
      Math.pow(move.startX - move.centerX, 2) + 
      Math.pow(move.startY - move.centerY, 2)
    );

    const startAngle = Math.atan2(
      move.startY - move.centerY,
      move.startX - move.centerX
    );

    const endAngle = Math.atan2(
      move.endY - move.centerY,
      move.endX - move.centerX
    );

    // Draw arc (note: Y-axis flip handled by viewport transform)
    this.ctx.beginPath();
    this.ctx.arc(
      move.centerX,
      move.centerY,
      radius,
      startAngle,
      endAngle,
      !move.clockwise // Canvas arc direction is inverted from G-code
    );
    this.ctx.stroke();
  }

  /**
   * Validate arc move data
   * @param {Object} move - Arc move to validate
   * @returns {boolean} Whether arc move is valid
   */
  _isValidArcMove(move) {
    return move &&
           ValidationUtils.isValidCoordinate(move.startX) &&
           ValidationUtils.isValidCoordinate(move.startY) &&
           ValidationUtils.isValidCoordinate(move.endX) &&
           ValidationUtils.isValidCoordinate(move.endY) &&
           ValidationUtils.isValidCoordinate(move.centerX) &&
           ValidationUtils.isValidCoordinate(move.centerY);
  }

  /**
   * Render start and end point markers
   */
  _renderStartEndPoints() {
    if (this.gcodePath.length === 0) return;

    // Draw start point
    const startPoint = this.gcodePath[0];
    if (ValidationUtils.isValidPoint(startPoint)) {
      this._renderMarker(startPoint, MARKERS.START_POINT);
    }

    // Draw end point
    if (this.gcodePath.length > 1) {
      const endPoint = this.gcodePath[this.gcodePath.length - 1];
      if (ValidationUtils.isValidPoint(endPoint)) {
        this._renderMarker(endPoint, MARKERS.END_POINT);
      }
    }
  }

  /**
   * Render clicked measurement points
   */
  _renderClickedPoints() {
    this.clickedPoints.forEach((point, index) => {
      if (ValidationUtils.isValidPoint(point)) {
        const config = {
          ...MARKERS.CLICKED_POINT,
          LABEL: `P${index + 1}`
        };
        this._renderMarker(point, config);
      }
    });
  }

  /**
   * Render a point marker with label
   * @param {Object} point - Point coordinates {x, y}
   * @param {Object} config - Marker configuration
   */
  _renderMarker(point, config) {
    // Use fixed sizes for now - no complex scaling
    const scaledRadius = config.RADIUS;
    const scaledOffsetX = config.OFFSET.X;
    const scaledOffsetY = config.OFFSET.Y;

    // Draw circle (this uses the flipped coordinate system)
    this.ctx.fillStyle = config.COLOR;
    this.ctx.beginPath();
    this.ctx.arc(point.x, point.y, scaledRadius, 0, Math.PI * 2);
    this.ctx.fill();

    // Draw label with text-safe transform to prevent mirroring
    this.ctx.save();
    this._applyTextTransform();
    
    // Convert world coordinates to screen coordinates for text
    const screenCoords = this.viewport.worldToScreen(point.x, point.y);
    
    this.ctx.fillStyle = config.COLOR;
    this.ctx.font = config.FONT;
    this.ctx.textAlign = 'left';
    this.ctx.textBaseline = 'top';
    this.ctx.fillText(
      config.LABEL,
      screenCoords.x + scaledOffsetX,
      screenCoords.y + scaledOffsetY
    );
    
    this.ctx.restore();
  }

  /**
   * Fit canvas view to show all G-code content
   */
  fitToContent() {
    if (this.gcodePath.length === 0) {
      return;
    }

    // Calculate content bounds
    const bounds = this._calculateContentBounds();
    
    if (bounds) {
      this.viewport.fitToBounds(bounds);
      this.redraw();
    }
  }

  /**
   * Calculate bounds of all content
   * @returns {Object|null} Bounds {minX, maxX, minY, maxY} or null if no content
   */
  _calculateContentBounds() {
    if (this.gcodePath.length === 0) return null;

    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;

    // Include G-code path bounds
    this.gcodePath.forEach(point => {
      if (ValidationUtils.isValidPoint(point)) {
        minX = Math.min(minX, point.x);
        maxX = Math.max(maxX, point.x);
        minY = Math.min(minY, point.y);
        maxY = Math.max(maxY, point.y);
      }
    });

    // Include clicked points bounds
    this.clickedPoints.forEach(point => {
      if (ValidationUtils.isValidPoint(point)) {
        minX = Math.min(minX, point.x);
        maxX = Math.max(maxX, point.x);
        minY = Math.min(minY, point.y);
        maxY = Math.max(maxY, point.y);
      }
    });

    return isFinite(minX) ? { minX, maxX, minY, maxY } : null;
  }

  /**
   * Get current viewport state
   * @returns {Object} Viewport state
   */
  getViewportState() {
    return this.viewport.getState();
  }

  /**
   * Get viewport instance for external manipulation
   * @returns {Viewport} Viewport instance
   */
  getViewport() {
    return this.viewport;
  }

  /**
   * Clear all clicked points
   */
  clearClickedPoints() {
    this.clickedPoints = [];
    this.redraw();
  }

  /**
   * Add a clicked point
   * @param {Object} point - Point coordinates {x, y}
   */
  addClickedPoint(point) {
    if (!ValidationUtils.isValidPoint(point)) {
      throw new Error('Invalid point coordinates');
    }

    this.clickedPoints.push({ ...point });
    this.redraw();
  }

  /**
   * Set hovered gcode point index to highlight
   * @param {number|null} index - index in gcodePath to highlight (endpoint of move)
   */
  setHoverHighlight(index) {
    if (typeof index === 'number') {
      this.hoverHighlight = { type: 'point', index };
    } else {
      this.hoverHighlight = null;
    }
    this.redraw();
  }

  /**
   * Toggle persistent highlight for a gcode point index
   * @param {number} index
   */
  togglePersistentHighlight(index) {
    if (this.persistentHighlights.has(index)) {
      this.persistentHighlights.delete(index);
    } else {
      this.persistentHighlights.add(index);
    }
    this.redraw();
  }

  /**
   * Toggle high-DPI support on/off (Phase 2B)
   * @param {boolean} enabled - Whether to enable high-DPI
   */
  setHighDPIEnabled(enabled) {
    if (this.enableHighDPI !== enabled) {
      this.enableHighDPI = enabled;
      console.log(`High-DPI ${enabled ? 'enabled' : 'disabled'}`);
      
      // Reconfigure canvas with new setting
      this._resizeCanvas();
      this.redraw();
    }
  }

  /**
   * Get current high-DPI status
   * @returns {Object} High-DPI status information
   */
  getHighDPIStatus() {
    return {
      enabled: this.enableHighDPI,
      devicePixelRatio: this.devicePixelRatio,
      logicalSize: { width: this.logicalWidth, height: this.logicalHeight },
      physicalSize: { width: this.physicalWidth, height: this.physicalHeight }
    };
  }

  /**
   * Validate dimension consistency between canvas and viewport
   * Critical for coordinate accuracy
   */
  _validateDimensionConsistency() {
    const issues = [];
    
    // Check if viewport dimensions match canvas transformation dimensions
    if (this.viewport.displayWidth !== this.logicalWidth) {
      issues.push(`Width mismatch: viewport.displayWidth=${this.viewport.displayWidth}, canvas.logicalWidth=${this.logicalWidth}`);
    }
    
    if (this.viewport.displayHeight !== this.logicalHeight) {
      issues.push(`Height mismatch: viewport.displayHeight=${this.viewport.displayHeight}, canvas.logicalHeight=${this.logicalHeight}`);
    }
    
    // Check if canvas dimensions are consistent based on mode
    if (this.enableHighDPI) {
      // High-DPI mode: canvas buffer should match physical dimensions
      if (this.canvas.width !== this.physicalWidth || this.canvas.height !== this.physicalHeight) {
        issues.push(`Canvas buffer mismatch (High-DPI): canvas=${this.canvas.width}x${this.canvas.height}, physical=${this.physicalWidth}x${this.physicalHeight}`);
      }
    } else {
      // Standard mode: canvas buffer should match logical dimensions
      if (this.canvas.width !== this.logicalWidth || this.canvas.height !== this.logicalHeight) {
        issues.push(`Canvas buffer mismatch (Standard): canvas=${this.canvas.width}x${this.canvas.height}, logical=${this.logicalWidth}x${this.logicalHeight}`);
      }
    }
    
    if (issues.length > 0) {
      console.error('Canvas dimension consistency issues detected:');
      issues.forEach(issue => console.error('- ' + issue));
      console.error('This will cause coordinate accuracy problems!');
      
      // Add runtime validation for the specific height mismatch that causes coordinate offset
      if (this.viewport.displayHeight !== this.logicalHeight) {
        console.error('❌ CRITICAL: Height mismatch detected! This causes ~4mm coordinate offset after G-code loading.');
        console.error('Canvas transformation uses this.logicalHeight:', this.logicalHeight);
        console.error('Coordinate conversion uses viewport.displayHeight:', this.viewport.displayHeight);
        console.error('These MUST match for accurate coordinates!');
      }
    }
  }


  /**
   * Destroy canvas and cleanup resources
   */
  destroy() {
    if (this.isDestroyed) return;

    // Cancel any pending render
    if (this.renderRequestId) {
      cancelAnimationFrame(this.renderRequestId);
      this.renderRequestId = null;
    }

    // Remove event listeners
    if (this.options.autoResize) {
      window.removeEventListener('resize', this._handleResize);
    }

    // Clear data
    this.gcodePath = [];
    this.clickedPoints = [];

    // Mark as destroyed
    this.isDestroyed = true;
  }
}