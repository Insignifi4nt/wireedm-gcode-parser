# TODO - Wire EDM G-Code Viewer

## Notes
- Review this file weekly to update priorities and status
- Add time estimates to help with sprint planning
- Completed Tasks section begins near line 69. Items are listed newest-to-oldest (top to bottom): latest completions are at the top, oldest at the bottom. Read the header/notes first; avoid scanning the entire file unless needed.

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

<!-- none currently -->

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
## Cancelled Tasks

### ❌ Cancelled
(None currently)

---

## Completed Tasks
*Tasks should always be placed at the top of the list (as the list grows, enables us to find the latest, without scrolling or reading the whole file)*
### ✅ Done
- [REFACTOR] Remove Toolbar Global Access — Completed
  - Resolution: Inject `gcodeDrawer` into `Toolbar` (no `window.wireEDMViewer`); normalization reads drawer text, falls back to loaded file.
  - Files: `src/components/Toolbar.js`, `src/core/ComponentInitializer.js`
- Arc rendering fixes and G2/G3 coordinate normalization; Debug overlay system for arc geometry visualization; Parser improvements for IJ-absolute/relative modes
- [BUG] Duplicate point delete emission — Fixed
  - Resolution: Removed Sidebar direct `.delete-point-btn` listeners and rely on global `EventDelegator` capture for a single `POINT_DELETE` emission.
  - Verified: Single click emits one `POINT_DELETE` and triggers one `POINT_UPDATE` cascade.
  - Files: `src/components/Sidebar.js`, `src/core/EventDelegator.js`, `src/core/EventWiring.js`
- [REFACTOR] Remove Global App Access Pattern — Completed
  - Resolution: `GCodeDrawer` now requests clicked points via events; `EventWiring` responds with `POINT_CLICKED_RESPONSE`.
  - Files: `src/components/GCodeDrawer.js`, `src/core/events/EventTypes.js`, `src/core/EventWiring.js`
- [BUG] Text Rendering System — Fixed coordinate mismatch for grid labels and point markers
  - Resolution: Adopted Strategy A (screen-space text with `viewport.worldToScreen`); grid/marker labels now align perfectly at all zoom levels.
  - Files: `src/components/canvas/CanvasGrid.js`, `src/components/canvas/MarkerRenderer.js`, `src/utils/geometry/CoordinateTransforms.js`
- [FEATURE] Dynamic Grid System — Implemented zoom-responsive grid density with adaptive spacing and infinite coordinate axes
  - Resolution: Added logarithmic grid spacing algorithms, pixel-density visibility thresholds, and viewport-bounded infinite axes. Label precision adapts to spacing (coarser → fewer decimals).
  - Files: `src/utils/Constants.js`, `src/utils/geometry/CoordinateTransforms.js`, `src/components/canvas/CanvasGrid.js`

---
