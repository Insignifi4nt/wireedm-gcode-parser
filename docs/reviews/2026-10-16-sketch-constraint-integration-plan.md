# Sketch constraint integration plan

Source review of the [decision draft](2026-10-16-sketch-constraint-design.md), current CAD document/parser, edits/session, forms, preview coordinator and path utilities. This is a proposed implementation plan, not an implemented solver or full-sketch completion claim. Solver capabilities and trial limits remain those in the [existing research](2026-10-16-sketch-solver-options.md).

## Choose a graph for new sketch geometry

| Choice | Benefit | Fundamental cost |
| --- | --- | --- |
| IDs alongside ordered legacy coordinates | Small change for current polygon/path grips; existing exact consumers survive. | Parallel arrays cannot represent general open/branched entities. Line joints duplicate coordinates, arc endpoints are derived, and current reorder/delete fields do not transport IDs. Same-length reorder can silently attach a relation to another intended point. This is an adapter strategy, not the final model. |
| Explicit sketch entity graph | Stable points/entities, open geometry, selection sets and topology edits have one owner. Closed material becomes a derived view. | Requires an exact material compiler and deliberate legacy adaptation. Flattening every primitive immediately would lose expression/dimension semantics and create unnecessary migrations. |

Recommend **graph-first for newly authored entities**, with legacy profiles as implicit parameterized groups in the same logical sketch compilation. Keep the stored legacy `profiles` unchanged until an explicit promotion. Graph geometry owns only newly created/promoted entities; never retain both authoritative legacy coordinates and graph coordinates for the same object. A compiled graph, solver arrays and derived material paths are disposable immutable views, not additional saved geometry.

Minimal graph source:

- Sketch-local points own stable IDs and XY `CadScalar` coordinates. Lines reference endpoint IDs. Arcs reference center/start/end point IDs and authored traversal direction; equal endpoint radii are an implicit structural relation. Do not also persist independent arc endpoint coordinates, radius and start/end angles as competing owners. Circles reference a center and own a radius scalar; full circles are distinct from endpoint arcs.
- Keep rectangle/circle/slot groups parameterized, including existing dimension intent and original scalars. Their intrinsic references use group ID plus semantic names. The compiler expands their structural geometry transiently. Generated plugin edges remain ineligible for persistent geometric references until their identity contract exists.
- Polygon/line-path promotion supplies an explicit old-to-new identity map. Arc promotion also needs an exact expression/driver mapping to the graph representation. Reject unsupported promotion rather than evaluating formulas into anonymous numbers. Preserve original source lineage. Do not merge approximately equal endpoints or infer coincidence from proximity.
- Typed point/entity references, relation IDs and ownership are unique within the sketch. Coincidence relates distinct points; merging points is a separate topology command. Split creates new edge identities; delete/trim explicitly report or cascade affected relations. Undo restores IDs. Never reuse a deleted ID or reconstruct one from coordinates, an array index or a solver handle.

Relations belong to the sketch, use discriminated operand types and carry `CadScalar` driving values where needed. Begin with coincidence, horizontal/vertical, fixed point/axis and point coordinate/distance. Add radius/angle/tangency only with their real mapping and residual checks. Extend parameter scanning, rename, usage inspection and dependency invalidation to relation values and graph scalars. Preserve both per-axis expressions and explicit primitive dimensions as hard drivers; structural rules cannot be deleted as user relations.

## Reuse exact geometry without pretending a face extractor exists

Use `cadAnalyticSegments`, `path-intel/segments.ts`, `intersections.ts`, `pathContainment.ts` and its spatial index for analytic supports, intersections, area, containment and bounds. Feed derived closed paths into the existing CAD material/measurement/native interfaces through one `compileCadSketchGeometry` module. Open entities are valid sketch data and remain selectable/saveable; only derived closed, nonconstruction cells produce material. Update existing `.profiles.some(...)` material gates accordingly. Keep the existing open `Curve` feature as its own sweep reference.

Separate graph validity from material eligibility. Do not run the current closed-profile validator on every open entity. Under today's strict accepted-document policy, opening a boundary already consumed by a Pad needs an owned sketch transaction that is closed again before Apply, or a batch that also suppresses/repairs the consumer. Persisting failed downstream features would be a separate deliberate behavior change, not an accidental relaxation during solver integration.

`buildChains` diagnoses degree-greater-than-two branches; it is not a planar arrangement. The DXF front door also sanitizes duplicates, clusters/heals endpoints and assigns ordinal IDs. Do not route authoritative sketch topology through those policies. Current `prepareCadSketchCells` handles a nesting forest of already-disjoint closed profiles, not intersecting entities.

First compile identity-connected degree-two cycles and leave open components intact. Full intersecting/branched-cell support needs a shared noding/half-edge face extraction increment using the existing exact math. No suitable general face extractor was found in this source review. Treat uncertain intersections/overlaps explicitly. Derived region references use oriented source-edge cycles and nesting signatures; ordinal `contour_0001` IDs are not persistent identity. Preserve existing profile-based selectors for legacy groups and reject changed topology rather than selecting a nearby face. Full sketch acceptance must include this later increment, not label simple-cycle support complete.

## One asynchronous edit preparation seam

