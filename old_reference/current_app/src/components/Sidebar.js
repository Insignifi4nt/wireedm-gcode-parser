/**
 * Sidebar Component for Wire EDM G-Code Viewer
 * 
 * This component manages the sidebar information panel that displays:
 * - Real-time mouse coordinates
 * - Grid snap status
 * - Clicked measurement points list
 * - Path information and G-code statistics
 * 
 * @author Agent C2
 * @created 2025-07-16
 */

import { EventBus } from '../core/EventManager.js';
import { EVENT_TYPES } from '../core/EventManager.js';
import { COORDINATES } from '../utils/Constants.js';
import { GUIDE_LANGUAGES, getGuideCopy } from '../utils/UserGuideContent.js';

export class Sidebar {
  /**
   * Creates a new Sidebar instance
   * @param {HTMLElement} container - The DOM container for the sidebar
   * @param {Object} options - Configuration options
   */
  constructor(container, options = {}) {
    if (!container) {
      throw new Error('Sidebar requires a container element');
    }

    this.container = container;
    this.options = {
      showCoordinates: true,
      showPoints: true,
      showPathInfo: true,
      ...options
    };

    // Component state
    this.currentMousePosition = { x: 0, y: 0 };
    this.gridSnapEnabled = false;
    this.clickedPoints = [];
    this.pathInfo = null;
    this.guideLanguage = localStorage.getItem('wireedm.guideLanguage') || 'en';
    this.guideOpen = false;
    this.highlightTimer = null;

    // Initialize component
    this.init();
  }

  /**
   * Initialize the sidebar component
   */
  init() {
    try {
      this.createSidebarStructure();
      this.bindEvents();
      this.updateDisplay();
    } catch (error) {
      console.error('Failed to initialize Sidebar:', error);
      throw error;
    }
  }

  /**
   * Create the sidebar HTML structure
   */
  createSidebarStructure() {
    this.container.innerHTML = `
      <div class="sidebar">
        <div class="coordinates-display">
          <h3>Current Position</h3>
          <div class="coordinate-item">Mouse X: <span id="mouseX">0.000</span> mm</div>
          <div class="coordinate-item">Mouse Y: <span id="mouseY">0.000</span> mm</div>
          <div class="coordinate-item">Grid Snap: <span id="gridSnap">OFF</span></div>
        </div>
        
        <div class="clicked-points">
          <h3>Clicked Points</h3>
          <div class="point-list" id="pointList"></div>
        </div>
        
        <div class="path-info">
          <h3>Path Information</h3>
          <div id="pathInfo">No G-Code loaded</div>
        </div>
        
        <div class="usage-launcher">
          <button class="usage-guide-button" type="button" data-guide-action="toggle" aria-expanded="false" aria-controls="usageGuidePopover">
            Controls
          </button>
          <div class="usage-popover" id="usageGuidePopover" hidden></div>
        </div>
      </div>
    `;

    // Cache DOM elements for performance
    this.mouseXElement = this.container.querySelector('#mouseX');
    this.mouseYElement = this.container.querySelector('#mouseY');
    this.gridSnapElement = this.container.querySelector('#gridSnap');
    this.pointListElement = this.container.querySelector('#pointList');
    this.pathInfoElement = this.container.querySelector('#pathInfo');
    this.guideButtonElement = this.container.querySelector('[data-guide-action="toggle"]');
    this.guidePopoverElement = this.container.querySelector('#usageGuidePopover');

    if (!this.mouseXElement || !this.mouseYElement || !this.gridSnapElement || 
        !this.pointListElement || !this.pathInfoElement || !this.guideButtonElement || !this.guidePopoverElement) {
      throw new Error('Failed to create sidebar DOM elements');
    }

    this.renderGuidePopover();
  }

