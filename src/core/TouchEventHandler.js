/**
 * Touch Event Handler for Wire EDM G-Code Viewer
 * Handles touch interactions for mobile devices
 */

import { EventBus, EVENT_TYPES, EventUtils } from './EventManager.js';
import { CANVAS } from '../utils/Constants.js';

/**
 * TouchEventHandler class manages touch interactions
 * Provides mobile-friendly touch gestures for pan, zoom, and tap
 */
export class TouchEventHandler {
  /**
   * Create TouchEventHandler instance
   * @param {HTMLCanvasElement} canvas - Canvas element to handle touch events for
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
    
    // Touch state tracking
    this.touches = new Map();
    this.lastTouchTime = 0;
    this.touchThrottleDelay = 16; // ~60fps
    
    // Gesture recognition
    this.gestureState = {
      type: null, // 'pan', 'zoom', 'tap'
      startTime: 0,
      lastDistance: 0,
      lastCenter: { x: 0, y: 0 },
      tapCount: 0,
      tapTimeout: null
    };
    
    // Configuration
    this.config = {
      tapThreshold: 10, // pixels
      tapTimeout: 300, // milliseconds
      doubleTapTimeout: 500, // milliseconds
      longPressTimeout: 800, // milliseconds
      pinchThreshold: 50, // pixels
      preventContextMenu: true
    };
    
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
    this._handleTouchStart = this._handleTouchStart.bind(this);
    this._handleTouchMove = this._handleTouchMove.bind(this);
    this._handleTouchEnd = this._handleTouchEnd.bind(this);
    this._handleTouchCancel = this._handleTouchCancel.bind(this);
    this._handleContextMenu = this._handleContextMenu.bind(this);
  }

  /**
   * Initialize touch event handlers
   */
  init() {
    if (this.isInitialized) {
      console.warn('TouchEventHandler already initialized');
      return;
    }

    // Add touch event listeners
    this.canvas.addEventListener('touchstart', this._handleTouchStart, { passive: false });
    this.canvas.addEventListener('touchmove', this._handleTouchMove, { passive: false });
    this.canvas.addEventListener('touchend', this._handleTouchEnd, { passive: false });
    this.canvas.addEventListener('touchcancel', this._handleTouchCancel, { passive: false });
    
    // Prevent context menu on touch devices
    if (this.config.preventContextMenu) {
      this.canvas.addEventListener('contextmenu', this._handleContextMenu);
    }

    this.isInitialized = true;
  }

  /**
   * Handle touch start events
   * @param {TouchEvent} event - Touch start event
   */
  _handleTouchStart(event) {
    if (this.isDestroyed) return;

    event.preventDefault();
    
    const touches = Array.from(event.touches);
    const touchCount = touches.length;
    
    // Update touch tracking
    touches.forEach(touch => {
      this.touches.set(touch.identifier, {
        id: touch.identifier,
        startX: touch.clientX,
        startY: touch.clientY,
        currentX: touch.clientX,
        currentY: touch.clientY,
        startTime: Date.now()
      });
    });

    // Determine gesture type
    if (touchCount === 1) {
      this._handleSingleTouchStart(touches[0]);
    } else if (touchCount === 2) {
      this._handlePinchStart(touches[0], touches[1]);
    } else {
      // More than 2 touches - ignore for now
      this._resetGestureState();
    }
  }

  /**
   * Handle single touch start (tap/pan)
   * @param {Touch} touch - Touch object
   */
  _handleSingleTouchStart(touch) {
    const touchData = this._createTouchEventData(touch);
    
    // Check for double tap
    const now = Date.now();
    const timeSinceLastTouch = now - this.lastTouchTime;
    
    if (timeSinceLastTouch < this.config.doubleTapTimeout) {
      this.gestureState.tapCount++;
    } else {
      this.gestureState.tapCount = 1;
    }
    
    this.lastTouchTime = now;
    
    // Set up gesture state
    this.gestureState.type = 'potential-tap';
    this.gestureState.startTime = now;
    this.gestureState.lastCenter = { x: touch.clientX, y: touch.clientY };
    
    // Set up long press detection
    if (this.gestureState.tapTimeout) {
      clearTimeout(this.gestureState.tapTimeout);
    }
    
    this.gestureState.tapTimeout = setTimeout(() => {
      if (this.gestureState.type === 'potential-tap') {
        this._handleLongPress(touchData);
      }
    }, this.config.longPressTimeout);
  }

  /**
   * Handle pinch start (zoom gesture)
   * @param {Touch} touch1 - First touch
   * @param {Touch} touch2 - Second touch
   */
  _handlePinchStart(touch1, touch2) {
    const distance = this._calculateTouchDistance(touch1, touch2);
    const center = this._calculateTouchCenter(touch1, touch2);
    
    this.gestureState.type = 'zoom';
    this.gestureState.startTime = Date.now();
    this.gestureState.lastDistance = distance;
    this.gestureState.lastCenter = center;
    
    // Clear any pending tap timeout
    if (this.gestureState.tapTimeout) {
      clearTimeout(this.gestureState.tapTimeout);
      this.gestureState.tapTimeout = null;
    }
  }

