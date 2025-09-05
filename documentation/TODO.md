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

- [REFACTOR] Remove Global App Access Pattern ⏳
  - Priority: 🟡 High
  - Estimate: M
  - File: `src/components/GCodeDrawer.js:149-153`
  - Description: Replace `window.wireEDMViewer` access with event-driven data flow.
  - Proposed: Add `app:get:clicked-points` request → `app:clicked-points:response`.

- [FEATURE] Text Rendering System (grid/point labels) ⏳
  - Priority: 🟡 High
  - Estimate: L
  - Files: `src/components/canvas/CanvasGrid.js`, `src/components/canvas/MarkerRenderer.js`, `src/components/Canvas.js`
  - Description: Current grid label placement mixes a text-safe transform (no Y flip) with `worldToScreen` values that assume Y-flip, leading to misaligned labels. Rebuild label system to consistently place text along axes and markers with proper transforms.
  - Acceptance:
    - Grid axis labels render aligned to axes at expected intervals across zoom levels.
    - Point marker labels (START/END/Pn) readable and not mirrored; placement rules defined for overlaps.
    - No reliance on mismatched transform/coordinate spaces.

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

### [REFACTOR] Remove Global App Access Pattern ⏳
**Priority**: 🟡 High  
**Category**: [REFACTOR]  
**Estimate**: M  
**File**: `src/components/GCodeDrawer.js:149-153`

**Current Issue**:
```javascript
_getClickedPointsFromApp() {
  // Peek global app instance for now; future: pass via event
  const app = window.wireEDMViewer;
  return app?.clickedPoints || [];
}
```

**Why This Needs Refactoring**:
- Breaks component isolation by directly accessing global state
- Creates tight coupling between GCodeDrawer and main app instance
- Makes component harder to test and reuse
- Violates the event-driven architecture pattern used elsewhere
- Could cause runtime errors if `window.wireEDMViewer` is undefined

**Proposed Solution**:
1. Create new event type `app:get:clicked-points` 
2. Replace global access with event-based communication
3. Main app responds with `app:clicked-points:response` event
4. Update GCodeDrawer to use async event pattern for data retrieval

**Impact**: Improves component isolation, testability, and architectural consistency

---

## Completed Tasks

### ✅ Done
- Arc rendering fixes and G2/G3 coordinate normalization; Debug overlay system for arc geometry visualization; Parser improvements for IJ-absolute/relative modes
 - [BUG] Duplicate point delete emission — Fixed
   - Resolution: Removed Sidebar direct `.delete-point-btn` listeners and rely on global `EventDelegator` capture for a single `POINT_DELETE` emission.
   - Verified: Single click emits one `POINT_DELETE` and triggers one `POINT_UPDATE` cascade.
   - Files: `src/components/Sidebar.js`, `src/core/EventDelegator.js`, `src/core/EventWiring.js`


---

## Cancelled Tasks

### ❌ Cancelled
(None currently)

---

## Notes
- Review this file weekly to update priorities and status
- Link related GitHub issues using #issue-number format
- Add time estimates to help with sprint planning
