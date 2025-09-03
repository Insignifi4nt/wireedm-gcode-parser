# Refactoring Plan

This is the master index for refactors. See per-file folders under `RefactoringFiles/` for detailed scopes and PR breakdowns.

Navigation
- GCodeDrawer: `RefactoringFiles/GCodeDrawer/00-scope.md` and `RefactoringFiles/GCodeDrawer/PRs/`

## Progress
- PR1 (GCodeDrawer): Extract sanitization helpers to `src/utils/Sanitize.js` — completed. Build passes; event contracts unchanged.
- PR2 (GCodeDrawer): Introduce `UndoRedoSystem` and migrate stack logic — completed. Buttons reflect state; behavior unchanged.
- PR3 (GCodeDrawer): Extract `MultiSelectHandler` and migrate selection operations — completed. Selection behavior and toolbar counters unchanged.

## Files Over 500 Lines Requiring Refactoring

### EventManager.js (1,060 lines)
**Split into:**
- `core/events/EventBus.js` - Core event system
- `core/events/EventTypes.js` - Event type definitions
- `core/events/EventHandlers.js` - Event handler utilities

### GCodeDrawer.js (1,057 lines)
**Split into:**
- `components/drawer/GCodeEditor.js` - Text editor functionality
- `components/drawer/DrawerToolbar.js` - Toolbar and controls
- `components/drawer/MultiSelectHandler.js` - Line selection logic
- `components/drawer/UndoRedoSystem.js` - Undo/redo functionality

### Canvas.js (970 lines)
**Split into:**
- `components/canvas/CanvasRenderer.js` - Drawing/rendering logic
- `components/canvas/CanvasInteractions.js` - Mouse/click handlers
- `components/canvas/CanvasGrid.js` - Grid drawing utilities
- `components/canvas/PathHighlights.js` - Path highlighting system

### main.js (774 lines)
**Split into:**
- `core/AppOrchestrator.js` - Main coordination logic
- `core/ComponentInitializer.js` - Component setup
- `core/EventWiring.js` - Event system connections

### Toolbar.js (619 lines)
**Split into:**
- `components/toolbar/FileControls.js` - File I/O controls
- `components/toolbar/ViewControls.js` - Zoom/pan controls
- `components/toolbar/ActionControls.js` - Action buttons

### StatusMessage.js (584 lines)
**Split into:**
- `components/notifications/ToastManager.js` - Toast system
- `components/notifications/MessageQueue.js` - Message queuing
- `components/notifications/NotificationStyles.js` - Styling logic

### TouchEventHandler.js (536 lines)
**Split into:**
- `core/input/TouchGestures.js` - Gesture recognition
- `core/input/TouchInteractions.js` - Touch event mapping

### MathUtils.js (531 lines)
**Split into:**
- `utils/geometry/ArcCalculations.js` - Arc math
- `utils/geometry/CoordinateTransforms.js` - Coordinate utilities
- `utils/geometry/BoundsCalculations.js` - Bounds utilities

## Priority Order
1. GCodeDrawer (most complex UI component)
2. Canvas (core rendering system)
3. EventManager (foundational system)
4. main.js (orchestration cleanup)
5. Toolbar (UI organization)
