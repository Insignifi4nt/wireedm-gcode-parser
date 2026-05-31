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
- Contours and posting are separate jobs. The planner should decide what belongs together and what
  cuts first; the G-code post should only turn the chosen operation plan into machine text.
- Repairs must be visible. Endpoint tolerance snaps and posted gap bridges are diagnostics, not
  silent edits, so the app can later show uncertain geometry to the user.
- Exact geometry should stay exact where possible. Arcs and circles remain first-class path
  segments until posting, instead of being flattened early.
- The internal plan is the future editor contract. G-code remains an output artifact, not the data
  structure the workbench has to edit.

## Why The Editor Is Path-First

Imported DXF projects now open as path plans, not as editable G-code programs. The editor can still
show a posted body preview because users need to inspect the eventual machine motion, but the
editable decisions are operation order, direction, start choice, construction points, and path
diagnostics.

That distinction matters because header and footer templates belong to the active machine profile.
They are applied when the current path plan is posted or exported; they should not become visible
working geometry or something the user edits while choosing contours. Showing them in the path editor
would make machine setup look like part geometry and would pull the workflow back toward line-based
G-code surgery.

Legacy external `.gcode`, `.nc`, `.iso`, and `.txt` imports still use the line drawer and text editor
because those files are already posted programs. DXF-origin projects keep the richer source model as
long as the path document is present.

## Current Code Map

- `src/domain/path-intel/types.ts` defines the path document, segments, clusters, chains, contours,
  operations, metrics, and diagnostics.
- `src/domain/path-intel/fromDxfEntities.ts` converts parsed DXF entities into the path document.
- `src/domain/path-intel/endpointClusters.ts` performs conservative endpoint clustering and records
  tolerance-based snaps.
- `src/domain/path-intel/chains.ts` builds continuous reversible chains from unordered segments.
- `src/domain/path-intel/contours.ts` classifies closed and open chains.
- `src/domain/path-intel/planOperations.ts` chooses operation order, contour starts, and direction.
- `src/domain/path-intel/postGcode.ts` emits body G-code from the operation plan.
- `src/domain/dxf/dxfToGcode.ts` keeps the existing DXF-to-G-code API while routing it through
  path-intel.
- `src/features/editor/EditorPathPlanPanel.tsx` is the DXF path-project surface for operation
  selection, ordering, direction, start selection, construction-point modes, saving, and posted body
  inspection.
- `src/features/editor/EditorProgramLinesPanel.tsx` remains the legacy posted-program surface for
  external G-code-style imports.

## What This Enables Next

- Add richer operation/feature inspectors without parsing G-code comments or line numbers.
- Add user locks for contour order, direction, role, and start point while preserving import
  provenance.
- Add lead-in/lead-out suggestions as path decisions before posting, not as manual text snippets.
- Keep machine profile templates attached to the final post/export boundary instead of baking
  machine assumptions into import.
- Keep future optimization modes modular: nearest travel, stability-first, manual order locks,
  profile-aware bounds, and eventually stronger search or learned route selection.
