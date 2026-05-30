/**
 * Event Delegation System for Wire EDM G-Code Viewer
 * Handles event delegation for dynamic UI elements
 */

import { EventBus, EVENT_TYPES } from './EventManager.js';

/**
 * EventDelegator class manages event delegation for dynamic elements
 * Implements efficient event delegation patterns
 */
export class EventDelegator {
  /**
   * Create EventDelegator instance
   * @param {HTMLElement} rootElement - Root element to delegate events from (default: document)
   */
  constructor(rootElement = document) {
    this.rootElement = rootElement;
    this.eventBus = EventBus.getInstance();
    
    // Event mapping registry
    this.delegations = new Map();
    this.isInitialized = false;
    this.isDestroyed = false;
    
    // Drag overlay for enhanced visual feedback
    this.dragOverlay = null;
    this.dragOverlayTimer = null;
    
    // Bind methods
    this._bindMethods();
  }

  /**
   * Bind methods to maintain context
   */
  _bindMethods() {
    this._handleDelegatedEvent = this._handleDelegatedEvent.bind(this);
  }

  /**
   * Initialize event delegation
   */
  init() {
    if (this.isInitialized) {
      console.warn('EventDelegator already initialized');
      return;
    }

    // Register default delegations
    this._registerDefaultDelegations();
    
    // Add global drag leave to hide overlay when dragging outside window
    this._addGlobalDragHandlers();
    
    this.isInitialized = true;
  }

  /**
   * Register default event delegations for common UI elements
   */
  _registerDefaultDelegations() {
    // Button clicks
    this.addDelegation('click', 'button', (event, element) => {
      const action = element.dataset.action || element.onclick?.toString() || 'button-click';
      
      this.eventBus.emit(EVENT_TYPES.UI_TOOLBAR_TOGGLE, {
        action: action,
        element: element,
        event: event
      });
    });

    // Point deletion buttons
    this.addDelegation('click', '.delete-point-btn', (event, element) => {
      const pointId = element.dataset.pointId;
      this.eventBus.emit(EVENT_TYPES.POINT_DELETE, {
        id: pointId,
        element: element,
        event: event
      });
    });

    // File input change is handled by Toolbar/FileControls to prevent duplicate emissions

    // Zoom control buttons
    this.addDelegation('click', '.zoom-in', (event, element) => {
      this.eventBus.emit(
        EVENT_TYPES.VIEWPORT_ZOOM_CHANGE,
        { action: 'zoom-in', element, event },
        { skipValidation: true }
      );
    });

    this.addDelegation('click', '.zoom-out', (event, element) => {
      this.eventBus.emit(
        EVENT_TYPES.VIEWPORT_ZOOM_CHANGE,
        { action: 'zoom-out', element, event },
        { skipValidation: true }
      );
    });

    this.addDelegation('click', '.fit-to-screen', (event, element) => {
      this.eventBus.emit(EVENT_TYPES.VIEWPORT_FIT_TO_SCREEN, {
        element: element,
        event: event
      });
    });

    // Point management buttons
    this.addDelegation('click', '.clear-points', (event, element) => {
      this.eventBus.emit(EVENT_TYPES.POINT_CLEAR_ALL, {
        element: element,
        event: event
      });
    });

    this.addDelegation('click', '.export-points', (event, element) => {
      this.eventBus.emit(EVENT_TYPES.EXPORT_START, {
        type: 'points',
        element: element,
        event: event
      });
    });

    // Grid toggle elements
    this.addDelegation('click', '.grid-toggle', (event, element) => {
      this.eventBus.emit(
        EVENT_TYPES.GRID_SNAP_TOGGLE,
        { element, event },
        { skipValidation: true }
      );
    });

    // Theme toggle elements
    this.addDelegation('click', '.theme-toggle', (event, element) => {
      this.eventBus.emit(EVENT_TYPES.UI_THEME_CHANGE, {
        element: element,
        event: event
      });
    });

    // Sidebar toggle elements
    this.addDelegation('click', '.sidebar-toggle', (event, element) => {
      this.eventBus.emit(EVENT_TYPES.UI_SIDEBAR_TOGGLE, {
        element: element,
        event: event
      });
    });

    // Navigation elements
    this.addDelegation('click', '[data-nav]', (event, element) => {
      const navTarget = element.dataset.nav;
      
      this.eventBus.emit(EVENT_TYPES.UI_TOOLBAR_TOGGLE, {
        action: 'navigate',
        target: navTarget,
        element: element,
        event: event
      });
    });

    // Form submissions
    this.addDelegation('submit', 'form', (event, element) => {
      event.preventDefault();
      
      const formData = new FormData(element);
      const data = Object.fromEntries(formData.entries());
      
      this.eventBus.emit(EVENT_TYPES.FILE_LOAD_START, {
        type: 'form-submit',
        data: data,
        element: element,
        event: event
      });
    });

    // Drag and drop on canvas/file areas with enhanced feedback
    // Note: file-input label drag/drop is handled by FileControls; avoid duplicate events here
    this.addDelegation('dragover', '.file-drop-area, canvas', (event, element) => {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
      
      // Add visual feedback
      element.classList.add('drag-over');
      
      // Add global drag overlay if not already present
      this._showDragOverlay();
    });

    this.addDelegation('dragleave', '.file-drop-area, canvas', (event, element) => {
      event.preventDefault();
      
      // Only remove drag-over if we're actually leaving the element
      if (!element.contains(event.relatedTarget)) {
        element.classList.remove('drag-over');
      }
    });

    this.addDelegation('drop', '.file-drop-area, canvas', (event, element) => {
      event.preventDefault();
      element.classList.remove('drag-over');
      
      // Hide drag overlay
      this._hideDragOverlay();
      
      const files = Array.from(event.dataTransfer.files || []);
      
      if (files.length === 0) {
        this.eventBus.emit(EVENT_TYPES.STATUS_SHOW, {
          type: 'warning',
          message: 'No files were dropped'
        });
        return;
      }
      
      // For G-code viewer, we typically only want one file at a time
      if (files.length > 1) {
        this.eventBus.emit(EVENT_TYPES.STATUS_SHOW, {
          type: 'warning',
          message: `Multiple files dropped. Using first file: ${files[0].name}`
        });
      }
      
      // Process the first file
      const file = files[0];
      this.eventBus.emit(EVENT_TYPES.FILE_LOAD_START, {
        name: file.name,
        size: file.size,
        type: file.type,
        file: file,
        element: element,
        event: event,
        isDrop: true,
        source: 'drag-drop'
      });
    });
  }

