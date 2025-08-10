/**
 * Viewport Management for Wire EDM G-Code Viewer
 * Handles zoom, pan, coordinate transformations, and viewport state
 */

import { VIEWPORT, CANVAS, COORDINATES } from '../utils/Constants.js';
import { CoordinateTransform, GridUtils } from '../utils/MathUtils.js';

/**
 * Viewport class manages the viewing area state and transformations
 * Extracted from original HTML viewport logic
 */
export class Viewport {
  /**
   * @param {HTMLCanvasElement} canvas - Canvas element
   */
  constructor(canvas) {
    this.canvas = canvas;
    // DO NOT call _updateDisplayDimensions() here - Canvas.js will set the dimensions
    // Initialize with default values, Canvas.js will override them
    this.displayWidth = 800;
    this.displayHeight = 600;
    // Grid snapping state
    this.gridSnapEnabled = false;
    this.gridSnapSize = 1;
    // Dynamic zoom limits (initialized to global fallbacks)
    this.minZoom = VIEWPORT.MIN_ZOOM;
    this.maxZoom = VIEWPORT.MAX_ZOOM;
    this.reset();
  }

  /**
   * Update display dimensions from canvas (single source of truth)
   */
  _updateDisplayDimensions() {
    // Always prefer clientWidth/Height over canvas.width/height for display dimensions
    // clientWidth/Height represents the actual CSS display size (logical pixels)
    // This is important for high-DPI displays where canvas.width/height may be scaled
    this.displayWidth = this.canvas.clientWidth || this.canvas.width;
    this.displayHeight = this.canvas.clientHeight || this.canvas.height;
    
    // Validation to prevent zero dimensions
    if (this.displayWidth <= 0 || this.displayHeight <= 0) {
      console.warn('Viewport: Invalid canvas dimensions detected, using fallback values');
      this.displayWidth = this.displayWidth || 800;
      this.displayHeight = this.displayHeight || 600;
    }
  }

  /**
   * Reset viewport to default state
   */
  reset() {
    this.zoom = VIEWPORT.DEFAULT_ZOOM;
    // Update display dimensions from canvas
    this._updateDisplayDimensions();
    
    this.offsetX = this.displayWidth / 2;
    this.offsetY = this.displayHeight / 2;
    this.isDragging = false;
    this.dragStartX = 0;
    this.dragStartY = 0;
    // Reset dynamic zoom limits to global fallbacks
    this.minZoom = VIEWPORT.MIN_ZOOM;
    this.maxZoom = VIEWPORT.MAX_ZOOM;
  }

  /**
   * Get current viewport state
   * @returns {Object} Current viewport state
   */
  getState() {
    return {
      zoom: this.zoom,
      offsetX: this.offsetX,
      offsetY: this.offsetY,
      isDragging: this.isDragging,
      bounds: this.getBounds()
    };
  }

  /**
   * Set viewport state
   * @param {Object} state - New viewport state
   */
  setState(state) {
    if (state.zoom !== undefined) this.zoom = this.clampZoom(state.zoom);
    if (state.offsetX !== undefined) this.offsetX = state.offsetX;
    if (state.offsetY !== undefined) this.offsetY = state.offsetY;
    if (state.isDragging !== undefined) this.isDragging = state.isDragging;
  }

  /**
   * Get current viewport bounds in world coordinates
   * @returns {Object} Bounds {minX, maxX, minY, maxY}
   */
  getBounds() {
    // Use current dimensions (already set by Canvas.js)
    const topLeft = this.screenToWorld(0, 0);
    const bottomRight = this.screenToWorld(this.displayWidth, this.displayHeight);
    
    return {
      minX: topLeft.x,
      maxX: bottomRight.x,
      minY: bottomRight.y, // Note: Y is flipped
      maxY: topLeft.y
    };
  }

