# Integrated desktop CAD workbench

## Objective and baseline

Build a desktop parametric CAD workspace inside Wire EDM Workbench, with direct CAM handoff and agent parity. The isolated `feature/parametric-cad-workbench` checkout starts at stable `3e3fce9` (app 0.0.696); the concurrent optimization branch is independent. This is a continuing implementation, with reviewed checkpoints rather than a claim of CATIA feature completeness.

## Interaction decisions

Use a persistent specification tree, visible reference planes, a central model/sketch viewport, a focused property editor and compact chronological history. CATIA familiarity informs the Sketch → Pad/Pocket flow. Onshape informs exact feature IDs, dependency ordering and predictable feature selection. Fusion informs context-specific sketch/solid tools and discoverable downstream manufacturing. The design uses its own compact visual language rather than copying assets or branding.

Dimensions accept safe arithmetic over named parameters. Sketches contain dimensioned rectangle, circle, polygon and slot profiles, with explicit material boundaries, holes and construction geometry. Drawing gestures and agent batches call the same validated edits and undo history. Every operation has real behavior; unsupported capabilities have no decorative controls.

Reference material:

- [CATIA sketcher interaction](https://blog.3ds.com/brands/catia/catia-talk-3d-innovator-2-how-to-use-catia-xdesign-sketcher/).
- [Onshape feature and parts lists](https://cad.onshape.com/help/Content/PartStudio/features_and_parts_lists.htm), [sketch tools](https://cad.onshape.com/help/Content/Sketch/sketch_tools.htm), [extrude](https://cad.onshape.com/help/Content/PartStudio/extrude.htm).
- [Fusion workspaces](https://help.autodesk.com/cloudhelp/ENU/Fusion-GetStarted/files/GS-WORKSPACES.htm).
- [Replicad library integration](https://replicad.pages.dev/docs/use-as-a-library/), [source](https://github.com/sgenoud/replicad).

## Implementation boundaries

- Domain: serializable discriminated feature model; schema and geometric validation; no code evaluation; analytic sketch/CAM curves; bounded coordinates, profiles, history and instances.
- Kernel: pinned Replicad/OpenCascade B-rep worker; lazy initialization; cancellation terminates active work; bounded queue and periodic recycling; explicit disposal; exact STEP and triangulated STL export. Triangles are for display, not machining geometry.
- State: one external CAD session, atomic versioned edit batches and undo/redo; separate saved-file fingerprint for conflict detection. UI workflows block agent mutations while local inputs are incomplete.
- Storage: additive CAD files on both adapters, shared exact-image journal, no existing schema migration, full backup retention. A portable document import always creates a new identity.
- CAM: source CAD is saved, then a detached portable-UPID project is created through existing operations. CAM retains its own stock, threading, compensation, machine setup, post processor and immutable revisions. Handoff does not generate feeds or bypass machining checks.
- Rendering: demand-driven Three.js viewport; lazy UI/kernel bundles; no continuous animation loop for a static part.

## Verification and continuation

Tests cover analytic geometry, expressions, graph edits, measurements, true WASM solids, export structure, both storage adapters, cancellation, stale writes, undo, real UI drawing and native agent transport. Cross-boundary tests validate CAD-derived UPID with the ordinary portable reader; unit-only geometry success is insufficient.

Capabilities still requiring separate design and implementation include a general geometric constraint solver, arbitrary face-attached sketches, selective edge references, assemblies, imported B-rep feature reconstruction, surfacing and production drawings. Agent-focused continuation emphasizes reproducible typed documents, exact measurements, final-solid sections and stable semantic selection before adding broad toolbars.
