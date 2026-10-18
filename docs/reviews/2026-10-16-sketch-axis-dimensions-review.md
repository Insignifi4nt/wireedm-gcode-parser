# Relative X/Y dimension review

2026-10-16. Independent bounded review of the working diff against `7117fe6`, using [the axis-dimension plan](2026-10-16-sketch-axis-dimensions-plan.md). No correctness repair requested. The only added implementation evidence is one storage case in the existing two-adapter table. No native probes, production changes, builds, browser runs, package commands or remote writes were performed by this reviewer.

## Source and solver contract

`cadSketchGraph.ts` preserves the ordered `pointIds`, axis, signed scalar and exact expression text. Shared reference validation rejects self/missing operands. `cadSketchGraphReferences.ts` includes the new scalar in existing parameter visitors without changing tuple order. The runtime maps the first and second points to native Difference's `param1` and `param2`; the independent residual checks `second[axis] - first[axis] - value` with the existing physical driver budget. It does not replace signed offset with length, fix a master point or create a coincident joint for zero.

Read the owner's real native evidence in `tmp/sketch-axis-distance-final.log`: 54 cases across eight suites pass. Free points retain translation freedom. Compatible fully driven strings can report native Success without redundant IDs; incompatible fixed offsets still reject through the independent residual. The implementation reports those native results honestly. No additional mathematical certification was attempted here.

Existing Trim/Extend dependency collection sees axis-distance's actual point operands. It remains a dimensional blocker and cannot inherit the direction-only H/V transfer policy.

## Editor, annotations and hosted API

The point-pair Dimension command opens the choice without adding an aligned relation. Matching/restoring an existing X/Y relation uses unordered pair plus axis for lookup, then retains its accepted ordered tuple, ID and scalar. The From/To display follows that saved order. Shared ScalarField, preparation, submission and cancellation remain the owners of editing.

Annotation layout projects X horizontally and Y vertically. Reversing operands reverses the tips while retaining the outward side. Zero projected spans keep an editable finite label and omit arrowheads. Annotation activation routes to the exact point pair even when those points are a line's endpoints. Read existing root evidence: 119 editor/workbench cases pass in `tmp/sketch-axis-distance-ui-final.log`; 27 layout/activation cases pass in `tmp/sketch-axis-dimension-annotations-green.log`.

`cad_get_context` derives supported relation kinds from `CadSketchGraphSchema`. Edit discovery and execution derive their relation contract from the same schema. Inspection returns the exact ordered source, axis, signed evaluated value and scalar role; feedback retains structured IDs with ordered human labels. No separate tool executor or saved derived DOF was added.

## Persistence evidence and limits

Added one case to `cadStorage.test.ts`, executed for browser cache and folder adapters. Reversed negative X and zero Y retain exact spaced point/relation expressions after save/reopen. A normal parameter edit saves and reopens without rewriting the graph. A malformed axis rejects before any write and retains the exact prior raw save, receipt and empty transaction state. Both rows pass in `tmp/sketch-axis-distance-storage-review.log`; the scoped storage-test TypeScript check exits zero in `tmp/sketch-axis-distance-storage-types.log`.

This adds a relation within schema 2. Existing documents require no migration. Older readers reject documents containing the unknown variant; public docs and the eventual compatibility record must state that limit. Post/package formats are unaffected. The existing physical tolerance can accept offsets below independently distinguishable arithmetic resolution; this slice makes no new exact-side or zero-resolution promise. Root still owns final public documentation and production/browser acceptance.

## Root final acceptance

The new complete plate/bore journey is genuinely red on the prior frozen production build at the missing Horizontal distance action (`tmp/sketch-axis-distance-journey-red.log`). On the final build it passes in Chromium and Firefox, along with the existing point-pair aligned-distance/conflict/recovery journey (`tmp/sketch-axis-distance-{chromium,existing-chromium,firefox}.log`). The latter now deliberately chooses Aligned distance after Dimension; it retains its previous behavioral assertions. Full app TypeScript/build, 98-file public documentation/discovery/schema check, corresponding source distributions, shared UI standard and icon integration pass. Focused domain/native, editor, annotation and two-adapter results above remain the verification scope; no wholesale suite rerun.

Native in-app browser proof uses a 60×40 mm plate with exact string-driven corners/radius and a free bore center. The human chooses Horizontal/Vertical in the existing point-pair form, binds exact ` boreX ` / ` boreY ` expressions, and previews X=35/Y=20 while the accepted source remains unchanged. Apply moves only the free center to `[35,20]`, retaining all other point records and every entity. Actual ΔX/ΔY guides are orthogonal and clicking the horizontal label reopens the same driver and ordered points. The UI and native inspection report zero DOF, exact scalar roles and ordered operands. Existing display/navigation preference values were left unchanged.

After Undo, ordinary native WebMCP parameter/set-relation edits reproduce the human sketch structurally. An explicit-area Pad with distance text ` 5e0 ` produces one native solid, area `2349.7345175425635` mm², volume `11748.672587712817` mm³ (`12000 - 80π`), bounds `[0,0,0]`–`[60,40,5]`, and no diagnostics. Two Undo operations restore the disposable draft to zero features, no parameters, no undo history and no pending workflow. No user record was saved. Images: ignored `tmp/sketch-axis-dimensions.png` and `tmp/sketch-axis-dimensions-solid.png`.

## Compatibility record for the next reviewed PR

| Area | Assessment |
| --- | --- |
| CAD schema and readers | Additive `axis-distance` relation within schema 2. Unchanged documents retain their exact form. Older apps reject a document using the unfamiliar relation; public CAD/agent guides state this. |
| Storage and recovery | No migration or rewrite. Browser-cache and folder roundtrips preserve exact source; malformed axes reject before writes and retain the prior save/version/transaction state. |
| Agent capabilities/events | Existing guarded set-relation, inspection and schema-derived discovery gain the variant. No new executor, workflow bypass, event contract or stored derived DOF. |
| Native solver and audit | Existing pinned Difference binding and independent physical residual budget; no native rebuild, tuning, normalization or relaxed acceptance. Native diagnostic limits remain honestly reported. |
| Posts, output and installation | Installed machine/post packages, post schema, engine events/capabilities, motion audit, encoding, numbering, generated output and saved revisions are unaffected. No package installation or snapshot rewrite. |
| Release and remote state | Unreleased local branch; app remains 0.0.699. Historical release records stay immutable. Transfer this assessment to the next reviewed PR's new release record and advance the app once then. No push, PR, merge or deployment during this goal. |

Next: [legacy profile position snaps](2026-10-16-sketch-legacy-profile-position-snaps-plan.md), with explicit numeric snapshot semantics rather than invented graph joins. Broader associative references and sketch inventory remain open; this checkpoint does not complete the goal.
