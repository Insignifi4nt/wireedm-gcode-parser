/**
 * Touch Event Handler for Wire EDM G-Code Viewer
 * Handles touch interactions for mobile devices
 * Orchestrates TouchGestures and TouchInteractions modules
 */

import { EventBus } from './EventManager.js';
import { TouchGestures } from './input/TouchGestures.js';
import { TouchInteractions } from './input/TouchInteractions.js';

/**
 * TouchEventHandler class manages touch interactions
 * Orchestrates gesture recognition and interaction handling
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
    
    // Configuration (shared between modules)
    this.config = {
      tapThreshold: 10, // pixels
      tapTimeout: 300, // milliseconds
      doubleTapTimeout: 500, // milliseconds
      longPressTimeout: 800, // milliseconds
      pinchThreshold: 50, // pixels
      preventContextMenu: true
    };
    
    // Initialize gesture recognition module
    this.touchGestures = new TouchGestures(this.config);
    
    // Initialize interaction handling module
    this.touchInteractions = new TouchInteractions(this.viewport, this.eventBus);
    
    // Long press timeout tracking
    this._currentLongPressTimeout = null;
    
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
    
    // Use TouchGestures for gesture detection
    const gestureInfo = this.touchGestures.detectGestureStart(touches);
    
    // Handle long press setup for potential taps
    this._setupLongPressDetection(gestureInfo, touches[0]);
  }

  /**
   * Handle touch move events
   * @param {TouchEvent} event - Touch move event
   */
  _handleTouchMove(event) {
    if (this.isDestroyed) return;

    event.preventDefault();
    
    const touches = Array.from(event.touches);
    
    // Use TouchGestures for gesture detection
    const gestureInfo = this.touchGestures.detectGestureMove(touches);
    
    // Use TouchInteractions for gesture response
    if (!gestureInfo.throttled && gestureInfo.type && gestureInfo.type !== 'unknown') {
      this.touchInteractions.processGesture(gestureInfo, this.canvas);
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
    
    // Use TouchGestures for gesture completion
    const gestureInfo = this.touchGestures.detectGestureEnd(changedTouches, remainingTouches);
    
    // Clear long press timeout if gesture completed
    if (gestureInfo.completed && this._currentLongPressTimeout) {
      clearTimeout(this._currentLongPressTimeout);
      this._currentLongPressTimeout = null;
    }
    
    // Use TouchInteractions for final gesture processing
    if (gestureInfo.completed || gestureInfo.type === 'tap') {
      this.touchInteractions.processGesture(gestureInfo, this.canvas, changedTouches[0]);
    }
  }

  /**
   * Set up long press detection for potential tap gestures
   * @param {Object} gestureInfo - Gesture information from TouchGestures
   * @param {Touch} touch - Original touch object
   */
  _setupLongPressDetection(gestureInfo, touch) {
    if (gestureInfo.type === 'potential-tap') {
      // Clear any existing timeout
      if (this._currentLongPressTimeout) {
        clearTimeout(this._currentLongPressTimeout);
      }
      
      // Set up long press timeout
      this._currentLongPressTimeout = setTimeout(() => {
        const currentGesture = this.touchGestures.getGestureState();
        if (currentGesture.type === 'potential-tap') {
          // Create touch data and handle long press
          const touchData = this.touchInteractions.createTouchEventData(touch);
          this.touchInteractions.handleLongPress(touchData);
        }
        this._currentLongPressTimeout = null;
      }, this.config.longPressTimeout);
    }
  }

  /**
   * Handle touch cancel events
   * @param {TouchEvent} event - Touch cancel event
   */
  _handleTouchCancel(event) {
    if (this.isDestroyed) return;

    // Clear long press timeout
    if (this._currentLongPressTimeout) {
      clearTimeout(this._currentLongPressTimeout);
      this._currentLongPressTimeout = null;
    }
    
    // Use TouchGestures for cleanup
    this.touchGestures.handleTouchCancel();
  }

  /**
   * Handle context menu events (prevent default)
   * @param {MouseEvent} event - Context menu event
   */
  _handleContextMenu(event) {
    event.preventDefault();
  }


  /**
   * Get current touch state
   * @returns {Object} Touch state information
   */
  getState() {
    return {
      ...this.touchGestures.getTouchState(),
      ...this.touchInteractions.getState(),
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
    this.touchGestures.updateConfig(config);
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

    // Clear long press timeout
    if (this._currentLongPressTimeout) {
      clearTimeout(this._currentLongPressTimeout);
      this._currentLongPressTimeout = null;
    }

    // Use TouchGestures for cleanup
    this.touchGestures.handleTouchCancel();
    
    this.isDestroyed = true;
  }
}