  /**
   * Clamp zoom to valid range
   * @param {number} zoom - Zoom value to clamp
   * @returns {number} Clamped zoom value
   */
  clampZoom(zoom) {
    // Use dynamic per-instance range if available
    const minZ = this.minZoom ?? VIEWPORT.MIN_ZOOM;
    const maxZ = this.maxZoom ?? VIEWPORT.MAX_ZOOM;
    return Math.max(minZ, Math.min(maxZ, zoom));
  }

  /**
   * Convert screen coordinates to world coordinates
   * @param {number} screenX - Screen X coordinate
   * @param {number} screenY - Screen Y coordinate
   * @returns {Object} World coordinates {x, y}
   */
  screenToWorld(screenX, screenY) {
    // Use standardized display height
    return CoordinateTransform.screenToWorld(
      screenX, screenY, this.zoom, this.offsetX, this.offsetY, this.displayHeight
    );
  }

  /**
   * Convert world coordinates to screen coordinates
   * @param {number} worldX - World X coordinate
   * @param {number} worldY - World Y coordinate
   * @returns {Object} Screen coordinates {x, y}
   */
  worldToScreen(worldX, worldY) {
    // Use standardized display height
    return CoordinateTransform.worldToScreen(
      worldX, worldY, this.zoom, this.offsetX, this.offsetY, this.displayHeight
    );
  }

  /**
   * Apply viewport transformation to canvas context
   * @param {CanvasRenderingContext2D} ctx - Canvas context
   */
  applyTransform(ctx) {
    // Use standardized display height
    CoordinateTransform.applyTransform(
      ctx, this.zoom, this.offsetX, this.offsetY, this.displayHeight
    );
  }

  /**
   * Get mouse coordinates from mouse event
   * @param {MouseEvent} event - Mouse event
   * @param {boolean} snapToGrid - Whether to snap to grid
   * @param {number} gridSize - Grid size for snapping
   * @returns {Object} Mouse coordinates {screen: {x, y}, world: {x, y}}
   */
  getMouseCoordinates(event, snapToGrid = false, gridSize = 1) {
    // DO NOT call _updateDisplayDimensions() here as it can overwrite 
    // the dimensions set by Canvas.js, causing coordinate mismatches
    
    const rect = this.canvas.getBoundingClientRect();
    let screenX = event.clientX - rect.left;
    let screenY = event.clientY - rect.top;
    
    // CRITICAL: Scale mouse coordinates to match canvas buffer coordinate system
    // This handles cases where canvas buffer size differs from CSS size (High-DPI, mobile scaling)
    if (this.canvas.width !== rect.width || this.canvas.height !== rect.height) {
      const scaleX = this.canvas.width / rect.width;
      const scaleY = this.canvas.height / rect.height;
      screenX = screenX * scaleX;
      screenY = screenY * scaleY;
    }
    
    let worldCoords = this.screenToWorld(screenX, screenY);
    
    // Validate coordinates
    if (!this.isValidCoordinate(worldCoords.x) || !this.isValidCoordinate(worldCoords.y)) {
      return null;
    }
    
    // Apply grid snapping if enabled (argument overrides internal state)
    const applySnap = snapToGrid || this.gridSnapEnabled;
    const effectiveGridSize = gridSize || this.gridSnapSize || 1;
    if (applySnap) {
      worldCoords = GridUtils.snapPointToGrid(worldCoords.x, worldCoords.y, effectiveGridSize);
    }
    
    return {
      screen: { x: screenX, y: screenY },
      world: worldCoords
    };
  }

  /**
   * Enable/disable grid snapping and optionally set grid size
   * @param {boolean} enabled - Whether snapping is enabled
   * @param {number} gridSize - Grid size to use when snapping
   */
  setGridSnap(enabled, gridSize = null) {
    this.gridSnapEnabled = !!enabled;
    if (typeof gridSize === 'number' && isFinite(gridSize) && gridSize > 0) {
      this.gridSnapSize = gridSize;
    }
  }

  /**
   * Check if coordinate is valid (not NaN or infinite)
   * @param {number} coord - Coordinate to validate
   * @returns {boolean} Whether coordinate is valid
   */
  isValidCoordinate(coord) {
    return !isNaN(coord) && isFinite(coord);
  }

