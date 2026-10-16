# Equal sizes and explicit radial dimensions

Investigation at local `a29212b`, 2026-10-16. Equality remains a design proposal. The next implementation is the radial-dimension prerequisite only.

## Behavior and exact source contracts

Onshape's Equal tool makes selected lines equal in length and arcs equal in radius; a dimensioned curve supplies its size. Fusion documents equal-size constraints and pairwise circle equality. This supports two narrow, scalar-free symmetric relations, rather than a generic arbitrary-expression relation. [Onshape Equal](https://cad.onshape.com/help/Content/Sketch/equal.htm), [Fusion Equal](https://help.autodesk.com/cloudhelp/ENU/Fusion-Sketch/files/SKT-CONSTRAIN-EQUAL.htm), [Fusion circle exercise](https://help.autodesk.com/cloudhelp/ENU/Fusion-Sketch/files/GUID-AEFB2074-65F7-46CD-B15E-EF12AC2EE1BC.htm).

```ts
{ id, kind: 'equal-length', lineIds: [lineId, lineId] }
{ id, kind: 'equal-radius', curveIds: [arcOrCircleId, arcOrCircleId] }
```

Keep source tuple order and exact IDs; match pairs symmetrically. Operands must be distinct existing entities of the required kinds. Construction entities and shared authored endpoints are valid. Equal length reuses the current line-pair resolver. Equal radius needs a small arc/circle-pair resolver. Reference traversal returns actual entity IDs and deduplicated point IDs; both scalar visitors are no-ops. Entity/point deletion uses the existing explicit-or-cascade dependency path. Existing `set-sketch-relation` and removal edits provide human/API parity. No new tool, saved group, geometry migration or endpoint joining is needed.

Selecting exactly two lines can add Equal length beside Parallel/Perpendicular. Selecting exactly two arcs/circles can add Equal radius. Mixed line/curve or extra selections do not expose these controls. Existing drivers are never removed or chosen as a hidden master. A pair of free numeric sizes still has a size freedom, even when native initialization happens to keep one initial value.

## Land explicit radial sizing first

Current graph circle `radius:number` is a native free variable. Editing its numeric initial value cannot promise a maintained size after equality is applied. Add one explicit relation before exposing equal-radius UI:

```ts
{ id, kind: 'radial-size', entityId, quantity: 'radius' | 'diameter', value: CadScalar }
```

`value` is the exact displayed scalar. A diameter evaluates to physical radius `value/2`; the stored expression is never rewritten by compilation. The strict parser resolves a circle/arc ID and permits unsolved numeric coordinates. Native preparation validates finite positive target radius greater than `1e-7` mm and at most `1e6` mm. Accepted actual radii must obey the same bounds.

Dimension on a fresh numeric circle defaults to Diameter; on an arc it defaults to Radius. Reopening an existing explicit radial or fillet driver edits that source relation. Radius and diameter represent one size freedom. A deliberate quantity change converts the displayed scalar and preserves the physical size; it does not add a second driver. An ordinary delete removes only the relation, retaining solved numeric geometry as free source values. Existing circle-radius strings remain exact hard drivers. The shared parser rejects a second radial-size owner on such a circle with `already-driven-sketch-radius`, asking for explicit editing or release of the original driver. This is a declared source-ownership check, not a fabricated native conflict/redundancy diagnosis. Two ordinary explicit radial-size relations still receive normal native conflict/redundancy checks. The UI should edit the actual driver and hide a misleading free initial-radius field when a relation owns size.

Explicit on-canvas labels show `R` or diameter notation and configure the existing relation through the current dimension interaction. Free numeric coordinates/radii do not manufacture annotations. Onshape distinguishes radial and diametrical driving dimensions, and Fusion's API accepts a diameter dimension on either a circle or arc. [Onshape Dimension](https://cad.onshape.com/help/Content/Sketch/dimension.htm), [Fusion diameter dimension API](https://help.autodesk.com/cloudhelp/ENU/Fusion-360-API/files/fusion_SketchDimensions_addDiameterDimension.htm).

## Verified pinned native mappings

