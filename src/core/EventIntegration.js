/**
 * Event Integration System for Wire EDM G-Code Viewer
 * Integrates all event handlers and provides a unified interface
 */

import { EventBus } from './EventManager.js';
import { MouseEventHandler } from './MouseEventHandler.js';
import { KeyboardHandler } from './KeyboardHandler.js';
import { TouchEventHandler } from './TouchEventHandler.js';
import { EventDelegator } from './EventDelegator.js';

/**
 * EventIntegration class manages all event handlers
 * Provides a unified interface for event management
 */
export class EventIntegration {
  /**
   * Create EventIntegration instance
   * @param {HTMLCanvasElement} canvas - Canvas element
   * @param {Viewport} viewport - Viewport instance
   * @param {Object} options - Configuration options
   */
  constructor(canvas, viewport, options = {}) {
    this.canvas = canvas;
    this.viewport = viewport;
    this.options = {
      enableMouse: true,
      enableKeyboard: true,
      enableTouch: true,
      enableDelegation: true,
      ...options
    };

    // Event system components
    this.eventBus = EventBus.getInstance();
    this.mouseHandler = null;
    this.keyboardHandler = null;
    this.touchHandler = null;
    this.delegator = null;

    // State
    this.isInitialized = false;
    this.isDestroyed = false;
  }

  /**
   * Initialize all event handlers
   */
  async init() {
    if (this.isInitialized) {
      console.warn('EventIntegration already initialized');
      return;
    }

    try {
      // Initialize mouse events
      if (this.options.enableMouse) {
        this.mouseHandler = new MouseEventHandler(this.canvas, this.viewport);
        this.mouseHandler.init();
      }

      // Initialize keyboard events
      if (this.options.enableKeyboard) {
        this.keyboardHandler = new KeyboardHandler(document, this.viewport);
        this.keyboardHandler.init();
      }

      // Initialize touch events
      if (this.options.enableTouch) {
        this.touchHandler = new TouchEventHandler(this.canvas, this.viewport);
        this.touchHandler.init();
      }

      // Initialize event delegation
      if (this.options.enableDelegation) {
        this.delegator = new EventDelegator(document);
        this.delegator.init();
      }

      this.isInitialized = true;
      console.log('EventIntegration initialized successfully');
      
    } catch (error) {
      console.error('Failed to initialize EventIntegration:', error);
      throw error;
    }
  }

  /**
   * Get event system statistics
   * @returns {Object} Statistics about all event handlers
   */
  getStats() {
    return {
      mouse: this.mouseHandler?.getState() || null,
      keyboard: this.keyboardHandler?.getPressedKeys() || null,
      touch: this.touchHandler?.getState() || null,
      delegation: this.delegator?.getStats() || null,
      eventBus: this.eventBus.getStats()
    };
  }

  /**
   * Enable or disable specific event types
   * @param {string} type - Event type ('mouse', 'keyboard', 'touch', 'delegation')
   * @param {boolean} enabled - Whether to enable the event type
   */
  setEventTypeEnabled(type, enabled) {
    switch (type) {
      case 'mouse':
        if (this.mouseHandler) {
          this.mouseHandler.setEnabled(enabled);
        }
        break;
      case 'keyboard':
        // Keyboard handler doesn't have enable/disable
        break;
      case 'touch':
        if (this.touchHandler) {
          this.touchHandler.setEnabled(enabled);
        }
        break;
      case 'delegation':
        // Delegation is always enabled if created
        break;
      default:
        console.warn(`Unknown event type: ${type}`);
    }
  }

  /**
   * Register a custom keyboard shortcut
   * @param {string} keyCode - Key code
   * @param {Object} shortcut - Shortcut configuration
   */
  registerKeyboardShortcut(keyCode, shortcut) {
    if (this.keyboardHandler) {
      this.keyboardHandler.registerShortcut(keyCode, shortcut);
    }
  }

  /**
   * Register a custom event delegation
   * @param {string} eventType - DOM event type
   * @param {string} selector - CSS selector
   * @param {Function} handler - Event handler
   */
  registerDelegation(eventType, selector, handler) {
    if (this.delegator) {
      return this.delegator.addDelegation(eventType, selector, handler);
    }
    return () => {};
  }

  /**
   * Update touch handler configuration
   * @param {Object} config - Touch configuration
   */
  updateTouchConfig(config) {
    if (this.touchHandler) {
      this.touchHandler.updateConfig(config);
    }
  }

  /**
   * Get keyboard help text
   * @returns {string} Help text for keyboard shortcuts
   */
  getKeyboardHelp() {
    return this.keyboardHandler?.getHelpText() || 'Keyboard handler not available';
  }

  /**
   * Clear all pressed keys (useful for focus loss)
   */
  clearPressedKeys() {
    if (this.keyboardHandler) {
      this.keyboardHandler.clearPressedKeys();
    }
  }

  /**
   * Check if a key is currently pressed
   * @param {string} keyCode - Key code to check
   * @returns {boolean} Whether the key is pressed
   */
  isKeyPressed(keyCode) {
    return this.keyboardHandler?.isKeyPressed(keyCode) || false;
  }

  /**
   * Get current mouse state
   * @returns {Object} Mouse state
   */
  getMouseState() {
    return this.mouseHandler?.getState() || null;
  }

  /**
   * Get current touch state
   * @returns {Object} Touch state
   */
  getTouchState() {
    return this.touchHandler?.getState() || null;
  }

  /**
   * Destroy all event handlers and cleanup
   */
  destroy() {
    if (this.isDestroyed) return;

    // Destroy all handlers
    if (this.mouseHandler) {
      this.mouseHandler.destroy();
      this.mouseHandler = null;
    }

    if (this.keyboardHandler) {
      this.keyboardHandler.destroy();
      this.keyboardHandler = null;
    }

    if (this.touchHandler) {
      this.touchHandler.destroy();
      this.touchHandler = null;
    }

    if (this.delegator) {
      this.delegator.destroy();
      this.delegator = null;
    }

    this.isDestroyed = true;
  }
}

/**
 * Factory function to create EventIntegration with default configuration
 * @param {HTMLCanvasElement} canvas - Canvas element
 * @param {Viewport} viewport - Viewport instance
 * @param {Object} options - Configuration options
 * @returns {EventIntegration} EventIntegration instance
 */
export function createEventIntegration(canvas, viewport, options = {}) {
  return new EventIntegration(canvas, viewport, options);
}

/**
 * Utility function to check if device supports touch
 * @returns {boolean} Whether device supports touch
 */
export function isTouchDevice() {
  return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
}

/**
 * Utility function to check if device is mobile
 * @returns {boolean} Whether device is mobile
 */
export function isMobileDevice() {
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}

export default EventIntegration;