# Persistent line midpoint seams

2026-10-16, following local `e2915aa`. First inspect the pinned package/source and run a disposable native preflight. Production implementation was subsequently authorized for the narrow manual relation below. No arc midpoint association or drawing inference is included.

## Contract and native evidence

Persist `{id,kind:'midpoint',pointId,lineId}` through existing `set-sketch-relation` / `remove-sketch-relation`. It keeps an existing graph point at the finite line's midpoint. Endpoint order does not change its meaning; construction lines and circle-center points are valid operands. It neither fixes the line's position/length nor joins the point to either endpoint. Existing line/arc midpoint drawing snaps remain numeric position snapshots.

Onshape explicitly supports selecting a point and line for Midpoint. Fusion documents a persistent Midpoint constraint and its visible badge. Our line-only first scope, exact owner guards and source-edit blockers are authored app decisions, not claims about either vendor's topology repair. [Onshape Midpoint](https://cad.onshape.com/help/Content/Sketch/midpoint.htm), [Fusion Midpoint](https://help.autodesk.com/cloudhelp/ENU/Fusion-Sketch/files/SKT-CONSTRAIN-MIDPOINT.htm)

Pinned `@salusoft89/planegcs@1.3.0` already exposes `p2p_symmetric_ppp`. Set `p1_id=line.startPointId`, `p2_id=line.endPointId`, `p_id=pointId`. The corresponding copied native source lowers it to point-on-perpendicular-bisector plus point-on-line using one source tag. These are two scalar conditions with no extra points, hidden lines or new binary. The similarly named `midpoint_on_line_ll` is insufficient: it only places one line's midpoint on another supporting line. [Typed primitive](https://github.com/Salusoft89/planegcs/blob/9d26baef0b240fe0eef4186d4e5e5e66ec3620b7/planegcs_dist/constraints.ts#L651), [native lowering](https://github.com/Salusoft89/planegcs/blob/9d26baef0b240fe0eef4186d4e5e5e66ec3620b7/planegcs/GCS.cpp#L1257), [midpoint-on-line error](https://github.com/Salusoft89/planegcs/blob/9d26baef0b240fe0eef4186d4e5e5e66ec3620b7/planegcs/Constraints.cpp#L1505)

Bounded actual-WASM evidence is in `tmp/sketch-midpoint-preflight.mjs`, `.json` and `.log`. It reused the installed wrapper/default solve and app evaluator/driver tolerance. Every system was destroyed. No production edits, package changes, binary rebuild, tuning or geometry correction occurred during the probe.

| Native case | Actual result |
| --- | --- |
| Fixed-string endpoints `[0,0]` and `[' width ',0]`, numeric bore center initially `[14,3]`, radius `2` | Width `40` gives center `[20,0]`; width `60` gives `[30,0]`. Radius stays `2`, driver strings stay exact. Success, zero midpoint residual. DOF `3 → 1`, with the numeric circle radius still free. |
| Remove relation, then width `80` | Center stays `[30,0]`; source geometry no longer follows. Success, DOF returns to `3`. |
| Free oblique reversed line and free point | DOF `6 → 4`, Success, residual `5.55e-16 mm`. Temporary move of midpoint to `[10,12]` retains the relation, residual `2.52e-15 mm`; native DOF remains `4` because temporary targets are excluded from that report. |
| All expression-fixed operands at the correct midpoint | Success, DOF `0`, no reported redundancy. Do not invent a redundant-source rejection. |
| All expression-fixed operands with midpoint `[0,4]` instead of `[20,0]` | Native Success, DOF `0`, no conflicts, but independent residual `20.39607805437114 mm` rejects. This must become an honest `invalid-solution`, not fabricated native conflict IDs. |
| Duplicate ordinary midpoint relation | Converged with actual redundant ID `duplicate-midpoint`; reject through the existing diagnostic path. |

These ordinary cases establish a sound mapping, not all-scale/native completeness. Keep the ordinary line nondegeneracy and existing physical driver acceptance gate. No additional numerical experiments are needed for this slice.

## Source and edit boundaries

The graph parser accepts unsolved coordinates but requires a real line and a distinct existing point. Reject the point being either endpoint, or belonging to an endpoint's explicitly declared Coincident component. Also reject a line whose endpoints belong to one declared component. This is source identity, never a proximity test. Extract/reuse the existing Coincident union logic so parsing can inspect identities without requiring solved numeric coordinates.

Independent acceptance computes `A + (B-A)/2` for X and Y, then checks the point's two-coordinate residual using unchanged `cadSketchDriverTolerance`. Both axes must agree; point-on-line alone or equal endpoint distances alone is insufficient. The existing structural entity/joint checks remain separate. String coordinate drivers are evaluated into native copies, remain fixed there, and retain their exact source text on writeback. Fully driven wrong geometry must still fail the independent gate even when native analysis reports Success.

