# Independent depth routing review

Reviewer: `/root/explicit_sketch_dimensions`; author: `/root/tree_interaction_refine`. Fixed source base is `fba236e004fb863e29d81bfc029be36b001397ac`; reviewed working-tree identities are pinned below. The author record is `2026-10-14-cad-depth-viewport-routing-review.md`. This review changed no viewport, helper, product or test source. The separately requested new public-agent E2E is recorded below and was not executed as a browser test here.

## Findings

No actionable standards or behavior defect was found in the frozen routing. It reuses the editor-owned typed control rather than creating an accepted mutation or second numeric binding policy. The existing area/source modes remain exclusive with depth mode.

Capture-phase pointerdown runs before OrbitControls. Only a successful primary-pointer begin owns capture and navigation; failed/locked starts and normal right-drag remain ordinary navigation. Owned movement/release is separate from body/topology/source click tracking. Foreign pointers and same-pointer additional right-button release cannot end or reinterpret the primary gesture. Capture release clears its identity before the resulting lost-capture event, avoiding reentrant cancellation. Pointerleave preserves a real capture; pointercancel, lost capture, window blur, graphics loss and unmount cancel through the same helper/editor path.

Canvas Escape consumes the owned gesture before the outer feature handler, restoring the prior provisional batch without accepting geometry or erasing a preceding typed edit. Own editor-pending state and candidate mesh/reference wrapper publications preserve the current control, while owner/source/frame/settings/navigation/dialog replacement cancels. Wheel and view-changing UI cannot drift the camera during dragging; release/cancellation restores the current navigation policy. The helper does not introduce a Fit or modify the underlying body materials.

The Three group attaches only for the current mode and is removed on exit. Camera/view updates use the helper's unchanged-update guard, avoiding idle render loops. Real helper changes advance the existing revision and coalesced render request. The small pointer-inert label reports Length or the actual hovered lock reason without competing with workflow/graphics status roles. Context loss hides it. Resources, subscriptions, captures and DOM listeners are released in the existing renderer lifecycle. This read found no stale-owner path or bypass of current-ready Apply/atomic Undo semantics.

## Independent verification

Node24.22.0: **94/94 tests in seven files passed**, independently (`tmp/cad-depth-routing-independent-focused.log`). These are the complete mounted depth, ordinary viewport, area picking, analytic area overlay, source-reference picking, depth helper and editor suites. They use actual Three cameras/rays and real Editor/Session callbacks; only GPU rendering/native-ready metadata is substituted where documented by the original tests. The 13 mounted depth cases retain exact accepted definitions/history and camera assertions through near/far movement, cancellation/publication/loss and mode exit.

Full app strict TypeScript passed with exit 0 (`tmp/cad-depth-routing-independent-types.log`); scoped diff whitespace checks passed. The three author hashes still match exactly after checks. No browser, server, build, native rerun, commit or user-draft action was performed. Fresh actual WebGL/CUA/native proof remains with root; unit verification does not certify that pending browser proof.

| Frozen file | SHA-256 |
| --- | --- |
| `src/features/cad/CadViewport.tsx` | `D69AB2C91E1AC29676E7D4429CA5DDE927B58CEF5731CB4A929A8EABFB0C5518` |
| `src/features/cad/CadViewportDepth.test.tsx` | `96DE8664FC924AA3549AF65AB3979E8454EE2191DD785FD97A01AAC91112CB61` |
| `src/features/cad/cad-depth-handle.css` | `43D26AB85FF7F18957037C5D1718A83A1A8E2CBC504A9EB52EA9347329B2875A` |

The separately independently reviewed helper/model retain hashes `37DB0032E5DD799182A1572363F7AC7F669B175B2CA05242A8662579FC3CFD83` and `1BB84072D76CB96367B7A8A5D251257C99E264D238AF51150D5F085487D54BD1`. See the helper owner and research independent review for binding/projection/cache coverage.

## New public-agent journey handoff

Root separately authorized only `e2e/cad-region-workflow.spec.ts`, SHA-256 `63529DF7A9368B4B527F54EC35B9762D972470B4028F957B058A0F6C5ACFA04D`. It reuses the existing actual-production registration/tool transport helper, with no controller/kernel/private state shortcut. It discovers the complete extrusion region schema, imports a fresh identity, reads accepted cells/pages and exact 41-code-unit reference chunks, proves a parameter-only topology edit refuses atomically, preflights both correlated sources (including the earlier selector that also needs repair), then submits one complete parameter/source/selector batch.

The independently worked circular volumes after that repair are `(10²-2²)π×5 = 480π` and `(10²-1²)π×5 = 495π`, at Z 0–5 and 10–15 with one solid each. The spec requires the public native worker build to verify those quantities, stale mutation/reference-read refusal, same-batch no-op retry and one exact Undo/Redo. Full compact document text equality retains all feature/scalar definitions and BOM/CRLF original DXF strings. No Save, new retry, sleep, timeout or skip is added.

Only strict spec/helper TypeScript and Playwright `--list` were run locally; both passed, with exactly one test discovered (`tmp/cad-region-e2e-types.log`, `tmp/cad-region-e2e-discovery.log`). The public/native browser test itself remains unrun here and is delegated to root's shared frozen CI candidate.

Root requested confirmation before preserving exact curved-bound comparisons. The current native test `src/features/cad/kernel/cadKernelRegionSelection.test.ts`, SHA `AE842BBC70D852A9FC0C8514588BA37F00DF451A8B087E3A11E51EF08E8DCB86`, matches the frozen region manifest. Its first real shared-driver repair case asserts both full bounds arrays with `toEqual` alongside 480π/495π and one solid. The actual frozen `tmp/cad-region-selection-domain-api-final.log` passes 272/272 in ten files; the owner's contract explicitly includes this native case and exact result. The new E2E uses the same numerical circle geometry and stations, changing only equivalent source representations to ` 5e0 ` and ` location `. These exact-output expectations therefore remain justified by existing observed native behavior. No extra native run or test-only correction was made; source/history/error/volume checks remain intact.
