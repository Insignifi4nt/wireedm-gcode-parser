/**
 * Wire EDM G-Code Viewer - Main Application Entry Point
 * 
 * This is the application bootstrap that initializes and coordinates all components.
 * Agent D3 Integration - Final integration phase
 */

// Core imports
import { EventBus, EVENT_TYPES } from './core/EventManager.js';
import { buildAppDOM, initAppComponents } from './core/ComponentInitializer.js';
import { attachEventWiring } from './core/EventWiring.js';

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
      
      // Wire up cross-component communication via centralized module (PR3)
      this._detachWiring = attachEventWiring(this);
      
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
  }

  /**
   * Create DOM structure for the application
   */
  async createDOMStructure() {
    // Delegate to ComponentInitializer (PR1)
    const domRefs = buildAppDOM();
    this.domRefs = domRefs;
    this.appContainer = domRefs.appContainer;
    this.canvasElement = domRefs.canvasElement;
  }

  /**
   * Initialize all UI components
   */
  async initializeComponents() {
    try {
      const components = await initAppComponents(this.domRefs);
      this.canvas = components.canvas;
      this.toolbar = components.toolbar;
      this.sidebar = components.sidebar;
      this.gcodeDrawer = components.gcodeDrawer;
      this.statusMessage = components.statusMessage;
      this.eventIntegration = components.eventIntegration;
      this.parser = components.parser;
    } catch (error) {
      console.error('Component initialization failed:', error);
      throw new Error(`Component initialization failed: ${error.message}`);
    }
  }

  /**
   * Wire up component communication through EventBus
   */
  async wireComponentCommunication() {}

  /**
   * Set up file loading workflow
   */
  setupFileLoadingWorkflow() {}

  /**
   * Set up canvas interaction workflow
   */
  setupCanvasInteractionWorkflow() {}

  /**
   * Wire interactions between drawer and canvas
   */
  setupDrawerWorkflow() {}

  /**
   * Set up point management workflow
   */
  setupPointManagementWorkflow() {}

  /**
   * Set up viewport control workflow
   */
  setupViewportControlWorkflow() {}

  /**
   * Set up status message workflow
   */
  setupStatusMessageWorkflow() {}

  /**
   * Set up export workflow
   */
  setupExportWorkflow() {}

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
  setupGlobalEventListeners() {}

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
      // Detach event wiring
      if (this._detachWiring) {
        try { this._detachWiring(); } catch (_) {}
        this._detachWiring = null;
      }
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