  /**
   * Debug coordinate conversion accuracy
   * @param {MouseEvent} event - Mouse event to test
   * @returns {Object} Debug information about coordinate conversion
   */
  debugCoordinateConversion(event) {
    const rect = this.canvas.getBoundingClientRect();
    const screenX = event.clientX - rect.left;
    const screenY = event.clientY - rect.top;
    
    // Forward conversion: screen to world
    const worldCoords = this.screenToWorld(screenX, screenY);
    
    // Reverse conversion: world back to screen
    const backToScreen = this.worldToScreen(worldCoords.x, worldCoords.y);
    
    // Calculate accuracy
    const xError = Math.abs(screenX - backToScreen.x);
    const yError = Math.abs(screenY - backToScreen.y);
    
    // Enhanced validation checks
    const dimensionConsistency = this.displayWidth === this.canvas.clientWidth && 
                                this.displayHeight === this.canvas.clientHeight;
    
    const coordinateSystemInfo = {
      usingDisplayHeight: this.displayHeight,
      canvasClientHeight: this.canvas.clientHeight,
      canvasHeight: this.canvas.height,
      heightConsistency: this.displayHeight === this.canvas.clientHeight,
      transformParameters: {
        zoom: this.zoom,
        offsetX: this.offsetX,
        offsetY: this.offsetY
      }
    };
    
    // Enhanced validation for coordinate system consistency
    const coordinateSystemValidation = this.validateCoordinateSystem();
    const mouseCoordinateScaling = {
      scaleX: this.canvas.width / rect.width,
      scaleY: this.canvas.height / rect.height,
      isScaled: this.canvas.width !== rect.width || this.canvas.height !== rect.height
    };

    return {
      originalScreen: { x: screenX, y: screenY },
      worldCoords: worldCoords,
      backToScreen: backToScreen,
      coordinateError: { x: xError, y: yError },
      accuracy: xError < 0.1 && yError < 0.1 ? 'GOOD' : 'POOR',
      dimensionConsistency: dimensionConsistency,
      coordinateSystemInfo: coordinateSystemInfo,
      coordinateSystemValidation: coordinateSystemValidation,
      mouseCoordinateScaling: mouseCoordinateScaling,
      dimensions: {
        displayWidth: this.displayWidth,
        displayHeight: this.displayHeight,
        canvasWidth: this.canvas.width,
        canvasHeight: this.canvas.height,
        clientWidth: this.canvas.clientWidth,
        clientHeight: this.canvas.clientHeight,
        cssWidth: rect.width,
        cssHeight: rect.height
      },
      validation: {
        heightSync: this.displayHeight === this.canvas.height,
        widthSync: this.displayWidth === this.canvas.width,
        canvasToDisplaySync: this.displayHeight === this.canvas.height && this.displayWidth === this.canvas.width ? 'SYNCED' : 'MISMATCHED',
        canvasToCssSync: this.canvas.width === rect.width && this.canvas.height === rect.height ? 'SYNCED' : 'SCALED'
      }
    };
  }

  /**
   * Validate coordinate system consistency
   * @returns {Object} Validation results
   */
  validateCoordinateSystem() {
    const issues = [];
    const warnings = [];
    
    // Check dimension consistency
    if (this.displayHeight !== this.canvas.clientHeight) {
      issues.push(`Height mismatch: displayHeight=${this.displayHeight}, clientHeight=${this.canvas.clientHeight}`);
    }
    
    if (this.displayWidth !== this.canvas.clientWidth) {
      issues.push(`Width mismatch: displayWidth=${this.displayWidth}, clientWidth=${this.canvas.clientWidth}`);
    }
    
    // Check for zero dimensions
    if (this.displayWidth <= 0 || this.displayHeight <= 0) {
      issues.push(`Invalid dimensions: ${this.displayWidth}x${this.displayHeight}`);
    }
    
    // Check canvas buffer vs display size
    if (this.canvas.width !== this.canvas.clientWidth || this.canvas.height !== this.canvas.clientHeight) {
      warnings.push(`Canvas buffer size differs from display size - High-DPI or scaling detected`);
    }
    
    return {
      isValid: issues.length === 0,
      issues: issues,
      warnings: warnings,
      dimensions: {
        display: { width: this.displayWidth, height: this.displayHeight },
        client: { width: this.canvas.clientWidth, height: this.canvas.clientHeight },
        buffer: { width: this.canvas.width, height: this.canvas.height }
      }
    };
  }

