/**
 * Wire EDM G-Code Viewer - Main Application Entry Point
 * 
 * This is the application bootstrap that initializes and coordinates all components.
 * Agent D3 Integration - Final integration phase
 */

// Core imports
import { EventBus, EVENT_TYPES } from './core/EventManager.js';
import { GCodeParser } from './core/GCodeParser.js';
import { EventIntegration } from './core/EventIntegration.js';

// Component imports
import { Canvas } from './components/Canvas.js';
import { Toolbar } from './components/Toolbar.js';
import { Sidebar } from './components/Sidebar.js';
import { GCodeDrawer } from './components/GCodeDrawer.js';
import { StatusMessage } from './components/StatusMessage.js';

// Utility imports
import { FileHandler } from './utils/FileHandler.js';
import { CANVAS, GRID } from './utils/Constants.js';

/**
 * Wire EDM G-Code Viewer Application
 * Main application class that orchestrates all components
 */
class WireEDMViewer {
  constructor() {
    // Core application state
    this.isInitialized = false;
    this.isDestroyed = false;
    
    // Core components
    this.eventBus = null;
    this.parser = null;
    this.eventIntegration = null;
    
    // UI components
    this.canvas = null;
    this.toolbar = null;
    this.sidebar = null;
    this.gcodeDrawer = null;
    this.statusMessage = null;
    
    // DOM elements
    this.appContainer = null;
    this.canvasElement = null;
    
    // Application data
    this.currentGCode = null;
    this.clickedPoints = [];
    this.gridSnapEnabled = false;
  }

  /**
   * Initialize the application
   */
  async init() {
    try {
      console.log('Wire EDM G-Code Viewer - Initializing...');
      
      // Wait for DOM to be ready
      if (document.readyState === 'loading') {
        await new Promise(resolve => {
          document.addEventListener('DOMContentLoaded', resolve);
        });
      }

      // Initialize core systems
      await this.initializeCore();
      
      // Create and setup DOM structure
      await this.createDOMStructure();
      
      // Initialize components
      await this.initializeComponents();
      
      // Wire up component communication
      await this.wireComponentCommunication();
      
      // Set up global event listeners
      this.setupGlobalEventListeners();
      
      // Hide loading indicator
      this.hideLoadingIndicator();
      
      // Mark as initialized
      this.isInitialized = true;
      
      // Emit app ready event
      this.eventBus.emit(EVENT_TYPES.APP_READY, {
        timestamp: Date.now(),
        version: '2.0.0',
        components: ['Canvas', 'Toolbar', 'Sidebar', 'StatusMessage']
      });
      
      console.log('Wire EDM G-Code Viewer - Ready');
      
    } catch (error) {
      console.error('❌ Failed to initialize Wire EDM G-Code Viewer:', error);
      this.showError('Failed to initialize application: ' + error.message);
    }
  }

  /**
   * Initialize core systems (EventBus, Viewport, Parser)
   */
  async initializeCore() {
    // Initialize EventBus singleton
    this.eventBus = EventBus.getInstance();
    
    // Create G-Code parser
    this.parser = new GCodeParser();
  }

  /**
   * Create DOM structure for the application
   */
  async createDOMStructure() {
    // Get app container
    this.appContainer = document.getElementById('app');
    if (!this.appContainer) {
      throw new Error('App container element not found');
    }
    
    // Clear existing content
    this.appContainer.innerHTML = '';
    
    // Create main application layout
    const appLayout = document.createElement('div');
    appLayout.className = 'wire-edm-viewer';
    appLayout.innerHTML = `
      <header class="header">
        <div id="toolbar-container" class="controls"></div>
      </header>
      
      <main class="main-container">
        <div class="canvas-container">
          <canvas id="main-canvas" class="main-canvas"></canvas>
          <div id="canvas-overlay" class="canvas-overlay"></div>
        </div>
        
        <aside id="sidebar-container" class="sidebar"></aside>
      </main>
      
      <div id="status-container" class="status-container"></div>
    `;
    
    this.appContainer.appendChild(appLayout);
    
    // Get canvas element reference
    this.canvasElement = document.getElementById('main-canvas');
    if (!this.canvasElement) {
      throw new Error('Canvas element not found');
    }
  }

