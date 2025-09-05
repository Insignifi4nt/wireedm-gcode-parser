/**
 * Wire EDM G-Code Viewer - Bootstrap Entry
 * Delegates to AppOrchestrator (PR5) to manage lifecycle.
 */

import { AppOrchestrator } from './core/AppOrchestrator.js';

async function startApplication() {
  try {
    const app = new AppOrchestrator();
    await app.init();
    // Preserve global for components that access window.wireEDMViewer
    window.wireEDMViewer = app;
    window.addEventListener('beforeunload', () => { try { app.destroy(); } catch (_) {} });
  } catch (error) {
    console.error('❌ Application startup failed:', error);
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

startApplication();

