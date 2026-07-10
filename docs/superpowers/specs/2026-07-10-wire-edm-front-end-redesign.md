# Wire EDM Front-End Redesign

Date: 2026-07-10

## Goal

Rebuild the Wire EDM Workbench front end as a compact, professional desktop engineering tool while preserving every implemented workflow, file type, data model, calculation, persistence path, edit operation, warning, and export behavior.

The redesign changes information architecture, navigation, workspace composition, settings placement, interaction hierarchy, components, and visual language. It does not replace stable parsing, path-planning, storage, machine-fit, or posting logic.

## Product Model

The product has two related but deliberately different document types.

1. **Path Project**
   - Begins with a DXF import.
   - Persists the original DXF plus a first-class UPID geometry/path-planning document.
   - Edits geometry, contour meaning, order, direction, start points, lead-ins, construction points, and document placement.
   - Produces machine text only at the explicit post/export-preview boundary.

2. **Machine Program**
   - Begins with an existing `.gcode`, `.nc`, `.iso`, or `.txt` program.
   - Persists the raw source plus a cleaned editable text copy.
   - Edits posted program lines, groups, order, start position, and normalized ISO output.
   - Previews parsed G0/G1/G2/G3 motion directly from the editable text.

These document types share an application shell, canvas conventions, measurements, machine context, notifications, and general interaction patterns. They do not share an indistinguishable editor mode. The active document type must be visible in the application bar, workspace structure, commands, inspector content, empty state, and status bar.

## Functionality Inventory and Regression Contract

### Application and persistence

- Cache-first startup under the `wire-edm-workbench` browser namespace.
- Tab-lifetime memory fallback when persistent browser storage is unavailable.
- Optional File System Access workbench folder with remembered IndexedDB handle and permission-aware reconnect.
- Workbench initialization for `imports`, `exports`, `templates`, `machines`, `editor`, and `projects`, plus manifest and header/footer templates.
- Storage status, warnings, errors, and location semantics.
- Project index, open, display-name rename, confirmed delete, and partial-cleanup reporting.
- Project search, source filter, sorting, and empty/filter-empty states.
- Session-level latest DXF import summary.
- Status toasts and retained notification history.

### DXF import and UPID

- Exact 2D `LINE`, `ARC`, `CIRCLE`, `LWPOLYLINE`, and classic `POLYLINE` support, including bulge arcs and closed flags.
- SPLINE/polyline fallback through the installed DXF library.
- BLOCK/INSERT expansion with transforms, arrays, layer inheritance, reflection handling, and provenance.
- Preserved handles, layers, drawing units, insertion base, extents, file name, and import time.
- Warnings for unsupported or unsafe geometry and rejection of imports with no usable geometry.
- Collision-safe project naming for repeated file names.
- Endpoint clustering, chains, contours, nesting, classification, operation planning, bounds, lengths, source summaries, diagnostics, and manual decision metadata.
- Direct path-document preview without hidden G-code generation or reparsing.
- Contour/segment/endpoint hierarchy, topology inspection, diagnostics, cut sequence, rapid selection, cross-highlighting, and provenance inspection.
- Reorder, planning-strategy reapply, role correction, reverse, endpoint or magnetic start selection, and circular center-pierce lead-in.
- Document/selection/operation/segment translate, rotate, mirror, exact placement, drag, and arc/circle center movement.
- Perpendicular and tangent construction points, constrained sliding, measurement points, and undo/redo.
- Explicit UPID export preview with header/body/footer composition, geometry trace, diagnostics, and browser download.

### Existing machine programs

- `.gcode`, `.nc`, `.iso`, and `.txt` import with 50 MiB limit, empty/extension validation, raw preservation, and cleaned editor copy.
- Existing cleanup behavior for outer `%`, block numbers, `M02`, canonical G00-G03, and bare `G92`.
- Parsed XY G0/G1/G2/G3 preview with modal continuation, numeric formats, G92, and supported IJ modes.
- Header/body/footer organization, heuristic toolpath groups, statistics, warnings, and errors.
- Line select/edit modes, Ctrl/Cmd additive selection, Shift range, inline edit commit, and pinned preview highlights.
- Group move/delete, selected-line move/delete, confirmation thresholds, undo/redo, and keyboard deletion.
- Start Here group rotation/reordering, Normalize Draft, non-mutating ISO export, Save, and full raw text editor.

