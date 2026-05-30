/**
 * Touch Gesture Recognition Engine
 * Handles gesture detection, touch tracking, and state management
 */

/**
 * TouchGestures class manages gesture recognition and touch state tracking
 * Pure gesture detection logic without external dependencies
 */
export class TouchGestures {
  /**
   * Create TouchGestures instance
   * @param {Object} config - Configuration for gesture recognition
   */
  constructor(config = {}) {
    // Configuration with defaults
    this.config = {
      tapThreshold: 10, // pixels
      tapTimeout: 300, // milliseconds
      doubleTapTimeout: 500, // milliseconds
      longPressTimeout: 800, // milliseconds
      pinchThreshold: 50, // pixels
      preventContextMenu: true,
      ...config
    };
    
    // Touch state tracking
    this.touches = new Map();
    this.lastTouchTime = 0;
    this.touchThrottleDelay = 16; // ~60fps
    
    // Gesture recognition state
    this.gestureState = {
      type: null, // 'pan', 'zoom', 'tap', 'potential-tap'
      startTime: 0,
      lastDistance: 0,
      lastCenter: { x: 0, y: 0 },
      tapCount: 0,
      tapTimeout: null
    };
  }

  /**
   * Process touch start event and detect initial gesture
   * @param {Touch[]} touches - Array of current touches
   * @returns {Object} Gesture detection result
   */
  detectGestureStart(touches) {
    const touchCount = touches.length;
    
    // Update touch tracking
    this.updateTouchTracking(touches, 'start');

    // Determine gesture type
    if (touchCount === 1) {
      return this._handleSingleTouchStart(touches[0]);
    } else if (touchCount === 2) {
      return this._handlePinchStart(touches[0], touches[1]);
    } else {
      // More than 2 touches - reset
      this.resetGestureState();
      return { type: 'unknown', touchCount };
    }
  }

  /**
   * Process touch move event and update gesture
   * @param {Touch[]} touches - Array of current touches
   * @returns {Object} Gesture detection result
   */
  detectGestureMove(touches) {
    const touchCount = touches.length;
    
    // Throttle touch move events
    const now = Date.now();
    if (now - this.lastTouchTime < this.touchThrottleDelay) {
      return { type: this.gestureState.type, throttled: true };
    }
    
    // Update touch tracking
    this.updateTouchTracking(touches, 'move');

    if (touchCount === 1) {
      return this._handleSingleTouchMove(touches[0]);
    } else if (touchCount === 2) {
      return this._handlePinchMove(touches[0], touches[1]);
    }

    return { type: this.gestureState.type, touchCount };
  }

  /**
   * Process touch end event and finalize gesture
   * @param {Touch[]} changedTouches - Array of ended touches
   * @param {Touch[]} remainingTouches - Array of remaining touches
   * @returns {Object} Gesture completion result
   */
  detectGestureEnd(changedTouches, remainingTouches) {
    // Remove ended touches from tracking
    changedTouches.forEach(touch => {
      this.touches.delete(touch.identifier);
    });

    // Handle gesture completion
    if (remainingTouches.length === 0) {
      return this._handleGestureEnd(changedTouches[0]);
    } else if (remainingTouches.length === 1 && this.gestureState.type === 'zoom') {
      // Transition from zoom to potential pan
      return this._handleSingleTouchStart(remainingTouches[0]);
    }

    return { type: this.gestureState.type, remainingTouches: remainingTouches.length };
  }

  /**
   * Update touch tracking with current touches
   * @param {Touch[]} touches - Array of current touches
   * @param {string} eventType - Type of event ('start', 'move', 'end')
   */
  updateTouchTracking(touches, eventType = 'move') {
    const now = Date.now();

    touches.forEach(touch => {
      if (eventType === 'start') {
        // Track new touches
        this.touches.set(touch.identifier, {
          id: touch.identifier,
          startX: touch.clientX,
          startY: touch.clientY,
          currentX: touch.clientX,
          currentY: touch.clientY,
          startTime: now
        });
      } else if (eventType === 'move') {
        // Update existing touches
        const trackedTouch = this.touches.get(touch.identifier);
        if (trackedTouch) {
          trackedTouch.currentX = touch.clientX;
          trackedTouch.currentY = touch.clientY;
        }
      }
    });

    this.lastTouchTime = now;
  }

  /**
   * Handle single touch start (potential tap or pan)
   * @param {Touch} touch - Touch object
   * @returns {Object} Gesture detection result
   */
  _handleSingleTouchStart(touch) {
    // Check for double tap
    const now = Date.now();
    const timeSinceLastTouch = now - this.lastTouchTime;
    
    if (timeSinceLastTouch < this.config.doubleTapTimeout) {
      this.gestureState.tapCount++;
    } else {
      this.gestureState.tapCount = 1;
    }
    
    // Set up gesture state
    this.gestureState.type = 'potential-tap';
    this.gestureState.startTime = now;
    this.gestureState.lastCenter = { x: touch.clientX, y: touch.clientY };
    
    // Clear any existing timeout
    if (this.gestureState.tapTimeout) {
      clearTimeout(this.gestureState.tapTimeout);
      this.gestureState.tapTimeout = null;
    }
    
    return {
      type: 'potential-tap',
      tapCount: this.gestureState.tapCount,
      center: this.gestureState.lastCenter
    };
  }

