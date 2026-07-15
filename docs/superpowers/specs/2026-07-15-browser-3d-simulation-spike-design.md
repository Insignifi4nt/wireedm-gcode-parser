# Browser 3D Simulation Spike Design

## Objective

Build a convincing, smooth, client-only Wire EDM simulation spike for path projects. The first milestone is geometrically faithful rather than physically predictive: it visualizes stock placement, material thickness, exact posted wire motion, operation sequencing, entry/rapid/cut states, and machine-relative context without claiming erosion-rate or machining-time accuracy.

## Scope

- Add a standalone full-screen simulation workspace launched from a path project on the Dashboard.
- Keep the editor workflow composition untouched so the spike can rebase after the ongoing editor task.
- Persist project stock/setup values in `project.json`.
- Persist reusable machine visualization values in `workbench.json`, keyed by configured machine-profile ID.
- Compile a deterministic simulation timeline from the project UPID document and its exact machine post result.
- Render a polished stock plate, work envelope, guides, vertical wire, completed path, active path, operation list, technical readout, camera controls, scrubber, playback speed, and play/pause/reset controls.
- Support browser cache, directory, and memory adapters through the existing storage abstraction.

## Non-goals

- Predictive cutting time, erosion rate, wire lag, flushing, thermal effects, taper, U/V motion, or collision certification.
- Real-time destructive CSG against the stock on every frame.
- External G-code project simulation in this spike.
- Changes to `EditorPage`, workflow routing, editor workflow panels, Program Lines, or the editor control ledger.

## Data Ownership

### Per-project setup

`WorkbenchProject.simulation` is optional for backward compatibility and normalized when opened. It contains schema version 1, a simulation machine-profile ID, stock dimensions, stock XY origin, top Z, material label, entry-hole diameter, and the most recently used playback speed.

The simulation machine is explicitly a visualization/setup selection. If it differs from the project's post machine snapshot, the UI labels the mismatch; it never silently changes export behavior.

### Reusable machine visualization settings

`WorkbenchManifest.simulation` is optional and normalized on connect. It contains rendering quality and a map keyed by machine-profile ID with upper/lower guide Z, tank depth, default wire diameter, and fixture clearance. Keeping these values outside `MachineProfile` avoids invalidating verified controller fingerprints or changing the portable machine-profile schema.

## Simulation Pipeline

1. Read the project and validate its UPID path document.
2. Compose the existing exact machine post result.
3. Convert posted moves into typed timeline segments with stable operation, segment, reason, command, and program-line traceability.
4. Sample line and arc/circle geometry by arc length into renderer-ready XY points.
5. Assign visual duration from geometric distance and move kind only. This duration is explicitly labeled “visual playback,” not machining time.
6. Drive animation by a normalized timeline cursor. React stores only user-facing controls; Three.js objects update through refs during playback.

## Browser Rendering

Use React Three Fiber 9 with Three.js WebGL. The scene uses one continuous render loop only while playback or camera interaction is active, adaptive device-pixel ratio, memoized buffer geometry, and no per-frame React state updates for wire coordinates.

The first-shot material-removal treatment is a progressive kerf/groove and completed-contour emphasis over a physically shaded stock plate. This remains smooth and honest. A later milestone can replace the stock renderer with operation-level precomputed removal meshes without changing the timeline API.

## UI Structure

- Full-screen dark technical workspace with a large 3D viewport.
- Left setup rail: project, simulation machine, stock width/length/thickness, XY origin, top Z, material, entry hole, and save.
- Right technical rail: current state, operation, command, program line, XY position, traveled length, progress, and operation sequence.
- Bottom transport: reset, play/pause, scrubber, visual speed, camera preset, fit view, grid/tank toggles.
- The scene defaults to a readable isometric view and provides top/front/right presets plus orbit controls.

## Error Handling

- Non-path projects do not show the Simulate action.
- Blocked or invalid posts render a clear blocking panel instead of guessing motion.
- Missing legacy settings synthesize safe defaults from path bounds, project machine work area, and stock thickness.
- Invalid numeric edits remain local and cannot be persisted.
- Storage failures keep the workspace open and show the error next to Save.

## Testing

- Pure unit tests cover defaults, validation, migration, storage persistence, line/arc sampling, stable event traceability, accumulated length, and cursor interpolation.
- Component tests cover controls, project loading, blocked state, and save behavior without asserting WebGL pixels.
- Production build verifies React/Three.js typing and bundling.
- A headed browser smoke check verifies the real scene, playback, scrubbing, orbiting, resizing, and absence of console errors.

