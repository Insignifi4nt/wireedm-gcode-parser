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

/**
 * Event Types Constants
 * Centralized definition of all application events
 */
export const EVENT_TYPES = {
  // File Operations
  FILE_LOAD_START: 'file:load:start',
  FILE_LOAD_SUCCESS: 'file:load:success',
  FILE_LOAD_ERROR: 'file:load:error',
  FILE_LOAD_PROGRESS: 'file:load:progress',
  FILE_CLEARED: 'file:cleared',
  
  // G-Code Parsing
  GCODE_PARSE_START: 'gcode:parse:start',
  GCODE_PARSE_SUCCESS: 'gcode:parse:success',
  GCODE_PARSE_ERROR: 'gcode:parse:error',
  GCODE_PARSE_PROGRESS: 'gcode:parse:progress',
  
  // Viewport Changes
  VIEWPORT_ZOOM_CHANGE: 'viewport:zoom:change',
  VIEWPORT_PAN_CHANGE: 'viewport:pan:change',
  VIEWPORT_RESET: 'viewport:reset',
  VIEWPORT_FIT_TO_SCREEN: 'viewport:fit:screen',
  
  // Mouse Events
  MOUSE_MOVE: 'mouse:move',
  MOUSE_CLICK: 'mouse:click',
  MOUSE_DOWN: 'mouse:down',
  MOUSE_UP: 'mouse:up',
  MOUSE_WHEEL: 'mouse:wheel',
  MOUSE_ENTER_CANVAS: 'mouse:enter:canvas',
  MOUSE_LEAVE_CANVAS: 'mouse:leave:canvas',
  
  // Point Management
  POINT_ADD: 'point:add',
  POINT_DELETE: 'point:delete',
  POINT_UPDATE: 'point:update',
  POINT_CLEAR_ALL: 'point:clear:all',
  POINT_SELECT: 'point:select',
  POINT_DESELECT: 'point:deselect',
  
  // Grid System
  GRID_SNAP_TOGGLE: 'grid:snap:toggle',
  GRID_SIZE_CHANGE: 'grid:size:change',
  GRID_VISIBILITY_TOGGLE: 'grid:visibility:toggle',
  
  // UI State Changes
  UI_TOOLBAR_TOGGLE: 'ui:toolbar:toggle',
  UI_SIDEBAR_TOGGLE: 'ui:sidebar:toggle',
  UI_THEME_CHANGE: 'ui:theme:change',
  UI_RESIZE: 'ui:resize',
  
  // Keyboard Events
  KEY_DOWN: 'key:down',
  KEY_UP: 'key:up',
  KEY_SHORTCUT: 'key:shortcut',
  
  // Export Operations
  EXPORT_START: 'export:start',
  EXPORT_SUCCESS: 'export:success',
  EXPORT_ERROR: 'export:error',
  
  // Status Messages
  STATUS_SHOW: 'status:show',
  STATUS_HIDE: 'status:hide',
  STATUS_UPDATE: 'status:update',
  
  // Canvas Rendering
  CANVAS_REDRAW: 'canvas:redraw',
  CANVAS_CLEAR: 'canvas:clear',
  CANVAS_RESIZE: 'canvas:resize',
  
  // Application Lifecycle
  APP_INIT: 'app:init',
  APP_READY: 'app:ready',
  APP_DESTROY: 'app:destroy'
};

/**
 * Event Data Structures
 * Type definitions for event payloads
 */
