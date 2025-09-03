/**
 * EventManager - Centralized Event Handling System
 * 
 * This module provides a comprehensive event management system for the Wire EDM G-Code Viewer.
 * It implements the Observer pattern to enable loose coupling between components.
 * 
 * DESIGN NOTES FOR IMPLEMENTING AGENT:
 * - This is the architectural design/interface - implementation will be done by Agent B3
 * - All event types and data structures are defined here
 * - Observer pattern with subscription/unsubscription management
 * - Memory leak prevention through proper cleanup
 * - Event delegation for dynamic elements
 */

import { EVENT_TYPES } from './events/EventTypes.js';
export { EVENT_TYPES };

import { EVENT_DATA_SCHEMAS } from './events/EventSchemas.js';
export { EVENT_DATA_SCHEMAS };
import { EventValidator } from './events/EventValidator.js';
export { EventValidator };
import * as EmitControls from './events/EmitControls.js';

/**
 * EventManager - Centralized Event Management Implementation
 * 
 * Implements the Observer pattern for loose coupling between components.
 * Provides event delegation, throttling, validation, and debugging support.
 */
import { EventHistory } from './events/EventHistory.js';

export class EventManager {
  /**
   * Constructor
   * Initializes the event management system
   */
  constructor() {
    this.listeners = new Map(); // event -> Set of listeners
    this.onceListeners = new Map(); // event -> Set of one-time listeners
    this.delegatedListeners = new Map(); // selector -> Map of event handlers
    this.isDestroyed = false;
    this._history = new EventHistory(100); // For debugging
    
    // Performance tracking
    this.listenerCount = 0;
    this.eventCount = 0;
    
    // Bind methods for consistent context
    this._handleDelegatedEvent = this._handleDelegatedEvent.bind(this);
  }

  /**
   * Subscribe to an event
   * @param {string} eventType - Event type from EVENT_TYPES
   * @param {Function} callback - Event handler function
   * @param {Object} options - Subscription options
   * @param {boolean} options.once - One-time listener
   * @param {number} options.priority - Execution priority (higher = first)
   * @returns {Function} Unsubscribe function
   */
  on(eventType, callback, options = {}) {
    this._validateEventType(eventType);
    this._validateCallback(callback);
    
    if (this.isDestroyed) {
      console.warn('EventManager: Cannot add listener to destroyed instance');
      return () => {};
    }
    
    const { once = false, priority = 0 } = options;
    const listenerMap = once ? this.onceListeners : this.listeners;
    
    if (!listenerMap.has(eventType)) {
      listenerMap.set(eventType, new Set());
    }
    
    // Create listener wrapper with metadata
    const listenerWrapper = {
      callback,
      priority,
      id: this._generateListenerId(),
      createdAt: Date.now()
    };
    
    listenerMap.get(eventType).add(listenerWrapper);
    this.listenerCount++;
    
    // Return unsubscribe function
    return () => {
      listenerMap.get(eventType)?.delete(listenerWrapper);
      this.listenerCount--;
      
      // Clean up empty sets
      if (listenerMap.get(eventType)?.size === 0) {
        listenerMap.delete(eventType);
      }
    };
  }

  /**
   * Subscribe to an event (one-time only)
   * @param {string} eventType - Event type from EVENT_TYPES
   * @param {Function} callback - Event handler function
   * @returns {Function} Unsubscribe function
   */
  once(eventType, callback) {
    return this.on(eventType, callback, { once: true });
  }

  /**
   * Unsubscribe from an event
   * @param {string} eventType - Event type from EVENT_TYPES
   * @param {Function} callback - Event handler function to remove
   */
  off(eventType, callback) {
    this._validateEventType(eventType);
    this._validateCallback(callback);
    
    // Remove from both regular and once listeners
    [this.listeners, this.onceListeners].forEach(listenerMap => {
      const listeners = listenerMap.get(eventType);
      if (listeners) {
        for (const wrapper of listeners) {
          if (wrapper.callback === callback) {
            listeners.delete(wrapper);
            this.listenerCount--;
          }
        }
        
        // Clean up empty sets
        if (listeners.size === 0) {
          listenerMap.delete(eventType);
        }
      }
    });
  }

