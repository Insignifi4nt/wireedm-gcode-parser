# Repository Guidelines

## Project Structure & Module Organization
- Root entry: `index.html` → `src/main.js` (Vite app). Legacy demo: `documentation/wire-edm-gcode-viewer.html`.
- `src/core`: parsing, viewport, orchestration, and event integration.
  - Key modules: `AppOrchestrator.js`, `ComponentInitializer.js`, `EventWiring.js`, `GCodeParser.js`, `Viewport.js`.
  - Event system: `EventManager.js` with `src/core/events/` (`EventBus.js`, `EventTypes.js`, `EventSchemas.js`, `EventValidator.js`, `EventHistory.js`, `DOMDelegation.js`, `EmitControls.js`).
  - Input: `src/core/input/` (`TouchInteractions.js`, `TouchGestures.js`). Legacy handlers remain (`TouchEventHandler.js`, `MouseEventHandler.js`, `KeyboardHandler.js`) for compatibility.
- `src/components`: UI modules.
  - Top-level: `Canvas.js`, `Toolbar.js`, `Sidebar.js`, `GCodeDrawer.js`, `StatusMessage.js`.
  - Toolbar: `src/components/toolbar/` (`FileControls.js`, `ViewControls.js`, `ActionControls.js`).
  - Canvas: `src/components/canvas/` (`CanvasGrid.js`, `PathHighlights.js`, `MarkerRenderer.js`, `CanvasRenderer.js`).
  - Drawer: `src/components/drawer/` (`UndoRedoSystem.js`, `MultiSelectHandler.js`, `GCodeEditor.js`, `DrawerToolbar.js`).
  - Notifications: `src/components/notifications/` (`ToastManager.js`, `MessageQueue.js`, `NotificationStyles.js`).
- `src/utils`: helpers and constants.
  - Core: `MathUtils.js`, `IsoNormalizer.js`, `FileHandler.js`, `Constants.js`, `Sanitize.js`.
  - Geometry: `src/utils/geometry/` (`CoordinateTransforms.js`, `ArcCalculations.js`, `BoundsCalculations.js`).
- `src/styles`: theme and layout CSS (`main.css`, `components.css`, `theme.css`).
- Coordination docs: `documentation/initial_coordination/`; issue assets: `documentation/IssuesPictures/`.
- Refactor notes: `documentation/RefactoringFiles/` contains scopes and PR docs for modules; template under `documentation/RefactoringFiles/templates/PR_Template.md`.

## Build, Test, and Development Commands
- `npm install`: install dependencies (Node >= 16).
- `npm run dev`: start Vite dev server (http://localhost:3000).
- `npm run build`: production build to `dist/`.
- `npm run preview`: serve the built app (port 4173).
- Optional utility: `python edm_iso_tester.py` to run the ISO helper script (not part of Vite build).

## Coding Style & Naming Conventions
- Follow `src/standards/CodingStandards.md`.
- JavaScript: ES modules, semicolons, 2‑space indent; prefer `const`/`let`.
- Naming: components/classes PascalCase; variables/functions camelCase; constants SCREAMING_SNAKE_CASE.
- Files: components/core/utils PascalCase (e.g., `GCodeParser.js`), entrypoints lower‑case (`main.js`), CSS kebab‑case.

## Testing Guidelines
- No test runner configured yet. If adding tests:
  - Use Vitest (unit) and/or Playwright (e2e).
  - Place unit tests under `src/__tests__/` with `*.test.js` naming.
  - Add `"test": "vitest"` to `package.json` scripts and keep fast, deterministic tests.

## Commit & Pull Request Guidelines
- Commits: imperative, present tense and scoped changes (e.g., "Add arc center absolute mode"). Reference issues (`#123`) when relevant.
- Prefer small, focused commits; include rationale when behavior changes.
- Pull Requests should include:
  - Summary of changes and motivation, screenshots/GIFs for UI.
  - Linked issues, migration notes if APIs or files moved.
  - Check that `npm run build` passes and no console errors in `npm run dev`.
  - When applicable, link the relevant `documentation/RefactoringFiles/<Module>/PRs/PRx-*.md` and use `documentation/RefactoringFiles/templates/PR_Template.md`.

### Commit Message Formatting (CLI)
- Subject: `type(scope): summary` (≤72 chars), imperative mood. Include PR label when applicable (e.g., `PR1`, `PR2`).
- Body: short paragraphs with bullet points for changes; separate paragraphs for docs/refs.
- Use multiple `-m` flags to create paragraphs so rendering is clean in Git/GitHub:
  - Example:
    - bash -lc 'git add -A && git commit \
      -m "refactor(GCodeDrawer,utils): PR1 extract sanitization helpers to utils/Sanitize.js" \
      -m "- Add src/utils/Sanitize.js with sanitizeText and sanitizeContentEditable (caret-preserving), extracted from private methods.\n- Update src/components/GCodeDrawer.js to import helpers for input/blur/paste and emit paths; remove old private methods.\n- Preserve behavior and contracts: drawer:* events unchanged; 3s debounce and caret behavior intact; public API stable.\n- Build: npm run build passes locally." \
      -m "Docs:\n- Update documentation/RefactoringFiles to mark PR1 completed; add implementation notes and verification steps in PR1-Sanitize." \
      -m "Refs: documentation/RefactoringFiles/GCodeDrawer/PRs/PR1-Sanitize.md"'
- Prefer ASCII bullets (`- `) and avoid tabs to keep consistent rendering across tools.
- Keep one logical change per commit; follow-up commits for docs or cleanup are welcome.

## Security & Configuration Tips
- Input handling: validate file size/types via `FileHandler` and keep parsing strict where possible.
- Do not include large binaries in the repo; place repro files under `documentation/IssuesPictures/` if needed.
- Keep Node up to date (>= 16). Avoid introducing dependencies without clear value.
