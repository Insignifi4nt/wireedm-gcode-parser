# Far-origin Sketch rendering and physical solid picking

## Evidence and scope

The original two journeys failed in all three attempts of [CI run 38606111258](https://github.com/Insignifi4nt/wireedm-gcode-parser/actions/runs/38606111258), against `8375c294d09e0a43b48b7c37d977cc59fd9a4065`. The review downloaded its existing `browser-test-report` artifact into ignored `tmp/cad-ci-far-origin-artifacts` and read its PNGs and trace JSON without launching a browser or executing the report HTML.

The solid screenshot contains the exact 2 × 2 mm cyan face around screen position 807,439 in the 1440 × 900 test window. Its former raw canvas-center click misses the body. Fit deliberately reserves the floating tree, properties and command dock, and existing renderer tests independently project far-origin vertices into the available area. The old fixed canvas-center and private `170` camera-extent assumptions are obsolete.

The Sketch failure initially looks similar. Its public frame is `[100000003.06361607,99999998.83458647]` with span `32.33082706766917`, rather than the old fixed center and span 30. That difference is valid overlay-aware Fit. However, the screenshot is completely blank. The CI trace contains the expected circle, `cx=cy=100000000` and `r=12`, inside a world-coordinate SVG viewBox `99999975.9959469 -100000015 54.13533834586466 32.33082706766917` and an enclosing Y flip.

The parent reproduced the actual blank circle through CUA in an isolated user-authorized tab. Its authored geometry and 452.389 mm² measurement are correct. Its rendered SVG circle rectangle is around `x=-1509479424,y=1509479808,width=height=512`, far outside the design area. Parent evidence is `tmp/cad-node24-far-circle-before.png` and `tmp/cad-node24-far-circle-before-dom.json` in the primary checkout. This establishes a real display precision failure, not a reason to weaken the view test.

The owner edits only the related Sketch render components, their focused regressions, the two assigned far-origin E2E blocks and one parent-approved Workbench assertion. Other owners' E2E repairs remain separate. No schema, native geometry, tolerance, source document, storage, tooling API, layout, CI, timeout, server or release change is part of this slice.

## Repair and invariants

The SVG viewport uses a small frame centered on zero. Public `centerMm`, fitting, pointer-to-world conversion, profile picking, snapping, keyboard cursor, contour translation, plane coordinates and dimension projection retain their existing world millimetres.

`CadSketchProfileGeometry` prepares exact analytic geometry once per immutable geometry/parameter pair. Each profile subtracts its analytic-bounds midpoint in JavaScript numbers before producing SVG coordinates. Core circles, rectangles, polygons and rotated slots retain their primitives. Paths and plugins retain one continuous analytic boundary, with the same radius and arc flags. Navigation changes only a small placement transform from that profile origin to the current world view center; it does not resolve a gear or regenerate the cached path on every pan.

Saved and provisional Curve chains cache their numeric segment content near their first segment. Live arc/line previews and draft markers subtract the current world center. Gear inspection uses the gear's own center for its circles, root/flank segments, sample markers and rotation marker. Grid phase is the world center modulo grid spacing, with the existing Y convention. World axes outside the visible frame are not emitted as huge offscreen paths.

`cadArcSvgPath` and `cadClosedBoundarySvgPath` accept an optional display origin. Their previous default remains zero. Subtraction precedes SVG serialization, including the opposite point of a full-turn arc. No resampling, simplification, chord tolerance, segment count, requested accuracy or native calculation changed.

The existing builtin gear package restricts placement to ±1,000,000 mm. Gear cases therefore run at its accepted 500,000 mm placement. Generic profiles, saved Curve and drawing cases run at ±100,000,000 mm. This repair does not silently alter package ranges. It also does not claim unlimited floating-point resolution for a single contour whose own extent spans enormous distances; the measured defect is a small contour far from the world origin.

## Meaningful red and green checks

Before production edits, the new circle regression failed on an SVG viewBox coordinate of `99999970`, where the test requires bounded display coordinates. It also verifies radius 12, exact expression/source retention and unchanged public world center. The original CI PNG and actual parent CUA reproduction provide the rasterized symptom that jsdom cannot certify.

The focused local suite exercises all six profile kinds, immutable source retention, parameter invalidation and cached geometry identity across navigation. Additional cases cover negative-world-Y pointer selection, grid phase, snapped keyboard circle creation, local preview/marker coordinates, saved Curve lines and analytic arcs, exact mixed line/arc creation and correlated gear inspection.

Three existing pointer fixtures now project their requested world points using the actual public controls center and local SVG viewBox. Pan lifecycle assertions read the public frame rather than relying on a world-coordinate viewBox changing. Their original selection, six-pixel tolerance, pending workflow, cancellation, pointer ownership, translation, source, constraints and Undo assertions are retained.

The complete affected run initially passed 173/174 cases. Its sole failure was the Workbench test's literal pre-rebase path prefix. With parent authorization, that assertion now independently verifies line displacement 20,0, radius 10, minor CCW arc flags and closure. Its exact domain/source/metadata checks remain unchanged. The final Node v24.22.0 focused run passes **174 tests across 10 files**, recorded in `tmp/cad-far-origin-render-focused.log`. Application TypeScript, strict two-CAD-spec TypeScript, focused Playwright discovery and `git diff --check` pass.

The far-origin Sketch E2E now checks substantial actual circle bounds, a square rendered aspect, full viewport containment and no overlap with visible tree/properties/dock rectangles. Its PNG must contain more than 400 outline pixels. It preserves this initial-entry check, then waits for the real `Contour 1 profile` tree row and explicitly fits before recording its translation baseline. It records the actual viewport client dimensions and viewport/tree/properties/dock rectangles, and requires those exact layout values to remain unchanged before comparing the second Fit. A 100 mm geometry move preserves that baseline's public frame, original DXF text and radius 12; explicit Fit must then shift the frame by exactly 100 mm with identical span and accepted version. These are real raster/DOM checks, not success inferred from correct metadata.

The solid journey derives the single fitted face's bounds from its actual unhighlighted PNG, maps image pixels to CSS canvas pixels, then physically clicks the visible face center and right edge. It preserves native volume 8 mm³, face and edge topology assertions, more than 100 face-highlight difference pixels, both rendered captures and unchanged accepted version. New width/height assertions require the face to retain more than 20 visible pixels per side. It no longer duplicates private camera projection constants.

No browser was launched by this owner. Parent fresh production build and actual CUA evidence are recorded below. Full E2E execution remains a separate parent gate. Independent source review is owned by the explicit-dimensions agent. This report does not declare the full E2E gate or the overall CAD goal complete.

## Frozen SHA-256

| File | SHA-256 |
| --- | --- |
| `src/features/cad/CadSketchCanvas.tsx` | `b8e891b2095ded0c8997fffaac9b1d470d9563407f67664b0d8047d5f2d2cd48` |
| `src/features/cad/CadSketchProfileGeometry.tsx` | `49a3a0c4f61754e37b544a5140d6b6f94bf36ee25431fa9c9329efa0d4befe2c` |
| `src/features/cad/CadPathDraftGeometry.tsx` | `c35e8c0a90808aa95b47a2218bcd2934cfae88952f957e67a0a154b452909ca8` |
| `src/features/cad/CadGearInspectionOverlay.tsx` | `79442d4164896048c115eb60cbf081192927d38c445ad317a806536615ef668a` |
| `src/features/cad/cadSketchSvg.ts` | `47bd556f9d6370bf925a4eb844dd5e50e415ab0da1d0641de73e8ad00a726d6d` |
| `src/features/cad/CadSketchLocalCoordinates.test.tsx` | `62351f0c5d329b1acdc400517c843e7176da01c72ee87c77024f8c64052d6fe3` |
| `src/features/cad/CadSketchCanvas.test.tsx` | `b663d9e32f83775a53e6561eb7cba69716f77d515894f3eb449bc2474b30eb77` |
| `src/features/cad/CadSketchCanvasPicking.test.tsx` | `c4c1e5919a33c1f199c04d05a4ff38c989ac51e0e95ec5072a2c81a977b2a2bc` |
| `src/features/cad/CadSketchDirectManipulation.test.tsx` | `be1790c7ac2a4523dd4afbf0d4a722faa6e9e69e4e1586739aa6be460ed560d9` |
| `src/features/cad/CadSketchPathDrawing.test.tsx` | `da6db256a661a452a74885f5da6eb09e5ede770f45a8b237f36730242b14391d` |
| `src/features/cad/cadSketchSvg.test.ts` | `f9abc2f8aca8b72fbf35db26f0db96b339bdf4fc30e36c8f9badc7be673d07eb` |
| `src/features/cad/CadWorkbench.test.tsx` | `4587363f6d7e18b82e1d22b7282789563377eaa7087bdc6741302c0dd2f71842` |

The shared E2E file contains other owners' changes, so exact UTF-8 fragments are also hashed separately. At the final precondition-repair freeze, the Sketch block starts at line 1216, is 7,296 bytes and hashes to `c038203ae0a56f820619bb0d9a34b5a084d995abdc45bf42b6183e36fa99df77`. The solid block starts at line 1325, is 6,733 bytes and retains hash `fa6e4d2cced3f432254c61b516ada15c2e8227c885c31a703b9feba6ec962e85`. Whole-file hash is `a65eb41dc438e9cfc867b4b91e06e6b4aba84176a8f694803a7a63829fd6e2c1`. Lines are a snapshot. All production and focused-unit hashes remain unchanged.

The original CI PNG SHA-256 values are `60fe6483c284b20720fcaf6bcf7eeb04f30162f3630b016bac33563587358434` for the blank Sketch and `5eaaa9f59407b8b39e8b43b9399ba334fdaf82b5cc2da96de5c0e4dbba479a6e` for the visible solid before its missed pick.

## Independent frozen review

The explicit-dimensions owner independently confirmed all production and new-test hashes, read the source/interaction boundaries and ran 67 Node v24.22.0 cases across five files. That gate, application TypeScript and diff checks pass. Its review found no actionable source issue and made no source/test edits. The independent record is `docs/reviews/2026-10-14-cad-local-svg-coordinate-independent-review.md`, final follow-up SHA-256 `c577ec932d5774ea7ffe96700637b7d563ef28669a345b0c744e43879657a1be`. It verifies authoritative sketch-plane coordinates, display-local rebasing, drag/grid/arc/cache/dimension/capture consistency and the separate imported-path E2E conversion. Its final follow-up also independently accepts the explicit-Fit baseline, unchanged-occlusion assertion and exact translation proof below. Full CI execution remains a separate parent gate.

## Fresh browser proof and the Fit comparison precondition

After the frozen repair, the parent imported the exact original DXF in a fresh disposable CUA tab and entered Sketch. The circle is visible with width/height about 494.67 pixels; its local SVG center is 0,0 and radius is 12. The public world coordinates, exact geometry and source text remain intact. The downloaded 1280 × 680 PNG contains 45,121 bytes and SHA-256 `52137bbab5b8c32ce723fe216f53ff02eac39ef417692be191f30f666a9838e2`, exactly matching the guarded capture receipt. Primary-checkout evidence is `tmp/cad-node24-far-svg-browser-report.json`, SHA-256 `b9944b413bcb1ca4875ac07b686b9907a25dda71012d45908ed8b5a86cd08267`.

That first probe also found a genuine test-precondition problem. Comparing automatic entry Fit to a later explicit Fit yielded an X shift of `99.6712434142828` mm, with the same span. The source's initial Canvas Fit runs in a layout effect; the specification tree expands the newly selected sketch in a passive effect, and its overlay width is `max-content`. The later Fit therefore need not read the same unobscured area. This was not evidence of inaccurate circle or Fit mathematics, and the test must not pretend that two different overlay layouts are equivalent.

The parent repeated the exact DXF journey after the `Contour 1` row was visible and established an explicit baseline Fit. Before and after the 100 mm geometry edit, the actual viewport, tree, properties and dock rectangles are exactly equal. The public center is retained exactly at `[100000003.65321742,99999998.5040442]` through the edit. Explicit Fit then produces `[100000103.65321742,99999998.5040442]`, an exact `[100,0]` shift, with unchanged span `32.991911575561744`. The owner independently read this saved report and verified exact rectangle equality, frame retention, delta and span in a Node script. Evidence is primary-checkout `tmp/cad-node24-far-svg-stable-fit-report.json`, SHA-256 `9549c1e94c70407258c3d446beb31bc297e90eb0af6842f934dc802e6a2d4510`. No additional production change was needed.

The final E2E fixture now makes that same-layout precondition explicit rather than adding waits, increasing timeouts or weakening the numerical assertion. Strict CAD E2E TypeScript, focused discovery and diff checks were rerun successfully. The parent closed both disposable tabs without Save and retained the user's main tab and accepted document.
