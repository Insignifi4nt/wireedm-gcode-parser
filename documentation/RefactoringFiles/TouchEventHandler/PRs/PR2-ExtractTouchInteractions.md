# TouchEventHandler PR2: Extract TouchInteractions

## Overview
Extract viewport interaction logic from TouchEventHandler into a focused TouchInteractions module for handling gesture responses.

## Scope
Move gesture response logic, viewport manipulation, and event emission from TouchEventHandler.js to TouchInteractions.js while maintaining behavioral parity.

## Code to Extract (from TouchEventHandler.js)

### Viewport Interaction Methods
- Pan handling logic from `_handleSingleTouchMove()` (lines ~255-266)
- Zoom handling logic from `_handlePinchMove()` (lines ~291-303) 
- Tap event emission from `_handleTap()` (lines ~364-377)
- Long press handling from `_handleLongPress()` (lines ~383-390)

### Event Creation and Emission
- `_createTouchEventData()` method (lines ~450-466)
- EventBus integration for emitting events
- Event type mapping and data structure creation

### Key Interaction Behaviors
```javascript
// Pan viewport interaction
this.viewport.pan(panDeltaX, panDeltaY);
this.eventBus.emit(EVENT_TYPES.VIEWPORT_PAN_CHANGE, {...});

// Zoom viewport interaction  
this.viewport.zoomAtPoint(canvasX, canvasY, zoomDelta);
this.eventBus.emit(EVENT_TYPES.VIEWPORT_ZOOM_CHANGE, {...});

// Tap event emission
this.eventBus.emit(EVENT_TYPES.MOUSE_CLICK, touchData);

// Double tap fit-to-screen
this.eventBus.emit(EVENT_TYPES.VIEWPORT_FIT_TO_SCREEN, {...});
```

## Implementation Strategy

### TouchInteractions Class Interface
```javascript
export class TouchInteractions {
  constructor(viewport, eventBus, canvas)
  
  // Gesture response handlers
  handleTap(touchData, tapCount)
  handleLongPress(touchData)  
  handlePan(gestureInfo)
  handleZoom(gestureInfo, canvas)
  
  // Event creation utilities
  createTouchEventData(touch, viewport)
  
  // State management
  getState()
}
```

### Method Refactoring

**Extract to `handlePan()`:**
- Viewport pan operations 
- PAN_CHANGE event emission
- Pan delta calculations and state updates

**Extract to `handleZoom()`:**
- Viewport zoom operations at specific point
- ZOOM_CHANGE event emission  
- Canvas coordinate conversion for zoom center

**Extract to `handleTap()`:**
- Single tap → MOUSE_CLICK event
- Double tap → VIEWPORT_FIT_TO_SCREEN event
- Tap count differentiation

**Extract to `handleLongPress()`:**
- Long press → MOUSE_CLICK with right button equivalent
- Special gesture marking

**Extract to `createTouchEventData()`:**
- Touch-to-mouse event compatibility layer
- EventUtils integration for proper event data format
- Viewport coordinate integration

## TouchEventHandler Integration

Update TouchEventHandler to use TouchInteractions:

```javascript
// In constructor
this.touchInteractions = new TouchInteractions(
  this.viewport, 
  this.eventBus, 
  this.canvas
);

// In gesture handling
if (gestureInfo.type === 'pan') {
  this.touchInteractions.handlePan(gestureInfo);
} else if (gestureInfo.type === 'zoom') {
  this.touchInteractions.handleZoom(gestureInfo, this.canvas);
} else if (gestureInfo.type === 'tap') {
  const touchData = this.touchInteractions.createTouchEventData(
    gestureInfo.touch, 
    this.viewport
  );
  this.touchInteractions.handleTap(touchData, gestureInfo.tapCount);
}
```

## Behavioral Preservation

### Critical Requirements
- **Viewport manipulation** - Pan and zoom operations produce identical results
- **Event emission format** - Exact same event types and data structures 
- **Coordinate conversion** - Touch-to-canvas coordinate mapping unchanged
- **Event timing** - Event emission timing and sequence preserved
- **Integration compatibility** - EventBus and Viewport integration maintained

### Event Format Preservation
Must maintain exact format for:
- `EVENT_TYPES.VIEWPORT_PAN_CHANGE` with gesture, canvas dimensions, viewport state
- `EVENT_TYPES.VIEWPORT_ZOOM_CHANGE` with gesture, canvas dimensions, viewport state  
- `EVENT_TYPES.MOUSE_CLICK` with touch data converted to mouse format
- `EVENT_TYPES.VIEWPORT_FIT_TO_SCREEN` with double-tap gesture info

### Validation Steps
1. **Pan operations** - Verify viewport.pan() called with correct deltas
2. **Zoom operations** - Verify viewport.zoomAtPoint() called with correct coordinates
3. **Event format** - Verify event data structures match original format
4. **Touch conversion** - Verify touch-to-mouse compatibility layer works
5. **Canvas integration** - Verify coordinate conversion for zoom center points

## Dependencies Required

### Imports Needed
```javascript
import { EVENT_TYPES, EventUtils } from '../EventManager.js';
import { CANVAS } from '../../utils/Constants.js';
```

### Constructor Dependencies
- `viewport` - Viewport instance for pan/zoom operations
- `eventBus` - EventBus instance for event emission  
- `canvas` - Canvas element for coordinate conversion (optional, can be passed to methods)

## Files Modified
- ✅ `src/core/input/TouchInteractions.js` - Implement full functionality
- ✅ `src/core/TouchEventHandler.js` - Remove extracted logic, add integration
- ✅ Build verification - `npm run build` passes

## Success Criteria
- [ ] All viewport interaction logic moved to TouchInteractions
- [ ] Event emission format and timing identical
- [ ] Touch-to-mouse conversion works correctly
- [ ] Pan/zoom operations produce same viewport changes
- [ ] Build passes without errors
- [ ] No behavioral regressions in touch interactions

## Next Steps
- PR3: Update TouchEventHandler to orchestrate both modules
- PR4: Cleanup and optimization of the complete refactor