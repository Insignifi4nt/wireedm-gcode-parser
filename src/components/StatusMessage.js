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
    
    // Message queue and tracking
    this.messageQueue = [];
    this.activeMessages = new Map();
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
    this.bindEvents();
    
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
    this.applyContainerStyles();
    
    this.container.appendChild(this.messageContainer);
  }

  /**
   * Apply container positioning styles
   */
  applyContainerStyles() {
    const styles = {
      position: 'fixed',
      zIndex: '1000',
      pointerEvents: 'none',
      display: 'flex',
      flexDirection: 'column',
      gap: '10px',
      maxWidth: '400px',
      fontFamily: 'Arial, sans-serif',
      fontSize: '14px'
    };
    
    // Position-specific styles
    switch (this.position) {
      case 'top-right':
        styles.top = STATUS.POSITION.TOP;
        styles.right = STATUS.POSITION.RIGHT;
        styles.alignItems = 'flex-end';
        break;
      case 'top-left':
        styles.top = STATUS.POSITION.TOP;
        styles.left = STATUS.POSITION.LEFT;
        styles.alignItems = 'flex-start';
        break;
      case 'bottom-right':
        styles.bottom = STATUS.POSITION.BOTTOM;
        styles.right = STATUS.POSITION.RIGHT;
        styles.alignItems = 'flex-end';
        styles.flexDirection = 'column-reverse';
        break;
      case 'bottom-left':
        styles.bottom = STATUS.POSITION.BOTTOM;
        styles.left = STATUS.POSITION.LEFT;
        styles.alignItems = 'flex-start';
        styles.flexDirection = 'column-reverse';
        break;
    }
    
    Object.assign(this.messageContainer.style, styles);
  }

  /**
   * Bind event listeners
   */
  bindEvents() {
    // Listen for status events
    const showCleanup = EventBus.on(EVENT_TYPES.STATUS_SHOW, (data) => {
      this.show(data.message, data.type, data.duration, data.persistent);
    });
    
    const hideCleanup = EventBus.on(EVENT_TYPES.STATUS_HIDE, () => {
      this.hideAll();
    });
    
    const updateCleanup = EventBus.on(EVENT_TYPES.STATUS_UPDATE, (data) => {
      this.update(data.id, data.message, data.progress);
    });
    
    this.eventCleanup.push(showCleanup, hideCleanup, updateCleanup);
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
    
    // Add to queue
    this.messageQueue.push(messageData);
    
    // Process queue
    this.processQueue();
    
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
    
    const messageData = this.activeMessages.get(messageId);
    if (!messageData) {
      console.warn(`StatusMessage: Message '${messageId}' not found for update`);
      return;
    }
    
    // Update message text
    if (newMessage && typeof newMessage === 'string') {
      messageData.message = newMessage;
      const textElement = messageData.element.querySelector('.status-message-text');
      if (textElement) {
        textElement.textContent = newMessage;
      }
    }
    
    // Update progress
    if (progress !== null && typeof progress === 'number') {
      messageData.progress = Math.max(0, Math.min(100, progress));
      this.updateProgress(messageData);
    }
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
    
    const messageData = this.activeMessages.get(messageId);
    if (!messageData) {
      return; // Message already hidden or doesn't exist
    }
    
    this.hideMessage(messageData);
  }

  /**
   * Hide all messages
   */
  hideAll() {
    // Clear all timeouts
    this.activeMessages.forEach(messageData => {
      if (messageData.timeoutId) {
        clearTimeout(messageData.timeoutId);
      }
    });
    
    // Clear all messages
    this.activeMessages.clear();
    this.messageQueue.length = 0;
    
    // Clear DOM
    if (this.messageContainer) {
      this.messageContainer.innerHTML = '';
    }
    
    this.isAnimating = false;
  }

  /**
   * Process the message queue
   */
  processQueue() {
    // Check if we can display more messages
    if (this.activeMessages.size >= this.maxMessages || this.messageQueue.length === 0) {
      return;
    }
    
    // Get next message from queue
    const messageData = this.messageQueue.shift();
    
    // Create DOM element
    this.createMessageElement(messageData);
    
    // Add to active messages
    this.activeMessages.set(messageData.id, messageData);
    
    // Set up auto-dismiss timer
    if (!messageData.persistent && messageData.duration > 0) {
      messageData.timeoutId = setTimeout(() => {
        this.hide(messageData.id);
      }, messageData.duration);
    }
    
    // Process more messages if possible
    setTimeout(() => this.processQueue(), 100);
  }

  /**
   * Create DOM element for a message
   * @param {Object} messageData - Message data object
   */
  createMessageElement(messageData) {
    const messageElement = document.createElement('div');
    messageElement.className = `status-message status-message-${messageData.type}`;
    messageElement.setAttribute('data-message-id', messageData.id);
    
    // Apply base styles
    this.applyMessageStyles(messageElement, messageData.type);
    
    // Create message content
    const contentHtml = this.createMessageContent(messageData);
    messageElement.innerHTML = contentHtml;
    
    // Add click handler for dismissal
    messageElement.addEventListener('click', () => {
      this.hide(messageData.id);
    });
    
    // Store element reference
    messageData.element = messageElement;
    
    // Add to container with animation
    this.messageContainer.appendChild(messageElement);
    
    // Trigger entrance animation
    this.animateIn(messageElement);
  }

  /**
   * Create message content HTML
   * @param {Object} messageData - Message data object
   * @returns {string} HTML content
   */
  createMessageContent(messageData) {
    let html = `
      <div class="status-message-content">
        <div class="status-message-text">${this.escapeHtml(messageData.message)}</div>
    `;
    
    // Add progress bar if needed
    if (messageData.progress !== null) {
      html += `
        <div class="status-message-progress">
          <div class="status-message-progress-bar" style="width: ${messageData.progress}%"></div>
        </div>
      `;
    }
    
    // Add dismiss button for persistent messages
    if (messageData.persistent) {
      html += `
        <button class="status-message-dismiss" type="button" aria-label="Dismiss">×</button>
      `;
    }
    
    html += '</div>';
    
    return html;
  }

  /**
   * Apply styling to message element
   * @param {HTMLElement} element - Message element
   * @param {string} type - Message type
   */
  applyMessageStyles(element, type) {
    const baseStyles = {
      display: 'flex',
      alignItems: 'center',
      padding: '15px 20px',
      borderRadius: '5px',
      color: 'white',
      cursor: 'pointer',
      pointerEvents: 'auto',
      boxShadow: '0 2px 10px rgba(0,0,0,0.3)',
      transition: `all ${ANIMATION.NORMAL}ms ${ANIMATION.EASE}`,
      transform: 'translateX(100%)',
      opacity: '0',
      marginBottom: '10px',
      maxWidth: '100%',
      wordWrap: 'break-word',
      position: 'relative'
    };
    
    // Type-specific colors
    const typeColors = {
      success: STATUS.COLORS.SUCCESS,
      error: STATUS.COLORS.ERROR,
      warning: STATUS.COLORS.WARNING,
      info: STATUS.COLORS.INFO
    };
    
    baseStyles.backgroundColor = typeColors[type] || STATUS.COLORS.INFO;
    
    Object.assign(element.style, baseStyles);
    
    // Add hover effect
    element.addEventListener('mouseenter', () => {
      element.style.transform = 'translateX(0) scale(1.02)';
    });
    
    element.addEventListener('mouseleave', () => {
      element.style.transform = 'translateX(0) scale(1)';
    });
  }

  /**
   * Update progress bar for a message
   * @param {Object} messageData - Message data object
   */
  updateProgress(messageData) {
    if (!messageData.element) return;
    
    const progressBar = messageData.element.querySelector('.status-message-progress-bar');
    if (!progressBar) {
      // Create progress bar if it doesn't exist
      const progressContainer = document.createElement('div');
      progressContainer.className = 'status-message-progress';
      progressContainer.style.cssText = `
        width: 100%;
        height: 4px;
        background-color: rgba(255,255,255,0.3);
        border-radius: 2px;
        margin-top: 8px;
        overflow: hidden;
      `;
      
      const progressBarElement = document.createElement('div');
      progressBarElement.className = 'status-message-progress-bar';
      progressBarElement.style.cssText = `
        height: 100%;
        background-color: rgba(255,255,255,0.8);
        border-radius: 2px;
        transition: width ${ANIMATION.FAST}ms ease;
        width: ${messageData.progress}%;
      `;
      
      progressContainer.appendChild(progressBarElement);
      messageData.element.querySelector('.status-message-content').appendChild(progressContainer);
    } else {
      // Update existing progress bar
      progressBar.style.width = `${messageData.progress}%`;
    }
  }

  /**
   * Animate message entrance
   * @param {HTMLElement} element - Message element
   */
  animateIn(element) {
    // Force reflow
    element.offsetHeight;
    
    // Animate in
    element.style.transform = 'translateX(0)';
    element.style.opacity = '1';
  }

  /**
   * Animate message exit and remove
   * @param {Object} messageData - Message data object
   */
  hideMessage(messageData) {
    if (!messageData.element) return;
    
    // Clear timeout
    if (messageData.timeoutId) {
      clearTimeout(messageData.timeoutId);
    }
    
    // Animate out
    messageData.element.style.transform = 'translateX(100%)';
    messageData.element.style.opacity = '0';
    
    // Remove from DOM after animation
    setTimeout(() => {
      if (messageData.element && messageData.element.parentNode) {
        messageData.element.parentNode.removeChild(messageData.element);
      }
      
      // Remove from active messages
      this.activeMessages.delete(messageData.id);
      
      // Process queue
      this.processQueue();
    }, ANIMATION.NORMAL);
  }

  /**
   * Escape HTML characters
   * @param {string} text - Text to escape
   * @returns {string} Escaped text
   */
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
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
    return {
      activeMessages: this.activeMessages.size,
      queuedMessages: this.messageQueue.length,
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
    this.eventCleanup.forEach(cleanup => cleanup());
    this.eventCleanup.length = 0;
    
    // Remove DOM elements
    if (this.messageContainer && this.messageContainer.parentNode) {
      this.messageContainer.parentNode.removeChild(this.messageContainer);
    }
    
    // Clear references
    this.messageContainer = null;
    this.activeMessages.clear();
    this.messageQueue.length = 0;
    
    console.debug('StatusMessage component destroyed');
  }
}

export default StatusMessage;