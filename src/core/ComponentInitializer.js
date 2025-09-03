/**
 * ComponentInitializer
 * PR1: Builds the application DOM structure.
 * PR2: Initializes core UI components via initAppComponents.
 * Extracted from src/main.js to keep entrypoint slim and focused.
 *
 * Exports:
 * - buildAppDOM(): creates header/main/sidebar/canvas/status DOM and returns refs
 * - initAppComponents(domRefs): instantiates Canvas, Toolbar, Sidebar, GCodeDrawer,
 *   StatusMessage, EventIntegration, and GCodeParser, returning component instances
 */

/**
 * Build application DOM structure and return key references.
 * Preserves IDs/classes used by CSS and selectors.
 * @returns {Object} domRefs
 */
export function buildAppDOM() {
  const appContainer = document.getElementById('app');
  if (!appContainer) {
    throw new Error('App container element not found');
  }

  // Clear existing content
  appContainer.innerHTML = '';

  // Create main application layout (IDs/classes preserved)
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

  appContainer.appendChild(appLayout);

  // Collect references
  const canvasElement = document.getElementById('main-canvas');
  if (!canvasElement) {
    throw new Error('Canvas element not found');
  }

  const domRefs = {
    appContainer,
    canvasElement,
    toolbarContainer: document.getElementById('toolbar-container'),
    sidebarContainer: document.getElementById('sidebar-container'),
    statusContainer: document.getElementById('status-container'),
    canvasOverlay: document.getElementById('canvas-overlay')
  };

  return domRefs;
}

// PR2 imports (kept here to avoid import churn in main.js)
import { Canvas } from '../components/Canvas.js';
import { Toolbar } from '../components/Toolbar.js';
import { Sidebar } from '../components/Sidebar.js';
import { GCodeDrawer } from '../components/GCodeDrawer.js';
import { StatusMessage } from '../components/StatusMessage.js';
import { EventIntegration } from './EventIntegration.js';
import { GCodeParser } from './GCodeParser.js';
import { GRID } from '../utils/Constants.js';

/**
 * Initialize core UI components with provided DOM references.
 * @param {Object} domRefs - DOM references from buildAppDOM
 * @returns {Promise<Object>} components
 */
export async function initAppComponents(domRefs) {
  if (!domRefs || !domRefs.canvasElement) {
    throw new Error('initAppComponents requires valid domRefs');
  }

  const { canvasElement, toolbarContainer, sidebarContainer, statusContainer } = domRefs;

  // Initialize Canvas
  const canvas = new Canvas(canvasElement, {
    showGrid: true,
    gridSize: GRID.SIZE,
    enableHighDPI: false
  });
  await canvas.init();

  // Initialize Toolbar
  const toolbar = new Toolbar(toolbarContainer, {
    enableFileInput: true,
    enableZoomControls: true,
    enableUtilityButtons: true
  });
  toolbar.init();

  // Initialize Sidebar
  const sidebar = new Sidebar(sidebarContainer, {
    showCoordinates: true,
    showPoints: true,
    showPathInfo: true
  });

  // Initialize GCode Drawer (collapsible panel)
  const gcodeDrawer = new GCodeDrawer(document.body, { anchor: 'right' });

  // Initialize StatusMessage
  const statusMessage = new StatusMessage({
    container: statusContainer,
    position: 'top-right',
    maxMessages: 3,
    defaultDuration: 3000
  });

  // Initialize Event Integration (do not call init() here; main controls lifecycle)
  const eventIntegration = new EventIntegration(canvasElement, canvas.viewport, {
    enableMouse: true,
    enableKeyboard: true,
    enableTouch: true,
    enableDelegation: true
  });

  // Create parser instance
  const parser = new GCodeParser();

  return {
    canvas,
    toolbar,
    sidebar,
    gcodeDrawer,
    statusMessage,
    eventIntegration,
    parser
  };
}

export default { buildAppDOM, initAppComponents };
