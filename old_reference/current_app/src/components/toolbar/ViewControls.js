/**
 * ViewControls
 * PR2: Extract zoom/fit controls and zoom display updates.
 */

import { EventBus, EVENT_TYPES } from '../../core/EventManager.js';

export class ViewControls {
  /**
   * @param {Object} elements - Element references
   * @param {HTMLElement} elements.zoomInButton
   * @param {HTMLElement} elements.zoomOutButton
   * @param {HTMLElement} elements.fitToScreenButton
   * @param {HTMLElement} elements.zoomDisplay
   */
  constructor(elements = {}) {
    this.elements = elements;
    this.isInitialized = false;
    this._bound = null;
    this.bus = EventBus.getInstance();
    this._offZoom = null;
  }

  init() {
    if (this.isInitialized) return;
    this._bind();
    this._attach();
    this._subscribe();
    this.isInitialized = true;
  }

  destroy() {
    this._detach();
    if (typeof this._offZoom === 'function') this._offZoom();
    this._offZoom = null;
    this._bound = null;
    this.isInitialized = false;
  }

  _bind() {
    this._bound = {
      onZoomIn: () => {
        this.bus.emit(EVENT_TYPES.VIEWPORT_ZOOM_CHANGE, { type: 'in', source: 'toolbar' }, { skipValidation: true });
      },
      onZoomOut: () => {
        this.bus.emit(EVENT_TYPES.VIEWPORT_ZOOM_CHANGE, { type: 'out', source: 'toolbar' }, { skipValidation: true });
      },
      onFit: () => {
        this.bus.emit(EVENT_TYPES.VIEWPORT_FIT_TO_SCREEN, { source: 'toolbar' });
      }
    };
  }

  _attach() {
    const { zoomInButton, zoomOutButton, fitToScreenButton } = this.elements;
    if (zoomInButton) zoomInButton.addEventListener('click', this._bound.onZoomIn);
    if (zoomOutButton) zoomOutButton.addEventListener('click', this._bound.onZoomOut);
    if (fitToScreenButton) fitToScreenButton.addEventListener('click', this._bound.onFit);
  }

  _detach() {
    const { zoomInButton, zoomOutButton, fitToScreenButton } = this.elements;
    if (zoomInButton && this._bound?.onZoomIn) zoomInButton.removeEventListener('click', this._bound.onZoomIn);
    if (zoomOutButton && this._bound?.onZoomOut) zoomOutButton.removeEventListener('click', this._bound.onZoomOut);
    if (fitToScreenButton && this._bound?.onFit) fitToScreenButton.removeEventListener('click', this._bound.onFit);
  }

  _subscribe() {
    this._offZoom = this.bus.on(EVENT_TYPES.VIEWPORT_ZOOM_CHANGE, (data) => {
      if (data && typeof data.zoom === 'number') {
        const percentage = Math.round(data.zoom * 100);
        if (this.elements.zoomDisplay) this.elements.zoomDisplay.textContent = `${percentage}%`;
      }
    });
  }
}

export default ViewControls;