Read the exact installed `@salusoft89/planegcs@1.3.0` generated constraint types and native source associated with publisher git head `9d26baef0b240fe0eef4186d4e5e5e66ec3620b7`. No new binary or binding is required. [Exact npm metadata](https://registry.npmjs.org/@salusoft89/planegcs/1.3.0), [native equal-size methods](https://github.com/Salusoft89/planegcs/blob/9d26baef0b240fe0eef4186d4e5e5e66ec3620b7/planegcs/GCS.cpp#L1200), [native radial methods](https://github.com/Salusoft89/planegcs/blob/9d26baef0b240fe0eef4186d4e5e5e66ec3620b7/planegcs/GCS.cpp#L1178), [wrapper parameter references](https://github.com/Salusoft89/planegcs/blob/9d26baef0b240fe0eef4186d4e5e5e66ec3620b7/sketch/gcs_wrapper.ts#L578).

| Source intent | Existing typed primitive | Notes |
| --- | --- | --- |
| Equal line lengths | `equal_length(l1_id,l2_id)` | Actual finite line lengths, independent of direction. |
| Equal circle radii | `equal_radius_cc(c1_id,c2_id)` | Native equality between radius parameters. |
| Equal arc radii | `equal_length` on existing `$arc-start:<id>` spokes | Keeps graph-owned endpoints and each arc's existing end-radius equation. |
| Equal circle/arc radii | `p2p_distance(center,start,distance:{o_id:circleId,prop:'radius'})` | Directly uses the real native circle-radius parameter; no copied radius constant. |
| Circle radius dimension | `circle_radius(c_id,radius)` | Native radius equality. |
| Circle diameter dimension | `circle_diameter(c_id,diameter)` | Native proportional equation with factor `0.5`. |
| Arc radius/diameter dimension | `p2p_distance(center,start,targetRadius)` | Diameter is halved numerically; existing structural equation constrains the other endpoint. |

There is no pinned `equal_line_circle_radius` method. Native arc-equality overloads exist, but graph arcs are intentionally compiled as endpoint-owned radial spokes, without an independent native Arc radius/angle object. Using native Arc equality would require a different ownership representation. It is unnecessary here.

## Independent acceptance and ownership

Equal length compares `abs(lengthA-lengthB)` in world mm, using the current closure tolerance over both lines' endpoints. Equal radius compares actual circle radius or actual center-to-endpoint arc distances. Check both endpoints of every arc, including the current independent structural equality. Do not compare arc chord lengths, displayed diameters or a sampled curve. Circle scalar comparisons need no unrelated world-origin coordinate; use actual/target radius values with the same roundoff helper. Arc comparisons retain center/endpoint world-roundoff context. Radial-size checks compare the evaluated physical target with circle radius or both actual arc radii. No relative-error substitute, tolerance widening, new angular tolerance, JS projection or convergence tuning is proposed.

Compilation preserves IDs, construction, arc center/endpoints, direction and all exact driver strings. Minor/major sweeps remain represented by the same endpoint identities and `cw`/`ccw` flag. A standalone size relation does not add an angular branch constraint or freeze other free point coordinates. The useful trial preserves the tested major arcs; it does not prove arbitrary unconstrained edits cannot move across another branch. Existing permanent corner guards remain in force.

Failed or redundant candidates remain disposable. Reuse current preparation, whole-part acceptance, worker ownership checks, cancellation and session history. No new persistence or preview paths.

## Bounded real-WASM evidence

Ignored `tmp/sketch-equal-size-trial/trial.mjs` and `report.json` retain all 19 exact inputs, commands, outputs, status, DOF and independent checks. Run with portable Node24 and repository `tsx --tsconfig tsconfig.app.json`. It uses the pinned module and the current adapter's same point/string ownership, structural spokes, temporary drag and cleanup pattern. This is trial evidence, not production integration or a comprehensive numerical matrix.

| Trial group | Cases | Result |
| --- | ---: | --- |
| Shared/reversed equal lines, parameter 10→14, endpoint drag | 3 | Success; size residual 0; DOF 0/0/1. |
| Equal circles with driver/edit, both free, center drag | 4 | Success; radius residual 0; DOF 0/0/1/2. |
| Mixed circle/major arc, parameter edit, reversed major support | 3 | Success; both radii 10 or 14; sweeps −270°/270°. |
| Arc/arc, parameter edit, free angular endpoint drag | 3 | Success; radius residual 0; major sweep retained, changing from −270° to about −306.87° on the intended drag. |
| Circle radius/diameter and major-arc radial dimensions, parameter edits | 6 | Success; actual target radius 10→14; residual 0. |

All 19 passed the unchanged graph check and additional world-mm size check at its `1e-12` mm floor. Source snapshots stayed exact; every native wrapper was deleted. Two free circle radii initially 10/6 happened to become 10/10 while DOF stayed 1. That result is free-solution choice, not a driving master or a guarantee that the initial first value is retained. No extreme-scale or oblique-arc support improvement is claimed. Known strict arc safe rejects remain.

A separate pre-guard runtime probe, archived as `tmp/sketch-equal-size-trial/radial-fixed-drivers.json`, found native Success/DOF0 with no conflict/redundancy IDs for both a matching and mismatching extra driver on a string-driven circle radius. The mismatch was independently rejected with a 4 mm residual, while an equal-value extra driver was accepted. That concrete limitation motivated the parser ownership guard above. The archived result predates that guard; rerunning the probe through the current runtime now rejects source ownership before native work. Production preparation tests also verify an explicit normal `update-feature` release followed by `set-sketch-relation` can commit atomically and Undo restores the exact original string.

Next production slice is radial-size only: domain parser/ref/scalar/checker and native compiler, candidate feedback/inspection, focused real preparation/driver/undo/conflict tests, then root-owned UI/annotation/API documentation and browser proof. Equality follows only after that prerequisite is reviewed, with shared endpoints, construction, both-free freedom, exact parameter edit, constrained drag, invalid operands and rejected-edit atomicity as the meaningful seams.
