/**
 * AppOrchestrator
 * High-level application lifecycle manager.
 * Coordinates DOM → components → event wiring and lifecycle events.
 */

import { EventBus, EVENT_TYPES } from './EventManager.js';
import { buildAppDOM, initAppComponents } from './ComponentInitializer.js';
import { attachEventWiring } from './EventWiring.js';

export class AppOrchestrator {
  constructor(options = {}) {
    this.options = options;
    this.eventBus = EventBus.getInstance();

    // App-level state mirrored from previous main.js
    this.isInitialized = false;
    this.isDestroyed = false;
    this.currentGCode = null;
    this.clickedPoints = [];
    this.gridSnapEnabled = false;

    // DOM + components
    this.domRefs = null;
    this.canvas = null;
    this.toolbar = null;
    this.sidebar = null;
    this.gcodeDrawer = null;
    this.statusMessage = null;
    this.eventIntegration = null;
    this.parser = null;

    // Wiring cleanup
    this._detachWiring = null;
  }

  async init() {
    // Wait DOM ready (parity with main.js)
    if (document.readyState === 'loading') {
      await new Promise(resolve => { document.addEventListener('DOMContentLoaded', resolve); });
    }

    this.eventBus.emit(EVENT_TYPES.APP_INIT, { timestamp: Date.now() }, { skipValidation: true });

    // Build DOM and init components
    this.domRefs = buildAppDOM();
    const components = await initAppComponents(this.domRefs);
    this.canvas = components.canvas;
    this.toolbar = components.toolbar;
    this.sidebar = components.sidebar;
    this.gcodeDrawer = components.gcodeDrawer;
    this.statusMessage = components.statusMessage;
    this.eventIntegration = components.eventIntegration;
    this.parser = components.parser;

    // Wire events
    this._detachWiring = attachEventWiring(this);

    // Hide loading
    this.hideLoadingIndicator();

    // Mark ready
    this.isInitialized = true;
    this.eventBus.emit(EVENT_TYPES.APP_READY, {
      timestamp: Date.now(),
      version: '2.0.0',
      components: ['Canvas', 'Toolbar', 'Sidebar', 'StatusMessage']
    });
  }

  // Methods preserved from main.js so wiring can call them
  addMeasurementPoint(x, y) {
    const pointId = Date.now().toString();
    const point = { id: pointId, x, y };
    this.eventBus.emit(EVENT_TYPES.POINT_ADD, point);
  }

  _exportPointsAsCSV(exportData) {
    const csvContent = [
      'Point,X,Y',
      ...exportData.points.map((point, index) => `P${index + 1},${point.x.toFixed(3)},${point.y.toFixed(3)}`)
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
    this.statusMessage?.show(`Exported ${exportData.points.length} points to CSV`, 'success');
    this.eventBus.emit(EVENT_TYPES.EXPORT_SUCCESS, {
      pointCount: exportData.points.length,
      format: 'csv',
      points: exportData.points
    });
  }

  hideLoadingIndicator() {
    const loadingElement = document.getElementById('loading');
    if (loadingElement) loadingElement.style.display = 'none';
  }

  showError(message) {
    if (this.statusMessage) this.statusMessage.show(message, 'error');
    else alert('Error: ' + message);
  }

  destroy() {
    if (this.isDestroyed) return;
    try {
      if (this._detachWiring) { try { this._detachWiring(); } catch (_) {} this._detachWiring = null; }
      if (this.eventIntegration) this.eventIntegration.destroy();
      if (this.canvas) this.canvas.destroy();
      if (this.toolbar) this.toolbar.destroy();
      if (this.sidebar) this.sidebar.destroy();
      if (this.statusMessage) this.statusMessage.destroy();
      if (this.eventBus) this.eventBus.removeAllListeners();
      if (this.domRefs?.appContainer) this.domRefs.appContainer.innerHTML = '';
      this.isDestroyed = true;
      this.eventBus.emit(EVENT_TYPES.APP_DESTROY, { timestamp: Date.now() }, { skipValidation: true });
    } catch (e) {
      console.error('AppOrchestrator cleanup failed:', e);
    }
  }
}

export default AppOrchestrator;