  /**
   * Emit an event
   * @param {string} eventType - Event type from EVENT_TYPES
   * @param {*} eventData - Event data payload
   * @param {Object} options - Emission options
   * @param {boolean} options.async - Emit asynchronously
   * @param {boolean} options.skipValidation - Skip data validation
   */
  emit(eventType, eventData = null, options = {}) {
    this._validateEventType(eventType);
    
    if (this.isDestroyed) {
      console.warn('EventManager: Cannot emit events from destroyed instance');
      return;
    }
    
    const { async = false, skipValidation = false } = options;
    
    // Validate event data if not skipped
    if (!skipValidation) {
      const validation = EventValidator.validate(eventType, eventData);
      if (!validation.valid) {
        console.warn(`EventManager: Invalid event data for ${eventType}:`, validation.errors);
      }
    }
    
    // Record event in history
    this._recordEvent(eventType, eventData);
    this.eventCount++;
    
    if (async) {
      // Emit asynchronously to prevent blocking
      setTimeout(() => this._executeListeners(eventType, eventData), 0);
    } else {
      this._executeListeners(eventType, eventData);
    }
  }

  /**
   * Create event delegation for dynamic elements
   * @param {string} selector - CSS selector for target elements
   * @param {string} domEventType - DOM event type (click, mouseover, etc.)
   * @param {string} customEventType - Custom event type to emit
   * @param {Function} dataExtractor - Function to extract event data
   * @returns {Function} Cleanup function
   */
  delegate(selector, domEventType, customEventType, dataExtractor) {
    this._validateEventType(customEventType);
    
    if (typeof selector !== 'string') {
      throw new Error('Selector must be a string');
    }
    
    if (typeof domEventType !== 'string') {
      throw new Error('DOM event type must be a string');
    }
    
    if (typeof dataExtractor !== 'function') {
      throw new Error('Data extractor must be a function');
    }
    
    const delegationKey = `${selector}:${domEventType}`;
    
    if (!this.delegatedListeners.has(delegationKey)) {
      this.delegatedListeners.set(delegationKey, new Map());
      
      // Add DOM event listener
      document.addEventListener(domEventType, (event) => {
        this._handleDelegatedEvent(event, selector, delegationKey);
      }, true); // Use capture phase
    }
    
    // Store the custom event mapping
    this.delegatedListeners.get(delegationKey).set(customEventType, dataExtractor);
    
    // Return cleanup function
    return () => {
      const handlers = this.delegatedListeners.get(delegationKey);
      if (handlers) {
        handlers.delete(customEventType);
        
        // If no more handlers, remove the delegation
        if (handlers.size === 0) {
          this.delegatedListeners.delete(delegationKey);
          // Note: DOM listener cleanup would require more complex tracking
        }
      }
    };
  }

  /**
   * Get list of active listeners for an event
   * @param {string} eventType - Event type to query
   * @returns {Array} Array of listener functions
   */
  getListeners(eventType) {
    this._validateEventType(eventType);
    
    const regularListeners = Array.from(this.listeners.get(eventType) || []);
    const onceListeners = Array.from(this.onceListeners.get(eventType) || []);
    
    return [...regularListeners, ...onceListeners]
      .sort((a, b) => b.priority - a.priority) // Higher priority first
      .map(wrapper => wrapper.callback);
  }

  /**
   * Remove all listeners for an event type
   * @param {string} eventType - Event type to clear
   */
  removeAllListeners(eventType) {
    if (eventType) {
      this._validateEventType(eventType);
      
      const regularCount = this.listeners.get(eventType)?.size || 0;
      const onceCount = this.onceListeners.get(eventType)?.size || 0;
      
      this.listeners.delete(eventType);
      this.onceListeners.delete(eventType);
      
      this.listenerCount -= (regularCount + onceCount);
    } else {
      // Clear all listeners
      this.listeners.clear();
      this.onceListeners.clear();
      this.listenerCount = 0;
    }
  }

  /**
   * Clean up all event listeners and resources
   */
  destroy() {
    if (this.isDestroyed) {
      return;
    }
    
    // Clear all listeners
    this.removeAllListeners();
    
    // Clear delegated listeners
    this.delegatedListeners.clear();
    
    // Clear history
    this._history.clear();
    
    // Mark as destroyed
    this.isDestroyed = true;
    
    console.debug('EventManager destroyed');
  }

  /**
   * Get event emission history (for debugging)
   * @returns {Array} Array of recent events
   */
  getEventHistory() {
    return this._history.getEvents();
  }