  /**
   * Initialize all UI components
   */
  async initializeComponents() {
    try {
      // Initialize Canvas component
      this.canvas = new Canvas(this.canvasElement, {
        showGrid: true,
        gridSize: GRID.SIZE,
        enableHighDPI: false // Temporarily disabled for debugging
      });
      
      // Initialize the canvas
      await this.canvas.init();
      
      // Initialize Toolbar component
      const toolbarContainer = document.getElementById('toolbar-container');
      this.toolbar = new Toolbar(toolbarContainer, {
        enableFileInput: true,
        enableZoomControls: true,
        enableUtilityButtons: true
      });
      
      // Initialize the toolbar
      this.toolbar.init();
      
      // Initialize Sidebar component
      const sidebarContainer = document.getElementById('sidebar-container');
      this.sidebar = new Sidebar(sidebarContainer, {
        showCoordinates: true,
        showPoints: true,
        showPathInfo: true
      });

      // Initialize GCode Drawer (collapsible panel)
      this.gcodeDrawer = new GCodeDrawer(document.body, { anchor: 'right' });
      
      // Initialize StatusMessage component
      const statusContainer = document.getElementById('status-container');
      this.statusMessage = new StatusMessage({
        container: statusContainer,
        position: 'top-right',
        maxMessages: 3,
        defaultDuration: 3000
      });
      
      // Initialize Event Integration system
      this.eventIntegration = new EventIntegration(this.canvasElement, this.canvas.viewport, {
        enableMouse: true,
        enableKeyboard: true,
        enableTouch: true,
        enableDelegation: true
      });
      
    } catch (error) {
      console.error('Component initialization failed:', error);
      throw new Error(`Component initialization failed: ${error.message}`);
    }
  }

  /**
   * Wire up component communication through EventBus
   */
  async wireComponentCommunication() {
    // File loading workflow
    this.setupFileLoadingWorkflow();
    
    // Canvas interaction workflow
    this.setupCanvasInteractionWorkflow();
    
    // Point management workflow
    this.setupPointManagementWorkflow();
    
    // Viewport control workflow
    this.setupViewportControlWorkflow();
    
    // Status message workflow
    this.setupStatusMessageWorkflow();
    
    // Export workflow
    this.setupExportWorkflow();

    // Drawer workflow
    this.setupDrawerWorkflow();
  }

