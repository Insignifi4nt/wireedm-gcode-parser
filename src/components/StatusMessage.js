/**
 * StatusMessage Component
 * Handles status messages, notifications, and progress indicators
 * 
 * Features:
 * - Multiple message types (success, error, warning, info)
 * - Auto-dismiss functionality with configurable timeouts
 * - Message queue system for handling multiple messages
 * - Progress indication for long-running operations
 * - Positioning and animation support
 */

import { STATUS, ANIMATION, THEME } from '../utils/Constants.js';
import { EventBus, EVENT_TYPES } from '../core/EventManager.js';
import { applyContainerStyles, applyMessageStyles, buildMessageContent, escapeHtml } from './notifications/NotificationStyles.js';
import { MessageQueue } from './notifications/MessageQueue.js';
import { ToastManager } from './notifications/ToastManager.js';

export class StatusMessage {
  /**
   * Constructor
   * @param {Object} options - Configuration options
   * @param {HTMLElement} options.container - Container element (default: document.body)
   * @param {string} options.position - Position ('top-right', 'top-left', 'bottom-right', 'bottom-left')
   * @param {number} options.defaultDuration - Default display duration in ms
   * @param {number} options.maxMessages - Maximum concurrent messages
   */
  constructor(options = {}) {
    this.container = options.container || document.body;
    this.position = options.position || 'top-right';
    this.defaultDuration = options.defaultDuration || STATUS.DURATION;
    this.maxMessages = options.maxMessages || 5;
    
    // Message queue manager (initialized in init)
    this.queue = null;
    this.toastManager = null;
    this.messageIdCounter = 0;
    
    // DOM elements
    this.messageContainer = null;
    
    // Animation state
    this.isAnimating = false;
    
    // Event listeners cleanup
    this.eventCleanup = [];
    
    this.init();
  }

  /**
   * Initialize the component
   */
  init() {
    this.createMessageContainer();
    // Initialize queue manager
    this.queue = new MessageQueue({
      container: this.messageContainer,
      maxMessages: this.maxMessages,
      ANIMATION,
      STATUS
    });
    // Wire EventBus via ToastManager
    this.toastManager = new ToastManager(this);
    this.toastManager.init();
    
    console.debug('StatusMessage component initialized');
  }

  /**
   * Create the message container element
   */
  createMessageContainer() {
    this.messageContainer = document.createElement('div');
    this.messageContainer.id = 'statusMessageContainer';
    this.messageContainer.className = 'status-message-container';
    
    // Apply positioning styles
    applyContainerStyles(this.messageContainer, this.position, STATUS, ANIMATION);
    
    this.container.appendChild(this.messageContainer);
  }



  /**
   * Show a status message
   * @param {string} message - Message text
   * @param {string} type - Message type ('success', 'error', 'warning', 'info')
   * @param {number} duration - Display duration in ms (optional)
   * @param {boolean} persistent - Whether message stays until manually dismissed
   * @returns {string} Message ID for updates/dismissal
   */
  show(message, type = 'info', duration = null, persistent = false) {
    if (!message || typeof message !== 'string') {
      console.warn('StatusMessage: Invalid message provided');
      return null;
    }
    
    // Validate message type
    const validTypes = ['success', 'error', 'warning', 'info'];
    if (!validTypes.includes(type)) {
      console.warn(`StatusMessage: Invalid type '${type}', defaulting to 'info'`);
      type = 'info';
    }
    
    // Generate unique message ID
    const messageId = `status_${++this.messageIdCounter}_${Date.now()}`;
    
    // Create message data
    const messageData = {
      id: messageId,
      message,
      type,
      duration: duration !== null ? duration : this.defaultDuration,
      persistent,
      createdAt: Date.now(),
      element: null,
      timeoutId: null,
      progress: null
    };
    
    // Enqueue via queue manager
    this.queue.enqueue(messageData);
    
    return messageId;
  }

  /**
   * Update an existing message
   * @param {string} messageId - Message ID to update
   * @param {string} newMessage - New message text
   * @param {number} progress - Progress value (0-100) for progress indicators
   */
  update(messageId, newMessage, progress = null) {
    if (!messageId) {
      console.warn('StatusMessage: Invalid message ID for update');
      return;
    }
    
    // Delegate to queue manager
    this.queue.update(messageId, newMessage, progress);
  }

  /**
   * Hide a specific message
   * @param {string} messageId - Message ID to hide
   */
  hide(messageId) {
    if (!messageId) {
      console.warn('StatusMessage: Invalid message ID for hide');
      return;
    }
    
    this.queue.hide(messageId);
  }

  /**
   * Hide all messages
   */
  hideAll() {
    this.queue.hideAll();
  }

  /**
   * Convenience methods for different message types
   */
  
  /**
   * Show success message
   * @param {string} message - Message text
   * @param {number} duration - Display duration
   * @returns {string} Message ID
   */
  success(message, duration = null) {
    return this.show(message, 'success', duration);
  }

  /**
   * Show error message
   * @param {string} message - Message text
   * @param {number} duration - Display duration
   * @returns {string} Message ID
   */
  error(message, duration = null) {
    return this.show(message, 'error', duration || STATUS.DURATION * 2); // Errors show longer
  }

  /**
   * Show warning message
   * @param {string} message - Message text
   * @param {number} duration - Display duration
   * @returns {string} Message ID
   */
  warning(message, duration = null) {
    return this.show(message, 'warning', duration);
  }

  /**
   * Show info message
   * @param {string} message - Message text
   * @param {number} duration - Display duration
   * @returns {string} Message ID
   */
  info(message, duration = null) {
    return this.show(message, 'info', duration);
  }

  /**
   * Show progress message
   * @param {string} message - Message text
   * @param {number} progress - Initial progress (0-100)
   * @returns {string} Message ID
   */
  progress(message, progress = 0) {
    const messageId = this.show(message, 'info', null, true);
    this.update(messageId, message, progress);
    return messageId;
  }

  /**
   * Get message statistics
   * @returns {Object} Statistics object
   */
  getStats() {
    const queueStats = this.queue?.getStats() || { activeMessages: 0, queuedMessages: 0 };
    return {
      ...queueStats,
      totalMessagesSent: this.messageIdCounter,
      maxMessages: this.maxMessages,
      defaultDuration: this.defaultDuration,
      position: this.position
    };
  }

  /**
   * Destroy the component and clean up resources
   */
  destroy() {
    // Hide all messages
    this.hideAll();
    
    // Clean up event listeners
    try { this.toastManager?.destroy(); } catch (_) {}
    try { this.queue?.destroy(); } catch (_) {}
    
    // Remove DOM elements
    if (this.messageContainer && this.messageContainer.parentNode) {
      this.messageContainer.parentNode.removeChild(this.messageContainer);
    }
    
    // Clear references
    this.messageContainer = null;
    
    console.debug('StatusMessage component destroyed');
  }
}

export default StatusMessage;
