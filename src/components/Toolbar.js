/**
 * Toolbar Component for Wire EDM G-Code Viewer
 * Provides file loading, zoom controls, and utility functions
 */

import { EventBus, EVENT_TYPES } from '../core/EventManager.js';
import { VIEWPORT } from '../utils/Constants.js';
import { FileHandler } from '../utils/FileHandler.js';
import { FileControls } from './toolbar/FileControls.js';
import { ViewControls } from './toolbar/ViewControls.js';
import { ActionControls } from './toolbar/ActionControls.js';

/**
 * Toolbar class manages the header toolbar with file and view controls
 */
export class Toolbar {
  /**
   * Create Toolbar instance
   * @param {HTMLElement} container - Container element for the toolbar
   * @param {Object} options - Configuration options
   */
  constructor(container, options = {}) {
    if (!container) {
      throw new Error('Container element is required');
    }

    this.container = container;
    this.options = {
      enableFileInput: true,
      enableZoomControls: true,
      enableUtilityButtons: true,
      ...options
    };

    // Event system
    this.eventBus = EventBus.getInstance();
    
    // File handler for file operations
    this.fileHandler = new FileHandler();
    // Submodules
    this.fileControls = null;
    this.viewControls = null;
    this.actionControls = null;
    
    // Component state
    this.state = {
      currentFile: null,
      zoomLevel: VIEWPORT.DEFAULT_ZOOM,
      isFileLoading: false,
      hasClickedPoints: false
    };

    // DOM elements (will be set during render)
    this.elements = {
      fileInput: null,
      fileInputLabel: null,
      zoomInButton: null,
      zoomOutButton: null,
      fitToScreenButton: null,
      zoomDisplay: null,
      clearPointsButton: null,
      exportPointsButton: null
    };

    // Bind methods
    this._bindMethods();
    
    // Initialize
    this.isInitialized = false;
    this.isDestroyed = false;
  }

  /**
   * Bind methods to maintain context
   */
  _bindMethods() {
    this._onPointsChange = this._onPointsChange.bind(this);
    this._onFileLoadStart = this._onFileLoadStart.bind(this);
    this._onFileLoadSuccess = this._onFileLoadSuccess.bind(this);
    this._onFileLoadError = this._onFileLoadError.bind(this);
    this._onPointsExportResponse = this._onPointsExportResponse.bind(this);
  }

  /**
   * Initialize toolbar component
   */
  init() {
    if (this.isInitialized) {
      console.warn('Toolbar already initialized');
      return;
    }

    try {
      // Render toolbar HTML
      this._renderToolbar();
      
      // Set up event listeners
      this._setupEventListeners();
      
      // Subscribe to application events
      this._subscribeToEvents();
      
      this.isInitialized = true;
      console.log('Toolbar initialized successfully');
      
    } catch (error) {
      console.error('Failed to initialize Toolbar:', error);
      throw error;
    }
  }

  /**
   * Render toolbar HTML structure
   */
  _renderToolbar() {
    const toolbarHTML = `
      ${this.options.enableFileInput ? this._renderFileInput() : ''}
      ${this.options.enableZoomControls ? this._renderZoomControls() : ''}
      ${this.options.enableUtilityButtons ? this._renderUtilityButtons() : ''}
    `;

    this.container.innerHTML = toolbarHTML;
    
    // Get references to DOM elements
    this._getElementReferences();
  }

  /**
   * Render file input section
   */
  _renderFileInput() {
    return `
      <div class="file-input-wrapper">
        <input type="file" id="fileInput" accept=".gcode,.nc,.txt,.iso" data-toolbar="file-input">
        <label for="fileInput" class="file-input-label" data-toolbar="file-input-label" title="Load G-Code files (.gcode, .nc, .txt) or drag and drop files here">
          Load G-Code File
        </label>
      </div>
    `;
  }

  /**
   * Render zoom controls section
   */
  _renderZoomControls() {
    return `
      <div class="zoom-controls">
        <button data-toolbar="zoom-in" type="button" title="Zoom in (or use mouse wheel)">Zoom +</button>
        <button data-toolbar="zoom-out" type="button" title="Zoom out (or use mouse wheel)">Zoom -</button>
        <button data-toolbar="fit-to-screen" type="button" title="Fit G-Code to screen">Fit to Screen</button>
        <span class="zoom-display" title="Current zoom level">Zoom: <span data-toolbar="zoom-level">100%</span></span>
      </div>
    `;
  }

  /**
   * Render utility buttons section
   */
  _renderUtilityButtons() {
    return `
      <button data-toolbar="clear-points" type="button" title="Clear all measurement points">Clear Points</button>
      <button data-toolbar="export-points" type="button" title="Export clicked points as ISO file (.iso)">Export ISO</button>
      <button data-toolbar="toggle-gcode-drawer" type="button" title="Show/Hide G-Code preview drawer">G-Code Drawer</button>
      <button data-toolbar="normalize-to-iso" type="button" title="Normalize current drawer content to .iso (no points needed)">Normalize to ISO</button>
    `;
  }