  /**
   * Set up file loading workflow
   */
  setupFileLoadingWorkflow() {
    // Handle file load start - just show loading message
    this.eventBus.on(EVENT_TYPES.FILE_LOAD_START, (data) => {
      this.statusMessage.show('Loading G-Code file...', 'info');
    });
    
    // Handle successful file load with parsed data
    this.eventBus.on(EVENT_TYPES.FILE_LOAD_SUCCESS, async (data) => {
      try {
        // Store the parsed result (data.path, data.bounds, etc. are already parsed by FileHandler)
        this.currentGCode = {
          path: data.path,
          bounds: data.bounds,
          stats: data.stats
        };
        
        // Update canvas with new path
        this.canvas.setGCodePath(data.path);
        
        // Fit viewport to new content and establish dynamic zoom limits
        this.canvas.viewport.fitToBounds(data.bounds);
        
        // Update canvas display
        this.canvas.redraw();

        // Provide stripped file content (for clean editing) and parsed mapping to drawer
        if (this.gcodeDrawer && this.toolbar?.fileHandler?.loadedData) {
          const raw = this.toolbar.fileHandler.loadedData.content;
          try {
            // Lazy import to avoid circular deps
            const { stripForEditing } = await import('./utils/IsoNormalizer.js');
            const stripped = stripForEditing(raw);
            this.gcodeDrawer.setContent({
              text: stripped,
              mapping: data.path.map((p, idx) => ({ index: idx, line: p.line || null, point: p }))
            });
          } catch (_e) {
            // Fallback to raw text, but still canonicalize motion codes (G01 -> G1)
            try {
              const { canonicalizeMotionCodes } = await import('./utils/IsoNormalizer.js');
              const canonical = canonicalizeMotionCodes(raw);
              this.gcodeDrawer.setContent({
                text: canonical,
                mapping: data.path.map((p, idx) => ({ index: idx, line: p.line || null, point: p }))
              });
            } catch (_e2) {
              // Ultimate fallback: raw text
              this.gcodeDrawer.setContent({
                text: raw,
                mapping: data.path.map((p, idx) => ({ index: idx, line: p.line || null, point: p }))
              });
            }
          }
        }
        
        // Show success message
        this.statusMessage.show(`G-Code loaded: ${data.file.name}`, 'success');
        
      } catch (error) {
        console.error('File display failed:', error);
        this.statusMessage.show(`Failed to display file: ${error.message}`, 'error');
      }
    });
    
    // Handle file load errors
    this.eventBus.on(EVENT_TYPES.FILE_LOAD_ERROR, (data) => {
      console.error('File loading failed:', data.error);
      this.statusMessage.show(`Failed to load file: ${data.error.message || data.error}`, 'error');
    });
  }

  /**
   * Set up canvas interaction workflow
   */
  setupCanvasInteractionWorkflow() {
    // Handle mouse clicks on canvas
    this.eventBus.on(EVENT_TYPES.MOUSE_CLICK, (data) => {
      console.log('MOUSE_CLICK event received:', data);
      if (data.target === 'canvas') {
        console.log('Adding measurement point at:', data.worldX, data.worldY);
        
        // Use the world coordinates from the event data directly (more accurate)
        this.addMeasurementPoint(data.worldX, data.worldY);
      }
    });
    
    // Handle viewport changes
    this.eventBus.on(EVENT_TYPES.VIEWPORT_ZOOM_CHANGE, () => {
      this.canvas.redraw();
    });
    
    this.eventBus.on(EVENT_TYPES.VIEWPORT_PAN_CHANGE, () => {
      this.canvas.redraw();
    });
    
    // Handle canvas resize
    this.eventBus.on(EVENT_TYPES.UI_RESIZE, () => {
      this.canvas._handleResize();
    });
  }

  /**
   * Wire interactions between drawer and canvas
   */
  setupDrawerWorkflow() {
    if (!this.gcodeDrawer) return;
    // Hover line -> highlight point
    this.eventBus.on('drawer:line:hover', ({ index }) => {
      this.canvas.setHoverHighlight(index);
    });
    // Leave
    this.eventBus.on('drawer:line:leave', () => {
      this.canvas.setHoverHighlight(null);
    });
    // Click line -> toggle persistent highlight
    this.eventBus.on('drawer:line:click', ({ index }) => {
      this.canvas.togglePersistentHighlight(index);
    });
    // Insert clicked measurement points into drawer text
    this.eventBus.on('drawer:insert:points', ({ atIndex, points }) => {
      if (!points || points.length === 0) return;
      this.gcodeDrawer.insertPointsAt(atIndex, points);
    });

    // Drawer content edits -> reparse and rebuild mapping and canvas path
    this.eventBus.on('drawer:content:changed', async ({ text }) => {
      try {
        // Normalize drawer text to canonical motion codes for consistency (G01 -> G1, etc.)
        const { canonicalizeMotionCodes } = await import('./utils/IsoNormalizer.js');
        const normalizedText = canonicalizeMotionCodes(text || '');

        // Reuse parser to keep mapping intact
        const result = this.parser.parse(normalizedText);
        this.currentGCode = { path: result.path, bounds: result.bounds, stats: result.stats };
        this.canvas.setGCodePath(result.path);
        this.canvas.redraw();
        // Rebuild mapping in drawer so hover/click keeps working (preserve undo/redo history)
        this.gcodeDrawer.setContent({
          text: normalizedText,
          mapping: result.path.map((p, idx) => ({ index: idx, line: p.line || null, point: p })),
          preserveHistory: true
        });
      } catch (e) {
        console.error('Re-parse failed:', e);
      }
    });
  }

