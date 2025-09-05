# TouchEventHandler PR3: Orchestrate TouchGestures and TouchInteractions

## Overview
Update TouchEventHandler.js to act as an orchestrator, coordinating between TouchGestures and TouchInteractions modules while maintaining the exact same public API.

## Scope
Transform TouchEventHandler from a monolithic class to an orchestrator that:
- Uses TouchGestures for gesture detection and state management
- Uses TouchInteractions for viewport manipulation and event emission
- Maintains all existing public methods and behavior
- Coordinates between the two modules seamlessly

## Integration Strategy

### Constructor Updates
```javascript
import { TouchGestures } from './input/TouchGestures.js';
import { TouchInteractions } from './input/TouchInteractions.js';

constructor(canvas, viewport) {
  // ... existing validation ...
  
  // Initialize gesture recognition
  this.touchGestures = new TouchGestures(this.config);
  
  // Initialize interaction handling
  this.touchInteractions = new TouchInteractions(viewport, this.eventBus);
  
  // Remove extracted properties (now in TouchGestures/TouchInteractions)
  // - this.touches (moved to TouchGestures)
  // - this.gestureState (moved to TouchGestures) 
  // - gesture detection logic (moved to TouchGestures)
  // - viewport interaction logic (moved to TouchInteractions)
}
```

### Event Handler Updates

**_handleTouchStart() Integration:**
```javascript
_handleTouchStart(event) {
  if (this.isDestroyed) return;
  event.preventDefault();
  
  const touches = Array.from(event.touches);
  
  // Use TouchGestures for gesture detection
  const gestureInfo = this.touchGestures.detectGestureStart(touches);
  
  // Handle long press setup (if needed)
  this._setupLongPressDetection(gestureInfo);
}
```

**_handleTouchMove() Integration:**
```javascript
_handleTouchMove(event) {
  if (this.isDestroyed) return;
  event.preventDefault();
  
  const touches = Array.from(event.touches);
  
  // Use TouchGestures for gesture detection
  const gestureInfo = this.touchGestures.detectGestureMove(touches);
  
  // Use TouchInteractions for gesture response
  if (!gestureInfo.throttled) {
    this.touchInteractions.processGesture(gestureInfo, this.canvas);
  }
}
```

**_handleTouchEnd() Integration:**
```javascript
_handleTouchEnd(event) {
  if (this.isDestroyed) return;
  event.preventDefault();
  
  const changedTouches = Array.from(event.changedTouches);
  const remainingTouches = Array.from(event.touches);
  
  // Use TouchGestures for gesture completion
  const gestureInfo = this.touchGestures.detectGestureEnd(changedTouches, remainingTouches);
  
  // Use TouchInteractions for final gesture processing
  if (gestureInfo.completed || gestureInfo.type === 'tap') {
    this.touchInteractions.processGesture(gestureInfo, this.canvas, changedTouches[0]);
  }
}
```

**_handleTouchCancel() Integration:**
```javascript
_handleTouchCancel(event) {
  if (this.isDestroyed) return;
  
  // Use TouchGestures for cleanup
  this.touchGestures.handleTouchCancel();
}
```

### Long Press Integration
Since TouchGestures handles timing but TouchInteractions handles the response:

```javascript
_setupLongPressDetection(gestureInfo) {
  if (gestureInfo.type === 'potential-tap') {
    // Set up long press timeout that coordinates between modules
    const longPressTimeout = setTimeout(() => {
      const currentGesture = this.touchGestures.getGestureState();
      if (currentGesture.type === 'potential-tap') {
        // Create touch data and handle long press
        const touch = this._getCurrentTouch();
        const touchData = this.touchInteractions.createTouchEventData(touch);
        this.touchInteractions.handleLongPress(touchData);
      }
    }, this.touchGestures.config.longPressTimeout);
    
    // Store timeout for cleanup
    this._currentLongPressTimeout = longPressTimeout;
  }
}
```

## Methods to Remove/Update

### Remove Extracted Methods
These methods are now in TouchGestures:
- ✅ `_handleSingleTouchStart()` 
- ✅ `_handlePinchStart()`
- ✅ `_handleSingleTouchMove()`
- ✅ `_handlePinchMove()` 
- ✅ `_calculateTouchDistance()`
- ✅ `_calculateTouchCenter()`
- ✅ `_resetGestureState()`

These methods are now in TouchInteractions:
- ✅ `_handleTap()`
- ✅ `_handleLongPress()` 
- ✅ `_createTouchEventData()`

### Update Existing Methods

**getState() Integration:**
```javascript
getState() {
  return {
    ...this.touchGestures.getTouchState(),
    ...this.touchInteractions.getState(),
    isInitialized: this.isInitialized,
    isDestroyed: this.isDestroyed
  };
}
```

**updateConfig() Integration:**
```javascript  
updateConfig(config) {
  this.config = { ...this.config, ...config };
  this.touchGestures.updateConfig(config);
}
```

**destroy() Integration:**
```javascript
destroy() {
  if (this.isDestroyed) return;

  // Clean up long press timeout
  if (this._currentLongPressTimeout) {
    clearTimeout(this._currentLongPressTimeout);
    this._currentLongPressTimeout = null;
  }

  // Use TouchGestures for cleanup
  this.touchGestures.handleTouchCancel();
  
  // ... existing cleanup ...
  
  this.isDestroyed = true;
}
```

## Behavioral Preservation Requirements

### Critical Compatibility
- **Public API unchanged** - All existing methods work identically
- **Event timing** - Event emission sequence and timing preserved  
- **Touch tracking** - Multi-touch handling behaves identically
- **Gesture detection** - Tap, pan, zoom detection accuracy maintained
- **Viewport integration** - Pan/zoom operations produce same results
- **Error handling** - Same error conditions and messages

### Integration Coordination
- **State synchronization** - Gesture state properly shared between modules
- **Event coordination** - Long press timeout coordination between modules
- **Configuration sharing** - Config updates propagate to both modules
- **Cleanup coordination** - Proper cleanup in both modules during destroy

### Performance Requirements  
- **No performance regression** - Touch processing speed maintained
- **Memory efficiency** - No memory leaks from module coordination
- **Event throttling** - Touch move throttling still works

## Files Modified
- ✅ `src/core/TouchEventHandler.js` - Update to orchestrator pattern
- ✅ Add imports for TouchGestures and TouchInteractions
- ✅ Remove extracted methods and properties
- ✅ Coordinate between modules in event handlers
- ✅ Build verification - `npm run build` passes

## Validation Steps
1. **Public API compatibility** - All existing methods work unchanged
2. **Touch gesture recognition** - Tap, pan, zoom work identically 
3. **Event emission format** - Same event types and data structures
4. **Multi-touch handling** - Pinch-to-zoom behavior preserved
5. **Long press timing** - Long press detection timing unchanged
6. **Build stability** - No build errors or circular dependencies

## Success Criteria
- [ ] TouchEventHandler acts as orchestrator between modules
- [ ] All gesture recognition delegated to TouchGestures
- [ ] All interaction handling delegated to TouchInteractions  
- [ ] Public API behavior completely preserved
- [ ] Event emission format and timing unchanged
- [ ] Build passes without errors
- [ ] No behavioral regressions in touch functionality

## Next Steps
- PR4: Final cleanup and optimization of the complete refactor