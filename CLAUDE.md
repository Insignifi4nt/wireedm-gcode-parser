# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Reading `documentation/TODO.md`
- Start with the header and Notes; avoid loading the entire file by default.
- Prioritize "## Active Tasks" for current work.
- "## Completed Tasks" are reverse‑chronological (newest → oldest) and begin near line 69; only read if explicitly needed.

## Project Overview

Wire EDM G-Code Viewer - Interactive, modular viewer for Wire EDM G-Code files. Supports visualization of toolpaths (G0/G1/G2/G3), measurement tools, G-code editing, and ISO program export.

## Development Commands

```bash
# Development server (opens http://localhost:3000)
npm run dev

# Production build
npm run build

# Preview built app (port 4173)  
npm run preview

# Deploy to GitHub Pages
npm run deploy

# Install dependencies
npm install
```

## Architecture Overview

The application follows a modular event-driven architecture with clear separation of concerns:

### Core Systems
- **AppOrchestrator**: Application lifecycle and component initialization
- **EventBus (EventManager.js)**: Singleton event system for decoupled component communication
- **GCodeParser**: Parses G-Code text into path data with bounds and statistics
- **Viewport**: Manages zoom, pan, coordinate transformations with dynamic zoom limits
- **EventIntegration**: Unified mouse/keyboard/touch event handling system

### Key Components
- **Canvas**: Grid + path rendering + highlights with high-DPI support
  - **CanvasGrid**: Dynamic zoom-responsive grid system with 1-2-5 snapping
  - **CanvasRenderer**: High-DPI path and geometry rendering
  - **MarkerRenderer**: Point and measurement visualization
  - **PathHighlights**: Interactive path highlighting and selection
- **Toolbar**: File I/O, zoom controls, drawer actions (modular: FileControls, ViewControls, ActionControls)
- **Sidebar**: Live coordinates, points management, path statistics
- **GCodeDrawer**: Collapsible G-code editor with multiselect, undo/redo, and line↔path highlighting
  - **GCodeEditor**: Text editing with debounced parsing
  - **MultiSelectHandler**: Line selection and bulk operations
  - **UndoRedoSystem**: Complete state management for editing operations
  - **DrawerToolbar**: Context-sensitive editing controls
- **Notifications**: Toast notification system
  - **ToastManager**: Non-blocking notification display
  - **MessageQueue**: Queued message processing
  - **NotificationStyles**: Consistent styling system

### Utilities
- **IsoNormalizer**: G-code normalization to ISO format with proper headers/footers
- **FileHandler**: File loading/validation with parser integration
- **Constants**: Centralized configuration (grid, viewport, colors, etc.)
- **MathUtils**: Arc calculations, coordinate transforms, bounds utilities
- **Geometry modules**: Specialized math utilities (ArcCalculations, BoundsCalculations, CoordinateTransforms)
- **TouchGestures/TouchInteractions**: Mobile touch input handling

## Key File Paths

- **Entry point**: `src/main.js` (delegates to AppOrchestrator)
- **Orchestration**: `src/core/AppOrchestrator.js` (manages application lifecycle)
- **Parser**: `src/core/GCodeParser.js` 
- **Rendering**: `src/components/Canvas.js`
- **Event system**: `src/core/EventManager.js`
- **Constants**: `src/utils/Constants.js`

## Supported G-Code

- **Linear moves**: G0/G1 with X/Y coordinates
- **Arc moves**: G2/G3 with I/J center offsets  
- **Comments**: `;` and `()` syntax
- **Coordinates**: X/Y (Z parsed but not visualized)
- **IJ modes**: Absolute (G90.1) and relative (G91.1) for arc centers

## Event-Driven Communication

Components communicate via EventBus using EVENT_TYPES constants. Key event flows:
- File loading → parsing → canvas update → drawer sync
- Canvas clicks → point addition → sidebar update
- Drawer edits → re-parsing → canvas redraw
- Viewport changes → canvas redraw → UI sync

## UX Lessons Learned

**Text editing debounce**: Use 3000ms, not 100ms. Short debounce disrupts editing flow by constantly refreshing.

**Dynamic grid system**: Uses 1-2-5 progression with pixel-density thresholds and hysteresis to prevent flicker. Configuration in `DYNAMIC_GRID` constant.

**Drawer modes**: Toggle between Select mode (safe, default) and Edit mode with preserved selection state across content refreshes. Mode persisted in localStorage.

## Current Branch Context

Currently on `main` branch. Recent work has focused on finalizing multiselect functionality with undo/redo system, dynamic grid improvements, and enhanced UI/UX patterns including selection state preservation and coordinate system fixes.
