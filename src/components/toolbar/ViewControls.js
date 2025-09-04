/**
 * ViewControls
 * PR0 scaffold for Toolbar viewport controls. No behavior yet.
 */

export class ViewControls {
  /**
   * @param {HTMLElement} container Toolbar container element
   * @param {Object} options optional
   */
  constructor(container, options = {}) {
    this.container = container;
    this.options = options;
    this.isInitialized = false;
  }

  init() {
    if (this.isInitialized) return;
    this.isInitialized = true;
  }

  destroy() {
    // No-op for scaffold
  }
}

export default ViewControls;

