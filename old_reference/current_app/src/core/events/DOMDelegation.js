/**
 * DOMDelegation - event delegation helper for dynamic elements
 * Maintains per-selector listeners and maps to custom event emitters.
 */
export class DOMDelegation {
  /**
   * @param {HTMLElement|Document} root - Root element to attach listeners (defaults to document)
   * @param {Function} emit - Callback to emit custom events: (type, data) => void
   */
  constructor(root = document, emit = () => {}) {
    this.root = root;
    this.emit = emit;
    // key => { selector, eventType, listener, handlers: Map<customType, extractor> }
    this._delegations = new Map();
  }

  /**
   * Add delegation mapping and ensure a capturing listener is registered per selector+eventType.
   * @param {string} selector
   * @param {string} domEventType
   * @param {string} customEventType
   * @param {Function} dataExtractor - (event, matchedElement) => any
   * @returns {Function} cleanup function
   */
  add(selector, domEventType, customEventType, dataExtractor) {
    if (typeof selector !== 'string') throw new Error('Selector must be a string');
    if (typeof domEventType !== 'string') throw new Error('DOM event type must be a string');
    if (typeof dataExtractor !== 'function') throw new Error('Data extractor must be a function');

    const key = `${selector}:${domEventType}`;

    if (!this._delegations.has(key)) {
      const listener = (event) => {
        const target = event.target?.closest?.(selector);
        if (!target) return;
        const entry = this._delegations.get(key);
        if (!entry) return;

        entry.handlers.forEach((extractor, customType) => {
          try {
            const data = extractor(event, target);
            this.emit(customType, data);
          } catch (error) {
            console.error('DOMDelegation: Error in delegated handler:', error);
          }
        });
      };

      this._delegations.set(key, {
        selector,
        eventType: domEventType,
        listener,
        handlers: new Map()
      });

      this.root.addEventListener(domEventType, listener, true); // capture phase
    }

    // Register handler for this custom event type
    const entry = this._delegations.get(key);
    entry.handlers.set(customEventType, dataExtractor);

    // Return cleanup function
    return () => {
      const e = this._delegations.get(key);
      if (!e) return;
      e.handlers.delete(customEventType);
      if (e.handlers.size === 0) {
        // Remove DOM listener and delete entry
        if (e.listener) this.root.removeEventListener(e.eventType, e.listener, true);
        this._delegations.delete(key);
      }
    };
  }

  /**
   * Count of active delegations (selector+eventType pairs)
   */
  size() {
    return this._delegations.size;
  }

  /**
   * Clear all delegations and remove listeners
   */
  clear() {
    this._delegations.forEach((entry) => {
      if (entry.listener) this.root.removeEventListener(entry.eventType, entry.listener, true);
    });
    this._delegations.clear();
  }
}