  /**
   * Bind event listeners for sidebar functionality
   */
  bindEvents() {
    const eventBus = EventBus.getInstance();

    // Mouse coordinate tracking
    // Store unsubscribe functions to properly remove listeners on destroy
    this._unsubscribes = [];
    this._handleMouseMove = this.handleMouseMove.bind(this);
    this._handleMouseLeave = this.handleMouseLeave.bind(this);
    this._handleGridSnapToggle = this.handleGridSnapToggle.bind(this);
    this._handlePointUpdate = this.handlePointUpdate.bind(this);
    this._handleParseSuccess = this.handlePathInfoUpdate.bind(this);
    this._handleFileLoad = this.handleFileLoad.bind(this);
    this._handleGuideClick = this.handleGuideClick.bind(this);
    this._handleDocumentClick = this.handleDocumentClick.bind(this);
    this._handleGuideKeydown = this.handleGuideKeydown.bind(this);

    this._unsubscribes.push(eventBus.on(EVENT_TYPES.MOUSE_MOVE, this._handleMouseMove));
    this._unsubscribes.push(eventBus.on(EVENT_TYPES.MOUSE_LEAVE_CANVAS, this._handleMouseLeave));

    // Grid snap toggle
    this._unsubscribes.push(eventBus.on(EVENT_TYPES.GRID_SNAP_TOGGLE, this._handleGridSnapToggle));

    // Point management
    this._unsubscribes.push(eventBus.on(EVENT_TYPES.POINT_UPDATE, this._handlePointUpdate));

    // Path information updates
    this._unsubscribes.push(eventBus.on(EVENT_TYPES.GCODE_PARSE_SUCCESS, this._handleParseSuccess));
    this._unsubscribes.push(eventBus.on(EVENT_TYPES.FILE_LOAD_SUCCESS, this._handleFileLoad));

    this.guideButtonElement.addEventListener('click', this._handleGuideClick);
    this.guidePopoverElement.addEventListener('click', this._handleGuideClick);
    document.addEventListener('click', this._handleDocumentClick);
    document.addEventListener('keydown', this._handleGuideKeydown);
  }

  handleGuideClick(event) {
    const action = event.target?.closest?.('[data-guide-action]')?.getAttribute('data-guide-action');
    if (!action) return;

    event.preventDefault();
    event.stopPropagation();

    if (action === 'toggle') this.toggleGuidePopover();
    else if (action === 'close') this.closeGuidePopover();
    else if (action === 'language') this.setGuideLanguage(event.target.getAttribute('data-guide-language'));
    else if (action === 'highlight') this.highlightGuideTarget(event.target);
  }

  handleDocumentClick(event) {
    if (!this.guideOpen) return;
    if (this.container.contains(event.target)) return;
    this.closeGuidePopover();
  }

  handleGuideKeydown(event) {
    if (event.key !== 'Escape') return;
    if (this.guideOpen) this.closeGuidePopover();
    this.clearGuideHighlight();
  }

  toggleGuidePopover() {
    if (this.guideOpen) this.closeGuidePopover();
    else this.openGuidePopover();
  }

  openGuidePopover() {
    this.guideOpen = true;
    this.guidePopoverElement.hidden = false;
    this.guideButtonElement.setAttribute('aria-expanded', 'true');
  }

  closeGuidePopover() {
    this.guideOpen = false;
    this.guidePopoverElement.hidden = true;
    this.guideButtonElement.setAttribute('aria-expanded', 'false');
  }

  setGuideLanguage(language) {
    if (!GUIDE_LANGUAGES[language]) return;
    this.guideLanguage = language;
    localStorage.setItem('wireedm.guideLanguage', language);
    this.renderGuidePopover();
    this.openGuidePopover();
  }

  renderGuidePopover() {
    const copy = getGuideCopy(this.guideLanguage);
    const sections = copy.sections.map(section => `
      <section class="usage-guide-section">
        <h4>${section.title}</h4>
        <ol>
          ${section.steps.map(step => `
            <li>
              <span class="usage-guide-step-text">${step.text}</span>
              ${step.mock ? `<span class="usage-control-mock ${step.mock.tone === 'danger' ? 'usage-control-mock--danger' : ''}">${step.mock.label}</span>` : ''}
              ${step.highlight ? `<button class="usage-highlight-btn" type="button" data-guide-action="highlight" data-guide-selector="${this.escapeAttr(step.highlight.selector)}" data-guide-drawer="${step.highlight.drawer ? 'true' : 'false'}">${copy.highlightLabel}</button>` : ''}
            </li>
          `).join('')}
        </ol>
      </section>
    `).join('');

    this.guideButtonElement.textContent = copy.buttonLabel;
    this.guidePopoverElement.innerHTML = `
      <div class="usage-guide-header">
        <div>
          <h3>${copy.title}</h3>
          <p>${copy.overview}</p>
        </div>
        <button class="usage-guide-close" type="button" data-guide-action="close" aria-label="${copy.closeLabel}">×</button>
      </div>
      <div class="usage-guide-language" aria-label="${copy.languageLabel}">
        ${Object.entries(GUIDE_LANGUAGES).map(([key, label]) => `
          <button type="button" data-guide-action="language" data-guide-language="${key}" aria-pressed="${this.guideLanguage === key ? 'true' : 'false'}">${label}</button>
        `).join('')}
      </div>
      <div class="usage-guide-content">${sections}</div>
    `;
  }