  /**
   * Set up point management workflow
   */
  setupPointManagementWorkflow() {
    // Handle point addition
    this.eventBus.on(EVENT_TYPES.POINT_ADD, (data) => {
      console.log('POINT_ADD event received:', data);
      const newPoint = {
        id: data.id || Date.now(),
        x: data.x,
        y: data.y,
        index: this.clickedPoints.length
      };
      this.clickedPoints.push(newPoint);
      console.log('Added point, total points:', this.clickedPoints.length);
      
      this.canvas.setClickedPoints(this.clickedPoints);
      this.canvas.redraw();
      
      // Emit point count change for other components
      this.eventBus.emit(EVENT_TYPES.POINT_UPDATE, {
        pointCount: this.clickedPoints.length,
        points: this.clickedPoints
      });
    });
    
    // Handle point deletion
    this.eventBus.on(EVENT_TYPES.POINT_DELETE, (data) => {
      this.clickedPoints = this.clickedPoints.filter(point => point.id !== data.id);
      
      // Re-index remaining points
      this.clickedPoints.forEach((point, index) => {
        point.index = index;
      });
      
      this.canvas.setClickedPoints(this.clickedPoints);
      this.canvas.redraw();
      
      // Emit point count change for other components
      this.eventBus.emit(EVENT_TYPES.POINT_UPDATE, {
        pointCount: this.clickedPoints.length,
        points: this.clickedPoints
      });
    });
    
    // Handle clear all points
    this.eventBus.on(EVENT_TYPES.POINT_CLEAR_ALL, () => {
      this.clickedPoints = [];
      this.canvas.setClickedPoints(this.clickedPoints);
      this.canvas.redraw();
      
      // Emit point count change for other components
      this.eventBus.emit(EVENT_TYPES.POINT_UPDATE, {
        pointCount: this.clickedPoints.length,
        points: this.clickedPoints
      });
    });
    
    // Handle request for clicked points (from components that need them)
    this.eventBus.on(EVENT_TYPES.POINT_GET_CLICKED, () => {
      // Respond with current clicked points
      this.eventBus.emit(EVENT_TYPES.POINT_CLICKED_RESPONSE, {
        points: [...this.clickedPoints] // Send a copy to prevent modification
      }, { skipValidation: true });
    });
  }

