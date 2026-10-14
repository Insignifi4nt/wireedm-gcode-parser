# Owned extrusion-depth viewport routing

2026-10-14; base `fba236e004fb863e29d81bfc029be36b001397ac`, shared dirty tree. This implementation owns `CadViewport.tsx`, the focused mounted regression file and the small label stylesheet. Explicit owns the depth control/model/helper, and the parent owns Workbench/preferences publication. The earlier area/source-picker work in the same Viewport remains intact.

## Red evidence and repair

The first real Editor/Session + Three viewport tests failed **12/12** because the viewport did not begin or draw the published control (`tmp/cad-depth-viewport-red.log`). The tests use real camera rays, actual editor callbacks and exact session history; only the GPU renderer is replaced with a scene-observing stub.

Capture-phase primary-pointer routing now offers the endpoint to the owned helper before OrbitControls. A successful begin owns pointer capture and navigation; ordinary clicks, failed/locked starts and right-drag navigation retain their original path. A separate depth pointer is not reinterpreted as a body, topology or source click. Its own editor-pending flag and unrelated candidate mesh/reference/version publications retain the same token. Owner/frame/settings/dialog changes, pointer cancellation, lost capture, blur, graphics loss and unmount cancel instead. Escape stops before the outer whole-feature handler and restores the exact pre-gesture provisional batch.

The gesture blocks Orbit/wheel and view-changing UI until release/cancellation, then restores current navigation policy. Pointerleave preserves a valid capture. A second focused red caught a same-ID additional right-button release terminating the primary drag, and a label surviving lost graphics (**2/2**, `tmp/cad-depth-pointer-tail-red.log`). Only the primary button now releases the gesture, and the label uses actual graphics availability. Foreign pointers cannot end the owned drag.

The helper remains subscribed to the actual editor-owned state. Its geometry is reused; its group is attached only while the mode is owned, so ordinary scenes regain their original bodies/references/materials. A compact pointer-inert endpoint label shows Length, and hovered locked states explain their actual reason. The label does not compete with existing graphics/workflow status roles. Every real helper visual change advances the existing rendered revision and requests the existing coalesced frame; unchanged helper view/control updates request no idle frame. Camera and geometry math are unchanged.

No accepted document mutation occurs during dragging. Release leaves the candidate provisional, current readiness gates Apply, and a real-session test applies the exact named binding plus parameter update in one Undo step. Cancel restores earlier typed edits rather than discarding them. Near-origin and `1e8` fixtures use actual projected endpoint pixels and preserve the same renderer/camera through preview publications.

## Verification and limits

Node **24.22.0**: **94/94 passed across seven full files** (`CadViewportDepth`, `CadRegionPicking`, `cadRegionSelectionOverlay`, `CadSourceReferencePicking`, `CadViewport`, `cadExtrudeDepthHandle`, `CadExtrudeDepthEditor`). Log: `tmp/cad-depth-viewport-focused-green.log`, 2.31 s. The new mounted file contains 13 meaningful cases. App TypeScript (`tsc -p tsconfig.app.json --noEmit`) passes; `tmp/cad-depth-viewport-type-final.log` is empty with exit 0. Scoped/full diff whitespace check passes.

The initial broad focused run also exposed three unchanged ordinary viewport assertions because a hidden helper group added scene meshes and a passive label was given a workflow status role. Production attachment and label semantics were corrected; those existing tests were not weakened. A new label expectation was corrected to require the actual pending-preview lock reason before current readiness, then Length after readiness.

No browser, native rebuild, server, build, commit, public docs or accepted user document changes were performed. Parent owns the fresh native-backed physical browser proof and combined release gate. This freeze is ready for an independent lifecycle/source review; it does not mark the overall CAD goal complete.

## Frozen SHA-256

| File | Hash |
| --- | --- |
| `src/features/cad/CadViewport.tsx` | `D69AB2C91E1AC29676E7D4429CA5DDE927B58CEF5731CB4A929A8EABFB0C5518` |
| `src/features/cad/CadViewportDepth.test.tsx` | `96DE8664FC924AA3549AF65AB3979E8454EE2191DD785FD97A01AAC91112CB61` |
| `src/features/cad/cad-depth-handle.css` | `43D26AB85FF7F18957037C5D1718A83A1A8E2CBC504A9EB52EA9347329B2875A` |
| `src/features/cad/cadExtrudeDepthHandle.ts` (read-only dependency) | `37DB0032E5DD799182A1572363F7AC7F669B175B2CA05242A8662579FC3CFD83` |
| `src/features/cad/cadExtrudeDepthInteraction.ts` (read-only dependency) | `1BB84072D76CB96367B7A8A5D251257C99E264D238AF51150D5F085487D54BD1` |

## 2026-10-15 physical-QA presentation follow-up

The parent verified the actual depth gesture, correlated preview and exact Cancel, then requested a narrow contrast/label fix. The Viewport, CSS and routing test hashes above remain unchanged. The helper and helper-test hashes are intentionally superseded by `docs/reviews/2026-10-15-cad-depth-handle-presentation-review.md`: compact existing CAD display precision with a scientific fallback when nonzero would disappear, and the source-picker rust palette, with full underlying doubles/expressions retained. That record contains the actual screenshot hashes, test-first evidence, final 93-case gate and exact two-entry candidate-manifest update. Fresh raster acceptance of the final palette remains parent-owned.
