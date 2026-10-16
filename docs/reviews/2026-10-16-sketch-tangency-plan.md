# Ordinary tangency at a declared sketch joint

Research, 2026-10-16, at `5cdda60` plus the frozen angle/precision integration. The initial investigation changed only this note. The later explicitly authorized bounded preflight below used a disposable local script and the already installed pinned WASM; production source/tests, packages, native settings and builds stayed untouched. The line-arc mapping now has that limited evidence. The arc-arc mapping remains a derivation without a new native trial.

## Recommended first scope

Add persistent **smooth tangency at an existing declared endpoint joint**, starting with line-to-arc. It owns which endpoints meet and which finite curve branches continue smoothly. It does not create geometry, merge points, add coincidence, choose a new radius, release a driver or replace a fillet feature. Arc-to-arc can use the same intent shape, but should be admitted only after its small separate native acceptance proof. General line/circle and arbitrary curve-support tangency remain another slice.

This is a useful next step for a freshly authored path with a line and analytic arc already sharing a joint. Users can keep that joint smooth through later radius/dimension edits instead of merely drawing an initially tangent numeric shape.

## Primary behavior and native evidence

| Evidence | Conclusion and limit |
| --- | --- |
| [Onshape Tangent](https://cad.onshape.com/help/Content/Sketch/tangent.htm) | Tangent relates pairs of selected curves; the tool can continue across selections. This supports one ordinary relation command. It does not specify our saved endpoint identity, solver representation or branch policy. |
| [Fusion sketch constraints](https://help.autodesk.com/cloudhelp/ENU/Fusion-Sketch/files/SKT-CONSTRAINTS.htm), [Tangent workflow](https://help.autodesk.com/cloudhelp/ENU/Fusion-Sketch/files/SKT-CONSTRAIN-TANGENT.htm) | Coincident and Tangent are distinct constraints. Tangency maintains contact without crossing and shows a saved constraint badge. Our command must distinguish making a joint from keeping an existing joint smooth. |
| [Fusion addTangent API](https://help.autodesk.com/cloudhelp/ENU/Fusion-360-API/files/fusion_GeometricConstraints_addTangent.htm) | Its narrow operation relates two curves. That API is not evidence that an unconstrained pair must already share endpoints or that all our finite-arc cases will solve. |
| [Pinned native system](https://github.com/Salusoft89/planegcs/blob/9d26baef0b240fe0eef4186d4e5e5e66ec3620b7/planegcs/GCS.cpp), [constraint equations](https://github.com/Salusoft89/planegcs/blob/9d26baef0b240fe0eef4186d4e5e5e66ec3620b7/planegcs/Constraints.cpp) | Line/circle and line/arc overloads use unsigned center-to-infinite-line distance equal to radius. Circle/arc pair overloads choose internal versus external contact from initial center distance; circumference equations use the radius difference or sum. These do not encode a chosen endpoint or finite arc sector. |

Installed 1.3.0 declarations provide `tangent_lc`, `tangent_la`, `tangent_cc`, `tangent_ca`, `tangent_aa`, `tangent_circumf` with an explicit `internal` option, and the already-used directed `l2l_angle_pppp`. The [source manifest](../../vendor/sketch-solver/planegcs-sources.json) records the exact package/core association. No binding or toolchain addition is necessary.

## Why joint and support tangency differ

| Intent | Equations alone do not establish | Proposed treatment |
| --- | --- | --- |
| Line and arc share a named endpoint | Whether their outward finite tangents oppose or form a cusp | Own the endpoint refs; enforce smooth continuation and preserve arc direction. First vertical slice. |
| Two arcs share a named endpoint | Which endpoint, smooth versus cusp, and whether the relation is already structural | Same narrow source shape, with explicit arc endpoint roles. Separate acceptance proof before exposing it. |
| Line tangent to circle/arc support | Contact foot lies inside the finite line; contact lies on the saved arc sweep; center side remains the intended side | Defer. `tangent_la` cannot stand in for endpoint tangency or certify visible finite contact. |
| Two circle/arc supports touch | Internal/external branch, containing curve, finite arc contact membership and degenerate equal/concentric supports | Defer. Save branch intent explicitly if added later; do not infer it again from every solve seed. |

The [current runtime](../../src/features/cad/sketch-solver/cadSketchSolverRuntime.ts) creates graph arcs as **two radial lines plus one structural equal-length equation**, not native Arc objects with independent angle/radius parameters. Therefore `tangent_la`/`tangent_aa` cannot simply be passed the graph arc ID. Manufacturing a second native arc representation and synchronizing hidden radius/angle parameters would be needless architecture for the joint case.

## Small persisted intent

Proposed strict readonly relation:

```ts
{
  id: string;
  kind: 'tangent-joint';
  endpoints: readonly [
    { readonly entityId: string; readonly pointId: string },
    { readonly entityId: string; readonly pointId: string }
  ];
}
```

Each point must be an actual start/end point of its named line or arc; entities must be distinct, with at least one arc. Circles have no authored endpoint. Line-line uses the existing line constraints instead. Construction targets are valid. Preserve tuple order and all source strings/IDs exactly; human matching can find an existing relation with reversed selection without rewriting it.

The two endpoints must already belong to one **declared** joint: the same point ID or an existing accepted coincidence class. Equal coordinates or a screen snap alone do not qualify. A deliberate agent can submit coincidence and tangency in the same ordinary atomic batch, using two explicit relation IDs. Removing Tangent leaves that coincidence in place. Removing the required coincidence without removing/replacing Tangent must fail final source validation, not silently turn it into free support tangency.

Source parsing checks topology only, so changed dimensions can still be unsolved intent. For alias classes, a small extraction of the existing joint union logic can provide topology-only ownership, while [resolveCadSketchGraphJoints](../../src/domain/cad/cadSketchGraphJoints.ts) retains its unchanged numeric span check. Do not duplicate the union algorithm or use an empty numeric map as a validation bypass. Actual coincidence remains subject to `cadPathClosureTolerance`, never the physical driver floor.

For the first human command, two selected eligible entities must have one unambiguous joint. Reuse the relation form's Tangent checkbox/Apply/Cancel and its existing set/remove relation edits. A pair with multiple candidate joints needs an explicit endpoint choice or remains unsupported initially. No persistent tool, new selection state, automatic joint inference or new WebMCP command is needed.

## Directed native mapping without new arc parameters

These derivations choose the **smooth** branch. Define an entity's outward unit tangent as pointing from its named joint into its finite geometry. A line uses joint-to-other-endpoint direction. For an arc, let `r=P-C` and

```text
sigma = (CCW ? +1 : -1) * (joint is start ? +1 : -1)
arc outward tangent = rotate(r, sigma * pi/2)
```

Smooth continuation requires the two outward tangents to be opposed. The stored arc direction and endpoint role already determine the branch; no extra numeric angle, boolean reversal or external/internal flag is needed for this joint intent.

**Line-to-arc:** let the line joint be Lp, other endpoint Lq, and the arc joint/center be Ap/C. Compile one existing `l2l_angle_pppp` between `(Lp -> Lq)` and `(C -> Ap)` with angle `sigma*pi/2`. Their joint may use two separately owned coincident point IDs. The existing coincidence equation and arc structural radius equation remain separate. This directed right-angle relation avoids relying solely on an unoriented perpendicular equation that also permits a same-sided cusp.

**Arc-to-arc candidate mapping:** use radial spokes `(C1 -> P1)` and `(C2 -> P2)`. If `sigma1 === sigma2`, their target is pi radians; otherwise it is zero. This follows by opposing their rotated outward tangents. The native angle primitive permits these internal constants; the public line-angle driver's `(0,180)` value rule must not be reused to reject an internal tangency equation. Both arc structural equations remain authoritative. This mapping is untried in the current task and must not be described as a verified ordinary arc-pair solver.

Existing [fillet compilation](../../src/features/cad/sketch-solver/cadSketchCornerConstraints.ts) already uses endpoint/radial equations, but adds nominal corner supports, radius drivers and permanent finite/minor-branch guards. Ordinary Tangent must not manufacture those extra design constraints. It preserves each ordinary arc's CW/CCW and endpoint ownership; it does not secretly freeze an original radius or minor/major sweep. Endpoint/whole-turn degeneracy and intrinsic radius mismatch still reject under the existing arc model.

## Independent acceptance and conflicts

Resolve actual endpoint geometry and the whole declared joint class. Require the contact positions to remain one roundoff-consistent joint, including transitive coincidence classes. Normalize nondegenerate outward tangents; for arcs use exact radial rotation, not sampled chords or degree-encoded endpoints.

Require strictly negative outward-tangent dot product to exclude the same-sided cusp, even when its angular residual could fall inside tolerance. Measure wrapped angular error against **opposition**, keep the existing `1e-12` radians gate, and check physical deflection using the longer relevant scale with `cadSketchDriverTolerance`. The relevant scales are line length/arc radius for line-arc and the two radii for arc-arc. A short curve must not license a visible mistake on a long support. Structural arc radius equality, coincidence and saved analytic cycle closure keep their current tighter roundoff checks. No point projection, endpoint welding or JS solve correction is permitted.

For a generic already-connected free pair, one tangency equation removes one remaining relative directional DOF. Separate endpoint coincidence normally removes two positional DOFs and must not be counted as a free side effect of adding Tangent. Fixed geometry or dependent equations may yield fewer changes, redundancy or rejection; the native diagnostics decide that, followed by independent validation. Existing all-string fixed cases can report native Success with no conflict IDs despite wrong geometry, so this checker remains mandatory. Source relation IDs and endpoint/entity subjects stay structured and machine-readable.

Guard known structural duplicate ownership narrowly:

- A fillet-corner already owns tangency between each named support line and treatment arc at its trim point. Reuse/inspect that owner, or reject an attempted duplicate with its actual source relation ID; do not add another driver or fabricate native redundancy IDs.
- Two arcs sharing the same declared center and joint already have coincident radial directions. Depending on endpoint roles/directions, smoothness is structural or impossible without an explicit source-direction change. Do not add a zero-information equation. Numerical center equality alone is insufficient to declare this structural ownership.
- Radius, equal-radius, length, coordinate and angle drivers otherwise stay unchanged. Do not broadly forbid them merely because they involve a selected entity. Report real conflict/redundancy or independent failure; explicit user removal/replacement stays an ordinary batch edit.

The relation owns both whole entities and endpoint support points. Shared reference helpers must expose those IDs so deletion and Split reject stale owners without silently moving the tangent to another endpoint. Scalar traversal returns the relation unchanged because Tangent has no scalar. The feedback label should name Tangent and the actual operands; source inspection can show endpoint refs and smooth-joint meaning without inventing a dimension annotation.

## Existing numerical limits still apply

The [solver note](2026-10-16-sketch-solver-options.md) records 28 accepted and eight safely rejected oblique arc cases under the radial-spoke representation. Those eight failures were **structural radius mismatch**, not ordinary driver residual. The later physical driver budget does not relax that check. The abandoned translation/unit-conditioning trials also remain abandoned; do not repeat them to make Tangent pass.

The original package trial's native Arc/`arc_rules` tangent example used a `1e-7` mm proof threshold. It is not evidence for this graph representation or its current acceptance. The [corner trial](2026-10-16-graph-corner-treatments-plan.md) and current runtime tests likewise retain strict support/radius safe rejects. Their successful quarter/axis cases support reusing the representation, not claiming arbitrary ordinary arc tangency works. A small later native preflight should establish that before implementation, without a matrix or numerical tuning.

## First vertical slice and meaningful red-first checks

Recommend line-arc at one declared joint first, through one `tangent-joint` relation and existing `set-sketch-relation`. Keep arc-arc and support/circle tangency visibly outside that initial eligibility until their separate bounded proof is accepted.

| Seam | Required behavior |
| --- | --- |
| Source/topology | One line/arc start or end owns the intended joint, including accepted coincidence aliases. Reverse source line endpoints without retargeting. Reject wrong/foreign endpoints, circles, line-line, multiple ambiguous joints and equal-coordinate undeclared gaps. Existing exact drivers/IDs remain unchanged. |
| Independent geometry | Smooth quarter and oblique contacts pass; same-sided cusp, wrong arc endpoint/side, mismatched radius, broken coincidence and near-degenerate support fail. CW/CCW and a major arc retain their actual branch and endpoint roles. Tiny/disparate supports cannot hide angular error. |
| Real pinned runtime | One free and one fixed/free line-arc, then one radius/length parameter edit and constrained movement. Demonstrate the expected one-DOF change when independent, preserve exact strings, and keep actual structural arc safe rejects. All-fixed incompatible geometry must reject independently even without native conflict IDs. |
| Shared acceptance | Human/agent emit the same source relation. Explicit coincidence plus tangent is atomic; failed driver batch, stale preview and Cancel preserve accepted version/history/storage. Remove Tangent keeps the joint; removing its required coincidence alone rejects. One Undo restores the accepted relation set. |
| Existing ownership | Fillet-owned duplicate and structurally same-center arc pair receive honest source diagnostics. Split/deletion cannot silently retarget the joint. Reversed selection reopens/removes the exact accepted relation ID; no scalar field or hidden construction geometry appears. |

Likely implementation ownership is one focused `cadSketchTangentRelations.ts`, narrow schema/reference/checker arms, one native compile arm, feedback/inspection cases and focused domain/runtime/shared-preparation tests. Root can own the existing relation form and browser proof. Alias topology may require the small joint-resolver extraction above. No new tool, solver framework, native Arc synchronization, storage migration, arrangement integration or offset work is proposed.

## Bounded native preflight: six solves, unchanged acceptance

The authorized follow-up ran exactly six native solves through installed `@salusoft89/planegcs@1.3.0`, using `GcsWrapper`, the current two-spoke structural `equal_length`, and one `l2l_angle_pppp` as derived above. All cases use one shared point ID, CCW arc start contact, and the native target `+pi/2` from the joint-to-line-other ray to the center-to-joint radial spoke. The source line itself is stored other-to-joint, so the mapping deliberately uses endpoint intent rather than blindly taking source-vector order. No algorithm/precision options changed, and no numerical corrections or retries were made.

Disposable evidence is `tmp/sketch-tangent-joint-preflight.mjs`, the full source/result record `tmp/sketch-tangent-joint-preflight.json`, and its human-readable `.log`. The command was portable Node 24.22.0 running `node_modules/tsx/dist/cli.mjs --tsconfig tsconfig.app.json tmp/sketch-tangent-joint-preflight.mjs`. The script uses the real graph parser/checker for existing relations and structural geometry, with a separate analytic opposition/deflection check for the proposed tangent intent, which is not yet part of production schema. Each solve owns and destroys its C++ system. The source snapshot and each exact expression string are asserted unchanged; writeback copies only free numeric coordinate components.

| Deliberate case | Actual result | Independent acceptance |
| --- | --- | --- |
| Both-free connected line/arc: line `A=(-10,-2)` to `J=(0,0)`, arc center `C=(1,5)`, end `E=(6,6)` | Baseline structural arc Success, DOF 7; adding Tangent Success, DOF 6. All four source points remain numeric and can move. | Accepted. Smooth opposition error `2.775557561562892e-17` radians; physical deflection `3.1004807390717164e-16` mm; structural endpoint-radius residual zero. No conflict/redundancy IDs. |
| Fixed line/free arc: exact line `A=[' -10 ','0']`, `J=[' 0 ','0']`; numeric `C=(1,5)`, `E.x=5`, exact `E.y=' bendRadius '`; radial-size driver also exactly `' bendRadius '`, parameter 5 | Success, DOF 0; center approximately `(9.05287573681627e-16,5)`, end x `5.000000000000001`. | Accepted. Smooth error `1.8105751473632542e-16` radians; structural radius residual zero. Source expressions remain byte-for-byte unchanged. |
| Same solved fixed/free source, changing only parameter `bendRadius: 5 -> 8` | Native Success, DOF 0, empty conflict/redundancy IDs. Center `(-9.806733024722417e-11,8.000000000025805)`, end x `7.99999999999511`; exact line and end-y driver strings retained. | **Rejected safely.** Tangent error `1.225841628086348e-11` radians exceeds `1e-12`; physical deflection `1.225841628086348e-10` mm exceeds `1e-10`; structural endpoint-radius mismatch `6.73718858479333e-11` mm exceeds unchanged `1e-12` roundoff. Ordinary radius-edit reliability is not established. |
| Fully exact-string fixed cusp: `A=(-10,0)`, `J=(0,0)`, `C=(0,-5)`, `E=(5,-5)` | Native Success, DOF 0, empty conflict/redundancy IDs; existing graph structural checks pass. | **Rejected independently.** Both outward tangents point toward negative X, dot `+1`, opposition error pi radians, physical discrepancy 20 mm. The intended smooth branch cannot be inferred from native Success. |
| Fully exact-string fixed nontangent arc: same line/joint, `C=(3,4)`, `E=(7,1)` | Native Success, DOF 0, empty conflict/redundancy IDs; both actual radii exactly 5 mm and existing graph checks pass. | **Rejected independently.** Outward dot `-0.8`; opposition error `0.6435011087932843` radians; physical discrepancy `6.324555320336758` mm. No fabricated conflict IDs. |

The preflight establishes the small direct binding and the expected one-DOF reduction in a generic free case. It also confirms that source-fixed wrong contacts must go through the independent tangent checker, even when every existing structural check passes. It does **not** establish robust ordinary radius edits: the single requested 5-to-8 edit fails both tangent convergence and the already-known strict structural radius gate. This is recorded as an actual rejected edit, not a reason to widen a tolerance or project the result.

The smallest implementation remains the declared-joint line-arc relation above, with normal atomic preparation and honest rejection diagnostics. If that slice proceeds, the two successful configurations and two independent invalid-contact proofs are suitable first real-package regressions, while this exact radius edit must remain a safe-rejection regression and a stated usability limit. Arc-arc, coincidence-alias solving, CW/end-contact combinations, drag, and general support/circle contact are not newly certified by these six solves. No further numerical experiments or solver changes are proposed in this preflight.

## Representation assessment after 2ba28b0

Read-only, 16 October 2026. **GO for one bounded perpendicular-equation comparison first; defer native Arc adoption.** No native test, build, browser or production edit was performed.

`cadSketchCornerConstraints.ts` already uses `perpendicular_pppp` for fillet tangency. For an ordinary declared joint J, use rays J→line-other and center→J, keeping existing source points and the spoke structural equality. Both native perpendicular variants use `ConstraintPerpendicular`: a polynomial dot residual scaled by the initial length product. `ConstraintL2LAngle` instead evaluates an atan2 residual. Thus this is a smaller equation change than native Arc, without changing precision or importing corner ownership. [Pinned constraint implementation](https://raw.githubusercontent.com/Salusoft89/planegcs/9d26baef0b240fe0eef4186d4e5e5e66ec3620b7/planegcs/Constraints.cpp).

Perpendicular admits both smooth and cusp branches. Source does not prove deterministic branch loss from an accepted pose, so a bounded ordinary edit comparison is justified. It does not justify accepting arbitrary initial contacts. Retain the strict outward-opposition, angular/physical, finite-support and structural-radius checks; reject a changed/wrong branch without projection, retries or automatic source reversal.

Native Arc can represent the current graph without saved changes. Compile `{type:'arc',c_id:C,start_id:S,end_id:E,radius:R,start_angle:α,end_angle:α+δ}`, where R and α come from current evaluated endpoints and δ is the saved direction's signed sweep. Add `arc_rules`, remove the old structural `equal_length`; parameterless spoke helpers may remain for existing relation mappings. The wrapper allocates `[start_angle,end_angle,radius]` at offsets0/1/2. Four equations enforce `S=C+R(cosα,sinα)` and the analogous E equation: nine variables minus four conditions give the same generic five freedoms. [Typed Arc and wrapper](https://github.com/Salusoft89/planegcs/tree/9d26baef0b240fe0eef4186d4e5e5e66ec3620b7/sketch), [native rules](https://raw.githubusercontent.com/Salusoft89/planegcs/9d26baef0b240fe0eef4186d4e5e5e66ec3620b7/planegcs/GCS.cpp).

Keep auxiliary angles/radius free unless an actual driver owns them. Existing string components remain fixed point parameters; write back solved numeric points, never reconstruct them trigonometrically. Discard auxiliaries after checking positive radius, endpoint consistency and intended signed/sub-full-turn branch. Periodic angles impose no CW/CCW or major/minor inequality. Extra equations can still stop too loosely or diagnose fixed-support redundancy; the old Arc trial's `1e-7` proof does not establish current acceptance.

The stop mismatch is source-derived: the binding setter assigns only `convergence`; DogLeg separately defaults `DL_tolf=1e-10` and succeeds when residual infinity norm is below it. This can be looser than our structural gate. A typed `DL_tolf` accessor is a small engine-boundary correction requiring a rebuilt binary, but choosing a tighter value remains an unverified convergence-policy change, not proof of a cure. [Pinned binding template](https://github.com/Salusoft89/planegcs/blob/9d26baef0b240fe0eef4186d4e5e5e66ec3620b7/build-bindings/templates/gcs_system.cpp.njk).

First gate: at most four unchanged-settings solves, R5 baseline, that accepted source→R8, one CW/major/wrap representative, and fixed wrong-cusp rejection. Check exact strings, DOF and all current residuals. Stop on ordinary failure; do not combine representation, stopping-policy or algorithm experiments.

### Root equation-mapping feasibility receipt

The source-backed fillet-style perpendicular_pppp candidate is GO for foundation work. Root reran exactly the four original deliberate fixtures (six solves: free baseline/constraint, fixed/free initial radius5 and parameter8 follow-up, fixed cusp and fixed nontangent). No new fixtures, retry, settings, coordinate conversion, projection or tolerance change. Evidence: tmp/sketch-tangent-perpendicular-preflight.{mjs,json,log}. Free DOF7→6; fixed radius5→8 now retains exact source strings, reaches angular error3.537382291578543e-24 radians and zero structural radius mismatch. Both fixed invalid contacts remain independently rejected despite native Success. This supersedes the old directed-angle mapping and its measured ordinary radius-edit rejection for this candidate only. The bounded source/API/native implementation still needs CW/end/alias/branch cases and complete material/private/history/save acceptance before human exposure; no general tangency is claimed.

## Production acceptance: declared line–arc joints

The perpendicular mapping is accepted through the ordinary shared relation path. Strict finite endpoint identity, full Coincident-class closure, smooth opposing outward direction and unchanged angular/physical/arc-structure gates remain independent of native Success. Foundation35 and integrated129 cases pass. Independent review repaired the agent boundary dropping the actual fillet owner ID;30 tool cases and scoped types pass. No solver setting, native binary, retry or source projection changed.

Full production types/build/docs/source/shared controls pass. The complete consumed rounded-profile journey passes Chromium6.6s and Firefox3.2s: Cancel/Apply, invalid-radius recovery, R5→8, private source isolation/Finish, native Pad, exact section and downloaded DXF, exact history, agent parity and save/reload. The initial test correctly reopened its radius inspector after Cancel; no product change was needed for that test assumption.

Independent native pointer proof reaches zero freedoms with authored strings retained, one651.3274122871835 mm³ Pad5 solid and one analyticR8 section arc plus three lines. Exact Undo/Redo pass. Disposable draft is restored empty and closed without Save. Evidence: tmp/sketch-tangent-native-{editor.png,solid.png,proof.json}. General circle/arc–arc support tangency remains outside this first joint contract. Continue the sketch inventory with precise reused-detail placement, rather than reopening this accepted numerical slice.