export const EVENT_DATA_SCHEMAS = {
  // Mouse event data
  MOUSE: {
    screenX: 'number',     // Screen coordinates (pixels)
    screenY: 'number',
    worldX: 'number',      // World coordinates (mm)
    worldY: 'number',
    button: 'number',      // Mouse button (0=left, 1=middle, 2=right)
    ctrlKey: 'boolean',    // Modifier keys
    shiftKey: 'boolean',
    altKey: 'boolean',
    originalEvent: 'Event' // Original DOM event
  },
  
  // Viewport change data
  VIEWPORT: {
    zoom: 'number',        // Current zoom level
    offsetX: 'number',     // Viewport offset X
    offsetY: 'number',     // Viewport offset Y
    bounds: 'Object',      // Visible bounds {minX, maxX, minY, maxY}
    canvasWidth: 'number', // Canvas dimensions
    canvasHeight: 'number'
  },
  
  // Point data
  POINT: {
    id: 'string',          // Unique point identifier
    x: 'number',           // World coordinates
    y: 'number',
    index: 'number',       // Point index in array
    metadata: 'Object'     // Additional point data
  },
  
  // File operation data
  FILE: {
    name: 'string',        // File name
    size: 'number',        // File size in bytes
    type: 'string',        // MIME type
    content: 'string',     // File content (for small files)
    progress: 'number'     // Progress percentage (0-100)
  },
  
  // G-Code parse data
  GCODE: {
    path: 'Array',         // Parsed path data
    bounds: 'Object',      // Path bounds {minX, maxX, minY, maxY}
    moveCount: 'number',   // Number of moves
    rapidCount: 'number',  // Number of rapid moves
    cutCount: 'number',    // Number of cutting moves
    arcCount: 'number'     // Number of arc moves
  },
  
  // Keyboard event data
  KEYBOARD: {
    key: 'string',         // Key name
    code: 'string',        // Key code
    ctrlKey: 'boolean',    // Modifier keys
    shiftKey: 'boolean',
    altKey: 'boolean',
    metaKey: 'boolean',
    originalEvent: 'KeyboardEvent'
  },
  
  // Status message data
  STATUS: {
    message: 'string',     // Message text
    type: 'string',        // 'success', 'error', 'warning', 'info'
    duration: 'number',    // Display duration in ms
    persistent: 'boolean'  // Whether message stays until manually dismissed
  },
  
  // Error data
  ERROR: {
    message: 'string',     // Error message
    error: 'Error',        // Error object
    context: 'string',     // Context where error occurred
    stack: 'string'        // Stack trace
  }
};

