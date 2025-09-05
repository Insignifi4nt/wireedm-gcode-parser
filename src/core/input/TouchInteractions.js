/**
 * Touch Interaction Handler
 * Handles touch gesture responses and viewport interactions
 */

import { EVENT_TYPES, EventUtils } from '../EventManager.js';

/**
 * TouchInteractions class manages touch gesture responses
 * Business logic for handling gestures and viewport manipulation
 */
export class TouchInteractions {
  /**
   * Create TouchInteractions instance
   * @param {Object} viewport - Viewport instance for coordinate transformations
   * @param {Object} eventBus - EventBus instance for event emission
   */
  constructor(viewport, eventBus) {
    if (!viewport) {
      throw new Error('Viewport instance is required');
    }
    
    if (!eventBus) {
      throw new Error('EventBus instance is required');
    }

    this.viewport = viewport;
    this.eventBus = eventBus;
  }

  /**
   * Handle tap gesture
   * @param {Object} touchData - Touch event data
   * @param {number} tapCount - Number of taps (1 for single, 2 for double)
   */
  handleTap(touchData, tapCount = 1) {
    if (tapCount === 1) {
      // Single tap - emit click event
      this.eventBus.emit(EVENT_TYPES.MOUSE_CLICK, touchData);
    } else if (tapCount === 2) {
      // Double tap - fit to screen
      this.eventBus.emit(EVENT_TYPES.VIEWPORT_FIT_TO_SCREEN, {
        gesture: 'double-tap',
        touch: touchData
      });
    }
  }

  /**
   * Handle long press gesture
   * @param {Object} touchData - Touch event data
   */
  handleLongPress(touchData) {
    // Long press - emit right click equivalent
    this.eventBus.emit(EVENT_TYPES.MOUSE_CLICK, {
      ...touchData,
      button: 2, // Right button equivalent
      gesture: 'long-press'
    });
  }

  /**
   * Handle pan gesture
   * @param {Object} gestureInfo - Gesture information containing deltaX, deltaY
   * @param {HTMLCanvasElement} canvas - Canvas element for canvas dimensions
   */
  handlePan(gestureInfo, canvas) {
    if (!gestureInfo.deltaX && !gestureInfo.deltaY) {
      return; // No movement to process
    }

    // Apply pan to viewport
    // Invert Y direction to match mouse drag behavior (drag down = viewport up)
    this.viewport.pan(gestureInfo.deltaX, -gestureInfo.deltaY);
    
    // Emit pan event
    this.eventBus.emit(EVENT_TYPES.VIEWPORT_PAN_CHANGE, {
      ...this.viewport.getState(),
      canvasWidth: canvas.width,
      canvasHeight: canvas.height,
      gesture: 'touch-pan'
    });
  }

  /**
   * Handle zoom gesture
   * @param {Object} gestureInfo - Gesture information containing distance, center, distanceDelta
   * @param {HTMLCanvasElement} canvas - Canvas element for coordinate conversion
   */
  handleZoom(gestureInfo, canvas) {
    if (!gestureInfo.distanceDelta || gestureInfo.distanceDelta === 0) {
      return; // No significant zoom change
    }

    // Convert center to canvas coordinates
    const rect = canvas.getBoundingClientRect();
    const canvasX = gestureInfo.center.x - rect.left;
    const canvasY = gestureInfo.center.y - rect.top;
    
    // Apply zoom
    const zoomDelta = gestureInfo.distanceDelta > 0 ? 1 : -1;
    this.viewport.zoomAtPoint(canvasX, canvasY, zoomDelta);
    
    // Emit zoom event
    this.eventBus.emit(EVENT_TYPES.VIEWPORT_ZOOM_CHANGE, {
      ...this.viewport.getState(),
      canvasWidth: canvas.width,
      canvasHeight: canvas.height,
      gesture: 'touch-zoom'
    });
  }

  /**
   * Create touch event data compatible with mouse events
   * @param {Touch} touch - Touch object
   * @returns {Object} Touch event data
   */
  createTouchEventData(touch) {
    // Create fake mouse event for compatibility
    const fakeEvent = {
      clientX: touch.clientX,
      clientY: touch.clientY,
      button: 0,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      target: touch.target,
      type: 'touch',
      preventDefault: () => {},
      stopPropagation: () => {}
    };
    
    return EventUtils.createMouseEventData(fakeEvent, this.viewport);
  }

  /**
   * Handle pan start - initialize pan state
   * @param {Object} gestureInfo - Gesture information
   * @returns {Object} Pan start result
   */
  handlePanStart(gestureInfo) {
    return {
      type: 'pan-start',
      startCenter: gestureInfo.center
    };
  }

  /**
   * Handle pan end - finalize pan gesture  
   * @param {Object} gestureInfo - Gesture information
   * @returns {Object} Pan end result
   */
  handlePanEnd(gestureInfo) {
    return {
      type: 'pan-end',
      completed: true
    };
  }

  /**
   * Handle zoom start - initialize zoom state
   * @param {Object} gestureInfo - Gesture information
   * @returns {Object} Zoom start result
   */
  handleZoomStart(gestureInfo) {
    return {
      type: 'zoom-start',
      startDistance: gestureInfo.distance,
      startCenter: gestureInfo.center
    };
  }

  /**
   * Handle zoom end - finalize zoom gesture
   * @param {Object} gestureInfo - Gesture information  
   * @returns {Object} Zoom end result
   */
  handleZoomEnd(gestureInfo) {
    return {
      type: 'zoom-end',
      completed: true
    };
  }

  /**
   * Process gesture info and route to appropriate handler
   * @param {Object} gestureInfo - Gesture information from TouchGestures
   * @param {HTMLCanvasElement} canvas - Canvas element
   * @param {Touch} touch - Original touch object (for tap/longpress)
   */
  processGesture(gestureInfo, canvas, touch = null) {
    switch (gestureInfo.type) {
      case 'tap':
        const touchData = this.createTouchEventData(touch || gestureInfo.touch);
        this.handleTap(touchData, gestureInfo.tapCount);
        break;
        
      case 'long-press':
        const longPressData = this.createTouchEventData(touch);
        this.handleLongPress(longPressData);
        break;
        
      case 'pan':
        this.handlePan(gestureInfo, canvas);
        break;
        
      case 'pan-start':
        return this.handlePanStart(gestureInfo);
        
      case 'pan-end':
        return this.handlePanEnd(gestureInfo);
        
      case 'zoom':
        this.handleZoom(gestureInfo, canvas);
        break;
        
      case 'zoom-start':
        return this.handleZoomStart(gestureInfo);
        
      case 'zoom-end':
        return this.handleZoomEnd(gestureInfo);
        
      default:
        // Unknown gesture type - no action needed
        break;
    }
    
    return { processed: true, type: gestureInfo.type };
  }

  /**
   * Get interaction state
   * @returns {Object} Interaction state information
   */
  getState() {
    return {
      viewport: this.viewport.getState(),
      hasEventBus: !!this.eventBus,
      hasViewport: !!this.viewport
    };
  }
}