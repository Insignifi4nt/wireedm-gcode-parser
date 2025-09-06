# TODO - Wire EDM G-Code Viewer

## Format Guidelines
- **Priority**: 🔴 Critical | 🟡 High | 🟢 Medium | 🔵 Low
- **Category**: [FEATURE] | [BUG] | [REFACTOR] | [DOCS] | [PERF]
- **Status**: ⏳ Todo | 🔄 In Progress | ✅ Done | ❌ Cancelled
- **Assignee**: @username (if applicable)
- **Estimate**: S/M/L/XL (Small/Medium/Large/Extra Large)

## Active Tasks

### 🔴 Critical Priority

<!-- none currently -->

### 🟡 High Priority

- [REFACTOR] Remove Toolbar Global Access ⏳
  - Priority: 🟡 High
  - Estimate: S
  - Files: `src/components/Toolbar.js:214`
  - Description: Replace `window.wireEDMViewer` access for normalization text with an event-driven or injected dependency approach (e.g., pass drawer reference via constructor or use EventBus request/response).
  - Acceptance: No direct `window.wireEDMViewer` usage in Toolbar; normalization still works when drawer is open or when only file content is present.

- [FEATURE] Text Rendering System (grid/point labels) ✅
  - Priority: 🟡 High
  - Estimate: L
  - Files: `src/components/canvas/CanvasGrid.js`, `src/components/canvas/MarkerRenderer.js`, `src/utils/geometry/CoordinateTransforms.js`
  - Description: Fixed coordinate system mismatch between text transforms and coordinate calculations.
  - Resolution: Implemented dual coordinate system helpers and adopted Strategy A for rendering.
  - Strategy: A — screen-space text (identity transform + `viewport.worldToScreen` with DPR scaling)
  - Acceptance: ✅ All criteria met
    - Grid axis labels render perfectly aligned to axes at all zoom levels.
    - Point marker labels (START/END/Pn) position correctly and remain readable.
    - Clean separation between world coordinates (Y-flip) and text coordinates (no Y-flip).

### 🟢 Medium Priority

- [POLISH] Mouse Wheel Zoom behavior ⏳
  - Priority: 🟢 Medium
   - Estimate: M
  - Files: `src/core/MouseEventHandler.js`, `src/core/Viewport.js`
  - Description: Zoom is centered on screen as intended; refine acceleration, min/max clamp feel, and smoothing. Consider animated zoom or easing.
  - Acceptance: Smooth, predictable zoom steps; clamped ranges feel natural; no jitter.

### 🔵 Low Priority

- [UI] Button visual feedback improvements ⏳
  - Priority: 🔵 Low
  - Estimate: S
  - Files: `src/styles/*.css`
  - Description: Improve hover/active/disabled states for better affordance (not a bug).

## Refactoring & Technical Debt

### [REFACTOR] Remove Global App Access Pattern ✅
**Priority**: 🟡 High  
**Category**: [REFACTOR]  
**Estimate**: M  
**File**: `src/components/GCodeDrawer.js`

**Resolution**:
- Implemented event-driven retrieval of clicked points in `GCodeDrawer`.
- Added/used event types: `point:get:clicked` → `point:clicked:response`.
- Wired response in `src/core/EventWiring.js` to return a copy of `app.clickedPoints`.

**Notes**:
- Legacy global `window.wireEDMViewer` remains for backward compatibility, but `GCodeDrawer` no longer relies on it.
- Follow-up tracked above: remove Toolbar’s remaining global usage for normalization text.

---

## Completed Tasks

### ✅ Done
- Arc rendering fixes and G2/G3 coordinate normalization; Debug overlay system for arc geometry visualization; Parser improvements for IJ-absolute/relative modes
 - [BUG] Duplicate point delete emission — Fixed
   - Resolution: Removed Sidebar direct `.delete-point-btn` listeners and rely on global `EventDelegator` capture for a single `POINT_DELETE` emission.
   - Verified: Single click emits one `POINT_DELETE` and triggers one `POINT_UPDATE` cascade.
   - Files: `src/components/Sidebar.js`, `src/core/EventDelegator.js`, `src/core/EventWiring.js`
 - [REFACTOR] Remove Global App Access Pattern — Completed
   - Resolution: `GCodeDrawer` now requests clicked points via events; `EventWiring` responds with `POINT_CLICKED_RESPONSE`.
   - Files: `src/components/GCodeDrawer.js`, `src/core/events/EventTypes.js`, `src/core/EventWiring.js`


---

## Cancelled Tasks

### ❌ Cancelled
(None currently)

---

## Notes
- Review this file weekly to update priorities and status
- Link related GitHub issues using #issue-number format
- Add time estimates to help with sprint planning
