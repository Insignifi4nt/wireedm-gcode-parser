# Path-Intel Architecture Rationale

Date: 2026-05-31

This slice changes DXF import from an entity-order converter into a path planning pipeline.

The reason is not only cleaner G-code. The editor needs a geometry-first model that can survive
future workbench operations: reordering contours, reversing directions, moving start points,
splitting arcs, attaching user choices, validating machine bounds, and exporting through different
machine profiles. Plain G-code is too lossy to be that source of truth.

## Why This Shape

- DXF entity order is not manufacturing order. A CAD file can contain correct geometry in an
  arbitrary entity sequence, so import must reconstruct topology before emitting moves.
- Segments must be reversible. Lines, arcs, and circles need to be inspected, reversed, rotated
  inside closed contours, and eventually split by editor gestures without losing source identity.
- Source hierarchy matters. DXF geometry hidden inside BLOCK definitions is resolved through INSERT
  transforms before UPID planning, and segment source metadata keeps the block/insert lineage for
  later inspection, debugging, and edit provenance.
- Contours and posting are separate jobs. The planner should decide what belongs together and what
  cuts first; the G-code post should only turn the chosen operation plan into machine text.
- Repairs must be visible. Endpoint tolerance snaps and posted gap bridges are diagnostics, not
  silent edits, so the app can later show uncertain geometry to the user.
- Exact geometry should stay exact where possible. Arcs and circles remain first-class path
  segments until posting, instead of being flattened early.
- The internal plan is the future editor contract. G-code remains an output artifact, not the data
  structure the workbench has to edit.

## Why The Editor Is Path-First

Imported DXF projects now open as UPID/path plans, not as editable G-code programs. The editor can
still post the current UPID through the active machine profile, but that happens in an explicit
Export Preview. The normal editing surface stays focused on operation order, direction, start
choice, construction points, contour/segment inspection, and path diagnostics.

That distinction matters because header and footer templates belong to the active machine profile.
They are applied when the current UPID is posted or exported; they should not become visible working
geometry or something the user edits while choosing contours. Showing them in the path editor would
make machine setup look like part geometry and would pull the workflow back toward line-based G-code
surgery.

External `.gcode`, `.nc`, `.iso`, and `.txt` imports still use the line drawer and text editor
because those files are already posted programs. DXF-origin projects keep the richer source model as
their source of truth.

DXF-origin project storage now treats `project.upid.document` as the first-class persisted internal
path model. The editor reads and writes that UPID document directly instead of maintaining a parallel
generated G-code artifact.

Manual path edits are stored as operation-level UPID overrides. Reordering operations, correcting a
contour role, reversing a cut direction, or choosing a start point changes the executable plan and
records the user decision beside that operation. This keeps the automatic planner output, manual
edits, and future AI/user review surfaces from collapsing into an unexplained final sequence.

## Current Code Map

- `src/domain/path-intel/types.ts` defines the path document, segments, clusters, chains, contours,
  editor-facing path elements, operations, metrics, diagnostics, and manual operation overrides.
- `src/domain/dxf/parseDxf.ts` keeps the DXF import boundary geometry-bearing and resolves
  referenced BLOCK/INSERT geometry while preserving lineage metadata on parsed entities.
- `src/domain/path-intel/fromDxfEntities.ts` converts parsed DXF entities into the path document.
- `src/domain/path-intel/endpointClusters.ts` performs conservative endpoint clustering and records
  tolerance-based snaps.
- `src/domain/path-intel/chains.ts` builds continuous reversible chains from unordered segments.
- `src/domain/path-intel/contours.ts` classifies closed and open chains.
- `src/domain/path-intel/planOperations.ts` chooses operation order, contour starts, and direction.
- `src/domain/path-intel/pathElements.ts` assembles navigator-ready root/nested path elements from
  contours and operations without making UI code stitch the model together ad hoc.
- `src/domain/path-intel/postGcode.ts` emits body G-code from the operation plan.
- `src/domain/path-editor/pathDocumentOperations.ts` edits UPID operations for manual order, role,
  direction, start, split, and construction workflows while recording override metadata and keeping
  tool previews and saved construction snaps attached to UPID path element identity.
- `src/domain/upid/upidDocument.ts` names the current internal document as the Universal Path
  Intelligence Document boundary and exposes the post/export adapter.
- `src/domain/upid/projectUpid.ts` reads and writes first-class project UPID state.
- `src/domain/editor/loadEditorProgram.ts` and `src/domain/editor/saveEditorProgram.ts` keep UPID
  editor sessions parse-free; `parseResult` is only populated for posted external program editing.
- `src/features/editor/EditorPathNavigatorPanel.tsx` is the DXF path-project rail surface for
  operation selection, nested contour/segment inspection, ordering, direction, start selection,
  construction-point modes, hover assist, magnetic snap, saving, and opening export preview. It
  consumes UPID `pathElements` so holes, islands, exteriors, segments, and manual overrides render
  from the same root/nested path tree that the document persists.
- `src/features/editor/EditorInspectorPanel.tsx` uses the selected UPID path element for geometry,
  provenance, nesting, manual decision, segment, and point details.
- `src/domain/editor/previewGeometry.ts` carries UPID path element identity into canvas paths so
  canvas hover/selection can round-trip to the navigator and inspector without lossy lookup.
- `src/features/editor/EditorPage.tsx` keeps the UPID-to-G-code post adapter behind the open export
  preview boundary, so normal path editing does not compute hidden machine text.
- `src/features/editor/EditorUpidExportPreview.tsx` is the explicit post boundary for inspecting and
  downloading machine-profile G-code.
- `src/features/editor/EditorProgramLinesPanel.tsx` remains the posted-program surface for external
  G-code-style imports.

## What This Enables Next

- Add richer operation/feature inspectors without parsing G-code comments or line numbers.
- Add user locks for contour order, direction, role, and start point while preserving import
  provenance.
- Add lead-in/lead-out suggestions as path decisions before posting, not as manual text snippets.
- Keep machine profile templates attached to the final post/export boundary instead of baking
  machine assumptions into import.
- Keep future optimization modes modular: nearest travel, stability-first, manual order locks,
  profile-aware bounds, and eventually stronger search or learned route selection.