  /**
   * Add event delegation for specific selector and event type
   * @param {string} eventType - DOM event type (click, change, etc.)
   * @param {string} selector - CSS selector for target elements
   * @param {Function} handler - Event handler function
   * @param {Object} options - Event listener options
   */
  addDelegation(eventType, selector, handler, options = {}) {
    if (typeof eventType !== 'string') {
      throw new Error('Event type must be a string');
    }
    
    if (typeof selector !== 'string') {
      throw new Error('Selector must be a string');
    }
    
    if (typeof handler !== 'function') {
      throw new Error('Handler must be a function');
    }

    const key = `${eventType}:${selector}`;
    
    if (!this.delegations.has(key)) {
      this.delegations.set(key, {
        eventType,
        selector,
        handlers: [],
        listener: null
      });
    }

    const delegation = this.delegations.get(key);
    delegation.handlers.push(handler);

    // Add DOM event listener if this is the first handler
    if (delegation.handlers.length === 1) {
      delegation.listener = (event) => {
        this._handleDelegatedEvent(event, selector, key);
      };
      
      this.rootElement.addEventListener(eventType, delegation.listener, {
        capture: true,
        ...options
      });
    }

    // Return cleanup function
    return () => {
      this.removeDelegation(eventType, selector, handler);
    };
  }

  /**
   * Remove event delegation
   * @param {string} eventType - DOM event type
   * @param {string} selector - CSS selector
   * @param {Function} handler - Specific handler to remove (optional)
   */
  removeDelegation(eventType, selector, handler = null) {
    const key = `${eventType}:${selector}`;
    const delegation = this.delegations.get(key);
    
    if (!delegation) return;

    if (handler) {
      // Remove specific handler
      delegation.handlers = delegation.handlers.filter(h => h !== handler);
    } else {
      // Remove all handlers
      delegation.handlers = [];
    }

    // Remove DOM event listener if no handlers remain
    if (delegation.handlers.length === 0) {
      if (delegation.listener) {
        this.rootElement.removeEventListener(eventType, delegation.listener, true);
      }
      this.delegations.delete(key);
    }
  }

