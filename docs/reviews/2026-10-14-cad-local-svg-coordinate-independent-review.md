# Independent local SVG coordinate review

Base checkpoint: `8375c294d09e0a43b48b7c37d977cc59fd9a4065`. Reviewed the tree owner's frozen Canvas/profile/path/gear-inspection/SVG repair and meaningful new/updated regressions. Also independently read the research owner's localized imported-path E2E projection integration. This reviewer made no product or test edits and operated no browser/server.

## Findings

No actionable defect was found in the scoped production repair. Source and test hashes match the owner's published freeze.

The original failure was real rendering loss: accepted R12 geometry at coordinates 1e8 remained present in the document/DOM while the SVG was blank. The owner records a red actual-coordinate regression (expected small display coordinates; received 99,999,970). The repair changes only display coordinates, retaining full source geometry and its exact parameter/expression representations.

The original `centerMm` and all input/picking/drawing values remain in the sketch's plane-local coordinate frame. They are not rebased document values or global 3D coordinates. Principal/datum placement and native geometry remain unchanged. The SVG viewBox is now centered near zero, and a cached contour frame serializes small geometry coordinates plus the difference between its origin and the current display center.

## Coordinate and lifecycle review

`CadSketchProfileGeometry` resolves the same exact analytic geometry/bounds used by Fit, chooses a midpoint without overflowing a sum, and subtracts that origin before serializing primitives or paths. Its enclosing translation is only `origin − viewCenter`; the existing enclosing Y flip retains the expected CAD-to-SVG orientation. Rectangle dimensions/corner radius, circle radius, slot rotation center/angle, polygon vertices, and generated/path boundaries retain their units and scale.

Geometry preparation is cached by immutable geometry and parameter identity. Pan/zoom changes placement without rebuilding the contour; changing a source geometry or parameter snapshot refreshes the content. The new matrix checks all six profile kinds, actual parameter invalidation, unchanged source JSON, and retained child DOM/content across navigation. This uses the application's existing immutable accepted-snapshot contract; it adds no parallel mutable geometry state.

Saved Curve and drawing chains cache their segment JSX against the segment snapshot, offset from the first start/arc center, then place it against the current display center. Partial previews, through-point markers, polygon points and crosshair use the same subtraction. No chain is closed, simplified, resampled, or altered by the renderer. Analytic radius, signed sweep, large-arc choice, and full turns remain intact; the full-turn opposite point is computed after origin subtraction. Default helper arguments preserve ordinary standalone rendering.

Pointer conversion still adds the original center to pixel displacement; profile picking receives those original plane-local coordinates. Keyboard cursor, snapped drawing values, closure checks, context-menu points and wheel/right-drag navigation are unchanged. Direct profile drag applies its existing signed translation above the local contour frame and commits through the existing source/version/lock/capture/cancel guards. There is no second translated document or double application of displacement. HTML dimension annotations continue projecting `point − center` into pixels, matching the SVG.

Grid phase is equivalent to subtracting the center from the original lattice (`−centerX mod step`, `centerY mod step` after Y inversion). Axes are rendered only when their exact zero coordinate lies in the visible interval; their local positions are `−centerX` and `centerY`. Nothing is dropped from accepted authored geometry.

Gear inspection uses the generating gear's actual center as its frame, keeping circles, root/tooth segments, samples and rotation aids aligned with the contour even when its bounds midpoint differs from the generating center. Package placement ranges and gear mathematics are unchanged; the new accepted-range far-gear regression uses 500,000 mm.

Capture still clones the current visible SVG including its local viewBox/transforms. Existing cancellation, owner, revision and accepted-version guards remain. Pan/zoom changes continue invalidating an in-flight capture. This review does not infer raster success from DOM coordinate checks alone.

## E2E integration review

The imported-path test still physically clicks the interior point (10,5) in its source plane. It reads the current version-pinned public `centerMm`, creates the local SVG point `(10 − centerX, centerY − 5)`, and uses the actual visible `getScreenCTM` to obtain screen pixels. This agrees with the new viewBox/Y flip and avoids treating a local viewBox as an authoritative document coordinate origin. All segment continuity, invalid-draft/workflow, exact original-source, area and volume assertions remain unchanged. The other five owned sketch helper/test regions remain frozen; the research owner updated only this integration region's hash/provenance.

## Independent verification and limits

Under Node 24.22.0:

- Independently ran 67 cases across `CadSketchLocalCoordinates`, analytic SVG helpers, direct manipulation, Canvas navigation/capture, and path drawing: all passed in about 6 s (`tmp/cad-local-svg-independent-focused.log`).
- Earlier cheap analytic SVG check: 4 passed (`tmp/cad-local-svg-independent-arc.log`). These are included in the 67-case run, not additional unique cases.
- Independent `npx.cmd tsc -b --pretty false`: passed with no diagnostics (`tmp/cad-local-svg-independent-type.log`). `git diff --check`: passed; Git's existing CRLF normalization notice is not a diff error.

