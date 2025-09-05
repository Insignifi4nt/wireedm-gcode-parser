# TODO - Wire EDM G-Code Viewer

## Format Guidelines
- **Priority**: 🔴 Critical | 🟡 High | 🟢 Medium | 🔵 Low
- **Category**: [FEATURE] | [BUG] | [REFACTOR] | [DOCS] | [PERF]
- **Status**: ⏳ Todo | 🔄 In Progress | ✅ Done | ❌ Cancelled
- **Assignee**: @username (if applicable)
- **Estimate**: S/M/L/XL (Small/Medium/Large/Extra Large)

## Active Tasks

### 🔴 Critical Priority

### 🟡 High Priority

### 🟢 Medium Priority

### 🔵 Low Priority

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
- Arc rendering fixes and G2/G3 coordinate normalization
- Debug overlay system for arc geometry visualization
- Parser improvements for IJ-absolute/relative modes

---

## Cancelled Tasks

### ❌ Cancelled
(None currently)

---

## Notes
- Review this file weekly to update priorities and status
- Link related GitHub issues using #issue-number format
- Add time estimates to help with sprint planning