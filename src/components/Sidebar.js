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
        
        <div class="usage-panel">
          <h3>Usage & Controls</h3>
          <div class="usage-content">
            <div class="usage-section">
              <h4>File Operations</h4>
              <p>• Use "Load G-Code File" button to upload .gcode, .nc, or .txt files</p>
              <p>• Drag and drop files onto the load button</p>
            </div>
            
            <div class="usage-section">
              <h4>Navigation</h4>
              <p>• <strong>Mouse wheel:</strong> Zoom in/out</p>
              <p>• <strong>Shift + Click:</strong> Pan view</p>
              <p>• <strong>Zoom buttons:</strong> +/- or Fit to Screen</p>
            </div>
            
            <div class="usage-section">
              <h4>Measurement</h4>
              <p>• <strong>Click:</strong> Add measurement point</p>
              <p>• <strong>Clear Points:</strong> Remove all points</p>
              <p>• <strong>Export Points:</strong> Save as G-Code</p>
            </div>
            
            <div class="usage-section">
              <h4>Keyboard Shortcuts</h4>
              <p>• <strong>G:</strong> Toggle grid snap ON/OFF</p>
            </div>
          </div>
        </div>
      </div>
    `;

    // Cache DOM elements for performance
    this.mouseXElement = this.container.querySelector('#mouseX');
    this.mouseYElement = this.container.querySelector('#mouseY');
    this.gridSnapElement = this.container.querySelector('#gridSnap');
    this.pointListElement = this.container.querySelector('#pointList');
    this.pathInfoElement = this.container.querySelector('#pathInfo');

    if (!this.mouseXElement || !this.mouseYElement || !this.gridSnapElement || 
        !this.pointListElement || !this.pathInfoElement) {
      throw new Error('Failed to create sidebar DOM elements');
    }
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

    this._unsubscribes.push(eventBus.on(EVENT_TYPES.MOUSE_MOVE, this._handleMouseMove));
    this._unsubscribes.push(eventBus.on(EVENT_TYPES.MOUSE_LEAVE_CANVAS, this._handleMouseLeave));

    // Grid snap toggle
    this._unsubscribes.push(eventBus.on(EVENT_TYPES.GRID_SNAP_TOGGLE, this._handleGridSnapToggle));

    // Point management
    this._unsubscribes.push(eventBus.on(EVENT_TYPES.POINT_UPDATE, this._handlePointUpdate));

    // Path information updates
    this._unsubscribes.push(eventBus.on(EVENT_TYPES.GCODE_PARSE_SUCCESS, this._handleParseSuccess));
    this._unsubscribes.push(eventBus.on(EVENT_TYPES.FILE_LOAD_SUCCESS, this._handleFileLoad));
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

    this.pathInfo = {
      totalMoves: eventData.totalMoves || 0,
      rapidMoves: eventData.rapidMoves || 0,
      cuttingMoves: eventData.cuttingMoves || 0,
      arcMoves: eventData.arcMoves || 0,
      bounds: eventData.bounds || null,
      parseTime: eventData.parseTime || 0
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

    // Add event listeners for delete buttons
    this.pointListElement.querySelectorAll('.delete-point-btn').forEach(btn => {
      btn.addEventListener('click', this.handleDeleteButtonClick.bind(this));
    });
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
   * Handle delete button clicks
   * @param {Event} event - Click event
   */
  handleDeleteButtonClick(event) {
    event.preventDefault();
    event.stopPropagation();

    const pointId = event.target.dataset.pointId;
    if (!pointId) {
      return;
    }

    const eventBus = EventBus.getInstance();
    eventBus.emit(EVENT_TYPES.POINT_DELETE, { id: pointId });
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
    const eventBus = EventBus.getInstance();

    // Call stored unsubscribes to remove exact listeners
    if (Array.isArray(this._unsubscribes)) {
      this._unsubscribes.forEach(unsub => {
        try { unsub && unsub(); } catch (_) {}
      });
      this._unsubscribes.length = 0;
    }

    // Clear DOM references
    this.container.innerHTML = '';
    this.mouseXElement = null;
    this.mouseYElement = null;
    this.gridSnapElement = null;
    this.pointListElement = null;
    this.pathInfoElement = null;

    // Clear state
    this.clickedPoints = [];
    this.pathInfo = null;
  }
}