# Initial Sketch Fit and selected tree expansion

## Scope and real evidence

This bounded follow-up starts from checkpoint `b0be1bce26f8eb671d27d17d17a33812afd52443`. The earlier short-label automatic-versus-explicit Fit difference did not prove a product defect. The question here is whether selecting a valid sketch expands the specification tree after initial Fit and then covers a real contour boundary.

The accepted fixture is document `Fit`, sketch `outline` named `S`, on XY at offset zero. Its one nonconstruction rectangle is positioned at [100000000,100000000], width 40, height 20 and corner radius zero. The contour is named `Outside contour for complete mounting plate stock and final wire-cut boundary`, 77 characters within the existing 160-character label schema. Shared `parseCadDocument`, `resolveCadSketchRegions` and `measureCadSketch` accept it, resolve one region with no voids and report exact material area 800 mm². An ignored portable copy is `tmp/cad-initial-fit-long-label-fixture.cad.json`, SHA-256 `4a74b8fe1bfa129e6882adc15419f195f7fc9cd18a59b7eeee663dbac2ad87f7`. The offline candidate projection only guided the probe; it is not treated as browser proof.

The parent then reproduced the fixture through CUA in a disposable tab at the frozen checkpoint. The SVG viewport is 1280 × 680 at y=40. The actual rectangle starts at [219.3249969482422,183.683349609375] and has width 661.933349609375, height 330.9666748046875. After automatic tree expansion, the opaque selected `S` row occupies x≈64.333 to345, y167 to197. The real rectangle corner falls inside that row, and the browser's hit test returns `<span class="cad-feature-name">S</span>`. The screenshot visibly hides the top-left boundary under the selected row. Measurements remain 800 mm² and perimeter 120 mm; no accepted geometry changed.

Primary-checkout evidence:

| File | SHA-256 |
| --- | --- |
| `tmp/cad-initial-fit-long-label-before.json` | `e54612a27fbfef04d6c81038ec4d9556b3e288b51ab422c150b786ffe8089881` |
| `tmp/cad-initial-fit-long-label-before.png` | `83cdd0e6d78db7cf2e97a2ccedc44e804553c7b2a0e22639b9b4fb21f0693b45` |

The public initial frame is center [100000025.42098896,100000008.1367723], span 41.09175156148864. The important evidence is the real boundary covered by the real row, not that frame's difference from a later Fit.

## Cause and minimal repair

`CadWorkbench` renders Canvas before the tree and reads current tree/properties/dock rectangles only when fitting. The Canvas initial Fit runs in a layout effect. `CadFeatureTree` previously opened newly selected features and collapsed parent branches in a passive effect. Its overlay has `width: max-content` capped by `min(340px,42%)`. Initial Fit therefore read the preceding narrow tree; the later long row widened the overlay and selected-parent background.

The repair keeps selected-ID ownership, expanded feature IDs and branch IDs in the same existing tree view state. When the controlled selected ID changes, a guarded update to this component's own state reveals the feature and its part/model ancestors during render. React reconciles that local update before commit, so the sibling Canvas layout effect reads the final tree DOM. Manual toggles update the same state without changing its remembered selected ID.

No camera, Canvas, fitting algorithm, tolerance, observer, timer, compensation offset, schema, tool API or layout CSS changed. Ordinary accepted geometry edits with the same selected ID do not reopen manual collapses or reframe the live Sketch. Selection changes retain the existing automatic-reveal behavior. Reference/parameter branches, sticky expanded feature history and rename/lock ownership remain intact.

## Red and green checks

`CadSketchInitialFit.test.tsx` mounts the real Canvas and real Tree in the current sibling order. Jsdom does not implement CSS layout, so its existing Fit-area-reader seam returns measured clear widths based on whether the actual profile row is already rendered. Neither component's lifecycle is mocked. The test first collapses both parent branches, then selects the sketch while entering its Canvas. The original source commits the final long row but fits the contour against the old width. The regression fails with projected boundary X `216.99999995231627`, below the final tree edge340. The repaired source fits clear of that edge and within the viewport.

The second case verifies exact public frame retention through manual collapse, a normal rerender, a valid geometry-width edit, reopening the row, deselection and a fresh automatic selection reveal. It verifies the manual collapse remains respected until a genuine selection change. The fixture's exact original document is retained during view-only first entry.

Node v24.22.0 checks:

- Red log `tmp/cad-initial-fit-long-label-red.log`: one initial-Fit failure, one frame-retention pass.
- Green log `tmp/cad-initial-fit-long-label-green.log`: 100 tests across `CadSketchInitialFit`, `CadFeatureTree`, `CadSketchCanvas`, `CadDatumEditing` and `CadWorkbench` pass.
- Application TypeScript and scoped `git diff --check` pass.

## Priority CI datum assertion repair

[CI run 38615078527](https://github.com/Insignifi4nt/wireedm-gcode-parser/actions/runs/38615078527) at the checkpoint passed 3,862 cases and failed the existing datum editor test's absolute SVG `cx=2` expectation after display rebasing. The same failure reproduced locally: expected2, received0. This was a stale assertion, not altered datum geometry.

Only the existing placement-editing case in `CadDatumEditing.test.tsx` changed. It now verifies local SVG center0,0, radius1, zero display placement and complete circle containment in the visible SVG frame. Its independently worked world point is [12,20.598076211353316,34.96410161513775] for the original translated, 30°-rotated datum and offset4. Exact imported geometry, original source text, `lift / 2` offset expression and the full restored document are retained. Cancel preserves the exact accepted version/history, and Undo/Redo restores the entire original/applied document atomically.

The priority green run passes 56 cases across the datum editor, local-coordinate, Canvas and direct-manipulation files. Logs are `tmp/cad-datum-local-coordinate-red.log` and `tmp/cad-datum-local-coordinate-green.log`. Production datum/frame code is untouched.

## Frozen implementation hashes and remaining gate

The parent's fresh production bundle `main-BwYHhAH4.js` now passes the actual first-entry probe without manual Fit. The exact rectangle spans screen `[411.400,226.367]..[902.600,471.967]`; the same selected tree row still ends at X345 and Y197. The formerly obscured top-left boundary now hits the actual SVG rectangle. The full canvas remains 1,280 × 680 pixels. Manual Collapse S and Expand S leave the complete public view byte-for-byte unchanged. The disposable fixture contains this exact rectangle plus two separate near/far gear-help sketches. Complete public document readback confirms all three feature definitions/packages/inputs match their fixtures, the version remains unchanged and no Undo/Redo/workflow state is created. No Save occurs. Evidence is in primary workspace `tmp/cad-initial-fit-long-label-fixed.json/png` and `cad-followup-browser-source-proof.json`; the disposable tab closes afterward. Full GitHub verification remains separate.

| File | SHA-256 |
| --- | --- |
| `src/features/cad/CadFeatureTree.tsx` | `226eddc46c12ca5e7444294541c42c94adc1f82854850a1044817772922843e9` |
| `src/features/cad/CadSketchInitialFit.test.tsx` | `ead92dde8b6da54922206cbd994edbc19d40653ae70768bf6162f112bdf2161d` |
| `src/features/cad/CadDatumEditing.test.tsx` | `2848ddcebddf1e451ef38aa509ab66a28f3dfe70a45081409d2e883b25a577b8` |

The owner made no browser, server, commit or push actions. The parent owns the fresh actual-browser after-repair probe and full CI gate; the research agent owns independent frozen source review. Those results must be recorded separately, and this bounded repair does not complete the overall CAD goal.
