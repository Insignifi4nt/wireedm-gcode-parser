# TouchEventHandler Refactoring Scope

## Overview

TouchEventHandler.js (537 lines) handles touch interactions for mobile devices in the Wire EDM G-Code Viewer. This refactor splits the monolithic class into focused modules following established patterns.

## Goals

- **Split gesture recognition from interaction handling** - Separate pure gesture detection from viewport manipulation
- **Improve maintainability** - Create clear, focused modules with single responsibilities
- **Preserve all touch behaviors** - Maintain exact behavioral parity for all touch gestures
- **Maintain public API** - Keep TouchEventHandler interface unchanged for existing integrations

## Non-Goals

- **No new touch features** - This is a pure refactor without feature additions
- **No UX changes** - Touch interaction behavior must remain identical
- **No performance optimization** - Focus on structure, not performance improvements
- **No mobile UI changes** - Visual behavior must be unchanged

## Current Architecture

```
TouchEventHandler.js (537 lines)
├── Touch State Tracking (touches Map, gestureState)
├── Gesture Recognition (tap, pan, zoom detection)
├── Touch Event Handlers (start, move, end, cancel)
├── Viewport Interactions (pan, zoom operations)
├── Event Emission (through EventBus)
├── Utility Methods (distance, center calculations)
└── Lifecycle Management (init, destroy)
```

## Target Architecture

```
src/core/input/
├── TouchGestures.js         - Gesture recognition engine
├── TouchInteractions.js     - Viewport interaction handlers
└── (TouchEventHandler.js)   - Orchestrator and public API
```

### TouchGestures.js (~180 lines)
**Purpose**: Pure gesture recognition and state tracking
- Gesture state management (`gestureState` object)
- Touch tracking (`touches` Map) 
- Gesture type detection (tap/pan/zoom recognition)
- Touch distance/center calculations
- Configuration management and thresholds
- No external dependencies except configuration

### TouchInteractions.js (~170 lines)
**Purpose**: Business logic for handling gestures
- Viewport manipulation (pan, zoom operations)
- Event emission through EventBus
- Touch-to-mouse event conversion
- Interaction behaviors (long press, double tap, etc.)
- Integration with application state

### TouchEventHandler.js (~180 lines)
**Purpose**: Orchestrator and public API
- Coordinates gesture recognition with interactions
- DOM event listener management
- Component lifecycle (init, destroy)
- Maintains existing public interface
- Error handling and validation

## Module Interactions

```
DOM Touch Events
       ↓
TouchEventHandler (orchestrator)
       ↓
TouchGestures.detectGesture()
       ↓
TouchInteractions.handleGesture()
       ↓
EventBus.emit() + Viewport.pan/zoom()
```

## Key Constraints

### API Compatibility
- **Constructor signature** - `new TouchEventHandler(canvas, viewport)` unchanged
- **Public methods** - `init()`, `destroy()`, `getState()`, `setEnabled()`, `updateConfig()` preserved
- **Event emissions** - Exact same event types and data structures
- **Error handling** - Same error messages and validation

### Behavioral Parity
- **Gesture recognition accuracy** - Tap, pan, zoom detection identical
- **Viewport manipulation** - Pan/zoom operations produce same results
- **Touch tracking** - Multi-touch handling works identically  
- **Timing and thresholds** - Same tap timeout, long press timeout, etc.
- **Mobile compatibility** - All mobile touch devices work unchanged

### Integration Points
- **EventBus integration** - Same event types: `MOUSE_CLICK`, `VIEWPORT_PAN_CHANGE`, `VIEWPORT_ZOOM_CHANGE`, `VIEWPORT_FIT_TO_SCREEN`
- **Viewport integration** - Same pan/zoom method calls
- **Canvas integration** - Same DOM event listener patterns

## Success Criteria

### Functionality
- [ ] All touch gestures work identically (tap, double-tap, long press, pan, zoom)
- [ ] Multi-touch handling preserved (pinch-to-zoom)
- [ ] Touch-to-mouse event conversion maintains compatibility
- [ ] Event emission format and timing unchanged
- [ ] Mobile device compatibility maintained

### Code Quality
- [ ] Clear module boundaries with single responsibilities
- [ ] No circular dependencies between modules
- [ ] Consistent error handling patterns
- [ ] Proper resource cleanup in destroy methods

### Performance
- [ ] Touch event processing performance maintained or improved
- [ ] Memory usage equivalent (no leaks from module splitting)
- [ ] Build size impact minimal

## Validation Strategy

### Manual Testing
- **Mobile devices** - Test on iOS and Android devices
- **Touch gestures** - Verify tap, double-tap, long press, pan, zoom
- **Multi-touch** - Test pinch-to-zoom accuracy
- **Integration** - Test with full application workflow

### Automated Validation
- **Build verification** - `npm run build` passes after each PR
- **Event format validation** - Verify event data structures unchanged
- **API compatibility** - Verify all public methods work identically

## Risk Assessment

**Risk Level**: Low
- Well-established refactoring pattern (5 successful precedents)
- Clear module boundaries
- No complex dependencies or circular references
- Comprehensive behavioral preservation requirements

**Mitigation Strategies**
- Small, focused PRs with individual verification
- Thorough testing on mobile devices after each PR
- Immediate rollback capability if issues discovered

## PR Sequence

1. **PR0** - Scaffold stub modules and verify build
2. **PR1** - Extract TouchGestures (recognition engine)  
3. **PR2** - Extract TouchInteractions (viewport handling)
4. **PR3** - Update TouchEventHandler (orchestrator)
5. **PR4** - Cleanup and optimization

Each PR maintains behavioral parity and build stability.