  /**
   * Get performance statistics
   * @returns {Object} Performance metrics
   */
  getStats() {
    return {
      listenerCount: this.listenerCount,
      eventCount: this.eventCount,
      eventTypes: {
        regular: this.listeners.size,
        once: this.onceListeners.size
      },
      delegations: this.delegatedListeners.size,
      historySize: this._history.getEvents().length,
      isDestroyed: this.isDestroyed
    };
  }

  // Private Methods

  /**
   * Execute listeners for an event
   * @private
   */
  _executeListeners(eventType, eventData) {
    // Get all listeners (regular + once) sorted by priority
    const allListeners = [];
    
    // Add regular listeners
    const regularListeners = this.listeners.get(eventType);
    if (regularListeners) {
      allListeners.push(...regularListeners);
    }
    
    // Add once listeners
    const onceListeners = this.onceListeners.get(eventType);
    if (onceListeners) {
      allListeners.push(...onceListeners);
    }
    
    // Sort by priority (higher first)
    allListeners.sort((a, b) => b.priority - a.priority);
    
    // Execute listeners with error handling
    allListeners.forEach(wrapper => {
      try {
        wrapper.callback(eventData, eventType);
      } catch (error) {
        console.error(`EventManager: Error in listener for ${eventType}:`, error);
        // Continue executing other listeners despite error
      }
    });
    
    // Clean up once listeners
    if (onceListeners && onceListeners.size > 0) {
      this.onceListeners.delete(eventType);
      this.listenerCount -= onceListeners.size;
    }
  }

  /**
   * Handle delegated DOM events
   * @private
   */
  _handleDelegatedEvent(event, selector, delegationKey) {
    const target = event.target.closest(selector);
    if (!target) return;
    
    const handlers = this.delegatedListeners.get(delegationKey);
    if (!handlers) return;
    
    handlers.forEach((dataExtractor, customEventType) => {
      try {
        const eventData = dataExtractor(event, target);
        this.emit(customEventType, eventData, { skipValidation: true });
      } catch (error) {
        console.error(`EventManager: Error in delegated event handler:`, error);
      }
    });
  }

  /**
   * Record event in history for debugging
   * @private
   */
  _recordEvent(eventType, eventData) {
    this._history.record(eventType, eventData, this.getListeners(eventType).length);
  }

  /**
   * Validate event type
   * @private
   */
  _validateEventType(eventType) {
    if (typeof eventType !== 'string') {
      throw new Error('Event type must be a string');
    }
    
    if (eventType.length === 0) {
      throw new Error('Event type cannot be empty');
    }
  }

  /**
   * Validate callback function
   * @private
   */
  _validateCallback(callback) {
    if (typeof callback !== 'function') {
      throw new Error('Callback must be a function');
    }
  }

