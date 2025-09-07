# Ideas for UX:

## Overall Implementation Priority Recommendation:

### **Phase 1: UX Improvements** (Immediate - High Value)
- Completed: Idea #4 — Edit/Select mode toggle
- Next: Ideas #1 & #2 — Segment selection + Path snapping  
  - Timeline: ~1 week  
  - Value: Transformative  
  - Risk: Low

### **Phase 2: Technical Foundation** (Future - Medium Value)
- Idea #3 — Parser refactor  
  - Timeline: 1–2 weeks  
  - Value: Better maintainability

### **Synergy Opportunities:**
- Ideas #1 and #2 benefit from #4’s clear mode separation
- Common utilities: geometric hit detection; shared modal UI state management

**Total Estimated Remaining Time: 2–3 weeks**

## 1. Click G-Code Segments for Selection/Highlighting

**Description:**
Being able to click gcode segments inside the canvas, and highlight them in the gcode drawer as well as in the canvas (including hover). This would mean, to disable adding points as default behavior. More explicit: have as default the default mouse cursor with the behavior described under this idea. Have a "Add points" toggle/button, when that's "active" the cursor changes to the current cross cursor for adding points.

### ✅ **Recommendation: IMPLEMENT** 
**Priority: HIGH** | **Complexity: 7/10** | **Value: EXCELLENT**

### Architecture Analysis:
- **Current System**: `MOUSE_CLICK` → `addMeasurementPoint()` → adds measurement points everywhere
- **Required Changes**: Modal interaction system with segment hit detection

### Implementation Requirements:
1. **Path Segment Hit Detection**
   - Geometric calculations for point-to-line distance (linear moves G0/G1)
   - Point-to-arc distance calculations (arc moves G2/G3) 
   - Hit tolerance handling for reasonable click targets
   - **Existing Foundation**: `MeasurementUtils.calculateDistance()` already available

2. **Modal UI System**
   - Toggle button in `Toolbar` component (straightforward - existing toolbar architecture)
   - Mode state management: "Select Segments" vs "Add Points" 
   - Cursor management via `MouseEventHandler.setCursor()` (already exists)
   - **Implementation**: Modify `EventWiring.js:83` to check mode before calling `addMeasurementPoint()`

3. **Bidirectional Highlighting**
   - Canvas → Drawer: Already works via `canvas.togglePersistentHighlight()` → `drawer:line:click`
   - Drawer → Canvas: Already works via `drawer:line:hover` → `canvas.setHoverHighlight()`
   - **Perfect fit**: Existing highlight system just needs to be triggered by segment clicks

### References:
- src/core/EventWiring.js — MOUSE_CLICK routing by interaction mode
- src/components/canvas/PathHighlights.js — segment highlighting utilities
- src/components/GCodeDrawer.js — drawer:line:click and hover integration
- src/components/toolbar/ActionControls.js — add/select toggle wiring

### Integration Points:
- ✅ Event system: Perfect fit with existing `EventBus` architecture
- ✅ Canvas rendering: `PathHighlights.js` already handles segment highlighting
- ✅ Drawer synchronization: Line-to-path mapping already exists
- ✅ UI integration: `Toolbar` component easily extended

### Effort Estimate: **2-3 days**
1. Day 1: Implement geometric hit detection utilities
2. Day 2: Add modal UI system and modify event handling  
3. Day 3: Testing, refinement, and visual polish

---

## 2. Add Points Along Existing Segments with Path Snapping

**Description:**
Being able to add points along an existing segment. Have some toggle that snaps onto the "drawn" path, that allows adding points precisely on the path. I thought of this because for example if i have 2 points, G0 X0 Y0, and G1 X10 Y10, With the current system, i can only hover the point and it highlights it, but if i want to add a point precisely on that path, there is no way to do this spot on.

### ✅ **Recommendation: IMPLEMENT**
**Priority: HIGH** | **Complexity: 6/10** | **Value: VERY PRACTICAL**

### Architecture Analysis:
- **Current System**: Points can only be added at arbitrary click coordinates
- **Enhancement**: Project clicks onto nearest path segment for precision

### Implementation Requirements:
1. **Point-to-Path Projection**
   - Linear segments: Project point onto line segment (with clamping to endpoints)
   - Arc segments: Project point onto circular arc (with angle clamping)
   - **Existing Foundation**: `CoordinateTransform` utilities available for coordinate conversions

2. **Snap Tolerance & Visual Feedback**
   - Define maximum snap distance (e.g., 10-20 pixels in screen space)
   - Show visual snap indicator during mouse hover
   - Cursor change when snap is available
   - **Integration**: Works well with existing `MOUSE_MOVE` event handling

3. **Toggle System**
   - "Path Snap" toggle in toolbar (can combine with segment selection mode)
   - Enable/disable snapping behavior
   - **UI Integration**: Natural extension of existing toolbar

### References:
- src/utils/geometry/CoordinateTransforms.js — coordinate helpers
- src/utils/geometry/ArcCalculations.js — arc math helpers
- src/core/EventWiring.js — pointer move/click integration for snapping

### Mathematical Foundation:
- **Line Projection**: Standard point-to-line projection with parameter clamping
- **Arc Projection**: Convert to polar coordinates, clamp angle, convert back
- **Distance Calculations**: Already available via `MeasurementUtils.calculateDistance()`