Choose an awaited controller interface for every UI/agent edit, with an internal no-solver fast path. A synchronously running solve after asynchronous lazy initialization cannot preserve the current synchronous callback contract. Preloading would only hide initialization latency and would still block pointer input. Use one lazy PlaneGCS worker/compiler, not separate human, agent and preview solvers.

Proposed flow:

1. `cad.edit(edits, expectedVersion, signal)` pins accepted document/version, adapter identity and an internal workflow-owner lease. Agents receive no lease and cannot edit through an active human form. A scope string such as `editor` alone cannot distinguish two form instances.
2. Split `cadOperations.ts` into internal intent reduction and final acceptance. Validate portable data, schema shape, IDs, ownership and command structure first. Do not call full geometric validation before solving. Parameter changes can temporarily violate joint closure or relations. Existing geometry-dependent grip helpers also need a relation-aware intent path; moving only the final `parseCadDocument` call is insufficient.
3. Compile affected sketches, evaluate expressions with the app evaluator, and solve copied numeric data. Initially solve every relation-bearing sketch on parameter changes, including suppressed sketches validated by the parser. Keep edit ordering: later geometric commands must read preceding staged results, solving inside the candidate when necessary. Do not coalesce ordered grip deltas against stale accepted coordinates.
4. Preserve exact driver strings on write-back; write only free numeric components. Independently check relation residuals, structural rules, finite values, arc traversal/branch and exact encoding precision. Then run complete document validation, including material selectors and downstream placement/feature checks. A valid numerical solve alone is insufficient.
5. Recheck cancellation, document/version, adapter, owner lease and input generation. Commit the prepared, validated document once through an internal `CadSession.commitPrepared` seam sharing existing history/text deduplication. Never call `replace` to commit an edit, and never replay the edits after solving. Failure/cancellation changes no accepted version, history or saved baseline. Undo/redo restore validated snapshots without solving again.

`parseCadDocument` remains synchronous and nonrepairing. On load/import it validates references, drivers and supported relation residuals; it neither initializes WASM nor silently solves/reformats originals. Worker results are untrusted numeric results until the application reconstructs and validates them. Diagnosis is ephemeral and keyed to the exact candidate; DOF may be unknown and is not saved as truth.

For drag preview, coalesce latest requests per owner and retain the last valid candidate separately from accepted geometry/history. Pointer release commits only the exact current accepted-version/input-generation candidate. Cancel, owner changes and stale results discard it. A synchronous WASM call cannot process a queued cancel message mid-solve; invalidate its result, and terminate/recreate the worker for a measured hard deadline. Free all native systems/vectors. Save/export/capture cannot consume a pending or stale candidate.

## Required caller changes before exposing relations

| Existing seam | Required change |
| --- | --- |
| `CadSession.edit`, `useCadController.edit` | Keep synchronous acceptance/history internally; expose awaited preparation and close every relation-bearing bypass. Do not add `skipValidation`. |
| `App.tsx` edit props, `CadWorkbench` apply/add/delete/grip callbacks | Return and await the actual promise. Keep owning workflow active until successful acceptance; remove pending-release-before-commit patterns from the async path. |
| Feature/profile forms, parameters panel, dimension controls | `onApply`/`onEditMany` must return promises. Preserve raw fields, error and ownership on failure; close/reset only after success. Cancel invalidates the in-flight input generation. |
| `CadSketchDimensionControls` candidate memo | Replace eager `applyCadEdits` as a validity gate with syntax/driver checks plus guarded asynchronous preparation. An unsolved closure failure cannot disable an otherwise solvable Apply. |
| `cadFeaturePreview` and canvas preview | Reuse edit preparation before native build/display. Keep preview out of session and accepted kernel cache; do not maintain another solver model. |
| `cad_edit_document` | Await `cad.edit` before returning context; otherwise agents receive the old version or false success. Discovery, inspection and rejection use the same source identities and coordinator. |

## Implementation order and proof

1. Introduce graph/reference/relation types and nonrepairing validation, plus the legacy compiler. Test real open geometry, stable identity through reorder/split/delete/Undo and legacy scalar preservation before adding controls. Decide explicit forward schema/compatibility handling before persistence; older strict parsers reject new fields. Preserve exact originals and cover both storage adapters for any upgrade.
2. Extract staged reduction and single-commit acceptance. Convert callback chains to awaited success/failure with owned cancellation, initially using the unchanged legacy fast path. One failing parameter/dimension form must retain its text and history; an agent must await the resulting version.
3. Connect one pinned PlaneGCS worker through preparation. Exercise parameter-driven closure repair, conflicting relations, mixed-axis expression preservation, stale/cancelled results, one Undo and no-op deduplication. Measure browser initialization, drag backlog, repeated allocation and failure recovery; retain the existing source/distribution obligations.
4. Add graph drawing/selection/relation workflows and closed-cell extraction through the same operations. Finish with actual open-to-closed editing, trim/split identity, constrained dragging, save/reopen, dependent solids and verified export. These are acceptance work, not optional polish after a closed-profile-only solver demo.

No production source, dependencies, saved records or tests were changed or run for this investigation. The plan deliberately revises the draft's parallel-array direction while retaining its expression, ownership, cancellation and single-solver requirements.
