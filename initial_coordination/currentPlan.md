# Multi-Agent Wire EDM Viewer Development Plan

## Project Overview
Transform the single-file Wire EDM G-Code Viewer into a modular, maintainable application using modern web development patterns. Multiple agents will work in parallel following this coordinated plan.

## Target Architecture
```
wire-edm-viewer/
├── index.html                 # Main entry point
├── package.json              # Dependencies & scripts  
├── src/
│   ├── main.js               # Application bootstrap
│   ├── core/
│   │   ├── GCodeParser.js    # G-code parsing logic
│   │   ├── Viewport.js       # Pan/zoom/coordinate transforms
│   │   └── EventManager.js   # Centralized event handling
│   ├── components/
│   │   ├── Canvas.js         # Canvas rendering engine
│   │   ├── Toolbar.js        # UI controls component
│   │   ├── Sidebar.js        # Info panel component
│   │   └── StatusMessage.js  # Notification system
│   ├── utils/
│   │   ├── FileHandler.js    # File I/O operations
│   │   ├── MathUtils.js      # Coordinate calculations
│   │   └── Constants.js      # App constants
│   └── styles/
│       ├── main.css          # Base styles
│       ├── components.css    # Component styles
│       └── theme.css         # Color scheme
└── coordination/             # Agent coordination files
    ├── currentPlan.md        # This file
    ├── comm.md              # Agent communication log
    ├── completed.md         # Completed tasks
    └── agentStatus.md       # Current assignments
```

## Phase 1: Project Foundation (Parallel Execution)

### Agent A1 - Foundation Setup
**Dependencies**: None  
**Output**: Basic project structure and build setup

- [ ] **A1.1**: Create package.json with Vite and development dependencies
  - Add vite, @vitejs/plugin-legacy for browser support
  - Include dev scripts: dev, build, preview
  - Set up basic project metadata
  
- [ ] **A1.2**: Configure Vite build system
  - Create vite.config.js with ES6 module support
  - Configure build output to dist/
  - Set up dev server with hot reload
  
- [ ] **A1.3**: Create initial project folder structure
  - src/ directory with subdirectories (core/, components/, utils/, styles/)
  - coordination/ directory (already exists)
  - dist/ for build output
  
- [ ] **A1.4**: Set up version control configuration
  - Create .gitignore for Node.js/Vite project
  - Exclude node_modules/, dist/, .env files
  - Include coordination/ files for tracking
  
- [ ] **A1.5**: Create main HTML entry point
  - index.html with basic structure
  - Link to main.js module
  - Include viewport meta tags for responsive design

### Agent A2 - Core Architecture Design
**Dependencies**: None (can work parallel with A1)  
**Output**: Base architectural components and utilities

- [ ] **A2.1**: Create application constants
  - src/utils/Constants.js with app-wide constants
  - Grid settings, color schemes, default values
  - File format specifications
  
- [ ] **A2.2**: Implement mathematical utilities  
  - src/utils/MathUtils.js with coordinate transformation functions
  - Distance calculations, angle conversions
  - Bounds checking and validation utilities
  
- [ ] **A2.3**: Design EventManager architecture
  - Create EventManager class interface
  - Define event types and data structures
  - Plan observer pattern implementation
  
- [ ] **A2.4**: Create base module templates
  - Standard ES6 class patterns
  - Import/export conventions
  - Documentation templates
  
- [ ] **A2.5**: Establish coding standards
  - ES6 module patterns
  - Naming conventions
  - Error handling patterns

### Agent A3 - G-Code Parser Extraction
**Dependencies**: A2.1, A2.2 (Constants and MathUtils)  
**Output**: Standalone G-code parsing module

- [ ] **A3.1**: Extract parsing logic from original HTML
  - Copy parseGCode function from wire-edm-gcode-viewer.html:246
  - Preserve all existing functionality
  - Clean up and modularize code structure
  
- [ ] **A3.2**: Create GCodeParser class structure
  - Constructor with options parameter
  - Public parse() method returning path and bounds
  - Private helper methods for different G-code types
  
- [ ] **A3.3**: Implement linear move parsing (G0/G1)
  - Handle X/Y coordinate extraction
  - Support for absolute positioning
  - Distinguish between rapid (G0) and cutting (G1) moves
  
- [ ] **A3.4**: Implement arc move parsing (G2/G3)
  - Handle I/J offset parameters
  - Calculate arc centers and radii
  - Support clockwise (G2) and counterclockwise (G3)
  
- [ ] **A3.5**: Add bounds calculation
  - Track min/max X/Y values during parsing
  - Include arc endpoints and centers in bounds
  - Return bounds object with path data
  
- [ ] **A3.6**: Implement error handling and validation
  - Invalid G-code line handling
  - Malformed coordinate detection
  - Progress reporting for large files

## Phase 2: Core Components (Parallel Execution)

