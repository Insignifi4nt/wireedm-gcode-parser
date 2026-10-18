# Independent directional-boundary review

Reviewed the working-tree slice against `97765b7` on 16 October 2026, using the [directional-boundary plan](2026-10-16-sketch-directional-boundary-plan.md) and [remaining-workflow audit](2026-10-16-sketch-remaining-workflow-audit.md). Scope: the surviving-line ownership exception and H/V operand transfer in `cadSketchTrimExtend.ts`, existing shared acceptance seams, public discovery/guide changes, two native preparation cases, the changed Trim/Extend production journeys, and the small Workbench active-sketch condition. Unwired arrangement and other remaining sketch features are excluded. No production edits or broad verification were performed by this reviewer.

## Result

No actionable defect found in the delivered policy. The exception is passed only for a surviving line. Matching H/V uses the original exact unordered endpoint IDs; the constructor substitutes only the detached operand, retaining relation ID, kind, tuple order and array position. Reversed line direction and reversed relation order are independent. A second line or arc with that original pair blocks the transfer, including construction geometry; coordinates and coincidence classes do not invent ownership.

Nonmatching H/V remains on its original old points. Parallel/Perpendicular records remain unchanged. Affected distance, fixed point/axis, exact coordinate strings, explicit coincidence, angle, size and corner ownership remain blockers. No-hit whole-edge deletion and arc Trim receive no line allowance and keep strict ownership. The changes neither drop a relation nor modify cutter geometry, saved source scalars or old point records.

Shared preparation is unchanged: preceding edits solve before construction, and the entire solved document must equal the constructed candidate. Permitting a directional source owner does not authorize native projection, outside movement or a new tolerance. Public query/proposal and final edits reach the same constructor and policy; discovery now describes the exception and strict cases.

The Workbench hides the redundant inspector **Edit sketch** action only while a sketch is active. Selecting a different feature already clears the active sketch ID, while a private sketch owner disallows changing to another target. The normal entry remains available outside sketch mode; Finish/Cancel and the existing guarded edit entry are unchanged.

## Evidence and limits

Inspected the meaningful domain regressions and logs: the three pre-change directional cases fail in `tmp/sketch-directional-boundary-domain-red.log`; the final eight-file set passes 56 cases in `tmp/sketch-directional-boundary-domain-final.log`, with scoped types clean. Cases cover fresh four-H/V rectangle trimming, reversed source/operand order, exact driven boundary reuse, adjacent old-corner intent, ambiguous line/arc ownership and strict driver/deletion/arc cases.

The two real pinned-WASM preparation cases failed before the change and pass afterward (`tmp/sketch-directional-boundary-native-{red,green}.log`). They require exact full graph equality: rectangle Trim transfers its matching H operand, and Extend retains Parallel/Perpendicular while closing 100 mm² material with 40 mm boundary. Root also reports the existing 91 Workbench cases pass. Counts overlap; they are bounded behavior evidence, not blanket numerical certification.

Root's full production build and actual browser/native acceptance are recorded below when finished. No new schema, native equation, driver-precision policy or general constraint-transfer mechanism is claimed. Broader sketch acceptance remains open.

## Root production acceptance

Accepted as the bounded directional-line editing checkpoint. Full production build/app TypeScript, docs/discovery checks across 98 files and exact corresponding-source distributions pass (`tmp/sketch-directional-boundary-build.log`). Shared UI standard and icon integration pass (`tmp/sketch-directional-boundary-{ui,icons}.log`). The final related Canvas/native/tool group passes 65 cases (`tmp/sketch-directional-boundary-integrated.log`); the existing Workbench file passes 91 (`tmp/sketch-directional-boundary-workbench.log`). No UI/copy/absence test was introduced for the small entry-button correction.

The existing consumed-Trim and endpoint-Extend journeys were strengthened with four H/V relations and exact resulting relation records. Both fail against the original frozen build because the actual menu action is disabled (`tmp/sketch-directional-boundary-{journey,extend}-red.log`). On the completed build, both full human/agent/Undo/solid/Save/reopen journeys pass in Chromium and Firefox, along with the existing fresh drawing/constraint/export workflow (`tmp/sketch-directional-boundary-{chromium,firefox}.log`). These extend existing behavioral journeys rather than adding duplicate UI tests.

Native in-app browser separately drew an actual 40×20 rectangle with the human Rectangle tool, inspected its four generated H/V relations, added a construction reference and confirmed the original disabled Trim. The same exact source on the updated build accepts the human cut at [10,0]. All six old point records stay equal, the source line ID stays unchanged, only its matching horizontal operand changes, and every other/adjacent relation stays structurally equal. Undo plus native WebMCP query/edit reproduces the full human result. Human Path reconnects the actual old/cut endpoints, with seven total points and all four relations retained, restoring area 800 mm² and boundary 120 mm. Its explicit-area native Pad preserves distance ` 5e0 ` and produces one solid, volume 3999.9999999999995 mm³, bounds [0,0,0]–[40,20,5], no diagnostics. Proofs: `tmp/sketch-directional-boundary-preview.png` and `tmp/sketch-directional-boundary-solid.png`.

The native browser confirms normal Edit sketch entry exists outside sketch mode; after entry the duplicate action is absent and Finish remains available. Four Undo steps restore zero features, empty parameters, no Undo and no workflow. No user record was saved. A transient native WebMCP registration during reload was handled by refreshing tool discovery; no application bypass or browser replacement was needed.

No remaining actionable finding in this slice. No schema/storage migration, native binary/tuning change, installed machine/post change, version bump, push, PR, merge or deployment. The broader sketch and local-only goal remain incomplete.
