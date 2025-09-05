## Bugs to Address

### 1) StatusMessage instantiated with wrong signature
- Files: `src/main.js`, `src/components/StatusMessage.js`
- Issue: Constructor expects a single options object (with `container`), but code calls `new StatusMessage(statusContainer, { ... })`. The second arg is ignored; `container` defaults to `document.body`; options lost.
- Fix: Use `new StatusMessage({ container: statusContainer, position: 'top-right', maxMessages: 3, defaultDuration: 3000 })`.

### 2) Missing Viewport.setGridSnap; grid snap event payload inconsistent
- Files: `src/main.js`, `src/core/Viewport.js`, `src/components/Sidebar.js`
- Issue: `main.js` calls `this.canvas.viewport.setGridSnap(...)` but `Viewport` has no such method. Sidebar expects `GRID_SNAP_TOGGLE` payload `{ enabled }`, but `main.js` emits none.
- Fix: Implement `Viewport.setGridSnap(enabled, gridSize)` (or move snapping to `Canvas`); emit `GRID_SNAP_TOGGLE` with `{ enabled }`; adjust Sidebar accordingly.

### 3) Event name mismatches across modules
- Files: `src/core/EventDelegator.js`, `src/utils/FileHandler.js`, `src/components/Toolbar.js`, `src/core/EventManager.js`, `src/main.js`
- Issues:
  - Delegator emits `STATUS_MESSAGE` (undefined). Expected `STATUS_SHOW`.
  - FileHandler emits `POINTS_EXPORT_SUCCESS`/`POINTS_EXPORT_ERROR` and `FILE_CLEARED` (all undefined in `EVENT_TYPES`).
  - Toolbar unsubscribes from `POINTS_EXPORT_RESPONSE` (undefined) while subscribing to `EXPORT_SUCCESS`.
  - Toolbar expects export success payload to include `points`, but `main.js` emits `EXPORT_SUCCESS` with only `{ pointCount, format }`.
- Fix: Normalize to `EXPORT_SUCCESS`/`EXPORT_ERROR` and `STATUS_SHOW`; add missing constants or change emit/listen sites; align payloads.

### 4) Toolbar methods referenced but not implemented
- File: `src/components/Toolbar.js`
- Issues: `_updateButtons()` and `_updateFileInputDisplay()` are called but not defined. Only `_updateFileInputLabel()` exists.
- Fix: Implement both methods (or replace calls with existing `_updateFileInputLabel` and a new `_updateButtonStates`).

### 5) Sidebar file info and options mismatch; point label indexing
- File: `src/components/Sidebar.js`, `src/main.js`
- Issues:
  - `handleFileLoad` reads `fileName`/`fileSize`, but event provides `{ file }`.
  - Constructor option uses `showPoints`; `main.js` supplies `showPointList`.
  - Points are displayed as `P${point.index}` where `index` starts at 0 in `main.js` → first point shows `P0`.
- Fix: Use `eventData.file.name`/`file.size`; align option name; display `P${point.index + 1}` or have `main.js` set 1-based indices.

### 6) StatusMessage position constants misused for left/bottom
- Files: `src/components/StatusMessage.js`, `src/utils/Constants.js`
- Issue: For `top-left`/`bottom-left`, code sets `styles.left = STATUS.POSITION.RIGHT`; for bottom, uses `STATUS.POSITION.TOP`. Constants lack `LEFT`/`BOTTOM`.
- Fix: Add `LEFT` and `BOTTOM` to `STATUS.POSITION`; use them in `applyContainerStyles`.

### 7) Viewport.fitToBounds overrides display dimensions causing coordinate mismatch
- File: `src/core/Viewport.js`
- Issue: `fitToBounds` calls `_updateDisplayDimensions()`, potentially diverging from dimensions set by `Canvas` (`logicalHeight` vs `displayHeight`), reintroducing the known offset bug.
- Fix: Do not call `_updateDisplayDimensions()` in `fitToBounds`; use current `displayWidth`/`displayHeight` already synchronized by `Canvas`.