  /**
   * Log coordinate system status for debugging
   * Useful for troubleshooting coordinate accuracy issues
   */
  logCoordinateSystemStatus() {
    const validation = this.validateCoordinateSystem();
    const canvasRect = this.canvas.getBoundingClientRect();
    
    console.group('🎯 Coordinate System Status');
    console.log('Validation Result:', validation.isValid ? '✅ VALID' : '❌ INVALID');
    
    if (validation.issues.length > 0) {
      console.warn('Issues found:');
      validation.issues.forEach(issue => console.warn('- ' + issue));
    }
    
    if (validation.warnings.length > 0) {
      console.info('Warnings:');
      validation.warnings.forEach(warning => console.info('- ' + warning));
    }
    
    console.table({
      'Display Dimensions': { width: this.displayWidth, height: this.displayHeight },
      'Canvas Buffer': { width: this.canvas.width, height: this.canvas.height },
      'Canvas CSS': { width: this.canvas.clientWidth, height: this.canvas.clientHeight },
      'Actual CSS': { width: canvasRect.width, height: canvasRect.height }
    });
    
    const scaleX = this.canvas.width / canvasRect.width;
    const scaleY = this.canvas.height / canvasRect.height;
    console.log('Mouse Coordinate Scaling:', { scaleX, scaleY, isScaled: scaleX !== 1 || scaleY !== 1 });
    console.log('Viewport State:', { zoom: this.zoom, offsetX: this.offsetX, offsetY: this.offsetY });
    
    console.groupEnd();
  }

  /**
   * Zoom in by the standard zoom step
   */
  zoomIn() {
    this.zoom = this.clampZoom(this.zoom * VIEWPORT.ZOOM_STEP);
  }

  /**
   * Zoom out by the standard zoom step
   */
  zoomOut() {
    this.zoom = this.clampZoom(this.zoom / VIEWPORT.ZOOM_STEP);
  }

  /**
   * Zoom to a specific level
   * @param {number} newZoom - New zoom level
   */
  setZoom(newZoom) {
    this.zoom = this.clampZoom(newZoom);
  }

  /**
   * Zoom at a specific point (mouse position)
   * @param {number} screenX - Screen X coordinate for zoom center
   * @param {number} screenY - Screen Y coordinate for zoom center
   * @param {number} delta - Zoom delta (positive = zoom in, negative = zoom out)
   */
  zoomAtPoint(screenX, screenY, delta) {
    // Get world coordinates before zoom
    const worldCoords = this.screenToWorld(screenX, screenY);
    
    // Apply zoom
    const zoomFactor = delta > 0 ? (1 + VIEWPORT.WHEEL_ZOOM_STEP) : (1 - VIEWPORT.WHEEL_ZOOM_STEP);
    this.zoom = this.clampZoom(this.zoom * zoomFactor);
    
    // Adjust offset to keep the same world point under the mouse
    this.offsetX = screenX - worldCoords.x * this.zoom;
    this.offsetY = screenY - worldCoords.y * this.zoom;
  }

  /**
   * Start dragging operation
   * @param {number} screenX - Screen X coordinate where drag started
   * @param {number} screenY - Screen Y coordinate where drag started
   */
  startDrag(screenX, screenY) {
    this.isDragging = true;
    this.dragStartX = screenX - this.offsetX;
    this.dragStartY = screenY - this.offsetY;
    this.canvas.style.cursor = CANVAS.CURSOR_DRAG;
  }