  /**
   * Generate unique listener ID
   * @private
   */
  _generateListenerId() {
    return `listener_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

/**
 * Event Validator Utility
 * Validates event data against schemas
 */
// EventValidator moved to ./events/EventValidator.js and re-exported above

// EventBus moved to ./events/EventBus.js
export { EventBus } from './events/EventBus.js';

/**
 * Event Utilities
 * Helper functions for common event operations
 */
export class EventUtils {
  /**
   * Create standardized mouse event data
   * @param {MouseEvent} domEvent - DOM mouse event
   * @param {Object} viewport - Current viewport state or Viewport instance
   * @returns {Object} Standardized mouse event data
   */
  static createMouseEventData(domEvent, viewport) {
    if (!domEvent) {
      throw new Error('DOM event is required');
    }
    
    // Handle both Viewport instance and viewport state object
    let screenCoords = { x: 0, y: 0 };
    let worldCoords = { x: 0, y: 0 };
    
    if (viewport) {
      if (typeof viewport.getMouseCoordinates === 'function') {
        // Always use Viewport instance methods for consistency
        const coords = viewport.getMouseCoordinates(domEvent);
        if (coords) {
          screenCoords = coords.screen;
          worldCoords = coords.world;
        }
      } else {
        // For viewport state objects, create minimal coordinates
        // This path should be avoided - always pass Viewport instances
        console.warn('EventManager: Received viewport state instead of Viewport instance. Coordinate accuracy may be affected.');
        screenCoords.x = domEvent.clientX;
        screenCoords.y = domEvent.clientY;
        worldCoords.x = domEvent.clientX;
        worldCoords.y = domEvent.clientY;
      }
    } else {
      // Fallback - use raw event coordinates
      screenCoords.x = domEvent.clientX;
      screenCoords.y = domEvent.clientY;
      worldCoords.x = domEvent.clientX;
      worldCoords.y = domEvent.clientY;
    }
    
    return {
      screenX: screenCoords.x,
      screenY: screenCoords.y,
      worldX: worldCoords.x,
      worldY: worldCoords.y,
      button: domEvent.button || 0,
      ctrlKey: domEvent.ctrlKey || false,
      shiftKey: domEvent.shiftKey || false,
      altKey: domEvent.altKey || false,
      target: 'canvas', // Add target property for canvas events
      originalEvent: domEvent
    };
  }

  /**
   * Create standardized keyboard event data
   * @param {KeyboardEvent} domEvent - DOM keyboard event
   * @returns {Object} Standardized keyboard event data
   */
  static createKeyboardEventData(domEvent) {
    if (!domEvent) {
      throw new Error('DOM event is required');
    }
    
    return {
      key: domEvent.key,
      code: domEvent.code,
      ctrlKey: domEvent.ctrlKey || false,
      shiftKey: domEvent.shiftKey || false,
      altKey: domEvent.altKey || false,
      metaKey: domEvent.metaKey || false,
      originalEvent: domEvent
    };
  }

  /**
   * Throttle event emissions
   * @param {Function} emitFunction - Function to throttle
   * @param {number} delay - Delay in milliseconds
   * @returns {Function} Throttled function
   */
  static throttle(emitFunction, delay) {
    // Delegate to EmitControls for maintainability
    return EmitControls.throttle(emitFunction, delay);
  }

  /**
   * Debounce event emissions
   * @param {Function} emitFunction - Function to debounce
   * @param {number} delay - Delay in milliseconds
   * @returns {Function} Debounced function
   */
  static debounce(emitFunction, delay) {
    return EmitControls.debounce(emitFunction, delay);
  }

  /**
   * Create a rate-limited emitter
   * @param {Function} emitFunction - Function to rate limit
   * @param {number} maxCalls - Maximum calls per period
   * @param {number} period - Time period in milliseconds
   * @returns {Function} Rate-limited function
   */
  static rateLimit(emitFunction, maxCalls, period) {
    return EmitControls.rateLimit(emitFunction, maxCalls, period);
  }

  /**
   * Prevent duplicate rapid events
   * @param {Function} emitFunction - Function to deduplicate
   * @param {number} threshold - Time threshold in milliseconds
   * @param {Function} keyExtractor - Function to extract comparison key from args
   * @returns {Function} Deduplicated function
   */
  static deduplicate(emitFunction, threshold = 50, keyExtractor = null) {
    return EmitControls.deduplicate(emitFunction, threshold, keyExtractor);
  }
}

// Also re-export EmitControls helpers for future direct usage, while keeping EventUtils API intact
export * as EmitControls from './events/EmitControls.js';

/**
 * IMPLEMENTATION GUIDELINES FOR AGENT B3:
 * 
 * 1. Observer Pattern Implementation:
 *    - Use Map/Set for efficient listener storage
 *    - Implement proper memory leak prevention
 *    - Support for one-time listeners (once)
 *    - Event delegation for dynamic DOM elements
 * 
 * 2. Event Data Validation:
 *    - Validate event data against schemas in development mode
 *    - Provide helpful error messages for invalid data
 *    - Type checking for event payloads
 * 
 * 3. Performance Considerations:
 *    - Throttle/debounce high-frequency events (mouse move, scroll)
 *    - Efficient listener lookup and execution
 *    - Minimal memory footprint
 * 
 * 4. Error Handling:
 *    - Catch and handle errors in event listeners
 *    - Provide error context and stack traces
 *    - Continue execution even if one listener fails
 * 
 * 5. Debugging Support:
 *    - Event history tracking
 *    - Listener inspection tools
 *    - Performance metrics
 * 
 * 6. Integration Points:
 *    - Mouse/keyboard event capture from DOM
 *    - Canvas interaction events
 *    - Component lifecycle events
 *    - File operation events
 * 
 * 7. Memory Management:
 *    - Automatic cleanup of destroyed components
 *    - WeakMap usage where appropriate
 *    - Reference counting for complex objects
 */

export default EventManager;