### Shared editor behavior

- SVG geometry/program preview with adaptive grid and axes.
- Zoom from 25% to 800%, fit, wheel zoom, mouse/touch pan, pinch, double-tap fit, and keyboard preview shortcuts.
- Select and point modes, marquee selection, direct geometry and point drag, grid snap, cursor position, start/end markers, and selection/pin/hover rendering.
- Measurement point numeric entry, canvas placement, reindex/delete/clear, external-text insertion, and CSV/G-code/ISO export.
- EN/RO usage guide with targeted highlighting.
- Machine-profile name, output format, line ending, templates, optional work-area limits, and machine-fit warning.
- Dockable, floating, movable, resizable, hideable advanced work panels.

### Explicitly absent behavior

The redesign must not imply functionality that the code does not implement. There is no physical machine connection, send-to-machine flow, machining-time simulation, feed generation, kerf/offset compensation, stock/collision model, taper/U-V support, or transactional cache-to-folder migration.

## Current Experience Critique

- The start screen gives permanent space to machine/output configuration and implementation details instead of prioritizing projects and clear workflow entry.
- Importing a DXF and opening a program begin through visually inconsistent paths, so users cannot predict the document context they will enter.
- The global left rail changes meaning between storage summary and arbitrary editor dock, and its collapsed state leaks across contexts.
- All 12 UPID panels start hidden, including Save, Export, Contour Tree, Transform, and Diagnostics. Guidance then refers to tools the user cannot see.
- A generic Panels menu conceals nearly the whole path workflow; its current toggle bug also blocks canvas/panel interaction in browser tests.
- The empty editor, Path Project, and Machine Program reuse nearly identical chrome despite different source-of-truth models and tool semantics.
- Machine/output settings are nested under Latest DXF Import while storage has a second settings dialog.
- Dirty state and Save are not reliably visible. There is no unsaved-navigation guard.
- Wide fixed panels collapse the dashboard and hide program controls on smaller laptop widths.
- Repeated 8-10px monospace copy, invisible scrollbars, one-off form styling, dense bordered boxes, and always-visible destructive actions reduce readability and hierarchy.
- `EditorPage`, the path navigator, inspector, and preview have accumulated broad state and rendering responsibilities. The hidden registry plus DOM-query portals makes visual composition difficult to reason about.

## Approaches Considered

### 1. One universal adaptive editor

Every document would open into one canvas-and-panels layout whose tools change by model. This maximizes shared chrome, but it preserves the central ambiguity: similar-looking screens would continue to represent different source data, edits, validation, and output.

### 2. Guided stage workflow

DXF work would become a staged import, inspect, plan, post, and export sequence. This is easy to teach, but it adds navigation and blocks the direct, iterative movement expected in a technical workbench. It also fits imported programs poorly.

### 3. Shared shell with distinct document workspaces

The application shell, visual language, status system, canvas conventions, and advanced panels are shared. Path Projects and Machine Programs receive distinct default layouts and command sets. This preserves coherence while making behavior differences explicit, and is the selected approach.

## Information Architecture

### Application shell

- A 40px application bar contains product identity, current document breadcrumb/context, notifications, compact storage status, and Settings.
- Storage connection configuration is available from Settings rather than dominating the main toolbar.
- A 24px status bar persistently shows storage kind, active machine profile, output extension/line ending, and project count.
- The main content is full width when no document-specific left slot is registered. There is no permanent empty application rail.
- In an editor, the shell exposes explicit left, center, right, and optional bottom workspace regions rather than using the dashboard rail as an arbitrary dock.

### Workbench start screen

- The page title is **Workbench**, not Dashboard.
- A compact start panel clearly offers:
  - **Import DXF as Path Project** — `.dxf`, geometry-first workflow.
  - **Open Machine Program** — `.gcode`, `.nc`, `.iso`, `.txt`, line/program workflow.
  - **Open Program Workspace** — preserves the current empty-editor entry for drag/drop or later import.
