# Pad/Pocket interaction audit

Date: 2026-10-14. This audit continues the CAD hardening goal after the tree/sketch overlay checkpoint. It covers current source selection, candidate previews, named dimensions, closed-contour semantics and a possible optional depth handle. It does not mark the broader goal complete.

The audit inspected the shared domain, editor, native kernel and existing tests. The native probes used an isolated document and the installed OpenCascade runtime. They did not alter the open browser part, storage, accepted native cache or development server.

## Reference interactions

Onshape permits selected sketch regions or planar faces as extrusion inputs. It offers a numeric depth, a manipulator arrow, reversed direction and symmetric extents. Starting Extrude while a sketch is open automatically selects its closed regions and nested entities. These details support an explicit region selection model; they do not establish this app's geometry or performance. [Onshape Extrude](https://cad.onshape.com/help/Content/PartStudio/extrude.htm).

Onshape's feature dialog has an active selection field populated from the model or tree. Its preview blends the before/after states. Editing normally rolls back later features; Final instead displays the later result with the current edit. That distinction matters for placing a handle on a historical feature which later moves or patterns the body. [Onshape Dialogs](https://cad.onshape.com/help/Content/Home/dialogs.htm).

Onshape's custom-feature manipulator callback can update several definition parameters and return quantities with expressions. Its client-side selection filters still require feature validation after an upstream edit. These are useful reference principles for sharing the domain operation between fields, handles and agent tools. [Onshape Feature UI](https://cad.onshape.com/FsDoc/uispec.html).

