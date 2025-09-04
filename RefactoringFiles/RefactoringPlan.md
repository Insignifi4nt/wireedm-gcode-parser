# Refactoring Plan

This is the master index for refactors. See per-file folders under `RefactoringFiles/` for detailed scopes and PR breakdowns.

Navigation
- GCodeDrawer: `RefactoringFiles/GCodeDrawer/00-scope.md` and `RefactoringFiles/GCodeDrawer/PRs/`
- Canvas: `RefactoringFiles/Canvas/00-scope.md` and `RefactoringFiles/Canvas/PRs/`
- EventManager: `RefactoringFiles/EventManager/00-scope.md` and `RefactoringFiles/EventManager/PRs/`

## Progress
- GCodeDrawer PR1–PR5: Completed. Drawer orchestrates Editor/Toolbar/Undo/Selection. Build passes.
- Canvas PR1–PR5: Completed. Canvas composes CanvasGrid, PathHighlights, MarkerRenderer, CanvasRenderer.
- EventManager PR0–PR9: Completed. Split into `core/events/*` with compatibility re-exports.
- main.js PR0–PR7: Completed. Split into AppOrchestrator, ComponentInitializer, EventWiring; `src/main.js` is a slim bootstrap. PR8 cleanup/docs done.
 - Toolbar PR0: Scaffold submodules — completed.
 - Toolbar PR1: Extract FileControls — completed.
 - Toolbar PR2: Extract ViewControls — completed.
 - Toolbar PR3: Extract ActionControls — completed.
 - Toolbar PR4: Orchestration cleanup — completed. PR5 cleanup pending.

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
Status: Completed. GCodeDrawer acts as an orchestrator; duplicate editor logic removed.

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
1. Completed: GCodeDrawer, Canvas, EventManager, main.js
2. Next: Toolbar (UI organization)
3. Then: StatusMessage, TouchEventHandler, MathUtils
