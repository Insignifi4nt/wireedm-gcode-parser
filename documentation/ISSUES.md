# Wire EDM Viewer - Issues Tracking

This document tracks all known issues, bugs, and improvement requests for the Wire EDM G-Code Viewer application.

## Current Status (Latest Update: 2025-01-17)

### **Recent Fixes Completed:**
- ✅ **Sidebar Visual Design**: Content now properly centered with improved layout and visual hierarchy
- ✅ **Delete Point Buttons**: Individual X buttons in sidebar now functional 
- ✅ **Coordinate Accuracy**: Point placement accurate after G-Code upload
- ✅ **Canvas Dimensions**: Buffer mismatch errors resolved
- ✅ **Event Validation**: Mouse event validation working correctly

### **Next Priority Items:**
1. **Text Rendering System**: Complete rebuild of grid labels and point markers
2. **Mouse Wheel Zoom Polish**: Refinements to zoom behavior

### **Application Status**: Core functionality stable, UI polished, ready for advanced features

## Testing Checklist

When testing fixes, verify the following functionality:
*Testing done by human coordinator with notes added per verification.*

### Coordinate Accuracy Testing
- [X] Click to add points at 10% zoom level
- [X] Click to add points at 100% zoom level  
- [X] Click to add points at 1000% zoom level
- [X] Verify points appear exactly under crosshair cursor at all zoom levels
- [X] Test coordinate accuracy debug output in console - *Fb*: Console log below

<consoleLog>MouseEventHandler.js:178 Click handler - mouse data: {screenX: 764.8885406189121, screenY: 561.2166913525341, worldX: 78.889, worldY: 39.783, button: 0, …}altKey: falsebutton: 0ctrlKey: falseoriginalEvent: PointerEvent {isTrusted: true, pointerId: 1, width: 1, height: 1, pressure: 0, …}screenX: 764.8885406189121screenY: 561.2166913525341shiftKey: falsetarget: "canvas"worldX: 78.889worldY: 39.783[[Prototype]]: Object
MouseEventHandler.js:179 Coordinate conversion accuracy: {originalScreen: {…}, worldCoords: {…}, backToScreen: {…}, coordinateError: {…}, accuracy: 'GOOD', …}accuracy: "GOOD"backToScreen: {x: 765, y: 541.2}coordinateError: {x: 0, y: 0.000003051757857974735}coordinateSystemInfo: {usingDisplayHeight: 1200, canvasClientHeight: 1156, canvasHeight: 1200, heightConsistency: false, transformParameters: {…}}coordinateSystemValidation: {isValid: false, issues: Array(2), warnings: Array(1), dimensions: {…}}dimensionConsistency: falsedimensions: {displayWidth: 1373.2000732421875, displayHeight: 1200, canvasWidth: 1373, canvasHeight: 1200, clientWidth: 1372, …}mouseCoordinateScaling: {scaleX: 0.9998543014626302, scaleY: 1.0369857622268357, isScaled: true}originalScreen: {x: 765, y: 541.1999969482422}validation: {heightSync: true, widthSync: false, canvasToDisplaySync: 'MISMATCHED', canvasToCssSync: 'SCALED'}worldCoords: {x: 79, y: 59.8}[[Prototype]]: Object
MouseEventHandler.js:188 Emitting MOUSE_CLICK event with valid coordinates
main.js:286 MOUSE_CLICK event received: {screenX: 764.8885406189121, screenY: 561.2166913525341, worldX: 78.889, worldY: 39.783, button: 0, …}altKey: falsebutton: 0ctrlKey: falseoriginalEvent: PointerEvent {isTrusted: true, pointerId: 1, width: 1, height: 1, pressure: 0, …}screenX: 764.8885406189121screenY: 561.2166913525341shiftKey: falsetarget: "canvas"worldX: 78.889worldY: 39.783[[Prototype]]: Object
main.js:288 Adding measurement point at: 78.889 39.783
main.js:501 addMeasurementPoint called with: 78.889 39.783
main.js:505 Emitting POINT_ADD event: {id: 1752754427338, x: 78.889, y: 39.783}id: 1752754427338x: 78.889y: 39.783[[Prototype]]: Objectconstructor: ƒ Object()hasOwnProperty: ƒ hasOwnProperty()isPrototypeOf: ƒ isPrototypeOf()length: 1name: "isPrototypeOf"arguments: (...)caller: (...)[[Prototype]]: ƒ ()[[Scopes]]: Scopes[0]propertyIsEnumerable: ƒ propertyIsEnumerable()toLocaleString: ƒ toLocaleString()toString: ƒ toString()valueOf: ƒ valueOf()__defineGetter__: ƒ __defineGetter__()__defineSetter__: ƒ __defineSetter__()__lookupGetter__: ƒ __lookupGetter__()__lookupSetter__: ƒ __lookupSetter__()__proto__: (...)get __proto__: ƒ __proto__()set __proto__: ƒ __proto__()
main.js:316 POINT_ADD event received: {id: 1752754427338, x: 78.889, y: 39.783}id: 1752754427338x: 78.889y: 39.783[[Prototype]]: Object
main.js:324 Added point, total points: 1 </consoleLog>