SketchUp Push/Pull acts on a face, previews depth during cursor movement, finishes with a second click and permits exact typed refinement. This is a direct face workflow, distinct from accepting a provisional parametric feature. [SketchUp Push/Pull](https://help.sketchup.com/en/sketchup/pushing-and-pulling-shapes-3d).

The existing [reference record](2026-10-14-cad-reference-interactions.md) documents the available CATIA/3DEXPERIENCE evidence and its limits. Current authenticated help was unavailable. No current Dassault parity claim follows from this audit.

## What already works

- Feature-owned source picking accepts preceding eligible IDs and preserves the editor's other fields, pending selection and cancellation. Body picking uses the preceding visible body model, rather than any historical feature with a solid-looking name.
- `CadFeatureEditor` owns an isolated feature draft and version baseline. Editing, source picking, previews, acceptance and agent mutation share workflow locks. Apply requires the current exact ready candidate; Cancel and stale owner/version responses cannot replace accepted geometry.
- `cadFeaturePreview` builds a provisional document through `applyCadEdits` in a separate worker. It debounces candidates, runs one build at a time and retains the last valid candidate while the next builds or rejects. Late results from a cancelled/replaced owner are discarded.
- Distance Pad supports signed nonzero depth and symmetric placement on principal or datum planes. Through-all Pocket supports principal planes and uses the target's bounds plus guarded precision evidence.
- Native failures retain the preceding valid body and identify the failed feature. Through-all Pocket already checks exact material intersection and rejects no-overlap, tangent/unresolved removal and complete erasure.
- Stored scalar expressions remain the authoritative definition. Editing an expression field explicitly can change its formula; a future drag must not silently perform that authoring action.

The current candidate command contains one feature and `isNew`. It can preserve a formula, but cannot represent a correlated shared-parameter update. That limitation is relevant to handles, not a reason to replace the healthy preview coordinator.

## Eligibility fixes implemented in this pass

The shared `cadSketchSources` policy distinguishes active material sketches from empty, construction-only and suppressed sketches. Pad defaults and its source picker use that policy. Through-all additionally requires a principal-plane source. The fields and factory use the same rule; domain/API validation remains authoritative. The module was initially introduced as `cadPadPocketSources` and generalized in the Revolve follow-up below.

An explicitly selected ineligible sketch returns no source. It does not substitute a different earlier sketch. When no sketch is selected, including a body or another feature selection, the factory may default to the latest eligible material sketch.

Distance cut on a datum sketch remains supported. Its Through-all extent option is disabled with an info tooltip stating the principal-plane requirement. A stored unavailable source remains selected with a concise disabled reason. Reading the editor does not rewrite it. Replacing the source is an explicit edit. Distance expressions and symmetric values remain local dormant fields when toggling the extent and are restored on returning to Distance.

Meaningful red-first cases caught the previous default to an empty/latest construction sketch, datum Through-all being offered, and explicit empty/construction selection being silently replaced. Tests also exercise source picking ownership, source replacement, disabled stored references and dormant named distance values.

Verification: 190 tests passed across nine focused factory/editor/reference/preview/domain/native suites. `npx tsc -b` passed. Scoped `git diff --check` passed, with only the existing CRLF normalization notices. No new feature kind or persistence schema was introduced.

Files changed for these fixes:

- `src/domain/cad/cadSketchSources.ts`
- `src/features/cad/CadExtrudeFields.tsx` and its behavior tests
- Relevant factory/availability entries in `src/features/cad/CadWorkbench.tsx` and its behavior tests

## Remaining correctness and feedback issue

Distance-cut and join acceptance lacks the effect evidence already present for Through-all Pocket. A valid solid result can currently consume the target and enter history even when the operation changes no material. This is a concrete remaining hardening issue.

An isolated native probe used a 20 by 20 by 10 mm stock body. Each result retained the stock volume, approximately 4000 mm³, and bounds `[0,0,0]` to `[20,20,10]`, with no diagnostics:

| Operation | Input | Observed result |
| --- | --- | --- |
| Distance cut | Radius 2 circle at `[50,50]`, depth 10 | No overlap; accepted unchanged stock |
| Distance cut | Radius 2 circle at `[10,10]`, sketch station 10, positive depth 5 | Cut proceeds outwards; accepted unchanged stock |
| Join | Radius 2 circle at `[10,10]`, station 0, depth 5 | Extrusion wholly inside stock; accepted unchanged stock |

The probe script is an ignored temporary local artifact, `tmp/cad-pad-pocket-interaction-audit.ts`. It runs the real kernel, not a mocked Boolean. These results are evidence of the local feedback gap, not a claim about vendor behavior.

This pass deliberately preserves stored distance-cut/join acceptance. Selecting an error versus a warning needs a documented compatibility decision for saved histories with deliberate no-effect operations. The implementation also needs native ownership and scale/precision evidence. Comparing total volumes with one epsilon would miss small legitimate removals and may misclassify uncertain results. The existing Pocket per-component Common evidence is a useful starting point; it is not automatically a complete join policy.

The initial audit found an adjacent factory gap: generic `featureDraft` chose the selected or latest active sketch for Revolve, including empty or construction-only sketches. Loft and Sweep use their own source preflight. The initial Pad/Pocket patch did not change Revolve; the later follow-up below closes that gap.

## Supported limits requiring a domain decision

Pad and Pocket currently consume every resolved material region in a source sketch. Their schemas record `sketchId`, not selected regions. A drawn contour has an ID and visible outline, but the model picker sends a whole feature ID. Selecting an outline alone cannot currently mean selecting a material region.

The accepted sketch model contains nonintersecting closed analytic contours. Its resolver computes full nesting first, treats odd depths as holes, and returns even-depth material boundaries with their immediate holes. Filtering raw profiles before this resolution would fill holes accidentally. Overlapping or touching curves do not define an arbitrary selectable face arrangement in the current domain.

Datum Through-all is unsupported by the current Pocket contract. Signed Distance on that same datum remains supported. The UI now expresses this limit before preview.

No solid-depth-handle preference or renderer exists. Current preferences contain navigation and on-part dimension visibility. Exact body face picking is not itself an extrusion-origin contract: later transforms, patterns, Booleans or finishing can change the body independently of the original Pad.

## Smallest sound next contracts

### Region selection

Agree on the selectable unit before adding a control. The smallest additive contract is an optional nonempty list of stable material-region boundary profile IDs. Omission preserves every existing whole-sketch extrusion. Resolve the entire sketch and its nesting before selecting these regions. A selected outer region keeps its holes; a nested even-depth island can be selected independently.

Reject duplicates, deleted IDs, construction contours, hole boundaries and unsupported/missing selections explicitly. Never fall back to the whole sketch or another contour. An upstream nesting change can turn a previously material boundary into a hole; that must fail rather than silently change the selection. Array indexes, native mesh face IDs and click coordinates are unsuitable persistent identities.

This proposed contract does not permit selecting a hole's interior as material. If the intended Onshape-like behavior includes every nested enclosed face cell, that is a different contract. Nonintersecting nesting cells could each use their own boundary and immediate child holes, but must be agreed and tested before UI. Neither option establishes a general overlapping-curve arrangement solver.

The selection must pass through the shared parser/operations, region resolver, native Pad/Pocket and budget checks, extent conversion, storage round trips and agent tool arguments. A selected material region's geometry still comes from its source sketch; there should be no copied second definition to drift.

Red-first examples after agreement:

- A radius 10 outer circle with radius 4 hole extruded 5 mm has volume `420π mm³`. A radius 2 nested material island separately has volume `20π mm³`; the legacy whole-sketch result has `440π mm³`.
- Disjoint 20 by 10 and 6 by 4 rectangles at depth 5 produce volumes 1000 and 120 mm³; omission preserves their combined 1120 mm³.
- A hole-boundary selection rejects under material-region semantics. Cell semantics, if chosen instead, need their own independent expected volumes.
- Deletion, source replacement, nesting changes and reordering cannot substitute another region. Extent conversion preserves selection. Omitted legacy selection and both storage adapters round-trip without synthesis.

### Depth handles and shared parameter preview

First extend the candidate-edit contract to represent a correlated atomic edit batch and build its entire provisional document. A feature-only command cannot show a handle editing `thickness` when that shared parameter also moves a sketch or drives another Pad. Matching a candidate by feature JSON alone is then insufficient; Apply must match the whole current candidate identity.

A shared binding operation should handle a literal depth by editing the feature, a sole named numeric parameter by updating that parameter while retaining its expression, and a compound formula by reporting a locked relation. Explicit unlinking is a separate user action. Fields, handles and tools should use this same operation, rather than implement three relation policies.

The gesture modifies only the pending draft. Release settles the current candidate, and acceptance makes one atomic edit batch with one undo step. Escape, capture loss, pointer cancellation, changed owner/source/version/storage or an invalid current native candidate must prevent acceptance and restore the accepted part. A retained earlier valid preview must never authorize an invalid latest depth.

Handle placement and movement must use the resolved sketch frame. For offset `o`, signed depth `d` and plane normal `n`, a one-sided endpoint is at station `o+d`. Symmetric endpoints are at `o-d/2` and `o+d/2`; dragging a symmetric endpoint edits twice its signed distance from the sketch station. Preserve the sign and do not clamp depth to positive. Crossing zero produces a pending invalid candidate. Principal normals are XY `+Z`, XZ `-Y`, YZ `+X`; datum placement uses its actual resolved normal. Through-all has a direction, not a depth handle.

The full-document preview currently shows later feature effects. A handle on an earlier Pad can therefore remain in the source frame while a later Move places the visible result elsewhere. Agree on a selected-feature/prefix ghost versus final-result presentation before adding on-model controls. Placing the handle at the final body's largest world Z would be wrong for signed, symmetric, datum and historical features.

A future optional CAD display preference can enable handles without changing geometry/history or rewriting old saved preferences. Agent tools should remain able to author the same candidate through structured operations without needing to operate a visual handle.

Red-first cases after agreement:

- A named depth of 10 changed to 20 previews all features sharing that parameter, preserves every expression and leaves the accepted document untouched until Apply. One Undo restores the complete accepted definition. A compound `thickness/2` remains locked until explicitly unlinked or its driver is edited.
- Positive and negative 20 mm depths, symmetric spans and principal/datum frames produce independently specified endpoints. Switching source or replacing the part during a drag cancels the gesture.
- A perspective ray nearly parallel to the handle axis cannot create a jump or nonfinite depth. Pointer capture loss, Escape, setting changes and stale native responses cannot commit a second edit.

The initial Pad/Pocket eligibility repairs were complete at this checkpoint. Region semantics, correlated parameter previews, depth handles and distance-operation effect feedback remain separate hardening work. The following addendum records the completed Revolve eligibility repair.

## Revolve source eligibility follow-up

Revolve now shares the material-sketch policy in `cadSketchSources` with Pad/Pocket. Its factory defaults to the latest eligible source only when no sketch is explicitly selected. Selecting an empty, construction-only or suppressed sketch rejects with the existing material-source diagnostic and leaves the accepted document, version and workflow untouched. Principal and datum sketches remain eligible; the principal-plane restriction still applies only to Through-all Pocket.

`CadSketchSourceField` centralizes the preceding-source options and unavailable-source display for all three operations. Its dropdown and owned model/tree picker receive the same enabled IDs. Stored empty, construction-only or suppressed sources remain selected and disabled, with their exact reason plus a compact info tooltip explaining how to choose a replacement. Reading a source does not substitute the first available option. Choosing a datum source repairs only `sketchId`; Revolve name, suppression, angle expression, axis, cut/join/new operation and target remain intact. The factory/context command and editor now use the same policy.

Missing or later sketch references cannot be stored by the existing parser, even on a suppressed Revolve. Domain tests confirm that boundary remains atomic. A disabled unavailable option remains appropriate for a transient stale candidate; it does not imply relaxing saved-document validation.

Four factory/model-picker tests failed against the old behavior before the fix: a latest construction-only sketch was used as default, and three explicitly selected ineligible sketches opened a candidate. Three stored-source editor tests also failed because empty/construction inputs were advertised as valid and a suppressed source displayed the first available sketch. All now pass. The editor tests retain the exact spaced formula ` turnAngle / 2 `, horizontal axis, cut target and suppression while repairing the source.

Verification: 211 tests passed in thirteen focused shared-source/domain/editor/factory/reference/preview/native suites. They include the existing principal/datum Revolve axis/native checks and Pad/Pocket regressions. Scoped diff checking passed. The first whole-worktree TypeScript pass found errors only in concurrent unload-integration and distance-cut tests, which were reported to their owners; the final `npx tsc -b` passed after those edits settled. No schema, feature kind, browser state, server or checklist was changed by this follow-up.

Accepted-feature Name-field cleanup was initially left to the coordinating pass. The later configuration pass below completes it by redirecting meaningful workflows to guarded tree Rename or substantive fields.

## Compact configuration follow-up

`CadFeatureEditor` no longer places Name in new or accepted feature configuration. Default names, explicit API names and stored names remain intact. Tree Rename owns post-acceptance naming. The separate Curve-creation draft name and profile metadata remain deliberate exceptions. The Sweep behavior test now creates default `Sweep 1`, renames it to `Pipe` through the tree, and independently undoes the rename and feature creation. Pocket cancellation/reset, imported-source identity and saved Sweep target tests retain their meaningful history/data assertions through modeling fields or actual Rename.

Move translation and rotation, linear spacing and circular axis center now group each supported XYZ vector in one row. The group shows its unit once, while every input retains its original visible label, aria label, exact scalar definition and context help. No vector math, angle conversion, expression policy or modeling API changed. Four red-first interaction cases verify that editing one coordinate preserves the other coordinates, precise numeric values, formulas, feature name and accepted document.

Selected-source failure messages now identify the selected sketch and its specific issue. Empty/construction sources offer material repair or another sketch; suppressed sources suggest Resume or an active replacement; datum Through-all suggests Distance or a principal-plane source. Five existing selection/atomicity regressions failed against the prior generic creation message before the copy fix. No-source creation guidance and source guards remain unchanged.

Verification: 139 tests passed across thirteen relevant feature/form/source/domain suites, plus `npx tsc -b` and scoped diff checking. The React review found no new hook, ownership or subscription issue. No absence-only test was added. E2E Name controls were reported to the coordinator for its owned production workflow update; Curve creation remains supported there.

The actual production [Move capture](C:/Users/cristian/code/Wire_EDM/tmp/cad-compact-move-configuration.png) was inspected at a 1651 px viewport. Translation and rotation labels, unit headings, info controls, inputs and acceptance controls fit without clipping or overlap. The coordinator's DOM measurement confirms each vector shares one input y coordinate and each input is 88.22 px wide. The fresh [linear pattern capture](C:/Users/cristian/code/Wire_EDM/tmp/cad-compact-linear-pattern.png) shows a readable instance-count control and one aligned XYZ spacing row, with its units/help/acceptance controls intact. The fresh [circular pattern capture](C:/Users/cristian/code/Wire_EDM/tmp/cad-compact-circular-pattern.png) likewise fits its count, axis, angular extent and aligned center XYZ row without clipping the labels, help or actions. No actionable form-layout defect was found in any capture, so no further implementation or test run was warranted.

The coordinator verified Cancel for all three provisional configurations retained the exact accepted version `4c24d57d-f760-46bd-bd1c-f9d05a5340da`. For linear Cancel, the viewport fields remained identical except the expected render revision increase from replacing preview/reference layers. The zoom `4.80225988700565` and named Custom framing stayed unchanged. These checks use isolated production QA; this reviewer performed no browser operation or user-draft mutation.

At that layout checkpoint, `ScalarField` still edited stored definitions directly. Entering a literal over a named expression detached it. The correlated preview and value-control follow-up below addresses that mismatch for fixed feature configuration fields.

## Correlated scalar preview and relation editing

Feature candidates now carry one typed add/update-feature edit followed by staged set-parameter edits. The same batch enters `applyCadEdits` for provisional validation and Session Apply. The preview coordinator builds the entire resulting document, including later features and sketches sharing those parameters. Its deterministic identity includes the complete edit batch, with parameter names sorted by ASCII order. Existing owner, document version, accepted document identity, storage identity, serial, cancellation and private-kernel checks remain authoritative. Apply compares the complete current identity and the current raw draft state. An earlier ready result, including a retained last-valid result, cannot authorize a newer invalid, changed, cancelled or stale candidate.

Fixed solid/reference fields show evaluated numbers at full stored precision. A numeric edit of a sole named parameter stages its numeric driver and preserves the exact expression, including whitespace. Other linked fields and derived descriptions evaluate against the same staged parameters. Compound formulas are read-only in numeric controls. The fx popup supplies separate explicit Keep relation and Use current value actions. A numeric no-op retains the exact original scalar representation and produces no history entry. Returning a named edit to its accepted value removes the staged parameter change and closes that workflow without accepting an old preview. Returning an independent numeric-string quantity restores its exact accepted representation using the shared scalar traversal's immutable location lookup. A separate explicit-relation intent flag prevents that normalization from restoring a former link or literal after an fx action. Scientific notation remains as typed during editing, so another exponent digit cannot silently append to a normalized magnitude.

Invalid raw numeric text stays visible and pending. It does not become a fake geometry expression or nonfinite document parameter. The internal blocked command cancels queued/active publication while retaining the owner's last valid preview and private client. It blocks both Apply and form submission, even if a ready result for the last numeric value arrives. Corrected input resumes that client; Cancel disposes it. Stale accepted-document or storage identity clears the retained result and resource. Dirty, unkept relation text also blocks acceptance; closing that popup discards it. Dormant distance text and the exact driving relation survive local Distance/Through-all toggles. Inactive invalid raw text cannot be persisted in a Pocket. Signed direction derives from the staged shared depth rather than the accepted parameter value. Apply commits feature and parameter changes atomically, and one Undo restores the whole accepted definition.

The value context covers Pad/Pocket distance, sketch/Curve placement offset, Revolve angle, fillet/chamfer size, shell thickness, Move translation/rotation, linear spacing, circular extent/center and datum origin/rotation. Every bound field has an explicit geometry location key. Translation and spacing retain full accessible names while visible XYZ rows stay compact. Repeated Curve/path segment controls and plugin/profile metadata keep their established editing policy and do not inherit this context. Extending value controls to repeated geometry requires stable segment identity and a segment-switch regression first. There is no schema migration, new feature kind or public tool type in this change.

Red evidence came from the shared candidate seam and the human editor seam. The old coordinator could not process a correlated batch. The old ready check accepted a matching feature with a different shared parameter batch. Move showed a spaced expression instead of its evaluated value. Meaningful regressions now cover whole-document dependent values, exact source preservation, high-precision literal no-ops, invalid/latest/stale/cancelled candidates, compound locking and explicit unlink, shared vector values, provisional datum normals, signed dormant extents, native text Undo and one-step Session history. Existing source/selection/topology and pattern tests author formulas through the explicit fx action while retaining their original data and geometry assertions.

Verification at this checkpoint: 257 tests passed in eighteen affected preview, controller, feature editor, source, vector, extent, pattern, Curve, Loft and Sweep suites. The final `npx tsc -b --pretty false` and scoped diff checking passed. An independent review found and verified the scientific-notation and preview-retention repairs, and the implementing agent independently checked the retained-preview coordinator branch. Production visual and native-result verification belongs to the coordinator's isolated QA pass; the earlier compact-layout screenshots predate the new fx controls and do not verify this follow-up. Optional depth handles and closed-region selection remain separate agreed design work.
