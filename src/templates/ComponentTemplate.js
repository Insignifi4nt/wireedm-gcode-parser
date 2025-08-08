/**
 * Component Template - Base ES6 Class Pattern
 * 
 * This template provides a standard pattern for creating components in the Wire EDM G-Code Viewer.
 * All components should follow this structure for consistency and maintainability.
 * 
 * USAGE:
 * 1. Copy this template for new components
 * 2. Replace 'ComponentTemplate' with your component name
 * 3. Update the constructor parameters as needed
 * 4. Implement the required methods
 * 5. Add component-specific methods
 * 
 * NAMING CONVENTIONS:
 * - Class names: PascalCase (e.g., CanvasRenderer, FileHandler)
 * - Method names: camelCase (e.g., init, handleClick, updateDisplay)
 * - Private methods: prefix with _ (e.g., _setupEventListeners, _validateInput)
 * - Constants: SCREAMING_SNAKE_CASE (e.g., DEFAULT_OPTIONS, EVENT_TYPES)
 */

// Import required modules
import { EventBus, EVENT_TYPES } from '../core/EventManager.js';
import { THEME, UI } from '../utils/Constants.js';
import { ValidationUtils } from '../utils/MathUtils.js';

/**
 * ComponentTemplate - Template for creating UI/Logic components
 * 
 * @example
 * const component = new ComponentTemplate(container, options);
 * component.init();
 */
export class ComponentTemplate {
  /**
   * Constructor
   * @param {HTMLElement} container - DOM container for the component
   * @param {Object} options - Configuration options
   */
  constructor(container, options = {}) {
    // Validate required parameters
    if (!container || !(container instanceof HTMLElement)) {
      throw new Error('ComponentTemplate requires a valid DOM container');
    }

    // Store references
    this.container = container;
    this.eventBus = EventBus.getInstance();
    
    // Merge options with defaults
    this.options = {
      ...this._getDefaultOptions(),
      ...options
    };

    // Component state
    this.isInitialized = false;
    this.isDestroyed = false;
    this.componentId = this._generateId();

    // Event listener references for cleanup
    this.eventListeners = new Map();
    this.domEventListeners = new Map();

    // Bind methods to preserve 'this' context
    this._bindMethods();
  }

  /**
   * Get default options for the component
   * @returns {Object} Default options
   * @private
   */
  _getDefaultOptions() {
    return {
      className: 'component-template',
      enabled: true,
      autoInit: false,
      theme: THEME
    };
  }

  /**
   * Bind methods to preserve 'this' context
   * @private
   */
  _bindMethods() {
    // Bind event handlers
    this.handleResize = this.handleResize.bind(this);
    this.handleDestroy = this.handleDestroy.bind(this);
    
    // Add other method bindings as needed
  }

  /**
   * Initialize the component
   * This method should be called after construction to set up the component
   * @returns {Promise<void>}
   */
  async init() {
    if (this.isInitialized) {
      console.warn(`${this.constructor.name} is already initialized`);
      return;
    }

    try {
      // Validate component state
      this._validateState();

      // Create DOM structure
      this._createDOM();

      // Set up event listeners
      this._setupEventListeners();

      // Initialize component-specific logic
      await this._initializeComponent();

      // Mark as initialized
      this.isInitialized = true;

      // Emit initialization event
      this.eventBus.emit(EVENT_TYPES.APP_INIT, {
        component: this.constructor.name,
        id: this.componentId
      });

      console.log(`${this.constructor.name} initialized successfully`);
    } catch (error) {
      console.error(`Failed to initialize ${this.constructor.name}:`, error);
      throw error;
    }
  }

  /**
   * Component-specific initialization logic
   * Override this method in derived classes
   * @returns {Promise<void>}
   * @protected
   */
  async _initializeComponent() {
    // Override in derived classes
    // Example: load data, set up canvas, initialize state, etc.
  }

  /**
   * Create DOM structure for the component
   * @private
   */
  _createDOM() {
    // Clear existing content
    this.container.innerHTML = '';

    // Add base CSS class
    this.container.classList.add(this.options.className);

    // Create component structure
    this.elements = {
      wrapper: this._createElement('div', 'wrapper'),
      content: this._createElement('div', 'content')
    };

    // Append elements
    this.elements.wrapper.appendChild(this.elements.content);
    this.container.appendChild(this.elements.wrapper);
  }

  /**
   * Set up event listeners
   * @private
   */
  _setupEventListeners() {
    // Application event listeners
    this._addEventListener(EVENT_TYPES.UI_RESIZE, this.handleResize);
    this._addEventListener(EVENT_TYPES.APP_DESTROY, this.handleDestroy);

    // DOM event listeners
    this._addDOMEventListener(window, 'resize', this.handleResize);

    // Component-specific event listeners
    this._setupComponentEventListeners();
  }

  /**
   * Set up component-specific event listeners
   * Override this method in derived classes
   * @protected
   */
  _setupComponentEventListeners() {
    // Override in derived classes
    // Example: canvas events, button clicks, etc.
  }

  /**
   * Add application event listener with cleanup tracking
   * @param {string} eventType - Event type
   * @param {Function} handler - Event handler
   * @private
   */
  _addEventListener(eventType, handler) {
    const unsubscribe = this.eventBus.on(eventType, handler);
    this.eventListeners.set(eventType, unsubscribe);
  }

