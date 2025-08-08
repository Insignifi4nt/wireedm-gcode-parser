/**
 * Mouse Event Handler for Wire EDM G-Code Viewer
 * Handles mouse interactions with the canvas including clicks, drags, and wheel events
 */

import { EventBus, EVENT_TYPES, EventUtils } from './EventManager.js';
import { CANVAS } from '../utils/Constants.js';

/**
 * MouseEventHandler class manages all mouse interactions
 * Extracted from original HTML mouse event logic
 */
export class MouseEventHandler {
  /**
   * Create MouseEventHandler instance
   * @param {HTMLCanvasElement} canvas - Canvas element to handle events for
   * @param {Viewport} viewport - Viewport instance for coordinate transformations
   */
  constructor(canvas, viewport) {
    if (!canvas || !(canvas instanceof HTMLCanvasElement)) {
      throw new Error('Canvas element is required');
    }
    
    if (!viewport) {
      throw new Error('Viewport instance is required');
    }

    this.canvas = canvas;
    this.viewport = viewport;
    this.eventBus = EventBus.getInstance();
    
    // State tracking
    this.isDragging = false;
    this.dragStartX = 0;
    this.dragStartY = 0;
    this.lastWheelTime = 0;
    this.wheelThrottleDelay = 16; // ~60fps
    
    // Bind methods
    this._bindMethods();
    
    // Initialize
    this.isInitialized = false;
    this.isDestroyed = false;
  }

  /**
   * Bind methods to maintain context
   */
  _bindMethods() {
    this._handleMouseMove = this._handleMouseMove.bind(this);
    this._handleMouseDown = this._handleMouseDown.bind(this);
    this._handleMouseUp = this._handleMouseUp.bind(this);
    this._handleClick = this._handleClick.bind(this);
    this._handleWheel = this._handleWheel.bind(this);
    this._handleContextMenu = this._handleContextMenu.bind(this);
    this._handleMouseEnter = this._handleMouseEnter.bind(this);
    this._handleMouseLeave = this._handleMouseLeave.bind(this);
  }

  /**
   * Initialize mouse event handlers
   */
  init() {
    if (this.isInitialized) {
      console.warn('MouseEventHandler already initialized');
      return;
    }

    // Add event listeners
    this.canvas.addEventListener('mousemove', this._handleMouseMove);
    this.canvas.addEventListener('mousedown', this._handleMouseDown);
    this.canvas.addEventListener('mouseup', this._handleMouseUp);
    this.canvas.addEventListener('click', this._handleClick);
    this.canvas.addEventListener('wheel', this._handleWheel, { passive: false });
    this.canvas.addEventListener('contextmenu', this._handleContextMenu);
    this.canvas.addEventListener('mouseenter', this._handleMouseEnter);
    this.canvas.addEventListener('mouseleave', this._handleMouseLeave);

    // Set initial cursor
    this.canvas.style.cursor = CANVAS.CURSOR_DEFAULT;

    this.isInitialized = true;
  }

  /**
   * Handle mouse move events
   * @param {MouseEvent} event - Mouse move event
   */
  _handleMouseMove(event) {
    if (this.isDestroyed) return;

    const mouseData = EventUtils.createMouseEventData(event, this.viewport);
    
    // Update drag if in progress
    if (this.isDragging) {
      this.viewport.updateDrag(mouseData.screenX, mouseData.screenY);
      
      // Emit viewport pan change event
      this.eventBus.emit(EVENT_TYPES.VIEWPORT_PAN_CHANGE, {
        ...this.viewport.getState(),
        canvasWidth: this.canvas.width,
        canvasHeight: this.canvas.height
      });
    }

    // Emit mouse move event
    this.eventBus.emit(EVENT_TYPES.MOUSE_MOVE, mouseData);
  }

  /**
   * Handle mouse down events
   * @param {MouseEvent} event - Mouse down event
   */
  _handleMouseDown(event) {
    if (this.isDestroyed) return;

    const mouseData = EventUtils.createMouseEventData(event, this.viewport);
    
    // Check for pan gesture (middle button or Shift+Left)
    if (event.button === 1 || (event.button === 0 && event.shiftKey)) {
      this.isDragging = true;
      this.dragStartX = mouseData.screenX;
      this.dragStartY = mouseData.screenY;
      
      this.viewport.startDrag(mouseData.screenX, mouseData.screenY);
      
      // Prevent default behavior
      event.preventDefault();
    }

    // Emit mouse down event
    this.eventBus.emit(EVENT_TYPES.MOUSE_DOWN, mouseData);
  }

  /**
   * Handle mouse up events
   * @param {MouseEvent} event - Mouse up event
   */
  _handleMouseUp(event) {
    if (this.isDestroyed) return;

    const mouseData = EventUtils.createMouseEventData(event, this.viewport);

    if (this.isDragging) {
      this.isDragging = false;
      this.viewport.endDrag();
      
      // Emit final viewport pan change event
      this.eventBus.emit(EVENT_TYPES.VIEWPORT_PAN_CHANGE, {
        ...this.viewport.getState(),
        canvasWidth: this.canvas.width,
        canvasHeight: this.canvas.height
      });
    }

    // Emit mouse up event
    this.eventBus.emit(EVENT_TYPES.MOUSE_UP, mouseData);
  }

