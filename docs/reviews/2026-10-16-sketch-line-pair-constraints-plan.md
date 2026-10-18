# Parallel and perpendicular sketch line constraints

Design investigation at `db1f805`, 2026-10-16. This note proposes one bounded slice. No production code, tests, native rebuild or new solver experiment was performed for this investigation.

## Contract and user behavior

Add two scalar-free relation variants to the existing graph union:

```ts
{ readonly id: string; readonly kind: 'parallel'; readonly lineIds: readonly [string, string] }
{ readonly id: string; readonly kind: 'perpendicular'; readonly lineIds: readonly [string, string] }
```

Each ID must resolve to a distinct graph line entity. Construction lines are valid operands. Shared endpoints and disjoint lines are valid; the relation changes orientation, never joins endpoints, extends finite segments, translates a chosen reference automatically, fixes length or changes construction status. Parallel accepts either direction and collinear supports. Perpendicular accepts either signed right angle. These choices describe the native equations and avoid inventing a branch or offset driver. Existing geometry/material checks still decide whether the resulting sketch supplies a usable boundary. Onshape documents selecting lines before applying either relation; Fusion also documents applying a constraint while editing a sketch. Our first UI keeps the existing selection-first panel rather than adding another tool state. [Onshape parallel](https://cad.onshape.com/help/Content/Sketch/parallel.htm), [Onshape perpendicular](https://cad.onshape.com/help/Content/Sketch/perpendicular.htm), [Fusion parallel](https://help.autodesk.com/cloudhelp/ENU/Fusion-Sketch/files/SKT-CONSTRAIN-PARALLEL.htm), [Fusion perpendicular](https://help.autodesk.com/cloudhelp/ENU/Fusion-Sketch/files/SKT-CONSTRAIN-PERPENDICULAR.htm).

Exactly two selected entity atoms, both actual lines, expose a Line pair section with Parallel and Perpendicular checkboxes. A selected point, circle, arc or third atom makes this section unavailable. Existing Shift selection, box selection, Edges filter and overlap choice already establish the exact IDs. Do not create a second selection state. New relations retain the accepted ordered selection, matching the existing point-pair editor. Accept either tuple order when reading source, without rewriting existing data. Reuse an existing matching relation independent of tuple order. An existing opposite relation disables adding its direct opposite until explicitly removed. Do not silently remove other relations or expression drivers. Unexpected conflicts or redundancy still go through normal preparation and structured feedback.

Humans and agents use the same existing edit, with one stable relation ID reused through preview and Apply:

```json
{"kind":"set-sketch-relation","sketchId":"outline","relation":{"id":"align","kind":"parallel","lineIds":["edgeA","edgeB"]}}
```

Removal remains `remove-sketch-relation`. No new tool, schema version, storage migration, history path, coordinate ownership rule or generated geometry is needed. Extend hosted feature/edit discovery and the public agent guide before exposing the UI.

## Native evidence

The installed exact `@salusoft89/planegcs@1.3.0` payload exports typed `parallel` and `perpendicular_ll` primitives, each with `l1_id` and `l2_id`. Its generated `GcsSystem` declaration includes both methods. The upstream pinned native classes implement a cross product for parallel and dot product for perpendicular, scaled by the reciprocal product of the line lengths when `rescale` runs. The generated binding calls `rescaleConstraint` only for a nondefault explicit scale. Use default scale, existing graph line primitives and relation ID as the diagnostic source tag. These are source/API facts, not new runtime success evidence. [Pinned npm metadata](https://registry.npmjs.org/@salusoft89/planegcs/1.3.0), [native constraint source, lines 1176–1334](https://github.com/Salusoft89/planegcs/blob/9d26baef0b240fe0eef4186d4e5e5e66ec3620b7/planegcs/Constraints.cpp#L1176), [native overloads](https://github.com/Salusoft89/planegcs/blob/9d26baef0b240fe0eef4186d4e5e5e66ec3620b7/planegcs/GCS.h#L296), [binding template](https://github.com/Salusoft89/planegcs/blob/9d26baef0b240fe0eef4186d4e5e5e66ec3620b7/build-bindings/templates/add_constraint_functions.cpp.njk). Local package evidence is `node_modules/@salusoft89/planegcs/planegcs_dist/constraints.ts:138` and `dist/planegcs_dist/gcs_system.d.ts`.

The current runtime can add two exhaustive switch cases directly. Every source numeric component remains a solver variable; every string remains an exact driver, including numeric strings and whitespace. Native conflict/redundant IDs retain the existing mapping. Success or Converged still requires independent graph acceptance. No use of native status alone, sampled geometry, JS correction, extra native parameter, changed native scale or solver tuning is proposed. The pinned source/binary provenance limits already recorded in `vendor/sketch-solver/planegcs-sources.json` remain unchanged.

## Independent numerical acceptance

This is a proposed product acceptance rule, not a tolerance claimed by upstream CAD vendors. Compute directions from the current numeric endpoint copies, independently of native cached constraint scale:

```text
a = A1 - A0; b = B1 - B0
La = hypot(a.x, a.y); Lb = hypot(b.x, b.y)
u = a / La; v = b / Lb
q = abs(u.x*v.y - u.y*v.x)              parallel
q = abs(u.x*v.x + u.y*v.y)              perpendicular
residualMm = q * max(La, Lb)
T = cadPathClosureTolerance([A0,A1,B0,B1])
accept only finite values, q <= 1e-12 and residualMm <= T
```

Require both line lengths to exceed the existing `1e-7` mm degeneracy threshold. Reject malformed or initially degenerate operands before constructing the native normalized equation; this does not require an unsolved relation to hold before solving. Repeat degeneracy and residual checks after solving. Normalize each direction separately before taking its cross/dot product. This avoids a raw squared-length residual and gives the diagnostic `residualMm` its actual unit. In exact arithmetic the result is invariant under endpoint reversal, swapping the lines and translating the sketch. IEEE endpoint subtraction can still lose direction information at distant origins; there is no coordinate transform or repair.

The maximum length enforces both possible endpoint deflections. Using the shorter length would permit the long line to miss alignment substantially. The additional dimensionless `1e-12` gate makes orientation precision explicit: it corresponds to at most `1e-12` mm transverse error on a unit-length direction, using the existing local 1 mm precision floor as the proposed reference. It tightens acceptance for tiny geometry and far origins. Do not derive a looser angular bound from world coordinates or native convergence settings. Do not reinterpret `residualMm` as an angle.

Examples that the pure checker must distinguish:

- A `1e-6` mm line and a `1e6` mm line with `q=1e-7` have a `0.1` mm long-line deflection. A short-line-only check would see merely `1e-13` mm. Reject.
- Two approximately micron-long lines near coordinate `1e9` can have world roundoff allowance larger than their lengths. A 1-degree error must still reject even if a world-mm-only check passes. The unit-direction gate prevents it.
- Exact represented horizontal/vertical directions pass at tiny valid lengths and far origins. An intended rotated right angle encoded in short far-origin endpoint differences may fail the unit-direction gate after rounding. Preserve source and safely reject; do not claim all intended real-valued angles are representable.
- Long lines can fail the world deflection test even when `q` passes the unit-direction gate. Both conditions are necessary.

This rule must be confirmed with the focused pinned-WASM cases before claiming a useful supported solve range. Native stopping criteria and initial rescaling can return approximate geometry, collapse a line or fail to converge. The final gate rejects all those unsafe results. If ordinary cases fail it, report their exact result and residual; do not relax the gate in this slice. Existing arc/corner safe rejects remain unchanged.

## Lean implementation seams

Use one narrow pure `resolveCadSketchLinePair(graph, lineIds)` helper, returning the two typed lines or a domain error for duplicate, missing or nonline operands. The parser invokes it for the new variants. Its topology checks accept unsolved numeric intent. A small line-relation checker may share its module if that keeps `cadSketchGraph.ts` focused; no general constraint framework is needed.

- `cadSketchGraph.ts`: strict union variants, structural resolver, independent line-relation residual dispatch. Continue accepting unsolved intent in the parser and rejecting bad residuals only at the existing complete acceptance boundaries.
- `cadSketchGraphReferences.ts`: new relations return both entity IDs; point references start with no synthetic `pointId`, collect both lines' endpoints and deduplicate shared joints. Scalar mapping returns the unchanged relation. This automatically supplies deletion dependencies, parameter traversal and inspection highlights.
- `cadSketchGraphEdits` tests: removing either referenced entity or any incident point requires explicit relation removal or cascade. Toggling construction retains the relation. No guessed substitute line after delete/reappend.
- `cadSketchSolverRuntime.ts`: emit `{id,type:'parallel'|'perpendicular_ll',l1_id,l2_id}` using the source relation ID; guard initial operand length before native normalization. Keep module lifecycle, cleanup and exact-source writeback unchanged.
- `cadSketchConstraintFeedback.ts` and `cadSketchConstraintInspection.ts`: exhaustive names/meanings; label rows as `Parallel relation N · Line A and Line B`, with exact line IDs and deduplicated endpoint IDs in structured actions. Do not present an angular scalar editor or show raw IDs to humans.
- Root owns RelationsPanel, Workbench/canvas consumers as needed, hosted discovery/docs and end-to-end proof. Reuse current prepared preview, Apply, Cancel and inspection ownership. The relation panel's current scalar-field traversal already uses the shared scalar visitor.

## Test-first sequence and stop conditions

1. Domain seam: parse valid disjoint/shared-joint construction pairs; reject same entity, dangling ID and arc/circle operands. Check reversed/swapped operands and the worked scale counterexamples above. Retain exact strings, graph/source immutability and current IDs. Test strict source parsing with unsolved coordinates separately from residual acceptance.
2. Real pinned runtime seam: a fixed horizontal reference plus free endpoint and distance driver solves a parallel line, then a perpendicular shared-vertex line. Verify independent checks, expected global DOF reduction of one when independent, construction support, expression-preserving parameter edit and an ordinary drag. Reverse source directions without requiring a specific positive/negative native branch.
3. Rejection seam: duplicate/opposite/fixed-incompatible relations retain exact source diagnostic IDs and accepted session geometry, parameters, version and history. Include tiny/large/disparate/far-origin candidates; accepted results must satisfy the two independent numerical checks, while safe rejects remain explicit. Use a small set of geometrically distinct cases, not a Cartesian matrix.
4. Human/API seam: select two real lines through existing multi-selection, preview/apply/remove via the same shared edit, inspect both exact line operands, Cancel and late result guards unchanged. One browser workflow can cover a construction operand and shared endpoint; existing selection tests cover the selection mechanisms themselves.

Only then expose the two line-pair controls and report verified limits. Tangency, equal length, angular dimensions, multi-line batches, relation-driven endpoint joining and arrangement integration are separate work.

## Implemented checkpoint

The declared variants, pure line helper, parser/reference traversal, native compilation, independent acceptance, structured feedback and paged inspection are implemented. Humans use the existing two-line selection editor, shared controls and prepared Apply/Cancel operation. Exact accepted IDs and tuple order survive removal/re-enable. Source definitions, construction flags, expression strings and unrelated relations remain authoritative. TypeScript caught the initial mapped TypeBox variant combining both discriminants; explicit variant objects restored exhaustive narrowing before the final build.

The ignored pinned-WASM report `tmp/sketch-line-pair-trial/report.json` covers 14 distinct fixtures. Ten ordinary/shared/reversed/translated/tiny cases return native Success, with normalized errors approximately `5.55e-17` to `1.11e-16` and maximum orientation world residual `1.78e-15 mm`. A translated distance residual `3.02e-11 mm` remains within its existing `1.78e-9 mm` world roundoff. Four extreme disparate-length or far-origin tiny cases return native Failed and remain rejected. The independent checker also rejects far-origin angular errors which the world-distance gate alone would permit. No convergence tuning, coordinate repair or tolerance relaxation was introduced.

Focused verification passes 117 cases in 15 domain/native/boundary suites, `tmp/sketch-line-pair-trial/focused-tests.log`. The related human/tool group passes 144 cases, `tmp/sketch-line-pair-ui-related.log`, with overlap. Full production build, shared UI, hosted docs/discovery, source distributions and icon integration pass. Root production and native browser acceptance, including exact original restoration, are recorded in the [independent review](2026-10-16-sketch-line-pair-constraints-review.md). Existing strict nonlinear distance/arc safe rejects remain explicit; this slice does not change them. No remote action or installed package/post change.
