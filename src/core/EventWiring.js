/**
 * EventWiring
 * Cross-component EventBus subscriptions and global listeners.
 * Extracted from main.js (PR3) with behavior parity.
 */

import { EventBus, EVENT_TYPES } from './EventManager.js';

// Utils imported dynamically where needed to avoid circular deps

/**
 * Attach event wiring given the app context.
 * @param {Object} app - App context (WireEDMViewer instance)
 * @returns {Function} cleanup - Detaches all listeners and window handlers
 */
export function attachEventWiring(app) {
  const bus = EventBus.getInstance();
  const cleanups = [];

  // Helper to register and collect unsubscribe
  const on = (type, handler, options) => {
    const off = bus.on(type, handler, options);
    cleanups.push(off);
    return off;
  };

  // --- File loading workflow ---
  on(EVENT_TYPES.FILE_LOAD_START, () => {
    app.statusMessage?.show('Loading G-Code file...', 'info');
  });

  on(EVENT_TYPES.FILE_LOAD_SUCCESS, async (data) => {
    try {
      app.currentGCode = {
        path: data.path,
        bounds: data.bounds,
        stats: data.stats
      };

      app.canvas?.setGCodePath(data.path);
      app.canvas?.viewport.fitToBounds(data.bounds);
      app.canvas?.redraw();

      if (app.gcodeDrawer && app.toolbar?.fileHandler?.loadedData) {
        const raw = app.toolbar.fileHandler.loadedData.content;
        try {
          const { stripForEditing } = await import('../utils/IsoNormalizer.js');
          const stripped = stripForEditing(raw);
          app.gcodeDrawer.setContent({
            text: stripped,
            mapping: data.path.map((p, idx) => ({ index: idx, line: p.line || null, point: p }))
          });
        } catch (_e) {
          try {
            const { canonicalizeMotionCodes } = await import('../utils/IsoNormalizer.js');
            const canonical = canonicalizeMotionCodes(raw);
            app.gcodeDrawer.setContent({
              text: canonical,
              mapping: data.path.map((p, idx) => ({ index: idx, line: p.line || null, point: p }))
            });
          } catch (_e2) {
            app.gcodeDrawer.setContent({
              text: raw,
              mapping: data.path.map((p, idx) => ({ index: idx, line: p.line || null, point: p }))
            });
          }
        }
      }

      app.statusMessage?.show(`G-Code loaded: ${data.file.name}`, 'success');
    } catch (error) {
      console.error('File display failed:', error);
      app.statusMessage?.show(`Failed to display file: ${error.message}`, 'error');
    }
  });

  on(EVENT_TYPES.FILE_LOAD_ERROR, (data) => {
    console.error('File loading failed:', data.error);
    app.statusMessage?.show(`Failed to load file: ${data.error.message || data.error}`, 'error');
  });

  // --- Canvas interaction workflow ---
  on(EVENT_TYPES.MOUSE_CLICK, (data) => {
    if (data.target === 'canvas') {
      app.addMeasurementPoint?.(data.worldX, data.worldY);
    }
  });

  // Viewport zoom handling is consolidated later; avoid duplicate handlers
  on(EVENT_TYPES.VIEWPORT_PAN_CHANGE, () => {
    app.canvas?.redraw();
  });
  on(EVENT_TYPES.UI_RESIZE, () => {
    app.canvas?._handleResize();
  });

  // --- Drawer workflow ---
  if (app.gcodeDrawer) {
    on('drawer:line:hover', ({ index }) => {
      app.canvas?.setHoverHighlight(index);
    });
    on('drawer:line:leave', () => {
      app.canvas?.setHoverHighlight(null);
    });
    on('drawer:line:click', ({ index }) => {
      app.canvas?.togglePersistentHighlight(index);
    });
    on('drawer:insert:points', ({ atIndex, points }) => {
      if (!points || points.length === 0) return;
      app.gcodeDrawer.insertPointsAt(atIndex, points);
    });

    on('drawer:content:changed', async ({ text }) => {
      try {
        const { canonicalizeMotionCodes } = await import('../utils/IsoNormalizer.js');
        const normalizedText = canonicalizeMotionCodes(text || '');
        const result = app.parser.parse(normalizedText);
        app.currentGCode = { path: result.path, bounds: result.bounds, stats: result.stats };
        app.canvas?.setGCodePath(result.path);
        app.canvas?.redraw();
        app.gcodeDrawer.setContent({
          text: normalizedText,
          mapping: result.path.map((p, idx) => ({ index: idx, line: p.line || null, point: p })),
          preserveHistory: true
        });
      } catch (e) {
        console.error('Re-parse failed:', e);
      }
    });
  }

  // --- Point management workflow ---
  on(EVENT_TYPES.POINT_ADD, (data) => {
    const newPoint = {
      id: data.id || Date.now(),
      x: data.x,
      y: data.y,
      index: app.clickedPoints.length
    };
    app.clickedPoints.push(newPoint);
    app.canvas?.setClickedPoints(app.clickedPoints);
    app.canvas?.redraw();
    bus.emit(EVENT_TYPES.POINT_UPDATE, {
      pointCount: app.clickedPoints.length,
      points: app.clickedPoints
    });
  });

  on(EVENT_TYPES.POINT_DELETE, (data) => {
    app.clickedPoints = app.clickedPoints.filter(point => point.id !== data.id);
    app.clickedPoints.forEach((point, index) => { point.index = index; });
    app.canvas?.setClickedPoints(app.clickedPoints);
    app.canvas?.redraw();
    bus.emit(EVENT_TYPES.POINT_UPDATE, {
      pointCount: app.clickedPoints.length,
      points: app.clickedPoints
    });
  });

  on(EVENT_TYPES.POINT_CLEAR_ALL, () => {
    app.clickedPoints = [];
    app.canvas?.setClickedPoints(app.clickedPoints);
    app.canvas?.redraw();
    bus.emit(EVENT_TYPES.POINT_UPDATE, {
      pointCount: app.clickedPoints.length,
      points: app.clickedPoints
    });
  });

  on(EVENT_TYPES.POINT_GET_CLICKED, () => {
    bus.emit(EVENT_TYPES.POINT_CLICKED_RESPONSE, {
      points: [...app.clickedPoints]
    }, { skipValidation: true });
  });

  // --- Viewport control workflow ---
  on(EVENT_TYPES.VIEWPORT_ZOOM_CHANGE, (data) => {
    if (data && typeof data.type === 'string') {
      if (data.type === 'in') app.canvas?.viewport.zoomIn();
      else if (data.type === 'out') app.canvas?.viewport.zoomOut();
      app.canvas?.redraw();
      const state = {
        ...app.canvas.viewport.getState(),
        canvasWidth: app.canvas.canvas.width,
        canvasHeight: app.canvas.canvas.height
      };
      bus.emit(EVENT_TYPES.VIEWPORT_ZOOM_CHANGE, state);
      return;
    }
    app.canvas?.redraw();
  });

  on(EVENT_TYPES.VIEWPORT_FIT_TO_SCREEN, () => {
    if (app.currentGCode) {
      app.canvas?.viewport.fitToBounds(app.currentGCode.bounds);
      app.canvas?.redraw();
      const state = {
        ...app.canvas.viewport.getState(),
        canvasWidth: app.canvas.canvas.width,
        canvasHeight: app.canvas.canvas.height
      };
      bus.emit(EVENT_TYPES.VIEWPORT_ZOOM_CHANGE, state);
    }
  });

  on(EVENT_TYPES.VIEWPORT_RESET, () => {
    app.canvas?.viewport.reset();
    app.canvas?.redraw();
    const state = {
      ...app.canvas.viewport.getState(),
      canvasWidth: app.canvas.canvas.width,
      canvasHeight: app.canvas.canvas.height
    };
    bus.emit(EVENT_TYPES.VIEWPORT_ZOOM_CHANGE, state);
  });

  on(EVENT_TYPES.GRID_SNAP_TOGGLE, (data) => {
    const hasPayload = data && typeof data.enabled === 'boolean';
    if (hasPayload) {
      app.gridSnapEnabled = data.enabled;
    } else {
      app.gridSnapEnabled = !app.gridSnapEnabled;
      bus.emit(EVENT_TYPES.GRID_SNAP_TOGGLE, { enabled: app.gridSnapEnabled }, { skipValidation: true });
    }
    app.canvas?.viewport.setGridSnap(app.gridSnapEnabled, app.canvas.gridSize);
    if (!hasPayload) {
      app.statusMessage?.show(`Grid snap ${app.gridSnapEnabled ? 'enabled' : 'disabled'}`, 'info');
    }
  });

  on(EVENT_TYPES.GRID_VISIBILITY_TOGGLE, () => {
    const current = app.canvas?.gridEnabled;
    app.canvas?.setGridEnabled(!current);
    app.statusMessage?.show(`Grid ${!current ? 'enabled' : 'disabled'}`, 'info');
  });

  // --- Status message workflow ---
  on(EVENT_TYPES.STATUS_SHOW, (data) => {
    app.statusMessage?.show(data.message, data.type, data.options);
  });

  // --- Export workflow ---
  on(EVENT_TYPES.EXPORT_START, (data) => {
    const fmt = (data && typeof data.format === 'string') ? data.format.toLowerCase() : 'iso';

    if (fmt === 'iso') {
      const drawerText = app.gcodeDrawer?.getText?.();
      if (!drawerText || drawerText.trim() === '') {
        app.statusMessage?.show('Nothing to export. Load a file or add content.', 'warning');
        return;
      }
      const ok = app.toolbar?.fileHandler?.exportNormalizedISOFromText(drawerText, {
        filename: `program_${new Date().toISOString().slice(0,19).replace(/[:T]/g,'-')}.iso`
      });
      if (!ok) app.statusMessage?.show('ISO export failed', 'error');
      return;
    }

    if (fmt === 'csv') {
      if (app.clickedPoints.length === 0) {
        app.statusMessage?.show('No points to export', 'warning');
        return;
      }
      const exportData = {
        points: app.clickedPoints,
        format: 'csv',
        timestamp: new Date().toISOString()
      };
      if (typeof app._exportPointsAsCSV === 'function') {
        app._exportPointsAsCSV(exportData);
      } else {
        // Minimal inline CSV as fallback
        const csv = ['Point,X,Y', ...exportData.points.map((p, i) => `P${i+1},${p.x.toFixed(3)},${p.y.toFixed(3)}`)].join('\n');
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = 'measurement_points.csv'; a.click();
        URL.revokeObjectURL(url);
      }
      return;
    }

    // Unknown -> default ISO
    const drawerText = app.gcodeDrawer?.getText?.();
    if (!drawerText || drawerText.trim() === '') {
      app.statusMessage?.show('Nothing to export. Load a file or add content.', 'warning');
      return;
    }
    const ok = app.toolbar?.fileHandler?.exportNormalizedISOFromText(drawerText, {
      filename: `program_${new Date().toISOString().slice(0,19).replace(/[:T]/g,'-')}.iso`
    });
    if (!ok) app.statusMessage?.show('Export failed', 'error');
  });

  // --- Global listeners ---
  const onResize = () => {
    bus.emit(EVENT_TYPES.UI_RESIZE, { width: window.innerWidth, height: window.innerHeight });
  };
  window.addEventListener('resize', onResize);

  // Initialize event integration lifecycle
  app.eventIntegration?.init();

  // Return cleanup to detach all listeners and handlers
  return function detach() {
    cleanups.forEach((off) => { try { typeof off === 'function' && off(); } catch (_) {} });
    cleanups.length = 0;
    try { window.removeEventListener('resize', onResize); } catch (_) {}
    try { app.eventIntegration?.destroy(); } catch (_) {}
  };
}

export default { attachEventWiring };
