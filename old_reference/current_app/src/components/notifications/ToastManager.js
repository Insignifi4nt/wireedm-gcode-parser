/**
 * ToastManager
 * Wires EventBus STATUS_* events to a provided Status-like API.
 */

import { EventBus, EVENT_TYPES } from '../../core/EventManager.js';

export class ToastManager {
  /**
   * @param {Object} statusApi - Object exposing show, hide, hideAll, update
   */
  constructor(statusApi) {
    this.status = statusApi;
    this.cleanups = [];
  }

  init() {
    const offShow = EventBus.on(EVENT_TYPES.STATUS_SHOW, (data) => {
      this.status.show(data.message, data.type, data.duration, data.persistent);
    });
    const offHide = EventBus.on(EVENT_TYPES.STATUS_HIDE, () => {
      this.status.hideAll();
    });
    const offUpdate = EventBus.on(EVENT_TYPES.STATUS_UPDATE, (data) => {
      this.status.update(data.id, data.message, data.progress);
    });
    this.cleanups.push(offShow, offHide, offUpdate);
  }

  destroy() {
    this.cleanups.forEach((off) => { try { typeof off === 'function' && off(); } catch (_) {} });
    this.cleanups.length = 0;
  }
}

export default ToastManager;
