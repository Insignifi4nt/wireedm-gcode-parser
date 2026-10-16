# Selected graph corner fillet and chamfer

Date: 2026-10-16. Status: design proposal from source inspection, official references and the bounded temporary WASM trial below. No production source or test changes.

## Recommended first slice

Support one explicitly selected shared line vertex, with a fillet radius or two chamfer setbacks measured along the incident lines. Retain the old vertex as a virtual sharp and preserve every existing scalar and point relation. Create exact trim points and an analytic arc or straight chamfer. Keep structural equations and branch/extent checks in a small persisted corner relation so later parameter edits retain the intended construction.

Start with two identity-connected, nonconstruction lines and an unambiguous noncollinear corner. Reject mixed line/arc corners, extended intersections, parallel-line fillets, branch junctions, coincident-but-distinct vertices and uncertain numerical configurations. These are deliberate support limits. No arrangement integration or sampled curves are required.

Onshape accepts a point or two sketch curves and retains a virtual sharp as reference geometry with the old coincident constraints. Fusion likewise accepts a vertex or curve pair; its broader fillet support includes arcs and parallel lines. Fusion distinguishes equal-distance, two-distance and distance/angle chamfers. This proposal implements a bounded subset of those interactions. [Onshape sketch fillet](https://cad.onshape.com/help/Content/Sketch/sketch_fillet.htm), [Fusion modification tools](https://help.autodesk.com/cloudhelp/ENU/Fusion-Sketch/files/SKT-SKETCH-MODIFY-TOOLS.htm), [Fusion chamfers](https://help.autodesk.com/cloudhelp/ENU/Fusion-Sketch/files/SKT-ADD-CHAMFERS.htm).

## What is missing today

The legacy sketch Fillet edits a rectangle's single `cornerRadius`, rounding all four corners. The sketch toolbar and profile panel correctly restrict it to that profile representation. Graph entities currently have point/edge selection and point-based coincident, H/V, fixed and distance relations, but no general collinearity or perpendicularity relation. The solver deliberately represents an arc by equal-radius spokes rather than a native angular arc. A new corner operation must respect that ownership. [Legacy panel](../../src/features/cad/CadSketchProfilePanel.tsx), [corner command](../../src/features/cad/CadEdgeTreatmentCommand.tsx), [graph model/checker](../../src/domain/cad/cadSketchGraph.ts), [runtime](../../src/features/cad/sketch-solver/cadSketchSolverRuntime.ts).

Current graph selection contains one point or entity. A selected point can therefore be the first supported entry without adding multiselect. A lone edge identifies two possible corners and cannot silently stand for either one. The graph pick layer already gives points priority and owns pointer/cancel/version behavior. Reuse it. [Interaction preparation](../../src/features/cad/cadSketchGraphInteraction.ts), [graph layer](../../src/features/cad/CadSketchGraphLayer.tsx).

## Topology and driver ownership

Call the old corner `V`, and the other endpoints of its incident lines `A` and `B`. Retain `V`, `A`, `B`, all their exact scalar strings and all old relations. Retain the two line entity IDs, replacing only their references to `V` with fresh trim points `P` and `Q`. A fillet adds fresh center `C` and arc `F` sharing `P/Q`; a chamfer adds line `H` sharing `P/Q`. Do not merge coordinates, discard old constraints, rewrite an expression into its evaluated number or freeze the new points in place.

This keeps a dimension between `A` and `V` attached to the same nominal support, rather than retargeting it to a shorter trimmed edge. The UI should identify `V` as a retained reference corner. Its role can derive from the corner relation; points do not need a second coordinate owner or a new saved profile group. New radius/setback values retain their supplied `CadScalar` text. Evaluate them only to create the numeric seed and native driver values. Existing dimensions remain point-based. [Point relation ownership](../../src/domain/cad/cadSketchGraph.ts), [scalar preservation in preparation](../../src/features/cad/cadEditPreparation.ts).

Adding `F/H` intentionally changes the material contour signature. Existing explicit region references must reject and require deliberate reselection. Radius edits with unchanged boundary IDs should preserve that contour identity. Do not erase a consumer's explicit selection to make the edit pass. [Region identity checks](../../src/domain/cad/cadSketchRegionSelection.ts).

## Smallest robust source/API contract

Add a pure domain builder, provisionally `createCadSketchCornerTreatment({ graph, parameters, pointId, treatment, createId })`, returning a new parsed graph and the new treatment/entity IDs for selection. `treatment` is a discriminated union of fillet radius and two chamfer setbacks. Require exactly two eligible incident lines. Canonically order them by ID for a point-selected corner and label/highlight the two chamfer sides accordingly. Reordering source arrays must not change the target or side assignment.

The builder can use the existing same-sketch `update-feature` and shared prepared-edit callback. A new WebMCP tool, solver client or history path is unnecessary. Generate IDs once per owned command candidate, not on every hover/preview. Agents can submit the resulting complete graph through the existing atomic edit API.

Persist one narrow relation per treatment, for example:

```ts
// Common relation id omitted here.
{ kind: 'fillet-corner', pointId: V, lineIds: [L1, L2], arcId: F, value: radius }
{ kind: 'chamfer-corner', pointId: V, lineIds: [L1, L2], chamferId: H, values: [d1, d2] }
```

These records own driver values and the intended topology/branch. Derive `P/Q` from the unique endpoints shared by the two trimmed lines and `F/H`, and `A/B` from their other endpoints. Validate exact entity kinds, endpoint membership, distinct IDs and the retained vertex. This avoids redundant endpoint-coordinate or endpoint-ID records. No generic feature framework is needed.

An alternative is new generic collinear/perpendicular relations plus ordinary distances. Those are enough equations, but do not retain the finite-edge and intended-sector conditions after a later parameter edit. Persisting only those equations is insufficient for a robust corner tool. The corner record is the recommended first increment; generic constraint authoring can reuse the same native equations later.

## Exact geometry and structural solve

For `u = (A−V)/|A−V|`, `v = (B−V)/|B−V|`, let `theta = atan2(|cross(u,v)|, dot(u,v))`. Reject collinear or numerically uncertain rays. For fillet radius `r`, seed `d = r / tan(theta/2)`, `P = V + d*u`, `Q = V + d*v`, and `C = V + normalize(u+v) * r/sin(theta/2)`. Choose the minor arc from `P` to `Q` inside that corner's wedge. The ordered rays determine its direction; reverse both arc endpoint order and direction when reversing the representation.

For chamfer setbacks `d1/d2`, seed `P = V + d1*u`, `Q = V + d2*v`, then add exact line `P→Q`. Require positive dimensions and a strictly positive surviving segment on each side. Do not clamp to fit, extend the other lines or accept a zero-length remnant. Use the existing primitive limits and world roundoff policy rather than a fixed angular snap threshold.

The native package already supplies the needed equations. Its inspected 1.3.0 declarations expose `point_on_line_ppp`, `perpendicular_pppp` and `p2p_distance`; the pinned native header declares the corresponding operations. There is no need to adopt native arc angles or `tangent_la`. [Published constraint declarations](https://unpkg.com/@salusoft89/planegcs@1.3.0/planegcs_dist/constraints.ts), [pinned native API](https://github.com/Salusoft89/planegcs/blob/9d26baef0b240fe0eef4186d4e5e5e66ec3620b7/planegcs/GCS.h). The declarations were inspected in the installed pinned package; this browser fetch could not retrieve their URL.

| Treatment | Native equations in addition to retained source constraints |
| --- | --- |
| Fillet | Two point-on-line equations keep `V` on supports `AP/BQ`; two perpendicular equations enforce `CP ⟂ AP` and `CQ ⟂ BQ`; one point distance drives `|CP| = r`. The existing arc structural equal-radius equation supplies `|CP| = |CQ|` once. Six new point coordinates receive six equations. |
| Chamfer | Two support collinearity equations and distances `|VP| = d1`, `|VQ| = d2`. Four new point coordinates receive four equations. |

Map each generated native constraint ID back to its corner relation ID. Keep existing structural arc diagnostics mapped to the arc entity. Initial DOF should match the original sketch's DOF; do not add coordinate fixes to make tests pass.

Compilation validates referenced topology without demanding that the input coordinates already satisfy a newly changed radius or setback. Those are unsolved intents. Run world residual and branch acceptance after solving, as the existing preparation pipeline does.

The independent graph checker must verify these relations on every acceptance, including ordinary parameter edits and point drags. Check support distance, tangent residual in millimetres, radius/setbacks, strict ray order `V→P→A` and `V→Q→B`, surviving finite segments, and the arc's intended minor branch. The generic equality equations admit external solutions, so native Success/Converged alone is insufficient. Keep `cadPathClosureTolerance` and exact cycle/native encoding checks unchanged. Existing oblique-arc safe rejections remain a real limitation until tested with this representation. [Graph checks](../../src/domain/cad/cadSketchGraph.ts), [cycle encoding](../../src/domain/cad/cadSketchGraphGeometry.ts), [solver evidence and rejected conditioning trials](2026-10-16-sketch-solver-options.md).

## Integration seams and guards

| Seam | Necessary bounded change |
| --- | --- |
| New corner domain module | Resolve exact eligible vertex/incident lines, compute analytic seed, construct replacement source and fresh IDs. Reject selected source intersections or newly introduced ambiguous contacts; do not wire arrangement. |
| Graph schema/parser/checker | Add the two typed relation variants, validate entity dependencies and derive their point membership. Add permanent geometric/branch/extent checks. |
| Parameter mapping and graph deletion | Visit new driver scalars without altering strings. Deleting referenced entities must reject or explicitly cascade the dependent corner relation. Never leave dangling references or silently restore a sharp corner. |
| Solver runtime | Expand only the equations above using the existing package. Share one numeric corner-resolution helper with checks where useful; independent residuals must not call native acceptance logic. Worker/client packaging stays unchanged. |
| Relation panel/highlights | Resolve all referenced points/entities, show radius or the two setbacks, and expose the corner relation. Current visitors assume `pointIds` or `pointId`; they need explicit new-variant handling. Explain when apparent H/V behavior comes from nominal reference constraints, rather than adding a redundant trimmed-edge constraint. |
| Workbench/canvas | Point command previews the one selected corner. Keep the legacy rectangle all-corners action separate. A future two-edge picker must require the second eligible edge and explicit common vertex. Profile/interior selection never implies all corners. |
| Prepared command lifecycle | Reuse current preview, source-version, cancellation and local sketch-edit ownership. Apply accepts one prepared edit; failure retains values and accepted source/history. Consumed sketch Finish still validates all consumers. |

For the first UI, make point selection the supported entry. After Apply select `F/H` and configure the same persisted radius/setback fields. Do not advertise persistent equal-distance linkage by merely duplicating a numeric value into two unrelated distance relations. This plan's two-setback chamfer is explicit; an associative equal-distance mode would need an owned equality rule or shared driver. Radius zero is not an implicit removal command. Undo restores the original corner; removing a committed treatment and restoring its sharp topology is a separate later operation.

## Tests before controls

1. A `20×10` graph rectangle with one radius-2 corner has area `196 + pi`, perimeter `56 + pi`, one new analytic arc and unchanged other corners. The original corner, exact driver strings and old relations survive. A two-setback `2,3` chamfer has area `197`, perimeter `55 + sqrt(13)`.
2. Real WASM solves fixed and free 90-degree corners, then rotated 60/120-degree corners, reversed entity orientation and translated/tiny/large supported coordinates. Check independent residuals and DOF, not only status. Record safe rejects honestly; do not generalize the old quarter-arc trial.
3. Edit radius/setbacks and a shared nominal width parameter. Preserve exact expressions, retain finite edge order and material identity, and reject an oversized or wrong-sector result. A deliberately reflected external solution and a same-endpoint major arc must fail the independent checker even when tangent/radius equalities hold.
4. Two adjacent corner treatments either remain correct through size changes or explicitly reject overlap. No collapsed segment, switched corner or silently deleted constraint. Keep this unsupported initially if real-solver evidence fails.
5. Reject branch vertices, separate coincident IDs, mixed constructions, arc/line targets, collinear/uncertain supports, missing IDs, invalid dimensions and newly introduced intersections. Source-array reorder preserves targeting; a genuine split/replacement invalidates references.
6. Deferred preview/solve after Cancel or source replacement cannot commit. Rejected treatment, parameter shrink or stale consumer selection preserves accepted geometry, parameters, version and history. Existing legacy all-corners behavior remains covered. Round-trip new relations through browser-cache and folder storage with the normal strict parser.

## Bounded pinned-WASM trial

The proposed corner relation contract was accepted for the next implementation scope. Before implementation, an ignored [trial script](../../tmp/sketch-corner-trial/trial.mjs) ran 16 cases with the installed `@salusoft89/planegcs@1.3.0`, Node `v24.22.0`, original package settings and no conditioning, tolerance, algorithm or iteration changes. [Saved inputs, native outputs and independent checks](../../tmp/sketch-corner-trial/report.json).

The script reused the package initialization and production adapter for baseline DOF. Because the corner relation schema is not implemented, it compiled only the proposed new native equations directly through the same package wrapper and existing spoke/coordinate-driver pattern. That is a temporary equation trial, not an application acceptance path. The WASM SHA-256 was `af9d1874fc895726bd267703a698a86c82d35b7415a02fe5184ebf65ddbc04af`.

Each corner had legs 20 and 16 mm, plus a closing line to exercise a real bounded contour and the unchanged analytic cycle-encoding gate. Initial fillet seeds used radius 2.1 for a target of 2; chamfer seeds used 2.1/3.15 for targets 2/3, so the solver had to change the seed. Fixed cases kept every original `V/A/B` coordinate as an exact string driver. Free cases left those six coordinates numeric. Separate driver-edit cases started from the old 2 or 2/3 geometry and targeted radius 3 or setbacks 3/4.

| Configuration | World acceptance | Result |
| --- | --- | --- |
| Fixed/free 90 degrees at origin, plus fixed reversed line and arc directions | 6/6 | Both treatments passed. Free DOF stayed 6, fixed DOF stayed 0. |
| Fixed 60 degrees, rotation +23 degrees, at origin and at `(100,300)` | 4/4 | Both treatments passed. |
| Fixed 120 degrees, rotation -37 degrees, at origin | 1/2 | Chamfer passed; fillet safely rejected. |
| Fixed 120 degrees, rotation -37 degrees, reversed directions, at `(1000000,-2000000)` | 0/2 | Both candidates safely rejected. |
| Fixed 90-degree radius and setback driver edits | 2/2 | Both changed drivers solved within the unchanged gate. |

All 16 returned native `Success`, had the same DOF as the corresponding original sketch and reported no conflicting, redundant or partially redundant constraints. Source inputs and exact driver strings stayed unchanged. Independent finite-ray and minor-branch checks passed in all 16. Branches were also [reviewed from the saved candidate coordinates](../../tmp/sketch-corner-trial/review-report.mjs) independently of full-graph compilation; no solver was rerun for that review. Thirteen candidates passed every world check and produced one exact compiled material cycle.

The three rejected results are concrete limits, not reasons to weaken acceptance:

- The origin 120-degree fillet had maximum residual `1.6087131626818518e-11` mm against `1e-12` mm. That was also the arc endpoint-radius mismatch, so the existing graph checker already rejected it. Several support, tangent and radius residuals failed too.
- The far-origin fillet's support-A residual was `4.3728818495703266e-6` mm against about `3.5527350595651497e-9` mm.
- The far-origin chamfer's support-A residual was `3.3693707719117325e-6` mm against the same local world gate; support B also failed.

Both far-origin candidates passed the existing intrinsic graph checker and cycle compilation. Their failures were specifically in the new support equations. This demonstrates why a permanent independent corner checker is required even when a native solve and an ordinary closed graph look valid. These candidates were never applied to an application document.

Module initialization took about 6.45 ms in this run. Wrapper setup, solve, result extraction and independent checks took about 0.39 to 6.34 ms per candidate, excluding the baseline solve. These small Node timings do not establish browser latency or large-sketch performance.

The evidence supports the equation representation with strict safe rejection. It does not certify arbitrary angles/origins, nominal rectangle H/V constraints, adjacent treatments, construction corners, driver conflict mapping, browser ownership, persistence or consumed-part acceptance. The three failures remain rejected; no retries or numerical settings experiments were attempted. Implement the accepted typed relation/checking contract and the focused domain/runtime cases above before exposing a graph corner control. Do not infer an angle or origin blacklist from this small sample.

## Implementation checkpoint

The typed relation, builder, independent geometry checks and native equations are now implemented. The shared `create-sketch-corner` operation takes named trim, center, entity and relation IDs. It solves preceding parameter intents before reading the corner supports. Existing parameter/deletion visitors cover both relation variants, including both chamfer expressions. Original reference points appear as diamonds; their exact coordinates and old relations remain the nominal drivers. The initial UI targets one selected vertex of two nonconstruction lines; legacy rectangle all-corners behavior remains separate.

The existing relation editor owns preview, radius/setback fields and acceptance. It uses the shared numeric/fx controls. On-canvas radius and aligned setback annotations open the same relation. Constrained points remain selectable for inspection and corner commands while movement stays locked. Consumed sketches use their private edit and ordinary final whole-part validation. This adds relation kinds within the existing schema-2 graph contract; it adds no storage migration or installed machine/post change. Older app versions cannot read these new relation kinds and reject them rather than rewriting them.

An independent source review reproduced eager form reduction blocking a linked parameter before its numeric support could solve. The form now validates edit shape and pinned source, then delegates geometry to awaited preparation. The regression failed before the repair and passes afterward; the synchronous fallback retains reduction. Undo/source-change highlighting resolves the relation from the displayed graph before expanding its members. See [the bounded review](2026-10-16-graph-corner-treatments-review.md).

Production native tests cover fixed 90-degree radius/setback driver edits, initially free corners retaining six freedoms, wrong-sector/minor-arc rejection, oversize atomicity, diagnostic identity mapping and parameter-before-corner ordering. These are separate from the pre-production 16-case table above. A free chamfer changed from setbacks 2/3 to 3/4 returns native Success but remains rejected: support residual `1.4788654787566134e-12` mm and setback residual `1.1253220577600587e-12` mm exceed the unchanged `1e-12` gate. This remains an explicit numerical limitation, with no tolerance or conditioning change.

The focused related group passes 186 cases; the panel/annotation/gesture group passed 36 before the final clearance repair. The final annotation group passes 16, including three horizontal/near-horizontal/oblique clearance regressions. These are overlapping focused groups, not a repeated full-suite total. All ten production sketch journeys pass in Chromium and Firefox, including linked radius creation, Cancel, on-part dimension activation, agent chamfer creation, exact native extrusion volume, STEP download and Save/reopen. A native WebMCP session separately built a rotated 90-degree corner, changed radius 3 to 4 through the human field and measured `792.566370614359` mm² for its exact rounded/chamfered contour. The resulting one-solid native extrusion is `3962.831853071795` mm³ without diagnostics. Browser inspection found and repaired a horizontal radial label covering its arrow; the final label uses its actual shared dimensions plus clearance, without changing geometry. Full production build, documentation/source checks and shared UI checks pass. Final visual proof is `tmp/sketch-corner-dimensions.png`; the disposable unsaved native tab was closed. This remains a bounded corner increment, not a claim that sketch mode is finished.