  /**
   * Set up viewport control workflow
   */
  setupViewportControlWorkflow() {
    // Handle zoom controls
    this.eventBus.on(EVENT_TYPES.VIEWPORT_ZOOM_CHANGE, (data) => {
      // Command-style payload: { type: 'in' | 'out' }
      if (data && typeof data.type === 'string') {
        if (data.type === 'in') {
          this.canvas.viewport.zoomIn();
        } else if (data.type === 'out') {
          this.canvas.viewport.zoomOut();
        }
        this.canvas.redraw();

        // Re-emit stateful viewport change for UI sync
        const state = {
          ...this.canvas.viewport.getState(),
          canvasWidth: this.canvas.canvas.width,
          canvasHeight: this.canvas.canvas.height
        };
        this.eventBus.emit(EVENT_TYPES.VIEWPORT_ZOOM_CHANGE, state);
        return;
      }

      // Stateful payloads trigger redraw only
      this.canvas.redraw();
    });
    
    // Handle fit to screen
    this.eventBus.on(EVENT_TYPES.VIEWPORT_FIT_TO_SCREEN, () => {
      if (this.currentGCode) {
        this.canvas.viewport.fitToBounds(this.currentGCode.bounds);
        this.canvas.redraw();

        // Emit stateful viewport change for UI sync
        const state = {
          ...this.canvas.viewport.getState(),
          canvasWidth: this.canvas.canvas.width,
          canvasHeight: this.canvas.canvas.height
        };
        this.eventBus.emit(EVENT_TYPES.VIEWPORT_ZOOM_CHANGE, state);
      }
    });
    
    // Handle viewport reset
    this.eventBus.on(EVENT_TYPES.VIEWPORT_RESET, () => {
      this.canvas.viewport.reset();
      this.canvas.redraw();

      // Emit stateful viewport change for UI sync
      const state = {
        ...this.canvas.viewport.getState(),
        canvasWidth: this.canvas.canvas.width,
        canvasHeight: this.canvas.canvas.height
      };
      this.eventBus.emit(EVENT_TYPES.VIEWPORT_ZOOM_CHANGE, state);
    });
    
    // Handle grid snap toggle
    this.eventBus.on(EVENT_TYPES.GRID_SNAP_TOGGLE, (data) => {
      const hasPayload = data && typeof data.enabled === 'boolean';
      if (hasPayload) {
        this.gridSnapEnabled = data.enabled;
      } else {
        this.gridSnapEnabled = !this.gridSnapEnabled;
        // Announce new state so subscribers like Sidebar update correctly
        this.eventBus.emit(
          EVENT_TYPES.GRID_SNAP_TOGGLE,
          { enabled: this.gridSnapEnabled },
          { skipValidation: true }
        );
      }

      this.canvas.viewport.setGridSnap(this.gridSnapEnabled, this.canvas.gridSize);
      if (!hasPayload) {
        this.statusMessage.show(
          `Grid snap ${this.gridSnapEnabled ? 'enabled' : 'disabled'}`,
          'info'
        );
      }
    });

    // Handle grid visibility toggle
    this.eventBus.on(EVENT_TYPES.GRID_VISIBILITY_TOGGLE, () => {
      const currentGridState = this.canvas.gridEnabled;
      this.canvas.setGridEnabled(!currentGridState);
      this.statusMessage.show(
        `Grid ${!currentGridState ? 'enabled' : 'disabled'}`,
        'info'
      );
    });
  }

  /**
   * Set up status message workflow
   */
  setupStatusMessageWorkflow() {
    // Handle status show requests
    this.eventBus.on(EVENT_TYPES.STATUS_SHOW, (data) => {
      this.statusMessage.show(data.message, data.type, data.options);
    });
  }

  /**
   * Set up export workflow
   */
  setupExportWorkflow() {
    // Handle export requests
    this.eventBus.on(EVENT_TYPES.EXPORT_START, (data) => {
      const fmt = (data && typeof data.format === 'string') ? data.format.toLowerCase() : 'iso';

      if (fmt === 'iso') {
        // New behavior: Export the ENTIRE drawer text (including any inserted moves)
        // normalized to ISO, not just clicked points.
        const drawerText = this.gcodeDrawer?.getText?.();
        if (!drawerText || drawerText.trim() === '') {
          this.statusMessage.show('Nothing to export. Load a file or add content.', 'warning');
          return;
        }
        const ok = this.toolbar?.fileHandler?.exportNormalizedISOFromText(drawerText, {
          filename: `program_${new Date().toISOString().slice(0,19).replace(/[:T]/g,'-')}.iso`
        });
        if (!ok) {
          this.statusMessage.show('ISO export failed', 'error');
        }
        return;
      }

      if (fmt === 'csv') {
        // Fallback CSV of clicked points only
        if (this.clickedPoints.length === 0) {
          this.statusMessage.show('No points to export', 'warning');
          return;
        }
        const exportData = {
          points: this.clickedPoints,
          format: 'csv',
          timestamp: new Date().toISOString()
        };
        this._exportPointsAsCSV(exportData);
        return;
      }

      // Unknown format -> default ISO behavior
      const drawerText = this.gcodeDrawer?.getText?.();
      if (!drawerText || drawerText.trim() === '') {
        this.statusMessage.show('Nothing to export. Load a file or add content.', 'warning');
        return;
      }
      const ok = this.toolbar?.fileHandler?.exportNormalizedISOFromText(drawerText, {
        filename: `program_${new Date().toISOString().slice(0,19).replace(/[:T]/g,'-')}.iso`
      });
      if (!ok) {
        this.statusMessage.show('Export failed', 'error');
      }
    });
  }

