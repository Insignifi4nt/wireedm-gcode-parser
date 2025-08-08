/**
 * Keyboard Event Handler for Wire EDM G-Code Viewer
 * Handles keyboard shortcuts and key events
 */

import { EventBus, EVENT_TYPES, EventUtils } from './EventManager.js';
import { VIEWPORT } from '../utils/Constants.js';

/**
 * KeyboardHandler class manages keyboard shortcuts and events
 * Extracted from original HTML keyboard event logic
 */
export class KeyboardHandler {
  /**
   * Create KeyboardHandler instance
   * @param {HTMLElement} targetElement - Element to listen for keyboard events (default: document)
   * @param {Viewport} viewport - Viewport instance for zoom/pan operations
   */
  constructor(targetElement = document, viewport = null) {
    this.targetElement = targetElement;
    this.viewport = viewport;
    this.eventBus = EventBus.getInstance();
    
    // Shortcut registry
    this.shortcuts = new Map();
    this.isInitialized = false;
    this.isDestroyed = false;
    
    // State tracking
    this.pressedKeys = new Set();
    this.lastKeyTime = 0;
    this.keyThrottleDelay = 50; // Prevent rapid key repeats
    
    // Bind methods
    this._bindMethods();
    
    // Register default shortcuts
    this._registerDefaultShortcuts();
  }

  /**
   * Bind methods to maintain context
   */
  _bindMethods() {
    this._handleKeyDown = this._handleKeyDown.bind(this);
    this._handleKeyUp = this._handleKeyUp.bind(this);
    this._handleKeyPress = this._handleKeyPress.bind(this);
  }

  /**
   * Initialize keyboard event handlers
   */
  init() {
    if (this.isInitialized) {
      console.warn('KeyboardHandler already initialized');
      return;
    }

    // Add event listeners
    this.targetElement.addEventListener('keydown', this._handleKeyDown);
    this.targetElement.addEventListener('keyup', this._handleKeyUp);
    this.targetElement.addEventListener('keypress', this._handleKeyPress);

    this.isInitialized = true;
  }

  /**
   * Register default keyboard shortcuts
   */
  _registerDefaultShortcuts() {
    // Grid toggle (G key)
    this.registerShortcut('KeyG', {
      description: 'Toggle grid visibility',
      action: () => {
        this.eventBus.emit(EVENT_TYPES.GRID_VISIBILITY_TOGGLE);
      }
    });

    // Zoom shortcuts
    this.registerShortcut('Equal', {
      description: 'Zoom in',
      requiresCtrl: true,
      action: () => {
        if (this.viewport) {
          this.viewport.zoomIn();
          this.eventBus.emit(EVENT_TYPES.VIEWPORT_ZOOM_CHANGE, {
            ...this.viewport.getState(),
            canvasWidth: this.viewport.canvas.width,
            canvasHeight: this.viewport.canvas.height
          });
        }
      }
    });

    this.registerShortcut('Minus', {
      description: 'Zoom out',
      requiresCtrl: true,
      action: () => {
        if (this.viewport) {
          this.viewport.zoomOut();
          this.eventBus.emit(EVENT_TYPES.VIEWPORT_ZOOM_CHANGE, {
            ...this.viewport.getState(),
            canvasWidth: this.viewport.canvas.width,
            canvasHeight: this.viewport.canvas.height
          });
        }
      }
    });

    this.registerShortcut('Digit0', {
      description: 'Reset zoom to 100%',
      requiresCtrl: true,
      action: () => {
        if (this.viewport) {
          this.viewport.setZoom(VIEWPORT.DEFAULT_ZOOM);
          this.eventBus.emit(EVENT_TYPES.VIEWPORT_ZOOM_CHANGE, {
            ...this.viewport.getState(),
            canvasWidth: this.viewport.canvas.width,
            canvasHeight: this.viewport.canvas.height
          });
        }
      }
    });

    // Fit to screen (F key)
    this.registerShortcut('KeyF', {
      description: 'Fit to screen',
      action: () => {
        this.eventBus.emit(EVENT_TYPES.VIEWPORT_FIT_TO_SCREEN);
      }
    });

    // Reset viewport (R key)
    this.registerShortcut('KeyR', {
      description: 'Reset viewport',
      action: () => {
        if (this.viewport) {
          this.viewport.reset();
          this.eventBus.emit(EVENT_TYPES.VIEWPORT_RESET, {
            ...this.viewport.getState(),
            canvasWidth: this.viewport.canvas.width,
            canvasHeight: this.viewport.canvas.height
          });
        }
      }
    });

    // Clear points (C key)
    this.registerShortcut('KeyC', {
      description: 'Clear all points',
      requiresCtrl: true,
      action: () => {
        this.eventBus.emit(EVENT_TYPES.POINT_CLEAR_ALL);
      }
    });

    // Pan shortcuts with arrow keys
    this.registerShortcut('ArrowLeft', {
      description: 'Pan left',
      action: () => {
        if (this.viewport) {
          this.viewport.pan(-VIEWPORT.PAN_STEP, 0);
          this.eventBus.emit(EVENT_TYPES.VIEWPORT_PAN_CHANGE, {
            ...this.viewport.getState(),
            canvasWidth: this.viewport.canvas.width,
            canvasHeight: this.viewport.canvas.height
          });
        }
      }
    });

    this.registerShortcut('ArrowRight', {
      description: 'Pan right',
      action: () => {
        if (this.viewport) {
          this.viewport.pan(VIEWPORT.PAN_STEP, 0);
          this.eventBus.emit(EVENT_TYPES.VIEWPORT_PAN_CHANGE, {
            ...this.viewport.getState(),
            canvasWidth: this.viewport.canvas.width,
            canvasHeight: this.viewport.canvas.height
          });
        }
      }
    });

    this.registerShortcut('ArrowUp', {
      description: 'Pan up',
      action: () => {
        if (this.viewport) {
          this.viewport.pan(0, -VIEWPORT.PAN_STEP);
          this.eventBus.emit(EVENT_TYPES.VIEWPORT_PAN_CHANGE, {
            ...this.viewport.getState(),
            canvasWidth: this.viewport.canvas.width,
            canvasHeight: this.viewport.canvas.height
          });
        }
      }
    });

    this.registerShortcut('ArrowDown', {
      description: 'Pan down',
      action: () => {
        if (this.viewport) {
          this.viewport.pan(0, VIEWPORT.PAN_STEP);
          this.eventBus.emit(EVENT_TYPES.VIEWPORT_PAN_CHANGE, {
            ...this.viewport.getState(),
            canvasWidth: this.viewport.canvas.width,
            canvasHeight: this.viewport.canvas.height
          });
        }
      }
    });
  }