- The project library is the primary large surface and retains search, source filters, sorting, open, rename, and delete.
- Project rows identify **Path Project** or **Machine Program**, show updated time and path, and reveal destructive actions with appropriate visual restraint.
- Latest import appears only when real session activity exists. It is a compact activity/diagnostic summary, not a container for settings or placeholder implementation copy.
- Empty, preparing, importing, filter-empty, and error states explain the next valid action in place.

### Unified settings

- One settings dialog owns all persistent environment configuration.
- Sections are **Storage** and **Machine & Output**.
- Storage preserves connection status, location details, warnings, temporary/cache/folder distinctions, and folder connection.
- Machine & Output preserves machine name, work envelope, header/footer, output extension/custom extension, and line ending.
- Save state and errors appear within the relevant section.

### Path Project workspace

- The application bar labels the context **Path Project** and identifies the source project/file.
- The default left workspace is expanded and shows the Contour Tree as the persistent geometry hierarchy.
- The default right workspace is expanded and shows Path Actions/active selection, making Undo, Redo, Save, Export Preview, order strategy, role, direction, start, lead-in, and construction actions reachable.
- The geometry canvas remains the dominant center surface.
- A document status bar shows modified/saved state, selection, operation/contour/segment counts, diagnostics, cursor position, and machine-fit state.
- Common panels receive direct shortcuts: Tree, Sequence, Transform, Diagnostics, Inspect, Measure, and Machine. The full categorized panel menu remains available for advanced layout control.
- Floating/docking behavior remains, but an understandable working layout exists before the user customizes anything.
- Export Preview remains an explicit, traceable post boundary and is visually framed as generated machine output, not another editor mode.

### Machine Program workspace

- The application bar labels the context **Machine Program** and shows the active file.
- Program Lines/Text are visible by default in a resizable right or bottom work area rather than behind a collapsed inspector.
- The canvas remains connected to hovered, selected, and pinned lines.
- Select/Edit, Undo/Redo, Save, Normalize, Export ISO, Start Here, move/delete, pin, and grouped-line controls retain their current behavior.
- Parse errors and warnings remain close to program statistics and affected lines.
- The empty state says which posted-program file types can be imported and does not resemble an empty Path Project.

## Interaction Rules

- Save, document type, dirty state, current selection, and export/post actions must not depend on opening a generic panel menu.
- Every unavailable action has an explicit disabled state; nearby context explains meaningful prerequisites.
- Errors and warnings stay next to their source when possible. Global toasts confirm cross-cutting actions but do not replace local feedback.
- Advanced layout customization remains discoverable without hiding the primary workflow.
- Existing keyboard behavior is preserved unless it conflicts with ordinary text editing. Form controls must retain standard copy behavior.
- Project delete remains confirmed. Rename remains non-destructive and does not alter file paths/provenance.
- Navigation away from a modified document prompts before discarding the draft.
- Importing another file while modified must not silently destroy work.

## Visual System

- Desktop-first target: 1440x900 and 1920x1080; usable minimum laptop target: 1024x720.
- Neutral graphite surfaces with subtle elevation, restrained cyan for active selection/actions, emerald for valid/ready, amber for warning/modified, and red only for errors/destructive risk.
- Geometry and machine-code content carry the strongest contrast. Surrounding chrome remains quiet.
- UI text uses the system sans stack; monospaced type is reserved for filenames, coordinates, code, counts, and machine values.
- Primary controls are 28-32px high. Icon-only controls require accessible names and tooltips.
- Corners remain square or minimally rounded. Grouping relies on alignment, spacing, section headers, and separators rather than nested cards.
- Default UI text does not go below 10px; primary labels and body copy target 11-13px.
- Scrollable work regions expose subtle scrollbars. The application must not globally hide all scrollbars.
- Selection, hover, focus-visible, disabled, dirty, warning, error, and processing states are defined consistently.

## Responsive and Overflow Behavior