The implementation owner separately reports 174 focused cases across ten files, application/E2E typing and discovery in `docs/reviews/2026-10-14-cad-far-origin-svg-and-picking-review.md` (SHA-256 `D81A8874B60C4B5A4BF6BF9B12ADF7003240C256CE419F1F11619C02051F5C72`). Those are owner evidence, not a second independent run. Root owns the fresh production bundle, actual CUA raster check and combined CI. No heavy native benchmark or full-suite duplication was performed by this reviewer.

An adjacent preexisting surface remains outside this patch: `CadGearHelp` serializes absolute generated points and uses a large compensating transform/absolute root-diagram viewBox. It was recorded for later actual far-gear help raster verification; no new regression or production fix is claimed without that evidence.

## Frozen SHA-256

Machine-readable source snapshot: `tmp/cad-local-svg-independent-hashes.json`.

| File | SHA-256 |
| --- | --- |
| `src/features/cad/CadSketchCanvas.tsx` | `B8E891B2095DED0C8997FFFAAC9B1D470D9563407F67664B0D8047D5F2D2CD48` |
| `src/features/cad/CadSketchProfileGeometry.tsx` | `49A3A0C4F61754E37B544A5140D6B6F94BF36EE25431FA9C9329EFA0D4BEFE2C` |
| `src/features/cad/CadPathDraftGeometry.tsx` | `C35E8C0A90808AA95B47A2218BCD2934CFAE88952F957E67A0A154B452909CA8` |
| `src/features/cad/CadGearInspectionOverlay.tsx` | `79442D4164896048C115EB60CBF081192927D38C445AD317A806536615EF668A` |
| `src/features/cad/cadSketchSvg.ts` | `47BD556F9D6370BF925A4EB844DD5E50E415AB0DA1D0641DE73E8AD00A726D6D` |
| `src/features/cad/CadSketchLocalCoordinates.test.tsx` | `62351F0C5D329B1ACDC400517C843E7176DA01C72EE87C77024F8C64052D6FE3` |
| Updated imported-path E2E region (original source text through next top-level test) | `177722AE81CDE9AF7726F67CE3B9D44C2CDA954B257746817439194AAE6320B9` |

## Final explicit-Fit E2E baseline follow-up

Independently reviewed the tree owner's final, test-only far-Sketch baseline adjustment. Initial automatic Fit still must produce substantial actual circle pixels, a square rendered aspect, complete viewport containment and no overlap with the tree, inspector or dock. None of those checks was moved past an explicit repair action or relaxed.

The test then waits for the actual `Contour 1 profile` tree button to become visible, proving that the selection-driven branch expansion has rendered, and requests an explicit Fit. It records the exact current host rectangle/client dimensions, all relevant overlay rectangles, and public center/span. Moving the exact circle by 100 mm must preserve that complete public frame and exact DXF source/radius. Before the second explicit Fit, it additionally requires identical host/overlay rectangles. Only with those preconditions does it demand an exact 100 mm X-center shift, zero Y shift and identical span, followed by the original actual-pixel/no-occlusion checks.

This is a sound conditional invariant. Initial automatic Fit runs before the tree's expansion effect; comparing that earlier layout directly against a later explicit Fit mixed different occlusions. The prior 99.671 mm difference did not establish a geometry or renderer regression. The final test keeps the initial-entry visibility proof and now explicitly tests translation under one unchanged layout. No product change, sleep, skip, timeout increase, or weaker numerical assertion was introduced. The solid physical-picking region is unchanged from its reviewed freeze.

Read and independently evaluated root's actual fresh CUA report `C:/Users/cristian/code/Wire_EDM/tmp/cad-node24-far-svg-stable-fit-report.json` (SHA-256 `9549C1E94C70407258C3D446BEB31BC297E90EB0AF6842F934DC802E6A2D4510`). Its before/after overlay arrays are exactly equal, the geometry edit retains the original center, explicit refit shifts X by exactly 100 and Y by 0, span is exactly unchanged, and refit retains the accepted edited document version. This reviewer did not operate the browser. The full repaired GitHub E2E run remains root's execution gate.

Final strict two-CAD-spec TypeScript and discovery of exactly these two far-origin cases passed on Node 24.22.0 (`tmp/cad-local-svg-final-e2e-type.log`, `tmp/cad-local-svg-final-e2e-discovery.log`); diff checks passed. All five production render-file hashes above remain unchanged. No further test execution was necessary for this isolated harness ordering change.

Final exact E2E-region snapshot, UTF-8 source through the next top-level test, is stored in `tmp/cad-local-svg-final-e2e-region-hashes.json`:

| Final region | Bytes | SHA-256 |
| --- | --- | --- |
| Far-origin imported Sketch | 7,296 | `C038203AE0A56F820619BB0D9A34B5A084D995ABDC45BF42B6183E36FA99DF77` |
| Small far-origin solid physical picking | 6,733 | `FA6E4D2CCED3F432254C61B516ADA15C2E8227C885C31A703B9FEBA6EC962E85` |
