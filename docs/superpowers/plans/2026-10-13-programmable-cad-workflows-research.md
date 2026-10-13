# Reproducible agent CAD workflows

Primary-source review, 2026-10-13. This note informs local implementation; it is not a public setup procedure.

OpenSCAD's published manual describes repeated parameter overrides and generation of geometry from one textual model. The useful pattern is one model definition plus an explicit set of input values, rather than repeatedly drawing nearly identical parts. The manual page contains historical CLI versions, so it does not establish current command availability. [OpenSCAD parameter overrides](https://files.openscad.org/documentation/manual/Using_OpenSCAD_in_a_command_line_environment.html).

CadQuery's gateway separates parsing, parameter discovery and building. Parameter overrides are checked against declared inputs, and the build reports success, outputs and exceptions. Its shape API exposes area, volume and bounding boxes. These support a reproducible loop of load, change parameters, build and inspect measured geometry. [CadQuery gateway](https://cadquery.readthedocs.io/en/stable/cqgi.html), [CadQuery shape API](https://cadquery.readthedocs.io/en/latest/classreference.html).

build123d documents shape area, volume and bounding-box queries, with selectors that can filter or sort measured topology. Measurement is useful feedback for automated model edits and can be independent of a GUI mesh. [build123d direct API](https://build123d.readthedocs.io/en/stable/direct_api_reference.html), [build123d selectors](https://build123d.readthedocs.io/en/stable/selectors.html).

Zoo presents KCL as reviewable text with named dimensions, formulas and reusable modules. KCL numeric values carry length or angle units; its documentation says higher-dimensional area and volume calculations need all lengths converted before arithmetic. Zoo also exposes bounding-box, volume and surface-area inspection operations. [KCL overview](https://zoo.dev/docs/kcl), [numeric units](https://zoo.dev/docs/kcl-lang/numeric), [inspection commands](https://zoo.dev/docs/developer-tools/cli/manual/zoo_kcl).

## Implementation decisions

These are inferences from the documented workflows, not claims that Wire EDM runs those languages.

- Keep the existing typed declarative CAD document as the source of truth. It already has named numeric parameters, bounded arithmetic expressions and ordered feature history.
- Share a complete-document import operation between the hosted file UI and agent tools. Validate the entire document before replacing the draft, assign a fresh document identity, preserve feature IDs and expressions, and require the current input version. Import creates an unsaved draft; Save remains explicit.
- Measure sketches analytically. Rounded rectangles and slots retain circular formulas, circles retain exact area/perimeter, and polygons use translated coordinate differences to avoid cancellation at large origins. Use explicit `Mm`, `Mm2` and `Mm3` field names.
- Exclude construction geometry from material area, cut boundary length and cut bounds. Nested profiles alternate material and hole roles. Keep per-profile measurements available through pagination.
- Keep solid measurements attached to the exact OpenCascade build. A sketch measurement does not claim to measure a projection or cross-section of a final solid.
- Continue the parameter variation loop through the existing atomic edit, measured inspection, build, save and export operations. No arbitrary code execution or additional server dependency is needed for this scope.

Implemented contracts are `importDocumentValue(value, expectedVersion, signal)`, `cad_import_document`, `measureCadSketch(document, sketchId)` and `cad_measure_sketch`. Sketch measurements return local coordinates, plane and evaluated offset, material area, cut perimeter, exact bounds and per-profile results. Tests cover parameter propagation, nested material islands, construction exclusion, rotated capsule bounds, large-origin polygon integration, fresh import identities, stale calls, cancellation and preservation of unsaved drafts.

## Independent numerical review

Real OpenCascade tests cover clockwise polygon winding, negative pad distances, offsets and local revolve axes on all three planes, reflected circular sections, self-overlapping revolution rejection and explicit diagnostics below kernel precision. Whole turns are removed before slot and transform rotations, so a billion degrees produces the same geometry as 280 degrees. Saved expressions retain their original text.

Section extraction uses machine angular roundoff to distinguish circular sweeps, rather than comparing radians against a millimetre tolerance. An extreme-radius circle with a narrow rectangular notch exposes a native OCCT limit: its section can return a complete circle plus disconnected notch edges. The closure guard refuses that ambiguous handoff; it must not silently fill the opening. This regression uses direct BRep construction, avoiding expensive large-radius preview tessellation.

Accepted document semantics are checked against a detached own-data snapshot before freezing, so inherited fields cannot disappear after validation. Worker preview replies validate vertex tuples, normal counts, integral triangle indices within their vertex buffer, edge tuple counts, positive volume and ordered bounds. Sparse arrays and duplicate body IDs are rejected. The retained preview cache is limited to eight million numeric values across all current bodies; operations that exceed it keep the preceding valid preview and report a mesh limit. The worker's finite queue, cancellation termination, deadline and periodic worker replacement remain separate limits.