### 8) Export workflow conflict (Toolbar vs Main vs FileHandler)
- Files: `src/components/Toolbar.js`, `src/main.js`, `src/utils/FileHandler.js`
- Issues: Toolbar emits `EXPORT_START` intending G-code export via `FileHandler`, but `main.js` intercepts and exports CSV; Toolbar listens for `EXPORT_SUCCESS` with `points` which are not provided.
- Fix: Decide single export owner. Option A: let `main.js` own export and include `points` (and format) in success payload. Option B: route export to `FileHandler` and remove `_exportPointsAsCSV` from `main.js`.

### 9) EventDelegator selector mismatch for delete buttons
- Files: `src/core/EventDelegator.js`, `src/components/Sidebar.js`
- Issue: Delegator uses `.delete-point`, Sidebar renders `.delete-point-btn`.
- Fix: Align selectors (prefer `.delete-point-btn`).

### 10) Zoom/viewport events not re-emitted after applying changes in main
- File: `src/main.js`
- Issue: On handling `VIEWPORT_ZOOM_CHANGE` with `{ type: 'in'|'out' }`, `main.js` updates viewport but does not emit a follow-up event with updated `{ zoom, offsetX, offsetY }`. Toolbar’s zoom display may not update.
- Fix: After zoom/pan/reset/fit, emit corresponding event with current viewport state.

### 11) FileHandler creates its own StatusMessage, duplicating UI
- File: `src/utils/FileHandler.js`
- Issue: Default constructs a `StatusMessage` (separate container) instead of using the app’s instance.
- Fix: Inject the app’s `StatusMessage` instance into `FileHandler` (and avoid creating a second one by default in app context).

### 12) Delegated drop warnings emit wrong event
- File: `src/core/EventDelegator.js`
- Issue: Emits `STATUS_MESSAGE` for warnings (no files / multiple files). Not defined.
- Fix: Use `STATUS_SHOW` with `{ message, type: 'warning' }`.

### 13) Sidebar grid snap display never updates
- Files: `src/components/Sidebar.js`, `src/main.js`
- Issue: Sidebar expects `{ enabled }` on `GRID_SNAP_TOGGLE`, but main emits without payload.
- Fix: Emit `GRID_SNAP_TOGGLE` with `{ enabled }` and call Sidebar update.

### 14) Minor: `wire-edm-gcode-viewer.html` legacy page diverges from module app
- File: `wire-edm-gcode-viewer.html`
- Issue: Standalone demo uses different logic/styles and can confuse testing.
- Fix: Mark as legacy/demo or remove from prod build inputs.

### 15) Event validation noise for command-style events
- Files: `src/core/EventManager.js`, `src/components/Toolbar.js`
- Issue: Emitting `VIEWPORT_ZOOM_CHANGE` with `{ type: 'in'|'out' }` doesn’t match schema, triggering validation warnings.
- Fix: Either extend schema to allow command-style payloads or emit a separate command event, and re-emit stateful `VIEWPORT_*` events after applying.

### 16) Canvas grid calculation uses buffer size instead of display size
- File: `src/components/Canvas.js`
- Issue: `_renderGrid` passes `this.canvas.width/height` into `GridUtils.calculateGridLines`. In high-DPI mode these are physical pixels, while viewport/display logic uses logical pixels, causing inconsistent grid density/coverage.
- Fix: Use `this.displayWidth`/`this.displayHeight` for grid calculation to match viewport/display coordinates.

### 17) Sidebar event listeners not actually removed on destroy
- File: `src/components/Sidebar.js`
- Issue: Listeners are attached using `this.handleX.bind(this)` but removed with unbound method references in `destroy()`, so they aren’t deregistered.
- Fix: Store the unsubscribe functions returned by `eventBus.on(...)` and call them in `destroy()`, or pre-bind and reuse the same bound function references for both on/off.


