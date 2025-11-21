# Agent Documentation

This file contains all the information an agent needs to start working on the codebase, including project structure, architecture, guidelines, and workflows.

## Project Overview

**Wire EDM G-Code Viewer** is an interactive, modular viewer for Wire EDM G-Code files. It supports visualization of toolpaths (G0/G1/G2/G3), measurement tools, G-code editing, and ISO program export.

## Quick Start & Commands

### Development
- **Start Dev Server**: `npm run dev` (http://localhost:3000)
- **Install Dependencies**: `npm install` (Node >= 16)
- **Production Build**: `npm run build` (output to `dist/`)
- **Preview Build**: `npm run preview` (port 4173)
- **Deploy**: `npm run deploy` (deploys to GitHub Pages)

### Testing
- **Run Tests**: `npm test` (if configured, currently Vitest/Playwright recommended)
- **ISO Helper**: `python edm_iso_tester.py` (utility script)

## Project Structure

- **Entry Point**: `index.html` → `src/main.js`
- **Core Logic**: `src/core/`
  - `AppOrchestrator.js`: Lifecycle and init.
  - `GCodeParser.js`: Parsing logic.
  - `Viewport.js`: Zoom/pan/transform.
  - `EventManager.js`: Event bus system.
- **UI Components**: `src/components/`
  - `Canvas.js`: Main rendering area.
  - `Toolbar.js`: Top controls.
  - `Sidebar.js`: Right-side info panel.
  - `GCodeDrawer.js`: Bottom editor/viewer.
- **Utilities**: `src/utils/`
  - `MathUtils.js`, `Constants.js`, `FileHandler.js`.
- **Styles**: `src/styles/` (`main.css`, `components.css`, `theme.css`).
- **Documentation**: `documentation/`
  - `TODO.md`: Active tasks and priorities.
  - `templates/`: Templates for PRs and issues.
  - `archive/`: Outdated or historical documentation (e.g., past refactors).
  - `IssuesPictures/`: Images for issues/repro.

## Architecture Overview

The application follows a modular **event-driven architecture**:

1.  **Event System**: `EventManager.js` acts as a singleton EventBus. Components communicate via `EVENT_TYPES` (in `src/core/events/EventTypes.js`) rather than direct coupling.
    - Flow: File Load → Parse → Event `PARSER_COMPLETED` → Canvas Redraw / Drawer Update.
2.  **State Management**:
    - `AppOrchestrator` holds high-level state.
    - Components manage their own local state (e.g., `GCodeDrawer` edits).
    - `UndoRedoSystem` manages history for edits.
3.  **Rendering**:
    - `CanvasRenderer` handles high-DPI rendering of paths.
    - `CanvasGrid` provides a dynamic 1-2-5 zoom-responsive grid.
    - `MarkerRenderer` draws points and measurements.

## Working with `documentation/TODO.md`

- **Read First**: Check "## Active Tasks" at the top.
- **Do Not Load All**: The file is large; read header/active sections first.
- **Completed Tasks**: Listed reverse-chronologically at the bottom.

## Coding Standards

- **Style**: ES modules, 2-space indent, semicolons, `const`/`let`.
- **Naming**:
  - Classes/Components: `PascalCase` (e.g., `GCodeParser`).
  - Variables/Functions: `camelCase`.
  - Constants: `SCREAMING_SNAKE_CASE`.
  - Files: Match export name (usually `PascalCase` for classes).
  - CSS: `kebab-case`.
- **Security**: Validate inputs via `FileHandler`. No large binaries in repo.

## Commit & Pull Request Guidelines

- **Commits**: `type(scope): summary` (e.g., `feat(parser): add G4 support`).
  - Imperative, present tense.
  - Keep small and focused.
- **Pull Requests**:
  - Use `documentation/templates/PR_Template.md` if available.
  - Link issues.
  - Verify `npm run build` passes.

## Supported G-Code Features

- **Motion**: G0 (Rapid), G1 (Linear), G2/G3 (CW/CCW Arcs).
- **Coordinates**: X, Y (Z parsed but ignored).
- **Arc Centers**: I, J (supports Absolute G90.1 and Relative G91.1).
- **Comments**: `;` and `()`.

## UX & Configuration Notes

- **Debounce**: Text editing uses ~3000ms debounce to prevent UI freezing.
- **Grid**: `DYNAMIC_GRID` constant controls adaptive grid.
- **Drawer Modes**: Select vs. Edit mode (persisted in localStorage).