  /**
   * Handle click events
   * @param {MouseEvent} event - Click event
   */
  _handleClick(event) {
    if (this.isDestroyed) return;

    // Don't register click when panning
    if (event.shiftKey) {
      console.log('Click ignored - shift key held for panning');
      return;
    }

    const mouseData = EventUtils.createMouseEventData(event, this.viewport);
    
    // Debug coordinate accuracy
    const debugInfo = this.viewport.debugCoordinateConversion(event);
    console.log('Click handler - mouse data:', mouseData);
    console.log('Coordinate conversion accuracy:', debugInfo);
    
    // Validate coordinates
    if (!this.viewport.isValidCoordinate(mouseData.worldX) || 
        !this.viewport.isValidCoordinate(mouseData.worldY)) {
      console.log('Click ignored - invalid coordinates:', mouseData.worldX, mouseData.worldY);
      return;
    }

    console.log('Emitting MOUSE_CLICK event with valid coordinates');
    // Emit click event
    this.eventBus.emit(EVENT_TYPES.MOUSE_CLICK, mouseData);
  }

  /**
   * Handle wheel events (zoom)
   * @param {WheelEvent} event - Wheel event
   */
  _handleWheel(event) {
    if (this.isDestroyed) return;

    event.preventDefault();
    
    // Throttle wheel events
    const now = Date.now();
    if (now - this.lastWheelTime < this.wheelThrottleDelay) {
      return;
    }
    this.lastWheelTime = now;

    const mouseData = EventUtils.createMouseEventData(event, this.viewport);
    
    // Apply zoom at center of screen instead of mouse position
    // Use canvas buffer dimensions for consistent coordinate system
    const zoomDelta = event.deltaY > 0 ? -1 : 1;
    const centerX = this.canvas.width / 2;
    const centerY = this.canvas.height / 2;
    this.viewport.zoomAtPoint(centerX, centerY, zoomDelta);
    
    // Emit viewport zoom change event
    this.eventBus.emit(EVENT_TYPES.VIEWPORT_ZOOM_CHANGE, {
      ...this.viewport.getState(),
      canvasWidth: this.canvas.width,
      canvasHeight: this.canvas.height
    });

    // Emit mouse wheel event
    this.eventBus.emit(EVENT_TYPES.MOUSE_WHEEL, {
      ...mouseData,
      deltaX: event.deltaX,
      deltaY: event.deltaY,
      deltaZ: event.deltaZ || 0,
      deltaMode: event.deltaMode
    });
  }

  /**
   * Handle context menu events (prevent default)
   * @param {MouseEvent} event - Context menu event
   */
  _handleContextMenu(event) {
    event.preventDefault();
  }

  /**
   * Handle mouse enter events
   * @param {MouseEvent} event - Mouse enter event
   */
  _handleMouseEnter(event) {
    if (this.isDestroyed) return;

    const mouseData = EventUtils.createMouseEventData(event, this.viewport);
    this.eventBus.emit(EVENT_TYPES.MOUSE_ENTER_CANVAS, mouseData);
  }

  /**
   * Handle mouse leave events
   * @param {MouseEvent} event - Mouse leave event
   */
  _handleMouseLeave(event) {
    if (this.isDestroyed) return;

    const mouseData = EventUtils.createMouseEventData(event, this.viewport);
    this.eventBus.emit(EVENT_TYPES.MOUSE_LEAVE_CANVAS, mouseData);
    
    // End any dragging operation
    if (this.isDragging) {
      this.isDragging = false;
      this.viewport.endDrag();
    }
  }

  /**
   * Get current mouse state
   * @returns {Object} Mouse state information
   */
  getState() {
    return {
      isDragging: this.isDragging,
      dragStartX: this.dragStartX,
      dragStartY: this.dragStartY,
      isInitialized: this.isInitialized,
      isDestroyed: this.isDestroyed
    };
  }

  /**
   * Enable or disable mouse events
   * @param {boolean} enabled - Whether to enable mouse events
   */
  setEnabled(enabled) {
    this.canvas.style.pointerEvents = enabled ? 'auto' : 'none';
  }

  /**
   * Set cursor style
   * @param {string} cursor - CSS cursor value
   */
  setCursor(cursor) {
    this.canvas.style.cursor = cursor;
  }

  /**
   * Destroy mouse event handler and cleanup
   */
  destroy() {
    if (this.isDestroyed) return;

    // Remove event listeners
    this.canvas.removeEventListener('mousemove', this._handleMouseMove);
    this.canvas.removeEventListener('mousedown', this._handleMouseDown);
    this.canvas.removeEventListener('mouseup', this._handleMouseUp);
    this.canvas.removeEventListener('click', this._handleClick);
    this.canvas.removeEventListener('wheel', this._handleWheel);
    this.canvas.removeEventListener('contextmenu', this._handleContextMenu);
    this.canvas.removeEventListener('mouseenter', this._handleMouseEnter);
    this.canvas.removeEventListener('mouseleave', this._handleMouseLeave);

    // Reset state
    this.isDragging = false;
    this.canvas.style.cursor = CANVAS.CURSOR_DEFAULT;
    
    this.isDestroyed = true;
  }
}