  /**
   * Update drag operation
   * @param {number} screenX - Current screen X coordinate
   * @param {number} screenY - Current screen Y coordinate
   */
  updateDrag(screenX, screenY) {
    if (!this.isDragging) return;
    
    this.offsetX = screenX - this.dragStartX;
    this.offsetY = screenY - this.dragStartY;
  }

  /**
   * End dragging operation
   */
  endDrag() {
    this.isDragging = false;
    this.canvas.style.cursor = CANVAS.CURSOR_DEFAULT;
  }

  /**
   * Fit viewport to show specific bounds
   * @param {Object} bounds - Bounds to fit {minX, maxX, minY, maxY}
   * @param {number} padding - Padding in pixels (default from VIEWPORT.FIT_PADDING)
   */
  fitToBounds(bounds, padding = VIEWPORT.FIT_PADDING) {
    const { minX, maxX, minY, maxY } = bounds;
    
    // Validate bounds
    if (!this.isValidCoordinate(minX) || !this.isValidCoordinate(maxX) ||
        !this.isValidCoordinate(minY) || !this.isValidCoordinate(maxY)) {
      console.error('Invalid bounds for fitToBounds:', bounds);
      return;
    }
    
    const width = maxX - minX;
    const height = maxY - minY;
    
    // Handle zero width/height
    if (width === 0 || height === 0) {
      this.zoom = VIEWPORT.DEFAULT_ZOOM;
      this.offsetX = this.displayWidth / 2;
      this.offsetY = this.displayHeight / 2;
      return;
    }
    
    // Calculate zoom to fit content with padding using current display dimensions
    const canvasWidth = this.displayWidth;
    const canvasHeight = this.displayHeight;
    
    const scaleX = (canvasWidth - 2 * padding) / width;
    const scaleY = (canvasHeight - 2 * padding) / height;
    const fitScale = Math.min(scaleX, scaleY);

    // Establish dynamic zoom limits around the fit scale
    const minFactor = VIEWPORT.DYNAMIC_RANGE?.MIN_FACTOR ?? 1 / 1000;
    const maxFactor = VIEWPORT.DYNAMIC_RANGE?.MAX_FACTOR ?? 1000;
    this.minZoom = Math.max(VIEWPORT.MIN_ZOOM, fitScale * minFactor);
    this.maxZoom = Math.min(VIEWPORT.MAX_ZOOM, fitScale * maxFactor);

    // Set zoom to fit within new limits
    this.zoom = this.clampZoom(fitScale);
    
    // Center the content
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    
    this.offsetX = canvasWidth / 2 - centerX * this.zoom;
    this.offsetY = canvasHeight / 2 + centerY * this.zoom; // Note: Y-axis flip
  }

  /**
   * Resize handler for canvas resize events
   * DO NOT override dimensions - Canvas.js has already set them correctly
   */
  onCanvasResize() {
    // Dimensions are already set by Canvas.js - do not override them
    // Only update default offsets if they haven't been manually set
    if (this.offsetX === 0) {
      this.offsetX = this.displayWidth / 2;
    }
    if (this.offsetY === 0) {
      this.offsetY = this.displayHeight / 2;
    }
  }

  /**
   * Get zoom percentage as string
   * @returns {string} Zoom percentage (e.g., "100%")
   */
  getZoomPercentage() {
    return Math.round(this.zoom * 100) + '%';
  }

  /**
   * Check if point is visible in current viewport
   * @param {number} worldX - World X coordinate
   * @param {number} worldY - World Y coordinate
   * @returns {boolean} Whether point is visible
   */
  isPointVisible(worldX, worldY) {
    const screenCoords = this.worldToScreen(worldX, worldY);
    // Use standardized display dimensions
    return screenCoords.x >= 0 && screenCoords.x <= this.displayWidth &&
           screenCoords.y >= 0 && screenCoords.y <= this.displayHeight;
  }

  /**
   * Pan viewport by screen pixel amounts
   * @param {number} deltaX - X offset in screen pixels
   * @param {number} deltaY - Y offset in screen pixels
   */
  pan(deltaX, deltaY) {
    this.offsetX += deltaX;
    this.offsetY += deltaY;
  }
}