  /**
   * Add DOM event listener with cleanup tracking
   * @param {EventTarget} target - Event target
   * @param {string} eventType - Event type
   * @param {Function} handler - Event handler
   * @param {Object} options - Event options
   * @private
   */
  _addDOMEventListener(target, eventType, handler, options = {}) {
    target.addEventListener(eventType, handler, options);
    
    const key = `${target.constructor.name}-${eventType}`;
    if (!this.domEventListeners.has(key)) {
      this.domEventListeners.set(key, []);
    }
    this.domEventListeners.get(key).push({ target, eventType, handler, options });
  }

  /**
   * Create DOM element with optional CSS class
   * @param {string} tag - HTML tag name
   * @param {string} className - CSS class name
   * @returns {HTMLElement} Created element
   * @private
   */
  _createElement(tag, className = '') {
    const element = document.createElement(tag);
    if (className) {
      element.classList.add(`${this.options.className}__${className}`);
    }
    return element;
  }

  /**
   * Generate unique component ID
   * @returns {string} Unique ID
   * @private
   */
  _generateId() {
    return `${this.constructor.name.toLowerCase()}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Validate component state
   * @private
   */
  _validateState() {
    if (this.isDestroyed) {
      throw new Error(`${this.constructor.name} has been destroyed`);
    }

    if (!this.container.isConnected) {
      throw new Error(`${this.constructor.name} container is not in the DOM`);
    }
  }

  /**
   * Handle resize events
   * @param {Object} eventData - Resize event data
   */
  handleResize(eventData) {
    if (!this.isInitialized || this.isDestroyed) return;

    // Update component dimensions
    this._updateDimensions();

    // Emit component resize event
    this.eventBus.emit(EVENT_TYPES.UI_RESIZE, {
      component: this.constructor.name,
      id: this.componentId,
      dimensions: this._getDimensions()
    });
  }

  /**
   * Handle component destruction
   */
  handleDestroy() {
    this.destroy();
  }

  /**
   * Update component dimensions
   * Override this method in derived classes if needed
   * @protected
   */
  _updateDimensions() {
    // Override in derived classes
    // Example: resize canvas, update layout, etc.
  }

  /**
   * Get component dimensions
   * @returns {Object} Dimensions object
   * @protected
   */
  _getDimensions() {
    const rect = this.container.getBoundingClientRect();
    return {
      width: rect.width,
      height: rect.height,
      top: rect.top,
      left: rect.left
    };
  }

  /**
   * Enable the component
   */
  enable() {
    this.options.enabled = true;
    this.container.classList.remove('disabled');
    
    this.eventBus.emit(EVENT_TYPES.UI_ENABLE, {
      component: this.constructor.name,
      id: this.componentId
    });
  }

  /**
   * Disable the component
   */
  disable() {
    this.options.enabled = false;
    this.container.classList.add('disabled');
    
    this.eventBus.emit(EVENT_TYPES.UI_DISABLE, {
      component: this.constructor.name,
      id: this.componentId
    });
  }

  /**
   * Check if component is enabled
   * @returns {boolean} True if enabled
   */
  isEnabled() {
    return this.options.enabled;
  }

  /**
   * Update component options
   * @param {Object} newOptions - New options to merge
   */
  updateOptions(newOptions) {
    this.options = { ...this.options, ...newOptions };
    
    // Apply option changes
    this._applyOptions();
    
    this.eventBus.emit(EVENT_TYPES.UI_OPTIONS_UPDATE, {
      component: this.constructor.name,
      id: this.componentId,
      options: this.options
    });
  }

  /**
   * Apply current options to the component
   * Override this method in derived classes
   * @protected
   */
  _applyOptions() {
    // Override in derived classes
    // Example: update theme, change behavior, etc.
  }

  /**
   * Get current component state
   * @returns {Object} Component state
   */
  getState() {
    return {
      id: this.componentId,
      isInitialized: this.isInitialized,
      isDestroyed: this.isDestroyed,
      isEnabled: this.isEnabled(),
      options: { ...this.options },
      dimensions: this._getDimensions()
    };
  }

  /**
   * Destroy the component and clean up resources
   */
  destroy() {
    if (this.isDestroyed) {
      console.warn(`${this.constructor.name} is already destroyed`);
      return;
    }

    try {
      // Clean up event listeners
      this._cleanupEventListeners();

      // Component-specific cleanup
      this._cleanup();

      // Remove DOM elements
      if (this.container) {
        this.container.innerHTML = '';
        this.container.classList.remove(this.options.className);
      }

      // Mark as destroyed
      this.isDestroyed = true;
      this.isInitialized = false;

      // Emit destruction event
      this.eventBus.emit(EVENT_TYPES.APP_DESTROY, {
        component: this.constructor.name,
        id: this.componentId
      });

      console.log(`${this.constructor.name} destroyed successfully`);
    } catch (error) {
      console.error(`Error destroying ${this.constructor.name}:`, error);
    }
  }

  /**
   * Component-specific cleanup logic
   * Override this method in derived classes
   * @protected
   */
  _cleanup() {
    // Override in derived classes
    // Example: cancel animations, close connections, etc.
  }

  /**
   * Clean up all event listeners
   * @private
   */
  _cleanupEventListeners() {
    // Clean up application event listeners
    for (const [eventType, unsubscribe] of this.eventListeners) {
      try {
        unsubscribe();
      } catch (error) {
        console.warn(`Error unsubscribing from ${eventType}:`, error);
      }
    }
    this.eventListeners.clear();

    // Clean up DOM event listeners
    for (const [key, listeners] of this.domEventListeners) {
      for (const { target, eventType, handler } of listeners) {
        try {
          target.removeEventListener(eventType, handler);
        } catch (error) {
          console.warn(`Error removing DOM listener for ${eventType}:`, error);
        }
      }
    }
    this.domEventListeners.clear();
  }
}

export default ComponentTemplate;