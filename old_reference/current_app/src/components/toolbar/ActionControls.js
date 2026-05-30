/**
 * ActionControls
 * PR3: Extract clear/export/drawer/normalize handlers.
 */

import { EventBus, EVENT_TYPES } from '../../core/EventManager.js';

export class ActionControls {
  /**
   * @param {Object} elements
   * @param {HTMLElement} elements.clearPointsButton
   * @param {HTMLElement} elements.exportPointsButton
   * @param {HTMLElement} elements.drawerToggleButton
   * @param {HTMLElement} elements.normalizeButton
   * @param {Object} callbacks
   * @param {() => string} callbacks.getTextForNormalization
   * @param {(text: string, options?: Object) => boolean} callbacks.exportNormalizedISOFromText
   */
  constructor(elements = {}, callbacks = {}) {
    this.elements = elements;
    this.getTextForNormalization = callbacks.getTextForNormalization || (() => '');
    this.exportNormalizedISOFromText = callbacks.exportNormalizedISOFromText || (() => false);
    this.isInitialized = false;
    this._bound = null;
    this.bus = EventBus.getInstance();
  }

  init() {
    if (this.isInitialized) return;
    this._bind();
    this._attach();
    this.isInitialized = true;
  }

  destroy() {
    this._detach();
    this._bound = null;
    this.isInitialized = false;
  }

  _bind() {
    this._bound = {
      onClear: () => {
        this.bus.emit(EVENT_TYPES.POINT_CLEAR_ALL, { source: 'toolbar' });
      },
      onExportISO: () => {
        this.bus.emit(EVENT_TYPES.EXPORT_START, { source: 'toolbar', format: 'iso' });
      },
      onToggleDrawer: () => {
        this.bus.emit('drawer:toggle');
      },
      onNormalizeISO: () => {
        const text = this.getTextForNormalization() || '';
        const filename = `normalized_${new Date().toISOString().slice(0,19).replace(/[:T]/g,'-')}.iso`;
        const ok = this.exportNormalizedISOFromText(text, { filename });
        if (ok) {
          // Preserve original behavior: use custom status event
          this.bus.emit('status:show', { message: 'Normalized to ISO', type: 'success' }, { skipValidation: true });
        }
      }
    };
  }

  _attach() {
    const { clearPointsButton, exportPointsButton, drawerToggleButton, normalizeButton } = this.elements;
    if (clearPointsButton) clearPointsButton.addEventListener('click', this._bound.onClear);
    if (exportPointsButton) exportPointsButton.addEventListener('click', this._bound.onExportISO);
    if (drawerToggleButton) drawerToggleButton.addEventListener('click', this._bound.onToggleDrawer);
    if (normalizeButton) normalizeButton.addEventListener('click', this._bound.onNormalizeISO);
  }

  _detach() {
    const { clearPointsButton, exportPointsButton, drawerToggleButton, normalizeButton } = this.elements;
    if (clearPointsButton && this._bound?.onClear) clearPointsButton.removeEventListener('click', this._bound.onClear);
    if (exportPointsButton && this._bound?.onExportISO) exportPointsButton.removeEventListener('click', this._bound.onExportISO);
    if (drawerToggleButton && this._bound?.onToggleDrawer) drawerToggleButton.removeEventListener('click', this._bound.onToggleDrawer);
    if (normalizeButton && this._bound?.onNormalizeISO) normalizeButton.removeEventListener('click', this._bound.onNormalizeISO);
  }
}

export default ActionControls;