  /**
   * Handle delegated DOM event
   * @param {Event} event - DOM event
   * @param {string} selector - Target selector
   * @param {string} key - Delegation key
   */
  _handleDelegatedEvent(event, selector, key) {
    if (this.isDestroyed) return;

    // Find matching element
    const target = event.target.closest(selector);
    if (!target) return;

    const delegation = this.delegations.get(key);
    if (!delegation) return;

    // Execute all handlers for this delegation
    delegation.handlers.forEach(handler => {
      try {
        handler(event, target);
      } catch (error) {
        console.error(`Error in delegated event handler for ${key}:`, error);
      }
    });
  }

  /**
   * Get all active delegations
   * @returns {Map} Map of active delegations
   */
  getDelegations() {
    return new Map(this.delegations);
  }

  /**
   * Get delegation statistics
   * @returns {Object} Statistics about delegations
   */
  getStats() {
    const stats = {
      totalDelegations: this.delegations.size,
      totalHandlers: 0,
      eventTypes: new Set(),
      selectors: new Set()
    };

    this.delegations.forEach((delegation, key) => {
      stats.totalHandlers += delegation.handlers.length;
      stats.eventTypes.add(delegation.eventType);
      stats.selectors.add(delegation.selector);
    });

    return {
      ...stats,
      eventTypes: Array.from(stats.eventTypes),
      selectors: Array.from(stats.selectors)
    };
  }

  /**
   * Clear all delegations
   */
  clearDelegations() {
    this.delegations.forEach((delegation, key) => {
      const [eventType] = key.split(':');
      if (delegation.listener) {
        this.rootElement.removeEventListener(eventType, delegation.listener, true);
      }
    });
    
    this.delegations.clear();
  }

  /**
   * Add global drag handlers for window-level events
   * @private
   */
  _addGlobalDragHandlers() {
    // Hide overlay when dragging outside window
    document.addEventListener('dragleave', (event) => {
      if (event.clientX === 0 && event.clientY === 0) {
        this._hideDragOverlay();
      }
    });
    
    // Hide overlay on window blur (when switching to another app)
    window.addEventListener('blur', () => {
      this._hideDragOverlay();
    });
  }

  /**
   * Show drag overlay for enhanced visual feedback
   * @private
   */
  _showDragOverlay() {
    // Clear any existing timer
    if (this.dragOverlayTimer) {
      clearTimeout(this.dragOverlayTimer);
      this.dragOverlayTimer = null;
    }
    
    // Create overlay if it doesn't exist
    if (!this.dragOverlay) {
      this.dragOverlay = document.createElement('div');
      this.dragOverlay.className = 'drag-overlay';
      this.dragOverlay.innerHTML = `
        <div class="drag-overlay-content">
          <div class="drag-overlay-icon">📁</div>
          <div class="drag-overlay-text">Drop G-code file here</div>
        </div>
      `;
      document.body.appendChild(this.dragOverlay);
    }
    
    // Show overlay
    this.dragOverlay.style.display = 'flex';
    requestAnimationFrame(() => {
      this.dragOverlay.classList.add('visible');
    });
  }

  /**
   * Hide drag overlay
   * @private
   */
  _hideDragOverlay() {
    if (this.dragOverlay) {
      this.dragOverlay.classList.remove('visible');
      
      // Hide after animation
      this.dragOverlayTimer = setTimeout(() => {
        if (this.dragOverlay) {
          this.dragOverlay.style.display = 'none';
        }
      }, 300);
    }
  }

  /**
   * Destroy event delegator and cleanup
   */
  destroy() {
    if (this.isDestroyed) return;

    // Clear all delegations
    this.clearDelegations();
    
    // Clean up drag overlay
    if (this.dragOverlay) {
      this.dragOverlay.remove();
      this.dragOverlay = null;
    }
    
    if (this.dragOverlayTimer) {
      clearTimeout(this.dragOverlayTimer);
      this.dragOverlayTimer = null;
    }
    
    this.isDestroyed = true;
  }
}