### Effort Estimate: **2-3 days**
1. Day 1: Implement geometric projection utilities (point-to-line, point-to-arc)
2. Day 2: Add snap detection and visual feedback system
3. Day 3: UI integration and testing

### Synergy with Idea #1:
These features work perfectly together:
- Default mode: Select segments by clicking
- Hold modifier key: Enable point snapping mode
- Excellent workflow for inspection → precise measurement 

# Technical Improvements

## 3. Parser Refactor Track (separate from current UI refactor)

**Description:**
- Decision: Keep parser out of the ongoing UI/Event/Canvas refactor. Do a focused parser pass after the current branch stabilizes. (meanwhile refactor branch stabilized and completed its purpose. Has been merged into main)
- Rationale: Parser is a stable, single-module API. Refactoring it now risks subtle geometry regressions and churn in Drawer/Canvas mapping.

### ✅ **Recommendation: IMPLEMENT (Lower Priority)**
**Priority: MEDIUM** | **Complexity: 8/10** | **Value: ARCHITECTURAL IMPROVEMENT**

### Architecture Analysis:
- **Current State**: Single-file `GCodeParser.js` handles all parsing logic
- **Strengths**: Working parser with modal state handling (G92, I/J modes, error handling)
- **Technical Debt**: Monolithic structure, limited testing, no streaming for large files

### Implementation Plan Analysis:

#### **Goals Assessment:**
1. **✅ Cohesion**: Extract tokenization/line pre-processing; keep parse-to-path pure.
   - **Impact**: Better separation of concerns, easier testing
   - **Risk**: Low - well-defined interfaces

2. **✅ Modal clarity**: centralize handling for XY modes (G90/G91), units (G20/G21), IJ modes (G60, G90.1/G91.1).
   - **Current Foundation**: Already handles modal states but scattered logic
   - **Improvement**: Centralized modal state container

3. **✅ Deterministic outputs**: well-defined path item shapes and line↔path mapping.
   - **Critical**: Existing drawer sync depends on stable line mapping
   - **Validation Required**: Ensure no regressions in `GCodeDrawer` sync

4. **✅ Diagnostics**: structured warnings/errors (codes), graceful limits for large files.
   - **Current**: Basic error handling exists
   - **Enhancement**: Structured error codes, better user feedback

5. **⚠️ Performance**: optional streaming/chunked parsing for very large files.
   - **Analysis**: May not be necessary - current parser handles typical EDM files fine
   - **Recommendation**: Implement only if performance issues are demonstrated

### PR Strategy Evaluation:

#### **✅ PR1: Add Vitest + parser unit tests** - **ESSENTIAL**
- **Value**: HIGH - Currently no parser tests, regression risk is significant
- **Effort**: 2-3 days
- **Foundation**: Test fixtures for linear, arc, IJ absolute, G92 header cases
- **Outcome**: Confidence for safe refactoring

#### **✅ PR2: Extract tokenizer + modal state container** - **CORE REFACTOR**
- **Value**: MEDIUM-HIGH - Better architecture, easier maintenance
- **Effort**: 3-4 days 
- **Risk**: MEDIUM - Must preserve exact external API and outputs
- **Critical**: Extensive testing against existing fixtures

#### **⚠️ PR3: Gate optional features behind flags** - **QUESTIONABLE**
- **Value**: LOW - Adds complexity without clear benefit
- **Analysis**: Current parser already handles features gracefully
- **Recommendation**: Skip unless specific use cases demand it

#### **⚠️ PR4: Optimize for large files** - **PREMATURE**
- **Value**: LOW - No evidence of performance problems
- **Recommendation**: Defer until actual performance issues are identified

### Integration Risk Assessment:
- **Low Risk**: Parser has stable external API (`parse(gcodeText)` returns `{path, bounds, stats}`)
- **Medium Risk**: Line-to-path index mapping must remain identical for drawer sync
- **Mitigation**: Comprehensive test suite before any changes

### Recommended Implementation Order:
1. **Phase 1** (Essential): PR1 - Add comprehensive unit tests
2. **Phase 2** (Core): PR2 - Extract tokenizer and modal state
3. **Phase 3** (Optional): Skip PR3 and PR4 unless specific needs arise

### Effort Estimate: **1-2 weeks**
- Week 1: Comprehensive test suite development
- Week 2: Tokenizer extraction and modal state refactor
- **ROI**: Improved maintainability, safer future parser changes

### Non-goals Validation: ✅
- ✅ No UI/Drawer/Canvas changes required
- ✅ Only parser internals and tests 
- ✅ Preserve existing integration points

### Current Feature Compatibility: ✅
- ✅ G92 at header sets start point (maintains existing behavior)
- ✅ Mid-program G92 shows warning (maintains existing behavior)
- ✅ All existing modal state handling preserved

---

# Completed Ideas

## 4. Edit/Select Mode Toggle in G-Code Drawer
- Summary: Header toggle separates selecting lines and editing text; edit disables selection clicks, select disables editing.
- Notes: Mode persisted via localStorage; selection preserved across edit-triggered refresh; accessibility and cursor/user-select polish added.
- References: src/components/GCodeDrawer.js:36, 94, 112, 565 • src/components/drawer/GCodeEditor.js:11, 79, 267, 291 • src/components/drawer/DrawerToolbar.js:28, 77, 125 • src/styles/components.css:200, 208, 227, 383
