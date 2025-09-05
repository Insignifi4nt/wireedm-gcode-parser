# TouchEventHandler PR1: Extract TouchGestures

## Overview
Extract pure gesture recognition logic from TouchEventHandler into a focused TouchGestures module.

## Scope
Move gesture detection, touch tracking, and state management logic from TouchEventHandler.js to TouchGestures.js while maintaining behavioral parity.

## Code to Extract (from TouchEventHandler.js)

### Touch State Tracking (lines ~33-45)
```javascript
this.touches = new Map();
this.lastTouchTime = 0;
this.touchThrottleDelay = 16;

this.gestureState = {
  type: null, // 'pan', 'zoom', 'tap'
  startTime: 0,
  lastDistance: 0,
  lastCenter: { x: 0, y: 0 },
  tapCount: 0,
  tapTimeout: null
};
```

### Configuration (lines ~48-55)
```javascript
this.config = {
  tapThreshold: 10,
  tapTimeout: 300,
  doubleTapTimeout: 500,
  longPressTimeout: 800,
  pinchThreshold: 50,
  preventContextMenu: true
};
```

### Gesture Recognition Methods
- `_handleSingleTouchStart()` (lines ~138-168)
- `_handlePinchStart()` (lines ~175-189)
- `_handleSingleTouchMove()` (lines ~229-269)
- `_handlePinchMove()` (lines ~276-306)
- `_calculateTouchDistance()` (lines ~426-430)
- `_calculateTouchCenter()` (lines ~438-443)
- `_resetGestureState()` (lines ~471-477)

### Touch Tracking Logic
- Touch Map management from `_handleTouchStart()` (lines ~112-121)
- Touch updates from `_handleTouchMove()` (lines ~210-216)
- Touch cleanup from `_handleTouchEnd()` (lines ~321-323)

## Implementation Strategy

### TouchGestures Class Interface
```javascript
export class TouchGestures {
  constructor(config = {})
  
  // Touch tracking
  updateTouchTracking(touches)
  getTouchState()
  
  // Gesture detection
  detectGestureStart(touches)
  detectGestureMove(touches)
  detectGestureEnd(touches)
  
  // Gesture calculations  
  calculateDistance(touch1, touch2)
  calculateCenter(touch1, touch2)
  
  // State management
  getGestureState()
  resetGestureState()
  updateConfig(config)
}
```

### Method Refactoring

**Extract to `detectGestureStart()`:**
- Single touch start logic (tap detection, timing)
- Pinch start logic (two-touch distance/center)
- Touch tracking initialization

**Extract to `detectGestureMove()`:**
- Single touch move (pan detection)
- Pinch move (zoom detection)
- Touch position updates

**Extract to `detectGestureEnd()`:**
- Gesture completion logic
- Touch cleanup
- State reset

## TouchEventHandler Integration

Update TouchEventHandler to use TouchGestures:

```javascript
// In constructor
this.touchGestures = new TouchGestures(this.config);

// In _handleTouchStart
const gestureInfo = this.touchGestures.detectGestureStart(Array.from(event.touches));

// In _handleTouchMove  
const gestureInfo = this.touchGestures.detectGestureMove(Array.from(event.touches));

// In _handleTouchEnd
const gestureInfo = this.touchGestures.detectGestureEnd(Array.from(event.changedTouches));
```

## Behavioral Preservation

### Critical Requirements
- **Touch tracking accuracy** - touches Map management identical
- **Gesture timing** - tap timeout, double tap detection, long press timing
- **Pinch detection** - distance calculations and threshold logic
- **Pan detection** - movement threshold and direction tracking
- **State management** - gestureState transitions identical

### Validation Steps
1. **Touch tracking** - Verify touches Map updated correctly
2. **Tap detection** - Single tap, double tap, long press timing
3. **Pan detection** - Movement threshold triggering
4. **Pinch detection** - Two-touch distance calculations
5. **State transitions** - Gesture type changes handled correctly

## Files Modified
- ✅ `src/core/input/TouchGestures.js` - Implement full functionality
- ✅ `src/core/TouchEventHandler.js` - Integrate TouchGestures usage
- ✅ Build verification - `npm run build` passes

## Success Criteria
- [ ] All gesture recognition logic moved to TouchGestures
- [ ] TouchEventHandler uses TouchGestures for all detection
- [ ] Touch behavior unchanged on mobile devices
- [ ] Build passes without errors
- [ ] No circular dependencies introduced

## Next Steps
- PR2: Extract TouchInteractions for viewport manipulation
- PR3: Complete TouchEventHandler orchestration updates