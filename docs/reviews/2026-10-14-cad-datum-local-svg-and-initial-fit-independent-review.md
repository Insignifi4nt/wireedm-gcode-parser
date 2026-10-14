# Datum local SVG and initial Fit independent review

## Datum repair

The actual Node 24 CI run [38615078527](https://github.com/Insignifi4nt/wireedm-gcode-parser/actions/runs/38615078527) at `b0be1bce26f8eb671d27d17d17a33812afd52443` reported 3,862 passing tests and one failure: the datum editing test still expected an absolute SVG circle X coordinate of 2 after the display moved to local SVG coordinates. The production geometry and world-frame contract were not changed to satisfy that obsolete expectation.

Independently reviewed the owner's narrowly changed third case in `CadDatumEditing.test.tsx`. The accepted sketch still stores the exact circle (2,3,radius 1), original DXF source and `lift / 2` offset. With lift 8, datum origin [10,20,30] and 30° X rotation, the independent expected world point is [12,20.598076211353316,34.96410161513775]: local Y contributes 3 cos30 to world Y and 3 sin30 to world Z, while offset 4 contributes −4 sin30 and 4 cos30 respectively. The revised assertion now checks that complete numeric result instead of merely checking that world Z differs from the offset.

The circle uses bounded local coordinates (0,0), unchanged radius 1 and zero relative placement in this centered fixture, and the visible local viewBox must enclose its complete extent. The exact original local profile and source are reasserted after editing opens. The surrounding general local-coordinate tests separately prove authoritative public world centers, unchanged analytic geometry and pointer/keyboard world behavior; the local SVG numbers are not substituted into saved geometry.

Cancel now checks the original document, version and undo state as well as closed workflow. The accepted principal-plane replacement must equal the original sketch with only its plane changed; Undo and Redo compare the complete before/accepted documents. Returning to the datum sketch and opening its editor must leave the exact before-document and redo branch intact. No undo, source, expression or placement assertion was weakened.

The independent Node v24.22.0 command ran `CadDatumEditing.test.tsx`, `CadSketchLocalCoordinates.test.tsx`, `CadSketchCanvas.test.tsx` and `CadSketchDirectManipulation.test.tsx`: **56/56 cases across four files passed**, in 2.85 seconds. Log: `tmp/cad-datum-local-coordinate-independent.log`. The frozen test SHA-256 matches `2848DDCEBDDF1E451EF38AA509AB66A28F3DFE70A45081409D2E883B25A577B8`. No owner file was edited by this reviewer.

## Remaining absolute-SVG expectation audit

Searched all source tests for literal SVG cx/cy, path data, transforms and viewBox reads, then inspected producer provenance rather than changing numeric matches blindly. No additional stale CAD expectation was found outside the already reviewed rendering suites and repaired datum test.

The remaining literal coordinates in `src/__tests__/editorPathNativeDraft.test.tsx` and `src/features/editor/__tests__` belong to the separate unchanged CAM/editor preview. Their world-oriented SVG contract was not rebased by the CAD repair. CAD plugin field/help diagram assertions concern their own explanatory paths or primitive/arc semantics; the shared SVG helper's default origin remains zero, so those expected diagrams do not acquire the CAD viewport's center. Current sketch picking, direct manipulation and path drawing fixtures already project through their public frame; Workbench's remaining viewBox equality asserts unchanged navigation during a draft and is compatible with local rendering.

The first post-rebase full CI provides additional execution evidence for these untouched tests, but the new initial-Fit change remains a separate pending review. No broad repeated suite or browser automation was run for this scan.

## Initial long-label Fit

Parent CUA evidence `tmp/cad-initial-fit-long-label-before.json/png` in the primary checkout shows a real initial overlap: the accepted 40 × 20 mm rectangle begins at CSS [219.325,183.683], while the selected sketch row spans X 64.333–345 and Y 167–197. The rectangle's top-left boundary therefore falls inside the interactive tree row. This is physical DOM evidence, not a reason to weaken mathematical Fit or selection checks.

Independently reviewed the frozen `CadFeatureTree` repair and new `CadSketchInitialFit.test.tsx`. The tree's existing expanded-feature and branch state now records the controlled selected ID in the same value. A selection change conditionally updates only this component's own state during render, and React reconciles the rerender before committing the sibling DOM. The Canvas's unchanged initial layout-effect Fit therefore reads the revealed row's final width. The guard records the new selected ID on its next render and cannot form a render loop; functional manual-toggle updates preserve that record. Equal selection through ordinary rerenders or geometry edits leaves manual collapse intact. Selection null does not manufacture a selection or reopen branches; a genuine later selection still reveals the selected feature and part/model ancestors as before.

The new regression mounts real Canvas before real Tree, matching Workbench order. Its Fit-area reader uses actual row existence to supply the narrow/wide measured-layout cases because jsdom cannot lay out CSS. The unchanged old implementation fails with boundary X 216.99999995231627 inside the final 340px tree. The fixed implementation clears that final edge while remaining inside the viewport. The second case preserves the complete public frame through manual collapse, a normal rerender, accepted width edit, manual reopening, null selection and fresh reselection. No mocked lifecycle, forced extra Fit, timer, observer, tolerance, camera or Canvas implementation change is involved.

The independent Node v24.22.0 gate ran initial Fit, tree, Canvas, datum and Workbench: **100/100 across five files passed** in 8.35 seconds, log `tmp/cad-initial-fit-long-label-independent.log`. Two additional ignored private DOM probes passed, covering complete different-document replacement with cleared selection and same-ID document replacement with sticky manual collapse followed by deselect/reselect. Both preserve exact originals and invoke no mutation callback. Their source/log are `tmp/cad-tree-view-independent.test.tsx` and `tmp/cad-tree-view-independent.log`; they do not alter repository test discovery or an owner's files.

Frozen SHA-256 values match before and after these checks:

| File | SHA-256 |
| --- | --- |
| `CadFeatureTree.tsx` | `226EDDC46C12CA5E7444294541C42C94ADC1F82854850A1044817772922843E9` |
| `CadSketchInitialFit.test.tsx` | `EAD92DDE8B6DA54922206CBD994EDBC19D40653AE70768BF6162F112BDF2161D` |
| `CadDatumEditing.test.tsx` | `2848DDCEBDDF1E451EF38AA509AB66A28F3DFE70A45081409D2E883B25A577B8` |

No actionable source or test defect was found. The parent owns fresh raster and full CI verification; the DOM checks do not substitute for that physical browser gate. No owner production or test file was edited by this reviewer.

The overall CAD goal remains active.
