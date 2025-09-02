# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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

# Install dependencies
npm install
```

## Architecture Overview

The application follows a modular event-driven architecture with clear separation of concerns:

### Core Systems
- **EventBus (EventManager.js)**: Singleton event system for decoupled component communication
- **GCodeParser**: Parses G-Code text into path data with bounds and statistics
- **Viewport**: Manages zoom, pan, coordinate transformations with dynamic zoom limits
- **EventIntegration**: Unified mouse/keyboard/touch event handling system

### Key Components
- **Canvas**: Grid + path rendering + highlights with high-DPI support
- **Toolbar**: File I/O, zoom controls, drawer actions
- **Sidebar**: Live coordinates, points management, path statistics
- **GCodeDrawer**: Collapsible G-code editor with line↔path highlighting and point insertion
- **StatusMessage**: Non-blocking toast notifications

### Utilities
- **IsoNormalizer**: G-code normalization to ISO format with proper headers/footers
- **FileHandler**: File loading/validation with parser integration
- **Constants**: Centralized configuration (grid, viewport, colors, etc.)
- **MathUtils**: Arc calculations, coordinate transforms, bounds utilities

## Key File Paths

- **Entry point**: `src/main.js` (WireEDMViewer class orchestrates everything)
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

## Current Branch Context

Working on `feat/gcode-drawer-multiselect` - Implemented complete undo/redo system with multiselect interface, context-sensitive toolbar, and enhanced UX patterns.