  /**
   * Export points as CSV file
   */
  _exportPointsAsCSV(exportData) {
    const csvContent = [
      'Point,X,Y',
      ...exportData.points.map((point, index) => 
        `P${index + 1},${point.x.toFixed(3)},${point.y.toFixed(3)}`
      )
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `measurement_points_${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    this.statusMessage.show(`Exported ${exportData.points.length} points to CSV`, 'success');
    
    // Emit export success including points for consumers expecting them
    this.eventBus.emit(EVENT_TYPES.EXPORT_SUCCESS, {
      pointCount: exportData.points.length,
      format: 'csv',
      points: exportData.points
    });
  }

  /**
   * Set up global event listeners
   */
  setupGlobalEventListeners() {
    // Window resize
    window.addEventListener('resize', () => {
      this.eventBus.emit(EVENT_TYPES.UI_RESIZE, {
        width: window.innerWidth,
        height: window.innerHeight
      });
    });
    
    // Initialize event integration
    this.eventIntegration.init();
  }

  /**
   * Add a measurement point
   */
  addMeasurementPoint(x, y) {
    console.log('addMeasurementPoint called with:', x, y);
    const pointId = Date.now().toString();
    const point = { id: pointId, x, y };
    
    console.log('Emitting POINT_ADD event:', point);
    this.eventBus.emit(EVENT_TYPES.POINT_ADD, point);
  }

  /**
   * Hide loading indicator
   */
  hideLoadingIndicator() {
    const loadingElement = document.getElementById('loading');
    if (loadingElement) {
      loadingElement.style.display = 'none';
    }
  }

  /**
   * Show error message
   */
  showError(message) {
    // Try to show via status message if available
    if (this.statusMessage) {
      this.statusMessage.show(message, 'error');
    } else {
      // Fallback to alert
      alert('Error: ' + message);
    }
  }

  /**
   * Destroy the application and clean up resources
   */
  destroy() {
    if (this.isDestroyed) return;
    
    try {
      // Clean up event integration
      if (this.eventIntegration) {
        this.eventIntegration.destroy();
      }
      
      // Clean up components
      if (this.canvas) this.canvas.destroy();
      if (this.toolbar) this.toolbar.destroy();
      if (this.sidebar) this.sidebar.destroy();
      if (this.statusMessage) this.statusMessage.destroy();
      
      // Clear event bus
      if (this.eventBus) {
        this.eventBus.removeAllListeners();
      }
      
      // Clear DOM
      if (this.appContainer) {
        this.appContainer.innerHTML = '';
      }
      
      this.isDestroyed = true;
      
    } catch (error) {
      console.error('Cleanup failed:', error);
    }
  }
}

/**
 * Application entry point
 */
async function startApplication() {
  try {
    // Create and initialize the application
    const app = new WireEDMViewer();
    await app.init();
    
    // Make app globally available for debugging
    window.wireEDMViewer = app;
    
    // Handle page unload
    window.addEventListener('beforeunload', () => {
      app.destroy();
    });
    
  } catch (error) {
    console.error('❌ Application startup failed:', error);
    
    // Show error in DOM if possible
    const appContainer = document.getElementById('app');
    if (appContainer) {
      appContainer.innerHTML = `
        <div style="padding: 20px; text-align: center; color: #ff6b6b;">
          <h2>❌ Application Failed to Start</h2>
          <p>${error.message}</p>
          <p>Please refresh the page to try again.</p>
        </div>
      `;
    }
  }
}

// Start the application
startApplication();