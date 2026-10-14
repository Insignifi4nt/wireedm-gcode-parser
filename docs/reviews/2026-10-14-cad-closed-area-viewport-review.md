# Closed-area viewport ownership review

Date: 2026-10-14. This owner implements only `CadViewport` and a small scene helper plus focused tests. Workbench/field/editor lifecycle, prepared-cell domain math, tools, schemas, native builds and settings belong to other owners. The current reviewed capture checkpoint is `fba236e004fb863e29d81bfc029be36b001397ac`; region/depth product work is a separate uncommitted integration. No server, browser, distribution build or commit was performed by this owner.

## Narrow contract

`CadViewport` accepts `regionSelection?: CadFeatureRegionPickCommand | null`. The parent supplies a current owned command with its immutable prepared cells and placement from the same effective parameters. The viewport never substitutes native face/edge keys, filters profiles into a new sketch, changes accepted parameters or applies a feature. It emits complete canonical cell references only through the current command's `onSelect` callback. Header Done/Cancel remains parent-owned.

`createCadRegionSelectionOverlay` owns a scene Group and per-cell display resources. `update(command|null)` rebuilds only for owner/base/source/prepared-cell/placement changes; selection and hover repaint existing resources. `pick(ray)` intersects the actual resolved plane in doubles, converts to local XY, and calls the prepared analytic `cells.pick`. `selectionForRay` chooses only the hit cell, or toggles it from the current explicit selection/default-material legacy baseline. Empty draft selections are emitted for editor validation rather than silently falling back to default material.

Ray intersection uses a view-only edge-on conditioning refusal (`|direction·normal| <= 1e-8`) and rejects backwards/nonfinite intersections. It does not change any profile/contact predicate, model tolerance, region union, native acceptance or requested curve accuracy. Scratch vectors are retained across hover. The supplied frame and prepared cells are the authority; uploaded triangles are never used to accept or choose model cells.

## Faithful display and stable ownership

Each cell fill contains its direct-child voids, so hole interiors are independent bounded cells and concave paths retain their outline. Display sampling uses the existing reference angular interval `π/60`, once per prepared boundary. Each boundary appears once in the complete contour forest; its own line loop and fill use the same sampled geometry and resolved placement. Per-cell bounds midpoints are subtracted before Float32 upload, while object world translation and frame basis remain doubles. This preserves small features at coordinates of 100,000,000, including tilted datum placement. Sampling/triangulation is display-only.

Ordinary references are hidden during owned area mode because last-valid native references may use older parameters. The helper's own authoritative outlines remain visible above opaque stock. Existing source-picker rust/hover colors survive; on exit the original reference group, colors, depth and resources restore exactly. Body materials never change for this mode. Exact world bounds are cached through the existing `cadFrameEntityBounds`, preserving its conservative arithmetic enclosure. Explicit Fit includes current cells and body context, excludes hidden old references, and does not change ordinary/automatic framing or trigger an entry/refill camera adjustment.

Owned area clicks consume their event and do not select bodies or open context menus. Shift, Control and Meta toggle cells; ordinary right-drag navigation remains available without menu/selection mutation. Plane and topology modes retain ordinary behavior. Owner/base/source/cell/placement changes cancel begun pointers; unrelated candidate mesh/reference wrapper publications and selection-only rerenders retain the same region gesture and camera. Camera navigation clears old area hover. Visual mode, selection, hover, graphics availability and underlying rendered changes advance the existing revision mechanism. No capture or accepted-document guard was changed.

Graphics loss cancels a begun gesture and blocks any new area choice while the image is unavailable. Recovery retains the owned CPU/GPU cell resources and allows a fresh physical click. Exit/unmount disposes every fill and outline geometry/material deterministically; selection/hover updates do not dispose or allocate them.

## Red and green evidence

- `tmp/cad-region-overlay-red.log`: five red helper cases against the empty contract stub, before implementation; analytic hole/placement picks and shading were absent.
- `tmp/cad-region-picking-red.log`: six red real-mounted-viewport cases before routing; cells were absent and no canonical area callback was emitted.
- `tmp/cad-region-selection-wrappers-red.log`: one real regression when a selection-only wrapper publication cancelled an in-flight same-owner click. Region identity was then bound to the authoritative command rather than those wrappers.
- `tmp/cad-region-graphics-loss-red.log`: a confirmed new-mode regression allowed an invisible-area click while graphics were lost. The area-only availability guard now rejects it.

Final Node 24.22.0 focused gate: **68/68 tests across five files**, `CadRegionPicking`, `cadRegionSelectionOverlay`, `CadSourceReferencePicking`, `CadViewport` and `cadCurveRendering`. Log: `tmp/cad-region-viewport-focused-final.log`. Application TypeScript passes (`tmp/cad-region-viewport-type-final.log`); scoped diff checking passes. No broad native/browser gate was repeated by this owner.

The new cases use actual Three rays, camera projection, scene resources and shader/material state, mocking only unavailable WebGL raster transport. They cover normal/far principal placement, far tilted datum placement, nested hole/island interiors, single/toggle/default/empty selection, concave paths, clockwise major arcs, display-independent analytic picking, exact input/source preservation, effective-frame outlines and Fit, native-publication camera/pointer preservation, resource reuse/disposal, ordinary material/reference restoration, navigation, edge-on refusal and graphics loss/recovery. The major-arc bounds check requires the existing analytic conservative enclosure; its initial exact-integer assertion was corrected after observing the shared function's deliberate approximately `4e-14` enclosure. No math/tolerance was changed to satisfy it.

## Frozen area source snapshot

| File | SHA-256 |
| --- | --- |
| `src/features/cad/CadViewport.tsx` | `C80C27F283107FA8F1702997326DBD02284BF4C7241BB68D6811957E45AC9B58` |
| `src/features/cad/cadRegionSelectionOverlay.ts` | `4D8565415823D7F0742E9612AC24BA9E36AE5C71CDF1C16B7B91C541A337FF4C` |
| `src/features/cad/cadRegionSelectionOverlay.test.ts` | `F20DD8A29979BFE3222B490BA75D00DB2B23D1433083979CDA6279737ABD3F19` |
| `src/features/cad/CadRegionPicking.test.tsx` | `5BBFFF80E815D3D830068A0DE8A2AB287D1A02D2C345337ABF9F6B3CC9E2FA01` |

The earlier pure command/preparation read snapshot was `cadFeatureReferencePicking.ts` `0D12053A183AD074D87DAF8595728F18A44F69C2B52887D97E97DC5FF298FE4B` and `cadSketchRegionInspection.ts` `8F50490AE985649E7EE25A25E3695A0923BB1CCFD44EB666B4DC9029AC9F8A16`. Other owners may subsequently evolve those separate files.

The optional typed `depthControl` prop was added at the parent's request only to permit its guarded publication to compile. Depth rendering/gesture routing is not implemented or claimed by this area freeze. Independent review and parent native-backed physical area proof remain pending before a production checkpoint; the broader CAD goal stays active.