`cadSketchRelationEntityIds` returns the line; the point visitor returns the selected point and both endpoint IDs, deduplicated. Scalar mapping returns the relation unchanged. Existing parameter traversal then retains exact endpoint/source dependencies; no new scalar or parameter owner is introduced. Deletion requires explicit relation removal or existing cascade. Split rejects the whole-line owner. End/middle Trim and Extend reject the midpoint line owner; edits detaching an involved point are also blocked through the existing point visitor. Do not transfer the relation to one survivor or silently release it. Offset leaves the original relation untouched and emits a detached copy with no midpoint association.

The graph compiler's joint identity still includes only shared source point IDs and declared Coincident. A Midpoint constraint does not split a line, create a material node or make a circle center a contour endpoint. Arrangement-derived crossings continue through their existing exact analytic path.

## Bounded implementation and acceptance

Core owner updates `cadSketchGraph.ts`, shared relation visitors, the narrow midpoint operand/check helper, reused declared-joint logic and the real solver runtime. Existing dependency guard implementations should need only their shared visitor update; test them rather than adding per-operation special cases. Root owns mixed point+line selection, existing relation form, preview/Cancel/Apply, feedback/inspection labels and public guide. Adapter owner covers API discovery/schema and browser-cache/folder exact save/reopen. No new tool, history path or storage migration. The additive schema-2 relation is rejected by older app versions and must be documented accordingly.

Red-first gates: parser rejects invalid operands and direct/transitive endpoint alias collapse; aligned and oblique/reversed residuals check both coordinates; actual native width-driven bore follows and removal detaches; free geometry retains four DOF and constrained movement; fixed wrong source rejects atomically with structured midpoint subject; real duplicate diagnostic remains honest. Split/Trim/Extend ownership and cascade deletion preserve the complete accepted snapshot on rejection. One human/API center-on-construction-line workflow must cover parameter edit, Cancel, removal/Undo and exact save/reopen before claiming delivery.

No automatic midpoint relation is added by a position-only snap. A possible drag UX follow-up is excluding the point's own constrained line-midpoint snap target; current snapping already excludes geometrically dependent endpoint midpoints but does not yet inspect this new relation. That is a presentation exclusion, not a solver probe or new inference policy.

## Frozen core implementation evidence

The core schema, source resolver and native mapping are implemented. Domain and runtime cases first failed on the absent relation variant: `tmp/sketch-midpoint-domain-red.log`, `tmp/sketch-midpoint-native-red.log`. The final focused run passed 27 cases across the new domain/native/preparation suites and existing graph geometry/edit/source regressions: `tmp/sketch-midpoint-core-final.log`. Eight owned TypeScript paths and their dependencies checked cleanly: `tmp/sketch-midpoint-core-types.log`. No full build or browser journey ran in this core task.

Owned production paths are `cadSketchGraph.ts`, `cadSketchGraphReferences.ts`, `cadSketchGraphJoints.ts`, new `cadSketchMidpointRelations.ts`, and `sketch-solver/cadSketchSolverRuntime.ts`. New focused tests are `cadSketchMidpointRelations.test.ts`, `cadSketchMidpointRuntime.test.ts`, and `cadSketchMidpointPreparation.test.ts`. The existing Coincident identity union was extracted and reused; numeric joint checks retain their original implementation. Shared point/entity visitors make existing Split/Trim/Extend and cascade-delete ownership guards apply without operation-specific transfer logic or source edits in those operations.

Actual prepared history proves add, width `40 → 60`, remove plus width `80`, and exact Undo/Redo. An incompatible expression-fixed center rejects the complete batch with an `invalid-solution` midpoint subject and the same accepted snapshot, despite native Success. UI, hosted API, persistence and full native part acceptance remain separate integration evidence below.

## API and persistence integration evidence

The adapter owner adds one existing cache/folder-table case and one existing inspection case; no production adapter or storage change. The source fixture uses a construction line from `['2.000','-4.00']` to `[' span ','6.000']`, a bore center at `['(2 + span) / 2','1.000']` and radius `' boreRadius '`. The case round-trips a prior relation-free schema-2 document, then the new midpoint and every exact scalar string through ordinary saves; changing `span` from 22 to 24 keeps the saved expression source unchanged. Naming the circle as the relation's line must reject before writes and retain the exact prior save/version.

The inspection case checks the strict schema-derived set/remove contracts, no invented relation scalar, and the selected point plus the finite line's two endpoint operands. It reuses the existing inspection harness without adding a preparation, numerical or surgery test matrix. Genuine preimplementation failure is recorded in `tmp/sketch-midpoint-integration-red.log`: both adapters reject the unsupported relation and discovery rejects its schema. The three new cases passed after the core handoff (`tmp/sketch-midpoint-integration-green.log`); the two affected existing suites then passed all 63 cases (`tmp/sketch-midpoint-integration-final.log`). Scoped TypeScript checking of both test paths and their dependencies exited cleanly (`tmp/sketch-midpoint-integration-types.log`). No production adapter/storage changes, build or browser run were needed for this integration task.
