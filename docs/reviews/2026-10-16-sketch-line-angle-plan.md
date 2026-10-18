# Driving angles between graph lines

Investigation and bounded native preflight only, 2026-10-16. Inspected `25a3079` plus pending Split integration. Filenames were located with `rg --files`. The preflight below uses ignored `tmp` files; no production/test changes, builds, toolchain changes or remote writes were performed. This covers one remaining S15 dimension capability. Tangency, offset, three-point angles and reference-only dimensions are outside this slice.

## Recommendation

Persist a positive, non-reflex angle between **two explicitly oriented source rays**, with a saved clockwise/counterclockwise sense. The human command chooses rays for the visible corner and displays that same sector. Agents supply the same small relation through existing `set-sketch-relation`. Do not expose the source line's creation direction as a surprise supplementary angle, and do not reselect a sector from current numeric geometry on every solve.

The extra ray references are justified source intent. A polygon edge that points into its corner and the next edge that points out have a turning angle that is supplementary to the interior angle a human normally wants. A bare `{lineIds,value}` cannot express that distinction without hidden orientation state or expression rewriting.

## Primary evidence

| Source | Supported conclusion |
| --- | --- |
| [Onshape sketch Dimension](https://cad.onshape.com/help/Content/Sketch/dimension.htm) | Select two lines, then place the angle in the desired quadrant. The same dimension workflow edits placed values and accepts expressions; negative angles are also supported. Our first slice can be narrower, but its annotation must identify the sector it actually drives. |
| [Fusion addAngularDimension](https://help.autodesk.com/cloudhelp/ENU/Fusion-360-API/files/fusion_SketchDimensions_addAngularDimension.htm) | The API accepts two lines and a text position; that position determines which of four quadrants is dimensioned. It creates a driving dimension by default. Quadrant choice is therefore geometry intent, even when a product encodes it through a placement point. |
| [Fusion units](https://help.autodesk.com/cloudhelp/ENU/Fusion-360-API/files/Units_UM.htm) | Design API angles use radians internally, while human angle input uses degrees. Keep our own public unit contract explicit rather than borrowing Fusion's full unit parser. |
| [Onshape drawing line-to-line angular dimensions](https://cad.onshape.com/help/Content/Drawing/drawing_-_line_to_line_angular_dimension.htm) | Its drawing tool distinguishes supplementary, vertical and reflex angles. This is **drawing** evidence, not proof that every sketch dimension supports every one of those modes. Reflex dimensions can remain deferred here. |
| [Pinned PlaneGCS C++ equations](https://github.com/Salusoft89/planegcs/blob/9d26baef0b240fe0eef4186d4e5e5e66ec3620b7/planegcs/Constraints.cpp), [pinned system bindings](https://github.com/Salusoft89/planegcs/blob/9d26baef0b240fe0eef4186d4e5e5e66ec3620b7/planegcs/GCS.cpp) | `ConstraintL2LAngle` rotates the first endpoint direction by the supplied angle and measures the second direction with wrapped `atan2`. This is a directed radians equation, not an unsigned `acos(abs(dot))` equation. The native system exposes both line-object and four-point overloads. |

The installed `@salusoft89/planegcs@1.3.0` types expose `l2l_angle_ll` and `l2l_angle_pppp`, with `angle: ObjectParam | number | string`. Its `sketch/gcs_wrapper.ts:511` fixes numeric driving parameters by default and tags the constraint ID. The corresponding copied source and package association are recorded in [the solver manifest](../../vendor/sketch-solver/planegcs-sources.json). No new native binding, rebuild or package is needed. The bounded preflight below verifies direct mapping and identifies important acceptance limits; it does not certify a production adapter or general redundancy behavior.

## Small explicit source contract

Proposed new strict graph relation arm, schema-derived and readonly:

```ts
{
  id: string;
  kind: 'line-angle';
  rays: readonly [
    { readonly lineId: string; readonly towardPointId: string },
    { readonly lineId: string; readonly towardPointId: string }
  ];
  sense: 'cw' | 'ccw';
  value: CadScalar; // degrees, evaluated strictly inside (0, 180)
}
```

Each `towardPointId` must be an actual start or end point of its named line. The ray direction is **the other endpoint toward this endpoint**. Its annotation origin can be a shared corner or virtual support intersection; the field does not claim that the ray physically starts at the named endpoint. `lineId` preserves whole-entity intent, while the endpoint identity survives a deliberate reversal of that line's start/end ordering. Require two distinct existing nondegenerate lines; construction lines and shared endpoints are valid. No curve, foreign-sketch point or proximity-matched endpoint qualifies.

`sense` and the positive degree value define one visible sector smaller than a half-turn. Acute and obtuse values both work. Do not call this the smaller angle between *unoriented supports*, which would be at most 90 degrees. For example, rays from a triangle corner can deliberately drive its 120-degree interior angle. Reflex values, 0 and 180 are initially unsupported; use Parallel for the collinear cases. An out-of-range formula rejects with its exact source text retained. Do not reduce it modulo 360 with `evaluateCadAngle`.

Keep the exact ordered ray tuple, endpoint IDs, sense and scalar string on parse/save/solve. Reversing selection order should locate and open an existing angle for that unordered line pair, preserving the existing relation wholesale. Creating a different sector is an explicit replacement/edit, never an automatic tuple reorder or `180 - expression` rewrite.

## Human construction and sector selection

Use a narrow shared helper such as `createCadSketchLineAngleRelation({graph,parameters,lineIds,relationId,placementPoint?})`. It constructs one relation from accepted source geometry, without solving or mutating the graph. It can return a clear ambiguous-placement error rather than silently guessing a sector. The strict relation itself remains sufficient for agents, so this needs no new edit kind or tool.

1. With one shared **declared** joint, orient both rays away from that joint toward the far endpoints. Reuse [declared-joint resolution](../../src/domain/cad/cadSketchGraphJoints.ts) for accepted coincident aliases; equal coordinates alone are not connectivity. This makes an ordinary polygon corner's interior angle independent of source edge directions.
2. For disjoint lines, compute their infinite support intersection analytically in a local frame. Orient each ray toward the portion occupied by its segment, using the segment midpoint only when its side is unambiguous under existing roundoff. The existing exported intersection classifier is finite-support oriented; it must not be misrepresented as an exported infinite-line intersection utility. A small checked 2-by-2 calculation belongs with this angle geometry, not a new general framework.
3. A placement point in a strict quadrant selects the two supporting rays bounding that quadrant. Save their endpoint choices and sense once. The existing two-line selection can seed a conventional unambiguous corner automatically. A segment straddling the intersection, a cursor on a support, near-parallel supports or an uncertain remote intersection must request an explicit sector or reject placement. Do not use lexical IDs or line creation direction as an invisible fallback.
4. Preview the actual selected arc and two lines, then open the existing relation scalar editor with `unit="deg"`. A temporary sector placement request, when necessary, owns the current document/sketch/version, selection, prepared source/parameters, SVG frame and cancellation signal. Cancel, source changes or stale completion accept nothing. It should not introduce a persistent angle tool mode.

The accepted relation's rays/sense stay fixed through parameter changes and point dragging. Recomputing the current nearest/smaller sector in the runtime would silently replace the declared constraint and is specifically excluded.

## Native mapping and independent acceptance

Reuse [the line-pair resolver and numeric directions](../../src/domain/cad/cadSketchLineRelations.ts), adding only endpoint-membership and orientation resolution. For each ray, obtain the ordered pair `(otherEndpoint, towardPointId)`. Compile one typed package primitive:

```ts
{ id: relation.id, type: 'l2l_angle_pppp',
  l1p1_id: firstOther, l1p2_id: firstToward,
  l2p1_id: secondOther, l2p2_id: secondToward,
  angle: (relation.sense === 'ccw' ? 1 : -1) * degrees * Math.PI / 180 }
```

No synthetic geometry is required. Evaluate a numeric copy only; preserve the original expression and fixed point components exactly as the [existing runtime](../../src/features/cad/sketch-solver/cadSketchSolverRuntime.ts) does. The current one-worker solve, diagnostic source-ID mapping, cleanup, cancellation and world acceptance remain authoritative. A both-free pair should lose one DOF without either line being arbitrarily fixed; do not promise a specific endpoint receives all movement.

For independent checking, resolve the actual oriented unit vectors `u,v`. Let `actual = atan2(cross(u,v), dot(u,v))`, `target` be the signed radians above, and `q = abs(atan2(sin(actual-target), cos(actual-target)))`. This wrapped angular error catches the wrong mirrored/supplementary sector; `abs(sin(error))` alone would incorrectly pass a half-turn error.

Follow the current line-relation precision contract: require `q <= 1e-12` radians **and** an endpoint deflection `2*sin(q/2)*max(lengthA,lengthB)` no greater than unchanged `cadPathClosureTolerance` for the four actual endpoints. This is a proposal to extend the existing dimensionless-plus-world gate, not a relaxed native stopping threshold. The longer line must participate, so a tiny second line cannot license a large visible angular mistake. Degenerate, nonfinite or uncertain results reject, including native Success/Converged with failed residuals. A bounded real-package trial must establish ordinary acceptance before production; failures do not justify tolerance tuning or JS rotation/projection.

## Other constraints and rejected edits

Parallel plus a non-collinear angle on the same pair conflicts. Perpendicular plus a 90-degree angle is algebraically redundant; other angle values conflict. The panel should explain that an existing direct Parallel/Perpendicular relation must be explicitly removed before adding this driver. Preserve all existing drivers; do not silently replace them, convert the angle to a reference dimension or invent native conflict IDs.

Indirect fixed coordinates/H/V/distance relations can also fully determine an angle. The native diagnostic path and independent check still decide acceptance. Source inspection alone does not prove which native IDs will be reported, especially for entirely expression-driven geometry. Add one real matching and one incompatible fixed-driver case before claiming that behavior. Equal length is generally independent and stays available. One human angle control per line pair opens the saved relation; equivalent ray reversals or swapped rays/sense must not accidentally create duplicate human drivers.

Because angle references whole line entities, `cadSketchRelationEntityIds` must return both line IDs. Existing deletion dependencies and Split blockers then work without custom retarget logic. `cadSketchRelationPointIds` deduplicates actual endpoint operands, including shared joints. Scalar traversal includes `value`, so parameter inspection, rename/removal and dependency preservation use the existing visitors.

## Native annotation and editor reuse

Extend [dimension layout](../../src/features/cad/cadSketchGraphDimensionLayout.ts) with a discriminated **angle** result containing `valueDegrees` and exact arc geometry. Keep existing length results' `valueMm`; do not label an angle as millimetres or introduce a repository-wide quantity framework for this slice. The graph constraint inspection likewise needs a degree-valued angle row instead of its current universal `valueMm` scalar helper.

Place the arc at the shared/virtual corner in the saved sector. Choose a deterministic screen-sized radius with clearance from the label and finite segments, extend source rays when needed, and draw an analytic SVG arc. Arrow tips meet the ray guides with tangent arrow bases inside the arc when there is room. The existing parent Y flip, readable unflipped text, visual tokens, transparent default border, blocked event containment and label keyboard handling remain in [CadSketchGraphDimensions](../../src/features/cad/CadSketchGraphDimensions.tsx). Use `formatCadQuantity(valueDegrees) + '°'`; never round the saved scalar.

Click/Enter/Space on the label opens the existing relation field through `onConfigure`, not another editor. [ScalarField](../../src/features/cad/CadFields.tsx) already supports `unit`, accepted source scalars, exact alias updates and fx editing. [CadSketchRelationsPanel](../../src/features/cad/CadSketchRelationsPanel.tsx) needs an Angle command for exactly two lines, existing-relation reuse, and the same prepared Apply/Cancel state. [Workbench](../../src/features/cad/CadWorkbench.tsx) must route two-line Dimension to it before falling back to single-line length. No generic viewport command or second selection state is needed.

A very distant/uncertain virtual intersection may have no safe visible arc placement. Retain the panel driver and report/omit an unsafe annotation; never relocate source geometry to draw a convenient label. Persisted label dragging and changing sectors by dragging a placed annotation are deferred, since current dimension placement is transient display geometry.

## Actual pinned-WASM preflight

Ran six deliberate examples in ignored [script](../../tmp/sketch-line-angle-preflight.mjs), with full [numeric report](../../tmp/sketch-line-angle-preflight.json) and [console log](../../tmp/sketch-line-angle-preflight.log). Eight solver calls comprise seven angle-bearing calls and one length-only DOF baseline. The script directly loads the installed 1.3.0 WASM, uses typed package primitive names and production `evaluateCadScalar`/`cadPathClosureTolerance`, fixes only string coordinate components like the current adapter, and destroys every owned native system in `finally`. It never changes convergence, iterations, scaling, source geometry or tolerance.

For the shared-corner cases, `v=[0,0]` and `a=[10,0]` are exact string drivers. The reference line is intentionally stored **a to v**, while its selected ray is **v toward a**. The moving line is v to b with its ray toward b. Ordinary cases add one 10 mm v-to-b distance. The all-fixed incompatible case has b as string coordinates and omits that extra distance driver.

| Deliberate example | Actual native and independent result |
| --- | --- |
| Acute CCW 30 degrees, b initially `[9,14]` | Success, DOF 0, actual `29.999999999999993°`. Wrapped error `1.1102230246251565e-16` rad; long-line deflection `1.1102230246251565e-15` mm. Angle and length pass the unchanged `1e-12` mm world gate. This verifies explicit ray order instead of the reference line's incoming source order. |
| Obtuse CCW 120 degrees, b initially `[-3,12]` | **Safe rejection despite native Success/DOF 0**, with no conflict/redundancy IDs. Actual `120.00000000001921°`, wrapped error `3.352873534367973e-13` rad. The dimensionless check passes, but angle deflection `3.3528735343686578e-12` mm and distance residual `2.042810365310288e-12` mm exceed the unchanged `1e-12` mm world gate. No correction is applied. |
| Mirrored CW 30 degrees, b initially `[9,-14]` | Success, DOF 0, actual `-29.999999999999993°`; the same `1.1102230246251565e-16` rad error and `1.1102230246251565e-15` mm deflection pass. |
| Exact degree driver `' taper + 5 '`, parameter 25 then 55 | Numeric compilation copies 30 then 60 degrees, using the preceding solved numeric b as the next seed. Both calls pass angle and length gates at DOF 0; second actual `59.99999999999999°`, wrapped error 0. The original driver text and other source data remain unchanged by assertion. |
| Both-free disjoint pair | a=`[0,0]`, b=`[10,0]`, c=`[20,15]`, d=`[27,22]`, all numeric, with two length-10 drivers. Length-only baseline Success has DOF 6; adding CCW 60 degrees gives Success/DOF 5, actual `60.00000000000006°`, error `1.1102230246251565e-15` rad and deflection `1.1102230246252626e-14` mm. All actual length residuals pass. The baseline has no angle driver, so its angle measurement is informational. |
| Incompatible all-string fixed pair, actual 90 degrees requested CCW 30 | **Independent rejection is mandatory**. Native reports Success/DOF 0 with empty conflicting, redundant and partially redundant arrays. Actual stays 90 degrees; wrapped error `1.0471975511965979` rad and endpoint deflection 10 mm fail acceptance. Do not label fabricated native IDs as conflicts. |

This verifies the small direct mapping and one-degree-of-freedom effect. It also shows that the proposed current precision contract rejects an ordinary obtuse edit because of a few picometres of residual. Therefore **angle production is deferred** while root reviews the purpose of the existing precision policy. A useful general angle tool is not established by these results. This investigation does not propose widening that gate, changing native thresholds, seeding special cases, adding a JS solver or running a numerical sweep. All-string-fixed native Success cannot substitute for independent acceptance regardless of that later decision. No further probes were run after this bounded conclusion.

## Bounded red-first proof and ownership

| Seam | Meaningful acceptance |
| --- | --- |
| Pure source/helper | Triangle corner with one incoming and one outgoing line creates the visible 120-degree interior, not a 60-degree supplement. Reverse either line's source endpoints and reorder arrays without changing the selected physical rays. Construction, shared coincident aliases, disjoint supports and deliberate quadrant choices work; unknown/wrong endpoint, same line, collinear/degenerate and ambiguous placement reject unchanged. |
| Independent checker | Correct 30/120 degrees and mirrored/supplementary wrong solutions; tiny/large translated geometry and strongly disparate line lengths. A wrong half-turn must fail despite a near-zero sine residual. Exact expressions remain byte-for-byte unchanged. |
| Real pinned runtime | One fixed/free pair, one both-free pair, one shared-corner pair; exact parameter edit and constrained drag. Check world residuals/DOF independently. Parallel/Perpendicular equivalents and fixed-string equal/incompatible drivers retain real diagnostics and atomic rejection, without an acceptance-tuning matrix. |
| Shared document/session | Alias edit changes the parameter and all linked angle uses; formula remains locked behind fx. Rejected mixed batch, stale completion and Cancel preserve accepted version/storage/history. Explicit removal plus new driver is one valid Undo step. Split/deletion sees the exact whole-line owner. |
| Layout/UI/agent | Actual arc and degree label show the saved sector, including reversed source order and oblique lines; arrows/tips and Y flip are correct. Label reopens the same exact relation. Human and `set-sketch-relation` use identical refs/value; save/reopen and Undo/Redo retain them. |

Domain/native ownership can remain one focused `cadSketchAngleRelations.ts` plus the narrow graph schema/reference/scalar/runtime/presenter/inspection switches and focused tests. Root can own the shared helper's UI caller, sector placement when needed, Panel/Workbench, annotation layout/rendering and browser proof. Existing relation edits and private-draft/whole-part preparation provide agent parity and acceptance. No separate angle tool, migration, solver architecture, native rebuild, tangency or offset is proposed.
