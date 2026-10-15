# Depth intent and form-owned area selection checkpoint

Owner: `/root/explicit_sketch_dimensions`. Shared source base: `fba236e004fb863e29d81bfc029be36b001397ac`. Production/test sources below are frozen pending independent review and renderer integration. This is an internal implementation record; it does not claim that physical depth handles or their visible settings control have shipped.

## Scope and preserved boundaries

The existing feature editor remains the only provisional feature/parameter owner. Its candidate tuple, complete-document preview identity, current-ready Apply gate, cancellation and atomic session edit/Undo path are reused. No new feature kind, document/schema/tool API, native math, migration, saved source rewrite, viewport/camera command, server, browser action, version or commit was introduced by this owner. The renderer and Workbench remain separately owned. The new optional device preference is not exposed in settings yet.

`cadScalarValueIntent` extracts the existing numeric field policy into a pure shared function: literal changes update the scalar; named aliases update the shared numeric parameter while preserving exact alias whitespace; compound formulas remain locked until deliberate fx editing. Numeric text uses the existing CAD parser/range. An unchanged quantity retains the exact numeric/string representation and precision. Returning to an independent accepted quantity restores its original representation only when the relation was not deliberately edited. An accepted alias/formula cannot be resurrected after a deliberate unlink merely because the evaluated quantities coincide. `CadFields` consumes this same policy rather than duplicating it for mouse interaction; its non-context expression fallback remains intact.

## Internal depth geometry and gesture contract

`inspectCadExtrudeDepth(document, feature)` reads the effective provisional parameters and actual source placement. It returns only for an active Distance extrusion with an available material sketch; Through-all has no fictitious depth. Its model carries the resolved placement, unit normal, signed quantity, symmetry, binding and explicit editable/locked capability. XY, XZ and YZ normals are respectively +Z, -Y and +X; datum normals use the existing resolved frame. Only the relevant preceding datum is prepared. Invalid/unavailable frames are not approximated.

For source offset `o` and depth `d`, the endpoints are at stations `o` and `o+d`, or `o-d/2` and `o+d/2` for symmetric total thickness. Negative depth retains its sign. These model points use local `[0,0]` as the source-frame anchor. The future renderer must choose a visible contour anchor in that same frame; treating the sketch origin or a later transformed body's bounds as the cap center would be misleading. Native candidate validation remains authoritative for accepted geometry and supported placement precision.

A named depth also referenced by its own sketch offset or datum origin/rotation is explicitly locked for physical dragging. The actual candidate frame is still resolved, and ordinary numeric editing continues to update every correlated feature. The reason says the quantity and placement both reference the parameter; it does not claim arbitrary formulas necessarily move the source. This small policy avoids inventing a nonlinear pointer-to-coupled-frame solver or silently detaching the source. A compound depth is likewise locked with fx guidance. Zero is invalid for starting a gesture, but an already owned gesture may cross pending zero into a valid negative value.

`onDepthInteractionReady` publishes a stable internal `CadExtrudeDepthControl`:

- `subscribe` / `getState` publish the current candidate model, full definition key, capability and gesture state without waiting for native mesh completion.
- `begin(expectedDefinitionKey)` requires that exact current key, an editable/current owner and no concurrent gesture. It snapshots the current provisional feature, parameter edits, raw numeric text, relation-edit markers, issues and error, plus accepted document/version/source identity.
- `setQuantity(token, quantityMm)` uses the shared intent. It creates no accepted edit, direct session mutation or camera movement. Invalid numeric input remains pending and cannot use an older ready result to authorize Apply.
- `release(token)` ends only the gesture. The current candidate still needs ordinary ready-preview Apply. Apply remains one atomic feature/parameter edit and one Undo step.
- `cancel(token)` restores the exact starting provisional batch, preserving earlier typed edits. Full feature Cancel unmounts the controller and clears preview. Same-source interaction disable restores that starting batch; accepted document/version/source replacement invalidates ownership without writing an old snapshot over the new part.

Expired tokens, stale keys and stale accepted bases refuse further changes. Fields and Apply are disabled during an active gesture. The eventual pointer owner still must implement capture/lost-capture/Escape/blur/navigation/projection lifecycle, end-on-axis refusal and source-local anchoring; this checkpoint does not certify those physical renderer behaviors.

`showDepthHandles?: boolean` is device-local plumbing only. Missing means off. Old preference objects and exact stored bytes remain unchanged until explicit user action. The optional boolean is validated, propagates cross-tab updates and follows existing session behavior when storage is blocked. There is no migration and no visible settings claim before renderer integration.

## Root-owned area transport integrated into the same editor