- At 1024px and above, the standard three-region editor layout remains available with resizable side regions.
- Below the desktop breakpoint, side workspaces become tabbed drawers rather than disappearing.
- The Workbench start screen collapses from project-library plus start panel to a single scrollable column.
- Long filenames, project names, machine names, values, and warnings truncate only when a title or expandable region preserves the full value.
- No essential editor control may be reachable only through a desktop-hidden rail.

## Front-End Architecture

### Keep

- `useWorkbenchAppController` as the application/domain-service boundary.
- Domain import, parse, path editing, storage, save/load, machine fit, post, and export APIs.
- Preview geometry implementation and the behavior-rich path/program panels.
- Status toast system and shadcn-compatible primitive conventions.

### Refactor

- `AppShell` into explicit application bar, contextual workspace region, main content, settings, and global status bar.
- `DashboardPage` into a Workbench page composed from start actions, project library, and optional latest activity.
- `WorkbenchSettingsDialog` to own storage plus machine/output configuration.
- `EditorHeaderBar` to expose document type, title, persistent commands, and categorized workspace controls.
- `EditorPage` defaults and composition so Path Projects and Machine Programs open with useful, distinct layouts.
- Workspace panel menu to toggle reliably, expose common shortcuts, and remain an advanced layout tool.
- Shared form, badge, toolbar, status, and panel styling through focused primitives/CSS classes rather than repeated ad hoc strings.

### Constrain

- Do not rewrite parsers, path intelligence, file layout, posting, or machine calculations.
- Do not introduce a router solely for this redesign; the current two-view controller is sufficient.
- Do not add mock projects, fake machine connections, decorative charts, or controls without behavior.
- Do not remove docking/floating behavior, measurement features, guide highlighting, or either editor model.

## Data and State Flow

1. The controller initializes or reconnects storage and supplies the connected workbench to the shell.
2. Workbench start actions call the existing DXF or external-program import services.
3. A loaded editor program carries either `upid-document` or `gcode-text`; the workspace derives its explicit document context from that discriminant.
4. Editor-local draft state remains the source for dirty state, undo/redo, selections, measurements, and panel layout.
5. Save continues through the existing model-specific `EditorSaveDraft` boundary.
6. Settings continue through `UpdateWorkbenchSettingsInput` and refresh the connected workbench.
7. Generated output remains ephemeral until browser download; output extension does not alter program text.

## Error and Safety Handling

- Browser-cache fallback remains usable when optional folder connection fails.
- Storage warnings appear in Settings and the persistent status area without blocking work that remains safe.
- Import and save errors remain local to the triggering workspace and also enter notification history.
- Path diagnostics and machine-fit warnings remain visible near canvas/workspace state and in export preview.
- Machine Program parse issues remain line-aware.
- Dirty-navigation confirmation is a front-end guard only; it does not change persistence semantics.
- The redesign does not add new blocking safety gates to existing export behavior.

## Verification Plan

- Keep all existing Vitest domain and application contracts green.
- Add application tests for the two explicit start actions and their document contexts.
- Add settings tests proving storage and machine/output capabilities remain in one surface.
- Add editor tests proving Path Project defaults expose Contour Tree and Path Actions, while Machine Program defaults expose program controls.
- Add tests for persistent document-type labels, dirty/save state, status information, panel-menu toggling, and unsaved-navigation confirmation.
- Update Playwright layout assertions to the redesigned default layout while preserving functional panel, selection, transform, diagnostic, drag, measurement, and construction flows.
- Fix the two existing browser contract gaps for transform placement help and DXF source extents/base metadata.
- Run the entire Vitest suite, production build, full Chromium Playwright suite, and scripted screenshots at 1440x900 and 1024x720.
- Compare the final implementation against every item in the functionality inventory above.

## Success Criteria

- The Workbench entry points make the resulting document type predictable.
- Path Project and Machine Program contexts are unmistakable at a glance.
- Core work no longer begins with empty rails or a hunt through the Panels menu.
- Projects and active technical work receive more space than persistent configuration.
- Storage, machine, output, dirty, selection, validation, and warning state remain visible at the correct hierarchy.
- All existing functionality remains reachable and behaves as before.
- Unit tests, production build, and browser workflows pass.
- The final product reads as one coherent Wire EDM engineering workbench rather than a dashboard plus two historically similar editors.
