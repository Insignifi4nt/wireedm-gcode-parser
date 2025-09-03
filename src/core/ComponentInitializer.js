/**
 * ComponentInitializer
 * Builds the application DOM structure (PR1 scope).
 * Extracted from src/main.js to keep entrypoint slim and focused.
 *
 * Exports:
 * - buildAppDOM(): creates header/main/sidebar/canvas/status DOM and returns refs
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

/**
 * Initialize core UI components with provided DOM references.
 * @param {Object} domRefs - DOM references from buildAppDOM
 * @returns {Promise<Object>} components
 */
export default { buildAppDOM };