  /**
   * Handle touch move events
   * @param {TouchEvent} event - Touch move event
   */
  _handleTouchMove(event) {
    if (this.isDestroyed) return;

    event.preventDefault();
    
    // Throttle touch move events
    const now = Date.now();
    if (now - this.lastTouchTime < this.touchThrottleDelay) {
      return;
    }
    
    const touches = Array.from(event.touches);
    const touchCount = touches.length;
    
    // Update touch tracking
    touches.forEach(touch => {
      const trackedTouch = this.touches.get(touch.identifier);
      if (trackedTouch) {
        trackedTouch.currentX = touch.clientX;
        trackedTouch.currentY = touch.clientY;
      }
    });

    if (touchCount === 1) {
      this._handleSingleTouchMove(touches[0]);
    } else if (touchCount === 2) {
      this._handlePinchMove(touches[0], touches[1]);
    }
  }

  /**
   * Handle single touch move (pan or tap detection)
   * @param {Touch} touch - Touch object
   */
  _handleSingleTouchMove(touch) {
    const trackedTouch = this.touches.get(touch.identifier);
    if (!trackedTouch) return;

    const deltaX = touch.clientX - trackedTouch.startX;
    const deltaY = touch.clientY - trackedTouch.startY;
    const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);

    // Check if touch has moved beyond tap threshold
    if (distance > this.config.tapThreshold) {
      // Convert to pan gesture
      if (this.gestureState.type === 'potential-tap') {
        this.gestureState.type = 'pan';
        
        // Clear tap timeout
        if (this.gestureState.tapTimeout) {
          clearTimeout(this.gestureState.tapTimeout);
          this.gestureState.tapTimeout = null;
        }
      }
      
      // Handle pan
      if (this.gestureState.type === 'pan') {
        const panDeltaX = touch.clientX - this.gestureState.lastCenter.x;
        const panDeltaY = touch.clientY - this.gestureState.lastCenter.y;
        
        this.viewport.pan(panDeltaX, panDeltaY);
        
        // Update last center
        this.gestureState.lastCenter = { x: touch.clientX, y: touch.clientY };
        
        // Emit pan event
        this.eventBus.emit(EVENT_TYPES.VIEWPORT_PAN_CHANGE, {
          ...this.viewport.getState(),
          canvasWidth: this.canvas.width,
          canvasHeight: this.canvas.height,
          gesture: 'touch-pan'
        });
      }
    }
  }

  /**
   * Handle pinch move (zoom gesture)
   * @param {Touch} touch1 - First touch
   * @param {Touch} touch2 - Second touch
   */
  _handlePinchMove(touch1, touch2) {
    const distance = this._calculateTouchDistance(touch1, touch2);
    const center = this._calculateTouchCenter(touch1, touch2);
    
    if (this.gestureState.type === 'zoom') {
      const distanceDelta = distance - this.gestureState.lastDistance;
      
      // Only process significant changes
      if (Math.abs(distanceDelta) > this.config.pinchThreshold) {
        // Convert center to canvas coordinates
        const rect = this.canvas.getBoundingClientRect();
        const canvasX = center.x - rect.left;
        const canvasY = center.y - rect.top;
        
        // Apply zoom
        const zoomDelta = distanceDelta > 0 ? 1 : -1;
        this.viewport.zoomAtPoint(canvasX, canvasY, zoomDelta);
        
        // Update last distance
        this.gestureState.lastDistance = distance;
        
        // Emit zoom event
        this.eventBus.emit(EVENT_TYPES.VIEWPORT_ZOOM_CHANGE, {
          ...this.viewport.getState(),
          canvasWidth: this.canvas.width,
          canvasHeight: this.canvas.height,
          gesture: 'touch-zoom'
        });
      }
    }
  }

  /**
   * Handle touch end events
   * @param {TouchEvent} event - Touch end event
   */
  _handleTouchEnd(event) {
    if (this.isDestroyed) return;

    event.preventDefault();
    
    const changedTouches = Array.from(event.changedTouches);
    const remainingTouches = Array.from(event.touches);
    
    // Remove ended touches from tracking
    changedTouches.forEach(touch => {
      this.touches.delete(touch.identifier);
    });

    // Handle gesture completion
    if (remainingTouches.length === 0) {
      this._handleGestureEnd(changedTouches[0]);
    } else if (remainingTouches.length === 1 && this.gestureState.type === 'zoom') {
      // Transition from zoom to pan
      this._handleSingleTouchStart(remainingTouches[0]);
    }
  }

  /**
   * Handle gesture end
   * @param {Touch} lastTouch - Last touch that ended
   */
  _handleGestureEnd(lastTouch) {
    const gestureType = this.gestureState.type;
    
    if (gestureType === 'potential-tap') {
      // Process tap
      this._handleTap(lastTouch);
    } else if (gestureType === 'pan') {
      // Pan ended - no specific action needed
    } else if (gestureType === 'zoom') {
      // Zoom ended - no specific action needed
    }
    
    // Clear tap timeout
    if (this.gestureState.tapTimeout) {
      clearTimeout(this.gestureState.tapTimeout);
      this.gestureState.tapTimeout = null;
    }
    
    // Reset gesture state
    this._resetGestureState();
  }

  /**
   * Handle tap gesture
   * @param {Touch} touch - Touch object
   */
  _handleTap(touch) {
    const touchData = this._createTouchEventData(touch);
    
    if (this.gestureState.tapCount === 1) {
      // Single tap
      this.eventBus.emit(EVENT_TYPES.MOUSE_CLICK, touchData);
    } else if (this.gestureState.tapCount === 2) {
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
  _handleLongPress(touchData) {
    // Long press - show context menu or special action
    this.eventBus.emit(EVENT_TYPES.MOUSE_CLICK, {
      ...touchData,
      button: 2, // Right button equivalent
      gesture: 'long-press'
    });
  }

  /**
   * Handle touch cancel events
   * @param {TouchEvent} event - Touch cancel event
   */
  _handleTouchCancel(event) {
    if (this.isDestroyed) return;

    // Clear all touch tracking
    this.touches.clear();
    
    // Clear tap timeout
    if (this.gestureState.tapTimeout) {
      clearTimeout(this.gestureState.tapTimeout);
      this.gestureState.tapTimeout = null;
    }
    
    // Reset gesture state
    this._resetGestureState();
  }

  /**
   * Handle context menu events (prevent default)
   * @param {MouseEvent} event - Context menu event
   */
  _handleContextMenu(event) {
    event.preventDefault();
  }

  /**
   * Calculate distance between two touches
   * @param {Touch} touch1 - First touch
   * @param {Touch} touch2 - Second touch
   * @returns {number} Distance in pixels
   */
  _calculateTouchDistance(touch1, touch2) {
    const deltaX = touch1.clientX - touch2.clientX;
    const deltaY = touch1.clientY - touch2.clientY;
    return Math.sqrt(deltaX * deltaX + deltaY * deltaY);
  }

  /**
   * Calculate center point between two touches
   * @param {Touch} touch1 - First touch
   * @param {Touch} touch2 - Second touch
   * @returns {Object} Center point {x, y}
   */
  _calculateTouchCenter(touch1, touch2) {
    return {
      x: (touch1.clientX + touch2.clientX) / 2,
      y: (touch1.clientY + touch2.clientY) / 2
    };
  }

  /**
   * Create touch event data compatible with mouse events
   * @param {Touch} touch - Touch object
   * @returns {Object} Touch event data
   */
  _createTouchEventData(touch) {
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
   * Reset gesture state
   */
  _resetGestureState() {
    this.gestureState.type = null;
    this.gestureState.startTime = 0;
    this.gestureState.lastDistance = 0;
    this.gestureState.lastCenter = { x: 0, y: 0 };
    // Don't reset tapCount - it's used for double tap detection
  }

  /**
   * Get current touch state
   * @returns {Object} Touch state information
   */
  getState() {
    return {
      touchCount: this.touches.size,
      gestureType: this.gestureState.type,
      tapCount: this.gestureState.tapCount,
      isInitialized: this.isInitialized,
      isDestroyed: this.isDestroyed
    };
  }

  /**
   * Enable or disable touch events
   * @param {boolean} enabled - Whether to enable touch events
   */
  setEnabled(enabled) {
    this.canvas.style.touchAction = enabled ? 'none' : 'auto';
  }

  /**
   * Update configuration
   * @param {Object} config - Configuration updates
   */
  updateConfig(config) {
    this.config = { ...this.config, ...config };
  }

  /**
   * Destroy touch event handler and cleanup
   */
  destroy() {
    if (this.isDestroyed) return;

    // Remove event listeners
    this.canvas.removeEventListener('touchstart', this._handleTouchStart);
    this.canvas.removeEventListener('touchmove', this._handleTouchMove);
    this.canvas.removeEventListener('touchend', this._handleTouchEnd);
    this.canvas.removeEventListener('touchcancel', this._handleTouchCancel);
    
    if (this.config.preventContextMenu) {
      this.canvas.removeEventListener('contextmenu', this._handleContextMenu);
    }

    // Clear timeouts
    if (this.gestureState.tapTimeout) {
      clearTimeout(this.gestureState.tapTimeout);
      this.gestureState.tapTimeout = null;
    }

    // Clear state
    this.touches.clear();
    this._resetGestureState();
    
    this.isDestroyed = true;
  }
}