### Agent B1 - Viewport Management
**Dependencies**: A2.1, A2.2 (Constants, MathUtils)  
**Output**: Viewport state management and coordinate system

- [ ] **B1.1**: Create Viewport class for state management
  - Properties: zoom, offsetX, offsetY, bounds
  - Constructor with canvas dimensions
  - State validation and bounds checking
  
- [ ] **B1.2**: Implement coordinate transformation methods
  - screenToWorld(x, y) - mouse to world coordinates
  - worldToScreen(x, y) - world to canvas coordinates  
  - applyTransform(ctx) - apply zoom/pan to canvas context
  
- [ ] **B1.3**: Add mouse coordinate conversion
  - Real-time mouse position tracking
  - Grid snapping functionality
  - Coordinate validation and bounds checking
  
- [ ] **B1.4**: Implement zoom functionality
  - Zoom in/out with mouse wheel
  - Zoom limits (min/max values)
  - Zoom center point calculation
  
- [ ] **B1.5**: Add viewport manipulation
  - Reset to default view
  - Fit content to screen
  - Pan/drag viewport functionality

### Agent B2 - Canvas Rendering Engine
**Dependencies**: A2.1 (Constants), B1 (Viewport)  
**Output**: Modular canvas rendering system

- [ ] **B2.1**: Create Canvas component class
  - Constructor accepting canvas element and viewport
  - Rendering methods for different layer types
  - State management for drawing preferences
  
- [ ] **B2.2**: Implement grid rendering
  - Dynamic grid based on zoom level
  - Axis lines with different styling
  - Grid labels and measurements
  
- [ ] **B2.3**: Create G-code path rendering
  - Different styles for rapid vs cutting moves
  - Line width scaling with zoom
  - Path optimization for performance
  
- [ ] **B2.4**: Add start/end point markers
  - Distinct visual markers for path start/end
  - Labels and annotations
  - Hover/selection states
  
- [ ] **B2.5**: Implement point visualization
  - Clicked measurement points
  - Point numbering and labels
  - Selection and highlight states
  
- [ ] **B2.6**: Add responsive canvas handling
  - Automatic resize on window changes
  - High-DPI display support
  - Performance optimization for large datasets

### Agent B3 - Event Management System
**Dependencies**: A2.3 (EventManager design), B1 (Viewport)  
**Output**: Centralized event handling and coordination

- [ ] **B3.1**: Implement EventManager singleton
  - Event registration and deregistration
  - Event firing with data payload
  - Memory leak prevention
  
- [ ] **B3.2**: Create mouse event handling
  - Click, drag, wheel events
  - Touch events for mobile support
  - Event delegation and bubbling
  
- [ ] **B3.3**: Add keyboard shortcut system
  - Grid snap toggle (G key)
  - Zoom shortcuts (+ / -)
  - File operations (Ctrl+O, Ctrl+S)
  
- [ ] **B3.4**: Implement event delegation
  - Component event binding
  - Dynamic element event handling
  - Performance optimization
  
- [ ] **B3.5**: Add mobile/touch support preparation
  - Touch gesture recognition
  - Pinch-to-zoom handling
  - Mobile-specific event patterns

## Phase 3: UI Components (Parallel Execution)

### Agent C1 - Toolbar Component
**Dependencies**: B3 (EventManager), A2.1 (Constants)  
**Output**: Modular toolbar with file and view controls

- [ ] **C1.1**: Extract toolbar HTML structure
  - Create reusable toolbar component
  - Maintain existing visual design
  - Separate structure from behavior
  
- [ ] **C1.2**: Create Toolbar class with event binding
  - Component initialization and setup
  - Event listener registration
  - State management for button states
  
- [ ] **C1.3**: Implement file input handling
  - File selection and validation
  - Drag-and-drop file support
  - Error handling for invalid files
  
- [ ] **C1.4**: Add zoom control functionality
  - Zoom in/out buttons
  - Fit-to-screen button
  - Zoom level display and updates
  
- [ ] **C1.5**: Create export and utility buttons
  - Clear points functionality
  - Export points to G-code
  - Additional utility functions

### Agent C2 - Sidebar Information Panel
**Dependencies**: B3 (EventManager), A2.1 (Constants)  
**Output**: Information display and point management

- [ ] **C2.1**: Extract sidebar HTML structure
  - Coordinate display section
  - Clicked points list section
  - Path information section
  
- [ ] **C2.2**: Create real-time coordinate display
  - Mouse position tracking
  - Grid snap indicator
  - Unit display and formatting
  
- [ ] **C2.3**: Implement clicked points management
  - Point list display and updates
  - Point editing and deletion
  - Point numbering and organization
  
- [ ] **C2.4**: Add path information display
  - G-code statistics (move count, bounds)
  - File information and metadata
  - Performance metrics
  
- [ ] **C2.5**: Create point interaction features
  - Individual point deletion
  - Point reordering (drag-and-drop)
  - Point editing and coordinate modification

