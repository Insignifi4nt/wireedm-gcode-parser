# TODO - Wire EDM G-Code Viewer

## Notes
- Review this file weekly to update priorities and status
- Add time estimates to help with sprint planning
- Completed Tasks, should be moved under Completed tasks section. Respecting the summarization convention. Brief and concice, like the others.
- Completed Tasks section begins near line 69. Items are listed newest-to-oldest (top to bottom): latest completions are at the top, oldest at the bottom. Read the header/notes first; avoid scanning the entire file unless needed.

## Format Guidelines
- **Priority**: 🔴 Critical | 🟡 High | 🟢 Medium | 🔵 Low
- **Category**: [FEATURE] | [BUG] | [REFACTOR] | [DOCS] | [PERF]
- **Status**: ⏳ Todo | 🔄 In Progress | ✅ Done | ❌ Cancelled
- **Assignee**: @username (if applicable)
- **Estimate**: S/M/L/XL (Small/Medium/Large/Extra Large)

## Active Tasks

### 🔴 Critical Priority

[FEATURE] G-Code Drawer Folder Organization ⏳
- Priority: 🔴 Critical
- Category: [FEATURE]
- Estimate: L
- Files: `src/components/GCodeDrawer.js`, `src/components/drawer/GCodeEditor.js`, `src/styles/components.css`
- Description: Implement collapsible folder structure in G-code drawer for better organization:
  - **Header Folder**: Contains all configuration/setup commands (G90, M codes, etc.) at the top
  - **Body Folders**: Split into separate folders for each closed contour/toolpath for improved UX
  - **Footer Folder**: Contains program end commands (M30, etc.)
- Acceptance: Collapsible folders with clear visual hierarchy; header separated from toolpath; each contour organized independently

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
- [BUG] Set Start Here G2/G3 Arc Handling & Header/Body Separation — Fixed critical issues with arc coordinate preservation and G-code structure organization
  - Resolution: Implemented comprehensive arc coordinate transformation system; added header/footer identification functions; fixed I,J parameter preservation during rotation
  - Files: `src/utils/GCodeRewriter.js`, `src/components/GCodeDrawer.js`
  - Commit (356d2e9)
- [UI] Button visual feedback improvements — Enhanced hover/pressed/focus states with theme tokens; removed translateY animation 
  - Commit (6a1a553)
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