  /**
   * Get references to DOM elements
   */
  _getElementReferences() {
    this.elements.fileInput = this.container.querySelector('[data-toolbar="file-input"]');
    this.elements.fileInputLabel = this.container.querySelector('[data-toolbar="file-input-label"]');
    this.elements.zoomInButton = this.container.querySelector('[data-toolbar="zoom-in"]');
    this.elements.zoomOutButton = this.container.querySelector('[data-toolbar="zoom-out"]');
    this.elements.fitToScreenButton = this.container.querySelector('[data-toolbar="fit-to-screen"]');
    this.elements.zoomDisplay = this.container.querySelector('[data-toolbar="zoom-level"]');
    this.elements.clearPointsButton = this.container.querySelector('[data-toolbar="clear-points"]');
    this.elements.exportPointsButton = this.container.querySelector('[data-toolbar="export-points"]');
    this.elements.drawerToggleButton = this.container.querySelector('[data-toolbar="toggle-gcode-drawer"]');
    this.elements.normalizeButton = this.container.querySelector('[data-toolbar="normalize-to-iso"]');
  }

  /**
   * Set up event listeners for toolbar interactions
   */
  _setupEventListeners() {
    // File input + drag/drop delegated to FileControls
    this.fileControls = new FileControls(
      { fileInput: this.elements.fileInput, fileInputLabel: this.elements.fileInputLabel },
      { onChooseFile: (file) => this._loadFile(file) }
    );
    this.fileControls.init();

    // View controls delegated to ViewControls
    this.viewControls = new ViewControls({
      zoomInButton: this.elements.zoomInButton,
      zoomOutButton: this.elements.zoomOutButton,
      fitToScreenButton: this.elements.fitToScreenButton,
      zoomDisplay: this.elements.zoomDisplay
    });
    this.viewControls.init();

    // Utility buttons delegated to ActionControls
    this.actionControls = new ActionControls(
      {
        clearPointsButton: this.elements.clearPointsButton,
        exportPointsButton: this.elements.exportPointsButton,
        drawerToggleButton: this.elements.drawerToggleButton,
        normalizeButton: this.elements.normalizeButton
      },
      {
        getTextForNormalization: () => {
          const app = window.wireEDMViewer;
          const drawer = app?.gcodeDrawer;
          return drawer?.getText?.() || this.fileHandler?.loadedData?.content || '';
        },
        exportNormalizedISOFromText: (text, options) => this.fileHandler?.exportNormalizedISOFromText?.(text, options)
      }
    );
    this.actionControls.init();

    // Drag and drop support handled by FileControls
  }

  /**
   * Subscribe to application events
   */
  _subscribeToEvents() {
    // Viewport zoom display handled by ViewControls
    
    // Point management changes
    this.eventBus.on(EVENT_TYPES.POINT_UPDATE, this._onPointsChange);
    
    // File loading events
    this.eventBus.on(EVENT_TYPES.FILE_LOAD_START, this._onFileLoadStart);
    this.eventBus.on(EVENT_TYPES.FILE_LOAD_SUCCESS, this._onFileLoadSuccess);
    this.eventBus.on(EVENT_TYPES.FILE_LOAD_ERROR, this._onFileLoadError);
    
    // Points export events
    this.eventBus.on(EVENT_TYPES.EXPORT_SUCCESS, this._onPointsExportResponse);
  }

  

  /**
   * Handle export points with data
   * @param {Array} points - Points to export
   */
  _exportPoints(points) {
    if (!points || points.length === 0) {
      return;
    }
    
    // Use FileHandler to export points
    const success = this.fileHandler.exportPoints(points);
    
    if (success) {
      // Export successful (FileHandler already shows success message)
      this._updateButtons();
    }
  }

  

  /**
   * Load a file
   * @param {File} file - File to load
   */
  async _loadFile(file) {
    try {
      // Update state
      this.state.currentFile = file;
      this.state.isFileLoading = true;
      
      // Use FileHandler to load and parse the file
      const result = await this.fileHandler.loadFile(file);
      
      if (result) {
        // File loaded successfully
        this.state.isFileLoading = false;
        this._updateFileInputDisplay(`${file.name} loaded`);
        this._updateButtons();
      } else {
        // File loading failed (error already displayed by FileHandler)
        this.state.isFileLoading = false;
        this.state.currentFile = null;
        this._updateFileInputDisplay('Load G-Code File');
        this._updateButtons();
      }
    } catch (error) {
      this.state.isFileLoading = false;
      this.state.currentFile = null;
      this._updateFileInputDisplay('Load G-Code File');
      this._updateButtons();
      console.error('File loading error:', error);
    }
  }

  