The local picker discriminates whole-source `pick` and `pick-regions`. Root's prepared analytic cells and exact provisional placement are transported once, with owner/version, sketch ID, optional area references and select/finish/cancel callbacks. The editor does not recompute the contour forest or frame per hover and does not mutate the accepted part.

Area updates change the provisional feature and republish the current selection for the overlay. They preview live through the existing whole-document candidate coordinator. Done retains the current area candidate for ordinary Apply; Cancel restores only the pre-picker feature while retaining earlier parameter and raw quantity edits. Fields remain disabled while selecting. Separate private picker tokens and accepted document/version guards prevent an old selection/finish/cancel callback from changing a newer picker or replacement part. Root supplies the existing inspector header's Done/Cancel actions; no duplicate editor/canvas region toolbar was added here.

Whole-source picking explicitly clears candidate preview even when its caller leaves general previews enabled, then resumes the preserved candidate on cancellation. This keeps accepted source geometry available for selection and is distinct from live selected-area previews.

## Test-first evidence and focused verification

New shared helper/frame tests were written before those modules existed, and initial depth-editor tests failed before publication existed. Those are expected new-contract red cases, not evidence of an old native modeling defect. Two meaningful behavioral reds were also recorded:

1. `tmp/cad-depth-preferences-red.log`: 2 failed / 1 passed. The old parser dropped a cross-tab true depth preference and accepted malformed optional data without falling back. The validated optional parser now passes without rewriting original bytes.
2. `tmp/cad-source-preview-local-guard-red.log`: 1 failed / 3 passed. With general preview enabled, beginning whole-source picking left the prior candidate published. The local picker-kind preview guard fixes that case while allowing live areas.

The earlier combined run's two missing area-button failures occurred while root's controls were intentionally still unimplemented; this owner did not change their assertions. After the settled controls and final source, Node24.22.0 `tmp/cad-depth-intent-editor-preferences-final.log` reports **71/71 tests in 11 files**. The suite includes the five new files plus existing preference/scalar scientific-text/precision, feature preview, preview retention and root extrusion-fields cases. `tmp/cad-depth-region-types-freeze.log` records successful full `tsc -b --pretty false`. Scoped `git diff --check` passed.

Tests cover all principal normals, signed/symmetric stations, coupled sketch/datum placement, a far static oblique datum with independent negative symmetric depth, exact original definitions, literal full-precision no-op, shared alias updates, formula locking, invalid/latest preview gating, prior-draft cancellation, stale/expired ownership, disable/unmount, zero crossing, and atomic Apply/one Undo. Region tests use a real `CadSession` and actual fields/context; their wrapper observes the existing transport only. Native ready metadata is injected to exercise editor guards, so these tests do not claim an actual new native build or physical drag. Prior numeric/trackpad browser proof is recorded separately in `2026-10-14-cad-depth-navigation-and-handle-audit.md`; renderer integration needs its own real proof.

## Frozen source hashes

| File | SHA-256 |
| --- | --- |
| `src/domain/cad/cadScalarValueIntent.ts` | `8879B98B6422A9A7E5FCB92975FDA1EFA34BFA415F4611311E0494A05734393D` |
| `src/features/cad/cadExtrudeDepthInteraction.ts` | `38E1BDA7DB45BABA921B0C7D3DA2F93F4C2D5D5DC51A2EE433827DB7AEE253FC` |
| `src/features/cad/CadFields.tsx` | `6807B1448A402D9054EB71537453BE2D828C86242EB7A6254F8DCDBA01D1E6CE` |
| `src/features/cad/CadFeatureEditor.tsx` | `A041DB36475A1D77422147564D8165F8E4E2ADF32A619D2AE2CB2D14C7872E42` |
| `src/features/cad/cadPreferences.ts` | `2CEEC42933BCC0FABC5224F16E752A51599FBF3D9926F482E71C7D9FD6461036` |
| `src/domain/cad/__tests__/cadScalarValueIntent.test.ts` | `23B286C22AF8BB7E5245B7952CFB8BC59F56D4A80E4F1FBED50DD96B79E07C00` |
| `src/features/cad/cadExtrudeDepthInteraction.test.ts` | `5BF294271F94C7294A42653D62F98F4AED3CB46C03A49A84C442C6D50FD62915` |
| `src/features/cad/CadExtrudeDepthEditor.test.tsx` | `1B34043960B7E86305398031D8D8A911FB72DEE47A954CC1B50749169D630FE5` |
| `src/features/cad/CadFeatureRegionPickEditor.test.tsx` | `6E4EFDC7D60289522F5D3FDBFCBFCC61DD413510C980B765C0B9F916D007C789` |
| `src/features/cad/cadDepthPreferences.test.tsx` | `9C0394AFC2E4CBB7AD5A5057E6BD9D4FB8C7EFD9FF9DCF631D445F6A986C079B` |