  escapeAttr(value) {
    return String(value || '').replace(/"/g, '&quot;');
  }

  highlightGuideTarget(button) {
    const selector = button.getAttribute('data-guide-selector');
    const requiresDrawer = button.getAttribute('data-guide-drawer') === 'true';
    if (!selector) return;

    if (requiresDrawer) {
      const drawer = document.querySelector('.gcode-drawer');
      if (drawer && !drawer.classList.contains('open')) {
        document.querySelector('[data-toolbar="toggle-gcode-drawer"]')?.click();
      }
    }

    requestAnimationFrame(() => {
      const target = document.querySelector(selector);
      if (!target) return;
      this.closeGuidePopover();
      this.clearGuideHighlight();
      target.classList.add('usage-guide-highlight-target');
      target.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
      this.highlightTimer = setTimeout(() => this.clearGuideHighlight(), 3000);
    });
  }

  clearGuideHighlight() {
    if (this.highlightTimer) {
      clearTimeout(this.highlightTimer);
      this.highlightTimer = null;
    }
    document.querySelectorAll('.usage-guide-highlight-target').forEach(el => {
      el.classList.remove('usage-guide-highlight-target');
    });
  }

  /**
   * Handle mouse move events for coordinate display
   * @param {Object} eventData - Mouse event data
   */
  handleMouseMove(eventData) {
    if (!eventData || typeof eventData.worldX !== 'number' || typeof eventData.worldY !== 'number') {
      return;
    }

    this.currentMousePosition = {
      x: eventData.worldX,
      y: eventData.worldY
    };

    this.updateCoordinateDisplay();
  }

  /**
   * Handle mouse leave canvas events
   */
  handleMouseLeave() {
    this.currentMousePosition = { x: 0, y: 0 };
    this.updateCoordinateDisplay();
  }

  /**
   * Handle grid snap toggle events
   * @param {Object} eventData - Grid snap event data
   */
  handleGridSnapToggle(eventData) {
    this.gridSnapEnabled = eventData?.enabled || false;
    this.updateGridSnapDisplay();
  }

  /**
   * Handle point update events
   * @param {Object} eventData - Point update event data
   */
  handlePointUpdate(eventData) {
    if (!eventData || typeof eventData.pointCount !== 'number') {
      console.warn('Invalid point update event data:', eventData);
      return;
    }

    // Update points from the event data
    this.clickedPoints = eventData.points || [];
    this.updatePointList();
  }

  /**
   * Handle G-code parse success events
   * @param {Object} eventData - Parse success event data
   */
  handlePathInfoUpdate(eventData) {
    if (!eventData) {
      return;
    }

    const pathCounts = (() => {
      if (!Array.isArray(eventData.path)) return { total: null, rapid: null, cut: null, arc: null };
      let rapid = 0;
      let cut = 0;
      let arc = 0;
      for (const segment of eventData.path) {
        if (!segment || typeof segment.type !== 'string') continue;
        if (segment.type === 'rapid') rapid++;
        else if (segment.type === 'cut') cut++;
        else if (segment.type === 'arc') arc++;
      }
      return { total: eventData.path.length, rapid, cut, arc };
    })();

    const totalMoves = eventData.moveCount ?? eventData.totalMoves ?? pathCounts.total ?? 0;
    const rapidMoves = eventData.rapidCount ?? eventData.rapidMoves ?? pathCounts.rapid ?? 0;
    const cuttingMoves = eventData.cutCount ?? eventData.cuttingMoves ?? pathCounts.cut ?? 0;
    const arcMoves = eventData.arcCount ?? eventData.arcMoves ?? pathCounts.arc ?? 0;

    this.pathInfo = {
      totalMoves,
      rapidMoves,
      cuttingMoves,
      arcMoves,
      bounds: eventData.bounds || null,
      parseTime: eventData.parseTime || eventData.stats?.parseTime || 0,
      fileName: this.pathInfo?.fileName,
      fileSize: this.pathInfo?.fileSize
    };

    this.updatePathInfoDisplay();
  }

  /**
   * Handle file load success events
   * @param {Object} eventData - File load event data
   */
  handleFileLoad(eventData) {
    if (!eventData) {
      return;
    }

    // Update path info with file details
    if (this.pathInfo) {
      this.pathInfo.fileName = eventData.file?.name || 'Unknown';
      this.pathInfo.fileSize = eventData.file?.size || 0;
    }

    this.updatePathInfoDisplay();
  }

  /**
   * Update the coordinate display
   */
  updateCoordinateDisplay() {
    if (!this.mouseXElement || !this.mouseYElement) {
      return;
    }

    const x = this.currentMousePosition.x.toFixed(COORDINATES.PRECISION);
    const y = this.currentMousePosition.y.toFixed(COORDINATES.PRECISION);

    this.mouseXElement.textContent = x;
    this.mouseYElement.textContent = y;
  }

  /**
   * Update the grid snap display
   */
  updateGridSnapDisplay() {
    if (!this.gridSnapElement) {
      return;
    }

    this.gridSnapElement.textContent = this.gridSnapEnabled ? 'ON' : 'OFF';
    this.gridSnapElement.classList.toggle('enabled', this.gridSnapEnabled);
  }

  /**
   * Update the clicked points list display
   */
  updatePointList() {
    if (!this.pointListElement) {
      return;
    }

    if (this.clickedPoints.length === 0) {
      this.pointListElement.innerHTML = '<div class="no-points">No points selected</div>';
      return;
    }

    const pointsHTML = this.clickedPoints.map(point => {
      const x = point.x.toFixed(COORDINATES.PRECISION);
      const y = point.y.toFixed(COORDINATES.PRECISION);
      
      return `
        <div class="point-item" data-point-id="${point.id}">
          <span class="point-label">P${(point.index ?? 0) + 1}</span>
          <span class="point-coords">(${x}, ${y})</span>
          <button class="delete-point-btn" data-point-id="${point.id}" title="Delete point">×</button>
        </div>
      `;
    }).join('');

    this.pointListElement.innerHTML = pointsHTML;
  }

  /**
   * Update the path information display
   */
  updatePathInfoDisplay() {
    if (!this.pathInfoElement) {
      return;
    }

    if (!this.pathInfo) {
      this.pathInfoElement.innerHTML = 'No G-Code loaded';
      return;
    }

    const bounds = this.pathInfo.bounds;
    const boundsText = bounds ? 
      `${bounds.minX.toFixed(1)}, ${bounds.minY.toFixed(1)} to ${bounds.maxX.toFixed(1)}, ${bounds.maxY.toFixed(1)}` :
      'Unknown';

    this.pathInfoElement.innerHTML = `
      <div class="path-stat">
        <span class="stat-label">Total Moves:</span> 
        <span class="stat-value">${this.pathInfo.totalMoves}</span>
      </div>
      <div class="path-stat">
        <span class="stat-label">Rapid Moves:</span> 
        <span class="stat-value">${this.pathInfo.rapidMoves}</span>
      </div>
      <div class="path-stat">
        <span class="stat-label">Cutting Moves:</span> 
        <span class="stat-value">${this.pathInfo.cuttingMoves}</span>
      </div>
      <div class="path-stat">
        <span class="stat-label">Arc Moves:</span> 
        <span class="stat-value">${this.pathInfo.arcMoves}</span>
      </div>
      <div class="path-stat">
        <span class="stat-label">Bounds:</span> 
        <span class="stat-value">${boundsText}</span>
      </div>
      ${this.pathInfo.fileName ? `
        <div class="path-stat">
          <span class="stat-label">File:</span> 
          <span class="stat-value">${this.pathInfo.fileName}</span>
        </div>
      ` : ''}
    `;
  }

  

  /**
   * Re-index points after deletion
   */
  reindexPoints() {
    this.clickedPoints.forEach((point, index) => {
      point.index = index + 1;
    });
  }

  /**
   * Update all displays
   */
  updateDisplay() {
    this.updateCoordinateDisplay();
    this.updateGridSnapDisplay();
    this.updatePointList();
    this.updatePathInfoDisplay();
  }

  /**
   * Get current sidebar state
   * @returns {Object} Current sidebar state
   */
  getState() {
    return {
      mousePosition: { ...this.currentMousePosition },
      gridSnapEnabled: this.gridSnapEnabled,
      clickedPoints: [...this.clickedPoints],
      pathInfo: this.pathInfo ? { ...this.pathInfo } : null
    };
  }

  /**
   * Clean up resources and event listeners
   */
  destroy() {
    // Call stored unsubscribes to remove exact listeners
    if (Array.isArray(this._unsubscribes)) {
      this._unsubscribes.forEach(unsub => {
        try { unsub && unsub(); } catch (_) {}
      });
      this._unsubscribes.length = 0;
    }

    this.guideButtonElement?.removeEventListener?.('click', this._handleGuideClick);
    this.guidePopoverElement?.removeEventListener?.('click', this._handleGuideClick);
    document.removeEventListener('click', this._handleDocumentClick);
    document.removeEventListener('keydown', this._handleGuideKeydown);
    this.clearGuideHighlight();

    // Clear DOM references
    this.container.innerHTML = '';
    this.mouseXElement = null;
    this.mouseYElement = null;
    this.gridSnapElement = null;
    this.pointListElement = null;
    this.pathInfoElement = null;
    this.guideButtonElement = null;
    this.guidePopoverElement = null;

    // Clear state
    this.clickedPoints = [];
    this.pathInfo = null;
  }
}