  /**
   * Handle points change event
   * @param {Object} data - Points change data
   */
  _onPointsChange(data) {
    this.state.hasClickedPoints = data.pointCount > 0;
    this._updateButtonStates();
  }

  /**
   * Handle file load start event
   * @param {Object} data - File load start data
   */
  _onFileLoadStart(data) {
    this.state.isFileLoading = true;
    this._updateFileInputLabel('Loading...');
    this._updateButtonStates();
  }

  /**
   * Handle file load success event
   * @param {Object} data - File load success data
   */
  _onFileLoadSuccess(data) {
    this.state.isFileLoading = false;
    this._updateFileInputLabel('Load G-Code File');
    this._updateButtonStates();
  }

  /**
   * Handle file load error event
   * @param {Object} data - File load error data
   */
  _onFileLoadError(data) {
    this.state.isFileLoading = false;
    this._updateFileInputLabel('Load G-Code File');
    this._updateButtonStates();
    
    // Reset file input
    if (this.elements.fileInput) {
      this.elements.fileInput.value = '';
    }
  }

  /**
   * Handle points export response event
   * @param {Object} data - Points data
   */
  _onPointsExportResponse(data) {
    // Main owns export. Just reflect UI state if needed.
    this._updateButtonStates();
  }

  

  /**
   * Update file input label text
   * @param {string} text - New label text
   */
  _updateFileInputLabel(text) {
    if (this.elements.fileInputLabel) {
      this.elements.fileInputLabel.textContent = text;
    }
  }

  // Added for compatibility with callers
  _updateFileInputDisplay(text) {
    this._updateFileInputLabel(text);
  }

  // Added for compatibility with callers
  _updateButtons() {
    this._updateButtonStates();
  }

  /**
   * Update button states based on current state
   */
  _updateButtonStates() {
    // Update export button state
    if (this.elements.exportPointsButton) {
      this.elements.exportPointsButton.disabled = !this.state.hasClickedPoints;
    }
    
    // Update clear points button state
    if (this.elements.clearPointsButton) {
      this.elements.clearPointsButton.disabled = !this.state.hasClickedPoints;
    }
    
    // Update file input state
    if (this.elements.fileInput) {
      this.elements.fileInput.disabled = this.state.isFileLoading;
    }
  }

  /**
   * Get current toolbar state
   * @returns {Object} Current state
   */
  getState() {
    return {
      ...this.state,
      isInitialized: this.isInitialized,
      isDestroyed: this.isDestroyed
    };
  }

  /**
   * Update toolbar configuration
   * @param {Object} options - New options
   */
  updateOptions(options) {
    this.options = { ...this.options, ...options };
    
    // Re-render if already initialized
    if (this.isInitialized) {
      this._renderToolbar();
      this._setupEventListeners();
    }
  }

  /**
   * Destroy toolbar component and cleanup
   */
  destroy() {
    if (this.isDestroyed) return;

    // Unsubscribe from events
    this.eventBus.off(EVENT_TYPES.POINT_UPDATE, this._onPointsChange);
    this.eventBus.off(EVENT_TYPES.FILE_LOAD_START, this._onFileLoadStart);
    this.eventBus.off(EVENT_TYPES.FILE_LOAD_SUCCESS, this._onFileLoadSuccess);
    this.eventBus.off(EVENT_TYPES.FILE_LOAD_ERROR, this._onFileLoadError);
    this.eventBus.off(EVENT_TYPES.EXPORT_SUCCESS, this._onPointsExportResponse);

    // Clear container
    this.container.innerHTML = '';
    
    // Cleanup FileHandler
    if (this.fileHandler) {
      this.fileHandler.destroy();
      this.fileHandler = null;
    }
    if (this.fileControls) {
      this.fileControls.destroy();
      this.fileControls = null;
    }
    if (this.viewControls) {
      this.viewControls.destroy();
      this.viewControls = null;
    }
    if (this.actionControls) {
      this.actionControls.destroy();
      this.actionControls = null;
    }
    
    // Reset state
    this.elements = {};
    this.state = {
      currentFile: null,
      zoomLevel: VIEWPORT.DEFAULT_ZOOM,
      isFileLoading: false,
      hasClickedPoints: false
    };
    
    this.isDestroyed = true;
  }
}

/**
 * Factory function to create Toolbar with default configuration
 * @param {HTMLElement} container - Container element
 * @param {Object} options - Configuration options
 * @returns {Toolbar} Toolbar instance
 */
export function createToolbar(container, options = {}) {
  return new Toolbar(container, options);
}

export default Toolbar;
