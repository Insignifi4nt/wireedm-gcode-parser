/**
 * MessageQueue
 * Manages notification queue, DOM creation, auto-dismiss, and updates.
 */

import { applyMessageStyles, buildMessageContent, escapeHtml } from './NotificationStyles.js';

export class MessageQueue {
  /**
   * @param {Object} options
   * @param {HTMLElement} options.container
   * @param {number} [options.maxMessages]
   * @param {Object} options.ANIMATION
   * @param {Object} options.STATUS
   */
  constructor(options = {}) {
    this.container = options.container;
    this.maxMessages = options.maxMessages ?? 5;
    this.ANIMATION = options.ANIMATION;
    this.STATUS = options.STATUS;

    this.queue = [];
    this.active = new Map();
  }

  enqueue(messageData) {
    this.queue.push(messageData);
    this._process();
    return messageData.id;
  }

  update(id, newMessage, progress = null) {
    const msg = this.active.get(id);
    if (!msg) return;
    if (typeof newMessage === 'string' && newMessage.length) {
      msg.message = newMessage;
      const el = msg.element?.querySelector('.status-message-text');
      if (el) el.textContent = newMessage;
    }
    if (typeof progress === 'number') {
      msg.progress = Math.max(0, Math.min(100, progress));
      this._updateProgress(msg);
    }
  }

  hide(id) {
    const msg = this.active.get(id);
    if (!msg) return;
    this._hideMessage(msg);
  }

  hideAll() {
    this.active.forEach((msg) => {
      if (msg.timeoutId) clearTimeout(msg.timeoutId);
      try { msg.element?.remove(); } catch (_) {}
    });
    this.active.clear();
    this.queue.length = 0;
    if (this.container) this.container.innerHTML = '';
  }

  getStats() {
    return {
      activeMessages: this.active.size,
      queuedMessages: this.queue.length
    };
  }

  destroy() {
    this.hideAll();
    this.container = null;
  }

  _process() {
    if (this.active.size >= this.maxMessages || this.queue.length === 0) return;
    const msg = this.queue.shift();
    this._createMessageElement(msg);
    this.active.set(msg.id, msg);
    if (!msg.persistent && msg.duration > 0) {
      msg.timeoutId = setTimeout(() => this.hide(msg.id), msg.duration);
    }
    setTimeout(() => this._process(), 100);
  }

  _createMessageElement(messageData) {
    const el = document.createElement('div');
    el.className = `status-message status-message-${messageData.type}`;
    el.setAttribute('data-message-id', messageData.id);

    applyMessageStyles(el, messageData.type, this.STATUS, this.ANIMATION);
    el.addEventListener('mouseenter', () => { el.style.transform = 'translateX(0) scale(1.02)'; });
    el.addEventListener('mouseleave', () => { el.style.transform = 'translateX(0) scale(1)'; });

    el.innerHTML = buildMessageContent(messageData, escapeHtml);
    el.addEventListener('click', () => this.hide(messageData.id));
    messageData.element = el;
    this.container.appendChild(el);
    this._animateIn(el);
  }

  _updateProgress(messageData) {
    const progressBar = messageData.element?.querySelector('.status-message-progress-bar');
    if (!progressBar) {
      const wrapper = document.createElement('div');
      wrapper.className = 'status-message-progress';
      wrapper.style.cssText = `width:100%;height:4px;background-color:rgba(255,255,255,0.3);border-radius:2px;margin-top:8px;overflow:hidden;`;
      const bar = document.createElement('div');
      bar.className = 'status-message-progress-bar';
      bar.style.cssText = `height:100%;background-color:rgba(255,255,255,0.8);border-radius:2px;transition:width ${this.ANIMATION.FAST}ms ease;width:${messageData.progress}%;`;
      wrapper.appendChild(bar);
      messageData.element?.querySelector('.status-message-content')?.appendChild(wrapper);
    } else {
      progressBar.style.width = `${messageData.progress}%`;
    }
  }

  _animateIn(el) {
    // force reflow
    void el.offsetHeight;
    el.style.transform = 'translateX(0)';
    el.style.opacity = '1';
  }

  _hideMessage(msg) {
    if (msg.timeoutId) clearTimeout(msg.timeoutId);
    if (!msg.element) return;
    msg.element.style.transform = 'translateX(100%)';
    msg.element.style.opacity = '0';
    setTimeout(() => {
      try { msg.element?.remove(); } catch (_) {}
      this.active.delete(msg.id);
      this._process();
    }, this.ANIMATION.NORMAL);
  }
}

export default MessageQueue;