  /**
   * Handle key down events
   * @param {KeyboardEvent} event - Key down event
   */
  _handleKeyDown(event) {
    if (this.isDestroyed) return;

    // Skip if focused on input elements
    if (this._isInputFocused()) {
      return;
    }

    const keyboardData = EventUtils.createKeyboardEventData(event);
    this.pressedKeys.add(event.code);
    
    // Check for shortcuts
    const shortcut = this._findMatchingShortcut(event);
    if (shortcut) {
      event.preventDefault();
      
      // Throttle repeated keys
      const now = Date.now();
      if (now - this.lastKeyTime < this.keyThrottleDelay) {
        return;
      }
      this.lastKeyTime = now;

      // Execute shortcut
      try {
        shortcut.action();
        
        // Emit shortcut event
        this.eventBus.emit(EVENT_TYPES.KEY_SHORTCUT, {
          ...keyboardData,
          shortcut: shortcut.description
        });
      } catch (error) {
        console.error('Error executing keyboard shortcut:', error);
      }
    }

    // Emit key down event
    this.eventBus.emit(EVENT_TYPES.KEY_DOWN, keyboardData);
  }

  /**
   * Handle key up events
   * @param {KeyboardEvent} event - Key up event
   */
  _handleKeyUp(event) {
    if (this.isDestroyed) return;

    const keyboardData = EventUtils.createKeyboardEventData(event);
    this.pressedKeys.delete(event.code);

    // Emit key up event
    this.eventBus.emit(EVENT_TYPES.KEY_UP, keyboardData);
  }

  /**
   * Handle key press events
   * @param {KeyboardEvent} event - Key press event
   */
  _handleKeyPress(event) {
    if (this.isDestroyed) return;

    // Skip if focused on input elements
    if (this._isInputFocused()) {
      return;
    }

    const keyboardData = EventUtils.createKeyboardEventData(event);
    
    // Note: KeyPress events are deprecated, but included for compatibility
    console.debug('KeyPress event:', keyboardData);
  }

  /**
   * Check if an input element is currently focused
   * @returns {boolean} Whether an input element has focus
   */
  _isInputFocused() {
    const activeElement = document.activeElement;
    return activeElement && (
      activeElement.tagName === 'INPUT' ||
      activeElement.tagName === 'TEXTAREA' ||
      activeElement.tagName === 'SELECT' ||
      activeElement.contentEditable === 'true'
    );
  }