  /**
   * Handle pinch start (zoom gesture)
   * @param {Touch} touch1 - First touch
   * @param {Touch} touch2 - Second touch
   * @returns {Object} Gesture detection result
   */
  _handlePinchStart(touch1, touch2) {
    const distance = this.calculateDistance(touch1, touch2);
    const center = this.calculateCenter(touch1, touch2);
    
    this.gestureState.type = 'zoom';
    this.gestureState.startTime = Date.now();
    this.gestureState.lastDistance = distance;
    this.gestureState.lastCenter = center;
    
    // Clear any pending tap timeout
    if (this.gestureState.tapTimeout) {
      clearTimeout(this.gestureState.tapTimeout);
      this.gestureState.tapTimeout = null;
    }
    
    return {
      type: 'zoom',
      distance,
      center,
      startDistance: distance
    };
  }

  /**
   * Handle single touch move (pan detection)
   * @param {Touch} touch - Touch object
   * @returns {Object} Gesture detection result
   */
  _handleSingleTouchMove(touch) {
    const trackedTouch = this.touches.get(touch.identifier);
    if (!trackedTouch) {
      return { type: 'unknown', error: 'Touch not tracked' };
    }

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
        
        // Update last center
        this.gestureState.lastCenter = { x: touch.clientX, y: touch.clientY };
        
        return {
          type: 'pan',
          deltaX: panDeltaX,
          deltaY: panDeltaY,
          totalDistance: distance
        };
      }
    }

    return { type: this.gestureState.type, distance };
  }

  /**
   * Handle pinch move (zoom detection)
   * @param {Touch} touch1 - First touch
   * @param {Touch} touch2 - Second touch
   * @returns {Object} Gesture detection result
   */
  _handlePinchMove(touch1, touch2) {
    const distance = this.calculateDistance(touch1, touch2);
    const center = this.calculateCenter(touch1, touch2);
    
    if (this.gestureState.type === 'zoom') {
      const distanceDelta = distance - this.gestureState.lastDistance;
      
      // Only process significant changes
      if (Math.abs(distanceDelta) > this.config.pinchThreshold) {
        // Update last distance
        this.gestureState.lastDistance = distance;
        
        return {
          type: 'zoom',
          distance,
          center,
          distanceDelta,
          zoomDirection: distanceDelta > 0 ? 'out' : 'in'
        };
      }
    }
    
    return { type: 'zoom', distance, center, distanceDelta: 0 };
  }

  /**
   * Handle gesture completion
   * @param {Touch} lastTouch - Last touch that ended
   * @returns {Object} Gesture completion result
   */
  _handleGestureEnd(lastTouch) {
    const gestureType = this.gestureState.type;
    let result = { type: gestureType, completed: true };
    
    if (gestureType === 'potential-tap') {
      // Process tap
      result = {
        type: 'tap',
        tapCount: this.gestureState.tapCount,
        touch: lastTouch,
        completed: true
      };
    } else if (gestureType === 'pan') {
      result = { type: 'pan-end', completed: true };
    } else if (gestureType === 'zoom') {
      result = { type: 'zoom-end', completed: true };
    }
    
    // Clear tap timeout
    if (this.gestureState.tapTimeout) {
      clearTimeout(this.gestureState.tapTimeout);
      this.gestureState.tapTimeout = null;
    }
    
    // Reset gesture state
    this.resetGestureState();
    
    return result;
  }

  /**
   * Calculate distance between two touches
   * @param {Touch} touch1 - First touch
   * @param {Touch} touch2 - Second touch
   * @returns {number} Distance in pixels
   */
  calculateDistance(touch1, touch2) {
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
  calculateCenter(touch1, touch2) {
    return {
      x: (touch1.clientX + touch2.clientX) / 2,
      y: (touch1.clientY + touch2.clientY) / 2
    };
  }

  /**
   * Reset gesture state to initial values
   */
  resetGestureState() {
    this.gestureState.type = null;
    this.gestureState.startTime = 0;
    this.gestureState.lastDistance = 0;
    this.gestureState.lastCenter = { x: 0, y: 0 };
    // Don't reset tapCount - it's used for double tap detection
  }

  /**
   * Handle touch cancel (cleanup)
   */
  handleTouchCancel() {
    // Clear all touch tracking
    this.touches.clear();
    
    // Clear tap timeout
    if (this.gestureState.tapTimeout) {
      clearTimeout(this.gestureState.tapTimeout);
      this.gestureState.tapTimeout = null;
    }
    
    // Reset gesture state
    this.resetGestureState();
  }

  /**
   * Get current gesture state
   * @returns {Object} Current gesture state
   */
  getGestureState() {
    return { ...this.gestureState };
  }

  /**
   * Update configuration
   * @param {Object} newConfig - Configuration updates
   */
  updateConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
  }

  /**
   * Get touch tracking state
   * @returns {Object} Touch tracking information
   */
  getTouchState() {
    return {
      touchCount: this.touches.size,
      lastTouchTime: this.lastTouchTime,
      gestureType: this.gestureState.type,
      tapCount: this.gestureState.tapCount
    };
  }
}