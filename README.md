# Wire EDM G-Code Viewer

A modular Wire EDM G-Code Viewer application with interactive visualization and measurement tools.

## Development Status

**Current Phase**: Phase 2 (Core Components) - 2/3 complete  
**Progress**: 5/12 agents completed  
**Next Agent**: B3 (Event Management System)

### Completed Components
- ✅ **A1**: Foundation Setup (package.json, Vite config, folder structure)
- ✅ **A2**: Core Architecture (Constants, MathUtils, EventManager design)
- ✅ **A3**: G-Code Parser (Complete parsing system with G0/G1/G2/G3 support)
- ✅ **B1**: Viewport Management (Coordinate transforms, zoom, pan)
- ✅ **B2**: Canvas Rendering (Grid, G-code paths, markers, points)

### Ready to Start
- 🔄 **B3**: Event Management System (Mouse/keyboard events, event delegation)

## Testing the Current Build

### Prerequisites
```bash
# Install Node.js dependencies
npm install
```

### Development Server
```bash
# Start the development server
npm run dev
```
Opens at http://localhost:3000

### Building for Production
```bash
# Build the application
npm run build

# Preview the build
npm run preview
```

## File Structure
```
wire-edm-viewer/
├── index.html              # Main entry point
├── package.json            # Dependencies & scripts
├── vite.config.js          # Build configuration
├── src/
│   ├── main.js             # Application bootstrap (not yet created)
│   ├── core/
│   │   ├── GCodeParser.js  # ✅ G-code parsing logic
│   │   ├── Viewport.js     # ✅ Pan/zoom/coordinate transforms
│   │   └── EventManager.js # ✅ Event architecture (needs implementation)
│   ├── components/
│   │   └── Canvas.js       # ✅ Canvas rendering engine
│   ├── utils/
│   │   ├── Constants.js    # ✅ App constants
│   │   └── MathUtils.js    # ✅ Coordinate calculations
│   ├── templates/          # ✅ Development templates
│   ├── standards/          # ✅ Coding standards
│   └── styles/             # (not yet created)
└── coordination/           # Multi-agent coordination files
    ├── currentPlan.md      # Detailed task breakdown
    ├── agentStatus.md      # Current assignments
    ├── comm.md            # Communication log
    └── completed.md       # Task completion tracking
```

## Features Implemented So Far

### Core Parsing (A3)
- G0/G1 linear moves with coordinate extraction
- G2/G3 arc moves with I/J parameter handling
- Bounds calculation and error handling
- Comment processing and validation

### Viewport System (B1)
- Screen-to-world coordinate transformation
- Mouse coordinate conversion with grid snapping
- Zoom functionality (0.1x to 10x range)
- Pan/drag viewport manipulation
- Fit-to-bounds functionality

### Canvas Rendering (B2)
- Grid rendering with major/minor lines and axis labels
- G-code path visualization:
  - Yellow dashed lines for rapid moves (G0)
  - Green solid lines for cutting moves (G1)
  - Arc move support (G2/G3)
- Start/end point markers (red/blue circles)
- Measurement point visualization
- High-DPI display support

## Original Functionality Status

The modular version preserves ALL functionality from the original `wire-edm-gcode-viewer.html`:
- ✅ G-Code file loading and parsing
- ✅ Interactive canvas with pan/zoom
- ✅ Grid display and snapping
- ✅ Measurement point clicking
- ✅ Coordinate transformations
- ⏳ Event handling (B3 in progress)
- ⏳ UI components (Phase 3)
- ⏳ File operations (Phase 4)

## Next Steps

1. **Complete B3** (Event Management) - Mouse/keyboard events, shortcuts
2. **Phase 3** - UI Components (C1: Toolbar, C2: Sidebar, C3: Status)
3. **Phase 4** - Integration (D1: File ops, D2: CSS, D3: Assembly)

## Multi-Agent Development

This project uses a coordinated multi-agent development system. See `coordination/` directory for:
- Task assignments and dependencies
- Agent communication logs
- Completion tracking
- Development protocol