### Agent C3 - Status and Notification System
**Dependencies**: B3 (EventManager)  
**Output**: User feedback and notification system

- [ ] **C3.1**: Create StatusMessage component
  - Message display with different types
  - Positioning and animation
  - Auto-dismiss functionality
  
- [ ] **C3.2**: Implement notification queue system
  - Multiple message handling
  - Priority-based display
  - Message stacking and management
  
- [ ] **C3.3**: Add message type variations
  - Success messages (green)
  - Error messages (red)
  - Info messages (blue)
  - Warning messages (yellow)
  
- [ ] **C3.4**: Create auto-dismiss functionality
  - Configurable timeout periods
  - User interaction to dismiss
  - Animation and transition effects
  
- [ ] **C3.5**: Add progress indication support
  - File loading progress
  - Export operation status
  - Long-running operation feedback

## Phase 4: Integration and Polish (Sequential Execution)

### Agent D1 - File Operations
**Dependencies**: A3 (GCodeParser), C3 (StatusMessage)  
**Output**: Complete file handling system

- [ ] **D1.1**: Create FileHandler utility class
  - File reading and writing operations
  - Format validation and conversion
  - Error handling and user feedback
  
- [ ] **D1.2**: Implement G-code file loading
  - File reader integration
  - Progress reporting for large files
  - Parser integration and error handling
  
- [ ] **D1.3**: Add comprehensive file validation
  - File type checking (.gcode, .nc, .txt)
  - Content validation and sanitization
  - User-friendly error messages
  
- [ ] **D1.4**: Create export functionality
  - Point list to G-code conversion
  - File download and save handling
  - Export format options
  
- [ ] **D1.5**: Add drag-and-drop support
  - File drop zone implementation
  - Visual feedback during drag operations
  - Multiple file handling

### Agent D2 - CSS Organization and Theming
**Dependencies**: All UI components (C1, C2, C3)  
**Output**: Organized, maintainable stylesheet system

- [ ] **D2.1**: Extract and organize CSS files
  - Split styles into main.css, components.css, theme.css
  - Maintain existing visual design
  - Remove unused styles
  
- [ ] **D2.2**: Create component-specific stylesheets
  - Toolbar styles
  - Sidebar styles
  - Canvas and status message styles
  
- [ ] **D2.3**: Implement CSS custom properties
  - Color scheme variables
  - Spacing and sizing variables
  - Typography variables
  
- [ ] **D2.4**: Add responsive design improvements
  - Mobile-friendly layouts
  - Tablet and desktop optimizations
  - Accessibility improvements
  
- [ ] **D2.5**: Optimize CSS for performance
  - Remove redundant styles
  - Optimize selectors
  - Minimize bundle size

### Agent D3 - Application Integration
**Dependencies**: ALL previous agents  
**Output**: Complete, working modular application

- [ ] **D3.1**: Create main.js application bootstrap
  - Import and initialize all components
  - Set up component communication
  - Application startup sequence
  
- [ ] **D3.2**: Wire up component communication
  - EventManager integration
  - Data flow between components
  - State synchronization
  
- [ ] **D3.3**: Test all component interactions
  - File loading and parsing
  - Canvas rendering and interaction
  - UI component functionality
  
- [ ] **D3.4**: Debug and fix integration issues
  - Cross-component communication bugs
  - Event handling conflicts
  - Performance bottlenecks
  
- [ ] **D3.5**: Final optimization and cleanup
  - Code cleanup and documentation
  - Performance profiling and optimization
  - Final testing and validation

## Agent Coordination Protocol

### Communication Rules
1. **Before starting**: Log intent in comm.md with timestamp
2. **During work**: Update progress every 30 minutes in comm.md
3. **On completion**: Mark task complete in completed.md
4. **On blocking**: Log dependency wait in comm.md
5. **On conflict**: Escalate in comm.md for coordination review

### Dependency Chain
- **A-level agents**: Can work in parallel (A1, A2, A3)
- **B-level agents**: Depend on specific A-level completions
- **C-level agents**: Depend on B3 (EventManager) completion
- **D-level agents**: D1 and D2 can work parallel, D3 waits for all

### File Naming Conventions
- Classes: PascalCase (e.g., GCodeParser, EventManager)
- Files: PascalCase matching class names (e.g., GCodeParser.js)
- Utilities: camelCase (e.g., mathUtils.js, constants.js)
- Styles: kebab-case (e.g., main.css, components.css)

### Code Quality Standards
- ES6+ syntax throughout
- Comprehensive error handling
- JSDoc comments for public methods
- Consistent indentation (2 spaces)
- No global variables (use modules)

### Testing Strategy
- Each agent should test their components individually
- Integration testing by D3 agent
- Manual testing of all user workflows
- Performance testing with large G-code files

### Success Criteria
- ✅ All original functionality preserved
- ✅ Code is modular and maintainable
- ✅ Performance is equal or better than original
- ✅ Build system works correctly
- ✅ All agents complete their tasks successfully