  /**
   * Find matching shortcut for key event
   * @param {KeyboardEvent} event - Key event
   * @returns {Object|null} Matching shortcut or null
   */
  _findMatchingShortcut(event) {
    for (const [keyCode, shortcut] of this.shortcuts) {
      if (event.code === keyCode) {
        // Check modifier requirements
        if (shortcut.requiresCtrl && !event.ctrlKey) continue;
        if (shortcut.requiresShift && !event.shiftKey) continue;
        if (shortcut.requiresAlt && !event.altKey) continue;
        if (shortcut.requiresMeta && !event.metaKey) continue;
        
        // Check if modifiers are forbidden
        if (shortcut.forbidCtrl && event.ctrlKey) continue;
        if (shortcut.forbidShift && event.shiftKey) continue;
        if (shortcut.forbidAlt && event.altKey) continue;
        if (shortcut.forbidMeta && event.metaKey) continue;
        
        return shortcut;
      }
    }
    return null;
  }

  /**
   * Register a keyboard shortcut
   * @param {string} keyCode - Key code (e.g., 'KeyG', 'ArrowLeft')
   * @param {Object} shortcut - Shortcut configuration
   * @param {string} shortcut.description - Description of the shortcut
   * @param {Function} shortcut.action - Function to execute
   * @param {boolean} [shortcut.requiresCtrl] - Requires Ctrl key
   * @param {boolean} [shortcut.requiresShift] - Requires Shift key
   * @param {boolean} [shortcut.requiresAlt] - Requires Alt key
   * @param {boolean} [shortcut.requiresMeta] - Requires Meta key
   * @param {boolean} [shortcut.forbidCtrl] - Forbids Ctrl key
   * @param {boolean} [shortcut.forbidShift] - Forbids Shift key
   * @param {boolean} [shortcut.forbidAlt] - Forbids Alt key
   * @param {boolean} [shortcut.forbidMeta] - Forbids Meta key
   */
  registerShortcut(keyCode, shortcut) {
    if (typeof keyCode !== 'string') {
      throw new Error('Key code must be a string');
    }
    
    if (!shortcut || typeof shortcut.action !== 'function') {
      throw new Error('Shortcut must have an action function');
    }

    this.shortcuts.set(keyCode, {
      description: shortcut.description || 'Custom shortcut',
      action: shortcut.action,
      requiresCtrl: shortcut.requiresCtrl || false,
      requiresShift: shortcut.requiresShift || false,
      requiresAlt: shortcut.requiresAlt || false,
      requiresMeta: shortcut.requiresMeta || false,
      forbidCtrl: shortcut.forbidCtrl || false,
      forbidShift: shortcut.forbidShift || false,
      forbidAlt: shortcut.forbidAlt || false,
      forbidMeta: shortcut.forbidMeta || false
    });
  }

  /**
   * Unregister a keyboard shortcut
   * @param {string} keyCode - Key code to unregister
   */
  unregisterShortcut(keyCode) {
    this.shortcuts.delete(keyCode);
  }

  /**
   * Get all registered shortcuts
   * @returns {Map} Map of shortcuts
   */
  getShortcuts() {
    return new Map(this.shortcuts);
  }

  /**
   * Get currently pressed keys
   * @returns {Set} Set of pressed key codes
   */
  getPressedKeys() {
    return new Set(this.pressedKeys);
  }

  /**
   * Check if a key is currently pressed
   * @param {string} keyCode - Key code to check
   * @returns {boolean} Whether the key is pressed
   */
  isKeyPressed(keyCode) {
    return this.pressedKeys.has(keyCode);
  }

  /**
   * Clear all pressed keys (useful for focus loss)
   */
  clearPressedKeys() {
    this.pressedKeys.clear();
  }

  /**
   * Get help text for all shortcuts
   * @returns {string} Formatted help text
   */
  getHelpText() {
    const shortcuts = Array.from(this.shortcuts.entries())
      .map(([keyCode, shortcut]) => {
        let keyDisplay = keyCode.replace(/^Key/, '').replace(/^Digit/, '');
        
        const modifiers = [];
        if (shortcut.requiresCtrl) modifiers.push('Ctrl');
        if (shortcut.requiresShift) modifiers.push('Shift');
        if (shortcut.requiresAlt) modifiers.push('Alt');
        if (shortcut.requiresMeta) modifiers.push('Meta');
        
        if (modifiers.length > 0) {
          keyDisplay = modifiers.join('+') + '+' + keyDisplay;
        }
        
        return `${keyDisplay}: ${shortcut.description}`;
      })
      .join('\n');
    
    return shortcuts;
  }

  /**
   * Destroy keyboard handler and cleanup
   */
  destroy() {
    if (this.isDestroyed) return;

    // Remove event listeners
    this.targetElement.removeEventListener('keydown', this._handleKeyDown);
    this.targetElement.removeEventListener('keyup', this._handleKeyUp);
    this.targetElement.removeEventListener('keypress', this._handleKeyPress);

    // Clear state
    this.shortcuts.clear();
    this.pressedKeys.clear();
    
    this.isDestroyed = true;
  }
}