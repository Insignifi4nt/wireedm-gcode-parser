# Wire EDM G‑Code Viewer

Interactive, modular viewer for Wire EDM G‑Code. Load `.gcode`, `.nc`, `.txt`, or `.iso`, visualize toolpaths (G0/G1/G2/G3), inspect bounds, add measurement points, edit G‑code in a drawer, and export normalized ISO programs.

## Quick start

```bash
# Requirements: Node >= 16
npm install
npm run dev   # opens http://localhost:3000

# Build & preview
npm run build
npm run preview
```

- Main entry: `index.html` → `src/main.js`
- Legacy single‑file demo (no build needed): `wire-edm-gcode-viewer.html`

## What you can do

- Load and parse G‑code (linear G0/G1 and arcs G2/G3 with I/J)
- Viewport controls: fit, zoom, pan; high‑DPI aware transforms
- Grid display with major/minor lines; toggle visibility
- Click to add measurement points; manage from sidebar
- G‑Code Drawer: view/edit text, hover/click to highlight path, insert clicked points as G0 moves
- Export
  - Normalize any G‑code/ISO text to Fanuc‑style ISO (`%`, monotonically increasing N‑numbers, trailing M02, CRLF)
  - Export clicked points as ISO program (PinZ15New‑style header) or plain G‑code rapids

## Using the app

1. Load a file
   - Toolbar “Load G‑Code File” or drag‑and‑drop onto the button
   - Supported: `.gcode`, `.nc`, `.txt`, `.iso` (≤ 50 MB)
2. Navigate the view
   - Mouse wheel zoom, Shift+Left‑drag or Middle button to pan
   - Use “Fit to Screen” to center and scale content
3. Inspect
   - Sidebar shows live mouse XY, grid state, clicked points, path stats/bounds
   - Drawer button opens the G‑code drawer; hover/click lines to highlight; “Insert G0 Moves Here” to add points at a line
4. Export
   - Toolbar “Export ISO” exports the current drawer text normalized to `.iso`
   - “Normalize to ISO” creates a normalized `.iso` from current drawer (or loaded) text without needing points

## Shortcuts

- Ctrl+= / Ctrl++: Zoom in
- Ctrl+-: Zoom out
- Ctrl+0: Reset zoom
- F: Fit to screen
- Arrow keys: Pan
- G: Toggle grid visibility
- Ctrl+C: Clear all points

## Supported G‑code details

- Commands: G0/G1 linear moves, G2/G3 circular arcs with I/J center offsets
- Coordinates: X/Y (Z parsed but not visualized)
- Comments: `;` and `()` are handled and stripped during parsing/normalization
- Block numbers: Leading `N…` accepted; parser removes for uniform handling; normalizer regenerates

## Architecture (high level)

- Core
  - `GCodeParser`: Parses text → `{ path, bounds, stats }`
  - `Viewport`: Zoom/pan, coordinate transforms, fit‑to‑bounds
  - Event system (`EventBus`, `EVENT_TYPES`) for decoupled communication
- Components
  - `Canvas`: Grid + path rendering + highlights
  - `Toolbar`: File I/O, zoom/fit, drawer/normalization actions
  - `Sidebar`: Coordinates, grid state, points, path info
  - `GCodeDrawer`: Collapsible editor with line ↔ path highlighting and point insertion
  - `StatusMessage`: Non‑blocking toasts for progress/feedback
- Utils
  - `IsoNormalizer`: `%`, N‑numbers, trailing `M02`, CRLF; strip semicolon comments; build ISO from point lists
  - `FileHandler`: Load/validate files, parse via `GCodeParser`, export helpers
  - `Constants`/`MathUtils`: Rendering, precision, bounds/arc math, transforms

## Project structure

```
WireEDM_app/
  index.html
  wire-edm-gcode-viewer.html   # legacy single-file demo
  src/
    main.js                    # app bootstrap and orchestration
    core/                      # parser, viewport, event integration
    components/                # canvas, toolbar, sidebar, drawer, status
    utils/                     # constants, file handler, ISO normalizer, math
    styles/                    # theme + layout
```

## Scripts

- `npm run dev`: Start Vite dev server (port 3000)
- `npm run build`: Production build to `dist/`
- `npm run preview`: Preview built app (port 4173)

## Browser support

Modern evergreen browsers. Builds target ES2015; IE11 is not supported.

## License

MIT