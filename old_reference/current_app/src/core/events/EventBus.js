/**
 * Event Bus Singleton
 * Global event bus instance for the application
 */
import { EventManager } from '../EventManager.js';

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

