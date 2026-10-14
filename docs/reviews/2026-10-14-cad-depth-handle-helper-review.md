# Physical depth helper checkpoint

Owner: `/root/explicit_sketch_dimensions`. This follows the frozen editor contract recorded in `2026-10-14-cad-depth-intent-and-region-editor-review.md`. Root explicitly authorized reopening only the depth model/test to add current selected material bounds; the other editor/scalar/preferences sources remain unchanged. The five sources/tests below are frozen for viewport integration and independent review. No server, browser, commit, release, native feature, document/tool schema or saved-source edit was made here.

## Exact helper contract

`createCadExtrudeDepthHandle({ requestRender, onInteractionChange })` owns one attachable Three group and its GPU resources. It exposes:

- `update(control: CadExtrudeDepthControl | null)` and `setView(camera: THREE.OrthographicCamera, width, height)`; unchanged view/control publication returns false without scheduling frames.
- `getState()` with visibility, exact world endpoint, local pixel endpoint, evaluated quantity, concise Length label, active/hover state and editable/locked reason.
- `hitTest`, `hover`, and pointer-ID-owned `begin`, `move`, `release`, `cancel`, `dispose`.

The editor remains the sole candidate/parameter owner. The helper calls the existing control methods and never writes an accepted document or parameter directly. Release leaves ordinary current-ready Apply pending. Cancel restores the editor's exact pre-gesture provisional batch. Controller disappearance/replacement, actual frame change or camera/projection/size change ends the gesture; expired/foreign pointers cannot release or mutate it. Viewport must route Escape, lost capture, pointercancel, blur, graphics loss and settings/owner exit into this same cancellation path and suppress OrbitControls only while it actually owns the handle. Those event routes are separately owned and are not certified by this helper checkpoint.

## Source geometry and display

The model now includes current `materialBoundsMm`, using the complete validated source forest and the feature's actual optional selected-cell references. Undefined selection retains ordinary whole-sketch material. Changed/stale cell topology still rejects. Bounds use existing analytic measurement, not the last-valid native build, sampled pixels or accepted parameters from before a linked edit.

Each immutable sketch weakly owns one prepared forest, keyed by its conservative profile scalar dependencies and their exact parameter values. Offset/plane-only or unrelated depth changes do not regenerate the source forest. Only the latest selected bounds are retained. Source identity, a referenced value or the actual region selector invalidates the relevant result; a stale selector never becomes a cache hit for another valid selector. No accepted geometry is clipped, simplified or approximated by this cache.

The source material-bounds midpoint places the control near its actual footprint. This is a manipulator anchor, not a claim that the midpoint is an interior material point for every concave/holed profile. During dragging, the starting anchor and true unit normal are frozen. A named depth may resize source width without moving the gesture axis sideways; release refreshes the actual current anchor. Source-placement-coupled bindings remain explicitly locked by the editor model, with their existing numeric correlated editing available.

One-sided signed depth uses cap station `offset + depth`; symmetric total thickness uses `offset + depth/2` and maps cap displacement back to twice the quantity delta. Actual principal/datum normals determine the axis. The closest-point ray/axis calculation subtracts relative vectors before dot products to retain far-coordinate displacement, preserves the pointer-down offset to avoid a jump, and rejects a projected axis fraction below 0.1 rather than amplifying nearly end-on pointer noise. This is a gesture condition with a rotate-view reason, not a geometry policy or new saved restriction.

Arrow geometry and a generous hit target stay fixed in screen size through orthographic zoom. GPU vertices remain small/local; world endpoint and group placement retain JavaScript double precision. Depth guide/arrow transforms preserve negative direction and total symmetric thickness. Locked formulas/coupled placement/end-on views show a reason and do not call begin. The helper never fits, moves or rotates the camera. Resources are reused for hover/quantity/view changes and released exactly once on dispose; subscriptions do not survive owner exit.

## Test-first evidence and verification

The first real-ray/helper case failed before the new module existed, then passed after the implementation. That is a new-contract red, not a discovered old native bug. Two additional useful reds were established before their repairs:

- `tmp/cad-depth-material-bounds-red.log`: 2 failed / 9 passed because the model did not yet report selected material bounds. The authorized addition verifies selected-only bounds, linked-width updates, unrelated-depth cache reuse and stale-topology rejection.
- `tmp/cad-depth-handle-idle-render-red.log`: 1 failed / 10 passed because unchanged camera publication still requested another render. The helper now treats identical view/control state as unchanged, avoiding a viewport frame loop.

Current Node24.22.0 `tmp/cad-depth-handle-combined-final.log` passes **87/87 tests in 13 files**, including the unchanged editor/scalar/preferences/area/preview-retention cases. Full `tsc -b --pretty false` passes (`tmp/cad-depth-handle-types-final.log`), and scoped diff checks pass.

Real Three cameras, projections and rays verify a known 10 mm pointer displacement, negative/symmetric quantity conversion, a far principal source, a far rotated cardinal datum, fixed 14 px arrow height through 5× zoom, near-end-on/formula refusal, frozen linked-width anchor, foreign/late pointer refusal, cancellation/view/settings exit, idle scheduling and complete resource/subscription cleanup. The real Editor + `CadSession` integration verifies actual Length text, the exact shared parameter+feature batch and source aliases, no accepted mutation during drag, current-ready Apply only after release, one Undo restoring every original definition, cancellation to an earlier typed candidate, stale accepted replacement and unchanged camera matrices.

The integration injects ready native metadata to exercise the existing editor guards; it does not claim a new native build or an actual WebGL/CUA physical drag. Root/Tree still own mounted viewport event routes, accessible label presentation and fresh actual browser/native proof. The visible setting remains off by default and must not imply delivered physical interaction before that integration is verified.

## Frozen SHA-256

| File | SHA-256 |
| --- | --- |
| `src/features/cad/cadExtrudeDepthInteraction.ts` | `1BB84072D76CB96367B7A8A5D251257C99E264D238AF51150D5F085487D54BD1` |
| `src/features/cad/cadExtrudeDepthInteraction.test.ts` | `7E763A588E0E7C38FD6380A3B13810EAE9C2AB11A01B271D7109427989FC95CF` |
| `src/features/cad/cadExtrudeDepthHandle.ts` | `37DB0032E5DD799182A1572363F7AC7F669B175B2CA05242A8662579FC3CFD83` |
| `src/features/cad/cadExtrudeDepthHandle.test.ts` | `3ACE3198F55872303DD5CA868AA571BDF6548E2898913AA3A8187A93C41C3576` |
| `src/features/cad/CadExtrudeDepthHandleEditor.test.tsx` | `487D3CE5A18C4CF4D06E31CCB76B3980CA8E8816BC4DEB8D2B1A30BEBE423B0F` |
