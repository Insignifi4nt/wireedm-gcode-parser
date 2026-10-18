# Relative X/Y driving dimensions

2026-10-16. Read-only seam plan against `029f48d`. No production/test edits, native probes, tests, builds or package commands were run. The intended first workflow is a bore center 30 mm right and 20 mm above an authored plate corner, using the current graph relation editor and guarded API.

## Evidence and proposed scope

Onshape documents horizontal, vertical and shortest-distance sketch dimensions separately. It permits negative linear dimensions to reverse direction. This supports an explicit axis choice and signed editing, but does not establish our point-order equation. [Onshape Dimension](https://cad.onshape.com/help/Content/Sketch/dimension.htm)

Fusion's official sketch lesson distinguishes horizontal, vertical and aligned dimensions. Its dimension editor accepts values, parameters and expressions and renders dimensions on the canvas. The inspected sources do not establish Fusion's exact ordered-point sign rule. [Fusion sketch dimensions lesson](https://www.autodesk.com/learn/ondemand/course/fusion-core-engineer/unit/21psd5fsjnMEeOX3e84eF), [Fusion dimension geometry](https://help.autodesk.com/cloudhelp/ENU/Fusion-Sketch/files/SKT-CREATE-DIMENSIONS.htm)

FreeCAD's official documentation defines horizontal and vertical point distances independently, supports two selected points or one line's endpoints, and distinguishes a single point's origin-relative coordinate. The wiki presented an anti-bot page, so these facts were read from the project's official documentation repository. [FreeCAD horizontal distance](https://github.com/FreeCAD/FreeCAD-documentation/blob/main/wiki/Sketcher_ConstrainDistanceX.md), [FreeCAD vertical distance](https://github.com/FreeCAD/FreeCAD-documentation/blob/main/wiki/Sketcher_ConstrainDistanceY.md)

Our first slice should support two actual graph points, including circle/arc centers, construction endpoints and orphan reference points. Do not add line-to-line, point-to-support, tangent, ordinate-chain or implicit-origin semantics. Existing absolute Fix X/Y and Euclidean Distance retain their current meanings. No arrangement or legacy-profile promotion is involved.

## Persisted contract and sign

Add one strict graph variant, derived from the schema like current relations:

```ts
{
  id: string;
  kind: 'axis-distance';
  pointIds: readonly [string, string]; // [from, to], distinct actual IDs
  axis: 'x' | 'y';
  value: CadScalar;                  // signed local millimetres
}
```

The authored equation is `to[axis] - from[axis] = evaluateCadScalar(value, parameters)`. Positive X places the second point right of the first; positive Y places it above in sketch-local coordinates. Negative values select the opposite direction; zero aligns that coordinate and does not create a shared identity or coincident material joint. This ordered, signed equation is our deliberate authoring contract, not a claim of identical vendor storage behavior.

Preserve point tuple order, relation ID, scalar type and every character of expression text. A new relation seeds its value from the current ordered selection's coordinate difference. Reversed selection therefore produces the negated default for unchanged geometry. When editing/restoring an existing axis relation found by unordered pair plus axis, retain its exact accepted tuple and scalar instead of reversing them to match the latest selection. Show its actual From/To roles. Never sort IDs or silently negate/rewrite a saved expression. There is no need for a persistent direction flag in addition to the signed scalar and ordered operands.

One relation removes one independent scalar freedom. For two free points, X alone should leave three DOF; X and Y should leave two translation DOF. Neither point is implicitly fixed or designated a native master. Fixing the reference point then locates the bore; releasing it lets the complete pair translate with its offsets intact. With a free circle radius, one additional size freedom remains until its existing radial driver is supplied. DOF figures assume these are the only independent constraints on those variables.

## Exact native mapping and independent acceptance

The pinned `@salusoft89/planegcs@1.3.0` already exports typed `Difference` with `param1`, `param2` and `difference` accepting coordinate object parameters or numeric values. `SketchGeometryProperty` includes `x` and `y`; `GcsWrapper.push_constraint` resolves `{o_id, prop}` to existing geometry parameters. The copied core's `ConstraintDifference::error` is `scale * (param2 - param1 - difference)`. No native rebuild, new binding, dummy geometry, JS solver or conversion to Euclidean distance is needed. [Pinned official native source](https://github.com/Salusoft89/planegcs/blob/9d26baef0b240fe0eef4186d4e5e5e66ec3620b7/planegcs/Constraints.cpp#L674), [official package metadata](https://registry.npmjs.org/@salusoft89/planegcs/1.3.0)

Verified local source locations are `node_modules/@salusoft89/planegcs/planegcs_dist/constraints.ts`, `planegcs_dist/constraint_param_index.ts`, `sketch/geom_params.ts`, `sketch/gcs_wrapper.ts`, and `planegcs/Constraints.cpp` in the exact source archive already recorded by `vendor/sketch-solver/planegcs-sources.json`. The equation is at lines 674–676 in the available extracted source. Source association and existing packaging provenance limits remain unchanged.

Compile one source-tagged native object:

```ts
{ id: relation.id, type: 'difference',
  param1: { o_id: relation.pointIds[0], prop: relation.axis },
  param2: { o_id: relation.pointIds[1], prop: relation.axis },
  difference: evaluateCadScalar(relation.value, parameters) }
```

The independent checker computes `abs((b[axis] - a[axis]) - target)` in world millimetres and compares it with the existing `cadSketchDriverTolerance([a, b])`. Use the approved physical-driver budget, currently the maximum of `1e-10 mm` and analytic arithmetic allowance. Do not use absolute magnitudes, Euclidean length, a target-derived offset point, or a new tolerance. Parser checks still accept unsolved numeric intent and reject missing/duplicate references; evaluated invalid scalars and residuals reject at the normal solve/acceptance boundary.

Coordinate strings and existing fixed/other relations stay authoritative. Only free numeric components may change. Adding an incompatible relative driver must reject the entire batch with structured candidate relation/point subjects, even if native reports Success. Preserve reported conflict/redundancy IDs honestly. Matching fully driven coordinate pairs need one real pinned-native regression before claiming redundancy diagnosis: previous fixed-parameter paths have sometimes omitted that diagnosis. Do not add a speculative broad ownership guard or silently release any driver. A duplicate ID intentionally replaces one existing relation; a new ID does not authorize deleting another relation.

No `cadEditPreparation` special path is needed. `set-sketch-relation` already reduces pending intent, solves a copied whole document, preserves exact strings, checks graph residuals and validates consumers before commit. Normal preview cancellation, expected version, private-draft Finish and atomic history/storage semantics continue. Relative dimensions participate in parameter visitors through the shared scalar helper. Deletion and boundary-edit dependency checks should see their point operands automatically; they remain dimensional blockers, never inherit the direction-only H/V transfer policy.

## Human editor and on-part annotation

Reuse Dimension for an exact two-point selection and the existing Point pair form. Keep the current aligned Distance behavior available. Add explicit Horizontal distance and Vertical distance actions in that form, both opening the existing `ScalarField` and prepared-preview/Apply/Cancel owner. A new form/tool/controller is unnecessary. Label alignment checkboxes clearly as constraints, and label distance actions as driving dimensions so zero-axis alignment and positive-axis distance are not confused.

The form shows `From Point N → To Point M` for the active relation, X positive right or Y positive up, and signed mm. Existing `CadScalarEditContext` owns expressions and parameter changes. Selecting points in the reverse order can still locate/open an existing relation, but its editor shows the saved orientation. No UI-only expression rewrite, hidden master point or automatic removal of H/V/fixed/distance drivers is allowed. Directly known redundant alignment can explain what to remove; full redundancy/conflict remains the shared preparation boundary's decision.

Extend `CadSketchDimensionRelation` and `layoutCadSketchGraphDimensions`, then reuse the current SVG strokes, arrows, unflipped labels and hit/keyboard containment. For X, the measurement guide is horizontal and both extension guides are vertical; for Y, the measurement guide is vertical and extensions are horizontal. Place the guide 20 px outside the pair on the existing deterministic outward side relative to graph bounds. Reversing operands must not move it to another side. Arrow tips remain at guide intersections and bases inside the measured span; the measured stroke length is `abs(delta)` while the displayed source value stays signed. Include an axis marker such as `ΔX -30 mm` / `ΔY 20 mm`, and expose From/To in the accessible label. A diagonal aligned annotation with a renamed label would be wrong.

Zero is a valid driving value. Its projected measurement span has no direction, so show a stable offset `ΔX 0 mm` or `ΔY 0 mm` label with extension guides and omit the zero-span arrowheads. Do not divide by the span or suppress the only entry point for editing that driver. Tiny values use the existing `formatCadQuantity`, which retains nonzero scientific readouts. No persistent annotation-placement fields or new canvas gesture are needed initially.

`CadWorkbench.configureGraphRelation` must select the relation's exact two points and open that accepted relation ID. It must not select a whole line merely because the pair happens to be a line's endpoints. All annotation activation still uses the existing pointer/Enter/Space owner and respects preview/interaction locks.

## Shared API, compatibility and file ownership

Humans and agents use the existing guarded edit, for example:

```json
{"kind":"set-sketch-relation","sketchId":"plate","relation":{
  "id":"bore_dx","kind":"axis-distance","pointIds":["corner","bore_center"],
  "axis":"x","value":" boreX "}}
```

Add the Y record in the same atomic batch when both offsets are known. Inspection reports exact source tuple, axis, signed `valueMm`, source scalar role and real operand IDs. Human feedback uses bounded labels such as `Horizontal distance relation N · Point A → Point B`; machine IDs remain structured action keys. Removing the exact relation releases only that driver and retains current solved geometry.

| Ownership | Focused files and changes | Expected production size |
| --- | --- | --- |
| Domain/native owner | `cadSketchGraph.ts` schema/type plus one checker case; `cadSketchGraphReferences.ts` scalar traversal; `sketch-solver/cadSketchSolverRuntime.ts` one typed mapping; `cadSketchConstraintFeedback.ts` and `cadSketchConstraintInspection.ts` labels/meaning/value branch | Roughly 35–65 net lines across existing files; no new framework/module required |
| Root UI owner | `CadSketchRelationsPanel.tsx` point-pair actions, default seed, accepted relation matching/ScalarField; `CadWorkbench.tsx` annotation configuration | Roughly 60–100 net lines, depending on reuse of existing distance creation |
| Layout owner or root | `cadSketchGraphDimensionLayout.ts`, `CadSketchGraphDimensions.tsx`; reuse current CSS/tokens | Roughly 40–70 net lines for exact orthogonal projection and zero-span presentation |
| Public integration | `cadSiteTools.ts` feature description; generated schema/discovery assertions; `docs/site/agents.md`, `docs/site/cad.md` and release compatibility record | Schema-derived edit/discovery lists should update automatically; no new tool arguments outside the relation variant |

This is an additive relation within existing CAD schema 2, following the currently shipped relation additions. Old documents retain their exact representation, with no migration or storage rewrite. Older app versions cannot read a document using the unknown variant and will reject it. State that limitation in the release compatibility record and public authoring docs. Browser-cache and folder persistence use the same document representation; both should retain exact new relations during ordinary save/reopen. Post processor formats/capabilities are unaffected. File-size estimates are planning bounds, not measured patch results.

## Bounded red-first acceptance

1. **Equation and provenance.** Parser/reducer accepts exact signed X/Y records, negative/zero and reversed tuples; rejects missing/self references, invalid axis and invalid scalar. Checker distinguishes signed axis difference from aligned length, and rejects a wrong-sign ordinary residual without changing the source. Shared scalar traversal retains spaces and parameter dependency. Include one tiny and one translated literal in this focused group, not a numeric sweep.
2. **Real native anchoring and editing.** Two numeric reference/target points start with four DOF. X then Y reduce the expected independent freedoms without anchoring either point; translating both preserves offsets. Fixing the reference locates a circle center at `[reference.x + 30, reference.y + 20]`. Update one exact named offset parameter, then a negative and a zero offset, and preserve reference strings, radius driver and relation tuples. Prove an incompatible fixed/string candidate rejects atomically with useful candidate subjects. Record matching fully driven redundancy behavior rather than assuming it.
3. **Human editor and annotation.** Select plate corner then bore center, choose horizontal/vertical dimensions in the existing form, preview and Cancel without accepted mutation, then Apply. Reverse selection and reopen the accepted driver without changing its source orientation. Verify orthogonal guide/arrow-tip invariants, signed negative label and finite zero-span layout. Activating an annotation edits the actual relation, with existing keyboard and disabled-event containment.
4. **One complete shared workflow.** On a located plate plus bore, create both relative drivers through the guarded API or human form, change a named offset, Undo/Redo, inspect exact source/DOF, Pad or cut as appropriate and save/reopen. Confirm strings and IDs in browser-cache and folder adapter coverage. Extend existing realistic fixtures where possible; no separate absence/copy tests or broad end-to-end matrix.

## Actual blockers and evidence limits

No missing native type or architectural dependency was found. The remaining blocker before implementation claims is ordinary pinned-WASM behavior for the new `difference` compilation, especially all-fixed compatible/redundant and incompatible cases. Source inspection establishes the equation and binding, not runtime success. Run these as the focused real tests in the implementation slice, with no tuning loop.

The present physical precision contract still applies. At large translated coordinates, arithmetic allowance grows; offsets below that budget cannot promise an independently resolved side or exact binary difference. Very small nonzero targets may be indistinguishable from zero under the existing physical gate. Do not add a sign-specific clamp, projection, tolerance change or source-string normalization. Unrepresentable/out-of-range solved geometry rejects through the existing coordinate and complete-part checks. Two free points may both move when a new value is applied; the UI must explain that fixing the reference, rather than selection order alone, locates the bore.