/**
 * EventManager - Centralized Event Management Implementation
 * 
 * Implements the Observer pattern for loose coupling between components.
 * Provides event delegation, throttling, validation, and debugging support.
 */
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
    this.eventHistory = []; // For debugging
    this.maxHistorySize = 100;
    
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
    this.eventHistory.length = 0;
    
    // Mark as destroyed
    this.isDestroyed = true;
    
    console.debug('EventManager destroyed');
  }

  /**
   * Get event emission history (for debugging)
   * @returns {Array} Array of recent events
   */
  getEventHistory() {
    return [...this.eventHistory];
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
      historySize: this.eventHistory.length,
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
    this.eventHistory.push({
      type: eventType,
      data: eventData,
      timestamp: Date.now(),
      listeners: this.getListeners(eventType).length
    });
    
    // Maintain history size limit
    if (this.eventHistory.length > this.maxHistorySize) {
      this.eventHistory.shift();
    }
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
export class EventValidator {
  /**
   * Validate event data against schema
   * @param {string} eventType - Event type
   * @param {*} eventData - Event data to validate
   * @returns {Object} Validation result {valid: boolean, errors: Array}
   */
  static validate(eventType, eventData) {
    const schema = EventValidator.getSchema(eventType);
    
    if (!schema) {
      // No schema defined, consider valid
      return { valid: true, errors: [] };
    }
    
    const errors = [];
    
    // Null/undefined check
    if (eventData === null || eventData === undefined) {
      if (schema.required !== false) {
        errors.push(`Event data is required for ${eventType}`);
      }
      return { valid: errors.length === 0, errors };
    }
    
    // Type validation
    for (const [field, expectedType] of Object.entries(schema)) {
      if (field === 'required') continue;
      
      const value = eventData[field];
      const actualType = typeof value;
      
      // Skip validation for undefined optional fields
      if (value === undefined) continue;
      
      // Special type checks
      if (expectedType === 'Array' && !Array.isArray(value)) {
        errors.push(`Field '${field}' must be an array, got ${actualType}`);
      } else if (expectedType === 'Object' && (typeof value !== 'object' || value === null || Array.isArray(value))) {
        // Debug logging for bounds validation issue
        if (field === 'bounds') {
          console.debug(`Bounds validation failed:`, {
            field: field,
            expectedType: expectedType,
            actualType: typeof value,
            isNull: value === null,
            isArray: Array.isArray(value),
            value: value
          });
        }
        errors.push(`Field '${field}' must be an object, got ${Array.isArray(value) ? 'array' : typeof value}`);
      } else if (expectedType === 'Event') {
        // For Event validation, accept both native Event instances and event-like objects
        // This handles cases where events are wrapped, transformed, or synthetic
        if (!(value instanceof Event) && 
            !(typeof value === 'object' && value !== null && 
              (value.type !== undefined || value.target !== undefined || value.currentTarget !== undefined ||
               value.clientX !== undefined || value.clientY !== undefined || value.button !== undefined ||
               typeof value.preventDefault === 'function' || typeof value.stopPropagation === 'function'))) {
          errors.push(`Field '${field}' must be of type Event, got ${typeof value}`);
        }
      } else if (expectedType === 'KeyboardEvent') {
        // For KeyboardEvent validation, accept both native KeyboardEvent instances and event-like objects
        // This handles cases where events are wrapped, transformed, or synthetic
        if (!(value instanceof KeyboardEvent) && 
            !(typeof value === 'object' && value !== null && 
              (value.type !== undefined || value.target !== undefined || value.currentTarget !== undefined ||
               value.key !== undefined || value.code !== undefined || value.keyCode !== undefined ||
               typeof value.preventDefault === 'function' || typeof value.stopPropagation === 'function'))) {
          errors.push(`Field '${field}' must be a KeyboardEvent object`);
        }
      } else if (expectedType === 'Error' && !(value instanceof Error)) {
        errors.push(`Field '${field}' must be an Error object`);
      } else if (typeof expectedType === 'string' && actualType !== expectedType) {
        errors.push(`Field '${field}' must be of type ${expectedType}, got ${actualType}`);
      }
      
      // Number validation
      if (expectedType === 'number' && !isFinite(value)) {
        errors.push(`Field '${field}' must be a finite number`);
      }
    }
    
    return { valid: errors.length === 0, errors };
  }

  /**
   * Get schema for event type
   * @param {string} eventType - Event type
   * @returns {Object|null} Schema object or null if not found
   */
  static getSchema(eventType) {
    // Map event types to their schemas
    const schemaMap = {
      // Mouse events
      [EVENT_TYPES.MOUSE_MOVE]: EVENT_DATA_SCHEMAS.MOUSE,
      [EVENT_TYPES.MOUSE_CLICK]: EVENT_DATA_SCHEMAS.MOUSE,
      [EVENT_TYPES.MOUSE_DOWN]: EVENT_DATA_SCHEMAS.MOUSE,
      [EVENT_TYPES.MOUSE_UP]: EVENT_DATA_SCHEMAS.MOUSE,
      [EVENT_TYPES.MOUSE_WHEEL]: EVENT_DATA_SCHEMAS.MOUSE,
      [EVENT_TYPES.MOUSE_ENTER_CANVAS]: EVENT_DATA_SCHEMAS.MOUSE,
      [EVENT_TYPES.MOUSE_LEAVE_CANVAS]: EVENT_DATA_SCHEMAS.MOUSE,
      
      // Viewport events
      [EVENT_TYPES.VIEWPORT_ZOOM_CHANGE]: EVENT_DATA_SCHEMAS.VIEWPORT,
      [EVENT_TYPES.VIEWPORT_PAN_CHANGE]: EVENT_DATA_SCHEMAS.VIEWPORT,
      [EVENT_TYPES.VIEWPORT_RESET]: EVENT_DATA_SCHEMAS.VIEWPORT,
      [EVENT_TYPES.VIEWPORT_FIT_TO_SCREEN]: EVENT_DATA_SCHEMAS.VIEWPORT,
      
      // Point events
      [EVENT_TYPES.POINT_ADD]: EVENT_DATA_SCHEMAS.POINT,
      [EVENT_TYPES.POINT_DELETE]: EVENT_DATA_SCHEMAS.POINT,
      [EVENT_TYPES.POINT_UPDATE]: EVENT_DATA_SCHEMAS.POINT,
      [EVENT_TYPES.POINT_SELECT]: EVENT_DATA_SCHEMAS.POINT,
      [EVENT_TYPES.POINT_DESELECT]: EVENT_DATA_SCHEMAS.POINT,
      
      // File events
      [EVENT_TYPES.FILE_LOAD_START]: EVENT_DATA_SCHEMAS.FILE,
      [EVENT_TYPES.FILE_LOAD_SUCCESS]: EVENT_DATA_SCHEMAS.FILE,
      [EVENT_TYPES.FILE_LOAD_ERROR]: EVENT_DATA_SCHEMAS.ERROR,
      [EVENT_TYPES.FILE_LOAD_PROGRESS]: EVENT_DATA_SCHEMAS.FILE,
      
      // G-Code events
      [EVENT_TYPES.GCODE_PARSE_START]: { required: false },
      [EVENT_TYPES.GCODE_PARSE_SUCCESS]: EVENT_DATA_SCHEMAS.GCODE,
      [EVENT_TYPES.GCODE_PARSE_ERROR]: EVENT_DATA_SCHEMAS.ERROR,
      [EVENT_TYPES.GCODE_PARSE_PROGRESS]: { progress: 'number' },
      
      // Keyboard events
      [EVENT_TYPES.KEY_DOWN]: EVENT_DATA_SCHEMAS.KEYBOARD,
      [EVENT_TYPES.KEY_UP]: EVENT_DATA_SCHEMAS.KEYBOARD,
      [EVENT_TYPES.KEY_SHORTCUT]: EVENT_DATA_SCHEMAS.KEYBOARD,
      
      // Status events
      [EVENT_TYPES.STATUS_SHOW]: EVENT_DATA_SCHEMAS.STATUS,
      [EVENT_TYPES.STATUS_HIDE]: { required: false },
      [EVENT_TYPES.STATUS_UPDATE]: EVENT_DATA_SCHEMAS.STATUS,
      
      // Canvas events
      [EVENT_TYPES.CANVAS_REDRAW]: { required: false },
      [EVENT_TYPES.CANVAS_CLEAR]: { required: false },
      [EVENT_TYPES.CANVAS_RESIZE]: { width: 'number', height: 'number' }
    };
    
    return schemaMap[eventType] || null;
  }
}

/**
 * Event Bus Singleton
 * Global event bus instance for the application
 */
let eventBusInstance = null;

export class EventBus {
  /**
   * Get singleton instance
   * @returns {EventManager} Singleton instance
   */
  static getInstance() {
    if (!eventBusInstance) {
      eventBusInstance = new EventManager();
    }
    return eventBusInstance;
  }

  /**
   * Initialize the event bus with specific implementation
   * @param {EventManager} implementation - Concrete implementation
   */
  static setImplementation(implementation) {
    if (eventBusInstance && typeof eventBusInstance.destroy === 'function') {
      eventBusInstance.destroy();
    }
    eventBusInstance = implementation;
  }

  /**
   * Reset singleton (mainly for testing)
   */
  static reset() {
    if (eventBusInstance && typeof eventBusInstance.destroy === 'function') {
      eventBusInstance.destroy();
    }
    eventBusInstance = null;
  }
  
  /**
   * Quick access methods for common operations
   */
  static on(eventType, callback, options) {
    return EventBus.getInstance().on(eventType, callback, options);
  }
  
  static once(eventType, callback) {
    return EventBus.getInstance().once(eventType, callback);
  }
  
  static off(eventType, callback) {
    return EventBus.getInstance().off(eventType, callback);
  }
  
  static emit(eventType, eventData, options) {
    return EventBus.getInstance().emit(eventType, eventData, options);
  }
  
  static delegate(selector, domEventType, customEventType, dataExtractor) {
    return EventBus.getInstance().delegate(selector, domEventType, customEventType, dataExtractor);
  }
}

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
    if (typeof emitFunction !== 'function') {
      throw new Error('First argument must be a function');
    }
    
    if (typeof delay !== 'number' || delay < 0) {
      throw new Error('Delay must be a non-negative number');
    }
    
    let isThrottled = false;
    let lastArgs = null;
    
    return function throttledFunction(...args) {
      if (!isThrottled) {
        // Execute immediately
        emitFunction.apply(this, args);
        isThrottled = true;
        
        setTimeout(() => {
          isThrottled = false;
          
          // Execute with latest args if there were subsequent calls
          if (lastArgs) {
            emitFunction.apply(this, lastArgs);
            lastArgs = null;
          }
        }, delay);
      } else {
        // Store latest args
        lastArgs = args;
      }
    };
  }

  /**
   * Debounce event emissions
   * @param {Function} emitFunction - Function to debounce
   * @param {number} delay - Delay in milliseconds
   * @returns {Function} Debounced function
   */
  static debounce(emitFunction, delay) {
    if (typeof emitFunction !== 'function') {
      throw new Error('First argument must be a function');
    }
    
    if (typeof delay !== 'number' || delay < 0) {
      throw new Error('Delay must be a non-negative number');
    }
    
    let timeoutId = null;
    
    return function debouncedFunction(...args) {
      // Clear existing timeout
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      
      // Set new timeout
      timeoutId = setTimeout(() => {
        emitFunction.apply(this, args);
        timeoutId = null;
      }, delay);
    };
  }

  /**
   * Create a rate-limited emitter
   * @param {Function} emitFunction - Function to rate limit
   * @param {number} maxCalls - Maximum calls per period
   * @param {number} period - Time period in milliseconds
   * @returns {Function} Rate-limited function
   */
  static rateLimit(emitFunction, maxCalls, period) {
    if (typeof emitFunction !== 'function') {
      throw new Error('First argument must be a function');
    }
    
    const calls = [];
    
    return function rateLimitedFunction(...args) {
      const now = Date.now();
      
      // Remove old calls outside the period
      while (calls.length > 0 && calls[0] <= now - period) {
        calls.shift();
      }
      
      // Check if we're under the limit
      if (calls.length < maxCalls) {
        calls.push(now);
        return emitFunction.apply(this, args);
      }
      
      // Rate limit exceeded - could emit a warning event here
      console.debug(`Rate limit exceeded: ${maxCalls} calls per ${period}ms`);
    };
  }

  /**
   * Prevent duplicate rapid events
   * @param {Function} emitFunction - Function to deduplicate
   * @param {number} threshold - Time threshold in milliseconds
   * @param {Function} keyExtractor - Function to extract comparison key from args
   * @returns {Function} Deduplicated function
   */
  static deduplicate(emitFunction, threshold = 50, keyExtractor = null) {
    if (typeof emitFunction !== 'function') {
      throw new Error('First argument must be a function');
    }
    
    const lastCalls = new Map();
    
    return function deduplicatedFunction(...args) {
      const now = Date.now();
      const key = keyExtractor ? keyExtractor(...args) : JSON.stringify(args);
      const lastCall = lastCalls.get(key);
      
      if (!lastCall || now - lastCall > threshold) {
        lastCalls.set(key, now);
        
        // Clean up old entries periodically
        if (lastCalls.size > 100) {
          for (const [k, time] of lastCalls.entries()) {
            if (now - time > threshold * 2) {
              lastCalls.delete(k);
            }
          }
        }
        
        return emitFunction.apply(this, args);
      }
    };
  }
}

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