### Text Rendering Testing
- [X] Verify grid labels are not mirrored - *Fb*: Not mirrored(they look right), but also not displaying correctly on the axis(x/y). I would like them completely removed and reimplemented from scratch.
- [X] Verify point marker labels (START, END, P1, P2, etc.) are readable - *Fb*: I dont see the start point at all, neither its label, but i belive it should be the same as end, so its not an issue. Maybe they are overlapping or something. Anyway, being the same point they wouldnt be able to show at the same time without any visual overlapping, so only one of them its fine for now.
None of the label are visible anymore.
- [X] Test text rendering at different zoom levels

### UI Button Functionality Testing
- [X] Add some measurement points by clicking
- [X] Verify Clear Points button becomes enabled
- [X] Click Clear Points button and verify all points are removed
- [X] Add points again and verify Export Points button becomes enabled
- [X] Click Export Points and verify CSV file downloads
- [X] Add points and verify individual X delete buttons work in sidebar

### Keyboard Shortcuts Testing
- [X] Press G key and verify grid toggles on/off
- [X] Verify status message shows grid state change
- [X] Test other keyboard shortcuts (zoom in/out, etc.) - *Fb*: +/- ; Shift+Click work. 

### Mouse Wheel Testing
- [X] Test mouse wheel scroll up - should zoom in
- [X] Test mouse wheel scroll down - should zoom out
- [N] Verify zoom direction feels intuitive
- [N] Test zoom at point (cursor position) - *Fb*: It zoom in the current center of the screen as i wanted.

*Fb - Feedback*
*X - Feature tested and works as described*
*N - Feature tested and does not work as described*

## Known Issues (Acknowledged but Low Priority)

### Visual/UI Improvements

1. **Button States**: Some buttons could have better visual feedback
   - Status: Functional but could be improved
   - Priority: Low

## Development Notes

### Event System Architecture
The application uses a centralized EventBus system with the following key events:
- `POINT_UPDATE`: Notifies all components when point count/data changes
- `GRID_VISIBILITY_TOGGLE`: Toggles grid display on/off
- `GRID_SNAP_TOGGLE`: Toggles grid snapping functionality
- `EXPORT_START`: Initiates point export process

### Coordinate System
- Canvas uses Y-axis flip transformation for CNC coordinates
- Text rendering uses separate transformation to prevent mirroring
- Coordinate conversions are centralized in MathUtils.js
- All coordinate conversions should use Viewport instance methods for consistency

### File Structure
- `src/main.js`: Application orchestration and workflow management
- `src/components/Canvas.js`: Canvas rendering and drawing logic
- `src/components/Toolbar.js`: Toolbar UI and button functionality
- `src/components/Sidebar.js`: Sidebar UI and point management display
- `src/core/`: Core functionality (EventManager, Viewport, etc.)
- `src/utils/`: Utility functions (MathUtils, Constants, etc.)

## Reporting New Issues

When reporting new issues, please include:
1. **Steps to reproduce** the issue
2. **Expected behavior** vs **actual behavior**
3. **Browser and OS** information
4. **Console errors** (if any)
5. **Screenshots** (if visual issue)
6. **Zoom level and file** being used (if relevant)

## Active Issues Status

### **Coordinate Accuracy After G-Code Upload** - ✅ RESOLVED (2025-01-17)
- **Previous Status**: Points appeared below cursor with consistent ~4mm offset after G-Code upload
- **Empty Canvas**: Points appear correctly under cursor ✅
- **After G-Code Upload**: Points now appear correctly under cursor ✅
- **Fix**: Standardized canvas transformation and coordinate conversion to use same height reference
- **Files Modified**: `src/components/Canvas.js`, `src/main.js`


### **Text Rendering System**
- **Current Status**: Grid labels need complete rebuild
- **User Feedback**: "Labels not displaying correctly on axis, remove and reimplement from scratch"
- **Next Steps**: Design new text rendering system

## Priority Fix Order (Bottom-up Critical Path)

1. ✅ **Canvas Dimension Consistency** - FIXED (2025-01-17) - Canvas buffer mismatch resolved
2. ⚠️ **Event Validation System** - PARTIALLY FIXED (2025-01-17) - Mouse event validation resolved, remaining bounds validation on hold
3. ✅ **Coordinate Accuracy Post G-Code Upload** - FIXED (2025-01-17) - Point placement offset after loading G-Code resolved
4. ✅ **Individual Delete Buttons** - FIXED (2025-01-17) - X delete buttons in sidebar now working correctly
5. ✅ **Sidebar Content Centering** - FIXED (2025-01-17) - Sidebar content now properly centered with improved visual design
6. **Text Rendering System** - Complete rebuild of grid labels and point markers
7. **Mouse Wheel Zoom Polish** - Refinements to zoom behavior



## Console Log Analysis (For Reference)

**Canvas Dimension Errors (FIXED 2025-01-17)**:
- Console errors like `Canvas buffer mismatch: canvas=1373x1200, logical=1373.2000732421875x1200` have been resolved
- Fixed by rounding fractional pixel dimensions to integers

**Event Validation Errors (PARTIALLY FIXED 2025-01-17)**:
- Console errors like `EventManager: Invalid event data for mouse:enter:canvas`, `key:down`, `key:up`, and `point:add` have been resolved
- Fixed by enhancing Event and KeyboardEvent validation to accept event-like objects
- Mouse and keyboard events now pass validation correctly
- Remaining issue: `bounds` field validation warnings (non-critical, on hold)