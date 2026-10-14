# Independent review of five sketch E2E repairs

## Scope and result

Reviewed `createSketchOnCanvasPlane` and the five explicit-sketch owner's repaired regions in `e2e/cad-workflow.spec.ts` against checkpoint `8375c294d09e0a43b48b7c37d977cc59fd9a4065`, current supported UI/domain source, the owner's private repair record and actual CI report `38606111258`. No actionable defect or weakened assertion was found in these frozen regions. This owner made no product or test mutation and ran no browser or heavy verification suite during the review.

An independent UTF-8 extraction of each top-level declaration through the next top-level declaration reproduced all six expected character lengths and SHA-256 values from `tmp/cad-sketch-e2e-owned-region-hashes.json`. Results are preserved in `tmp/cad-sketch-e2e-independent-region-check.json`; other owners' changes to separate regions do not invalidate this scoped comparison.

## Actual red evidence and preserved semantics

The decoded CI report contains **34 CAD journeys in two files**: 32 workflow journeys, with 24 passed and eight failed; two kernel journeys, both failed. No CAD case was skipped. The full report has 124 tests: 113 passed, ten failed, zero flaky and one existing local-workbench-fixture skip. The five repaired failures agree with the owner's record: polygon expected five unrelated inputs but received six; path Fit was inaccessible with View collapsed; provisional Curve offset was stored as string `"5"`; two drawing journeys waited for the old principal-plane accessible label.

The plane helper now selects the actual `Select XY/XZ/YZ plane in design area` control and still requires the real drawing canvas. It does not bypass sketch creation or supply a silent fallback plane.

The polygon journey discloses the supported exact editor and checks vertex selection plus visible coordinate fields. It still edits two vertices before one Apply, rejects an intervening agent edit, and measures areas 250 → 200 → 250 across Undo/Redo. New readback checks the exact two `width + 5` expressions and unchanged numeric width parameter. Replacing a raw input count with these authoring-state checks preserves the useful invariant.

The imported-path journey opens View before Fit and discloses the exact segment editor after the genuine interior pointer selection. Its rejected discontinuous candidate must retain the accepted version and pending workflow; repairing the neighboring endpoint must commit the same original source with analytic area 250 and native volume 1,250. The existing source, version and geometry assertions remain intact.

The Curve journey's string offset matches the current provisional plain `ScalarField` contract. It now independently verifies YZ placement at 5 mm, world endpoints [5,0,0] and [5,20,20], and analytic length 20 + 10π. Cancellation, agent workflow exclusion, one accepted Curve, exact Redo, save, real DXF download and exact imported source text remain checked. Literal representation is distinguished from resolved placement rather than treated as a change in the mathematical expectation.

The mixed arc/line journey retains the invalid-through-point case and pending draft, and adds readback proving no geometry was prematurely published. Its radius-10 half-circle, closing line, area 50π, empty-sketch Undo, exact full-sketch Redo and volume 500π remain independently asserted.

The rectangle journey verifies a real free shape has no constraint record or width annotation before the Dimension command. Width 53 then creates an actual domain constraint and visible annotation; the pending dimension blocks agent edits. Undo must restore the exact original free sketch, and Redo the exact constrained sketch. The native Pad volume uses 53 times the independently retained drawn height times 10. These stronger checks replace the former partial negative Undo assertion without weakening numeric tolerances. Existing ready-build and save guards remain.

No geometry check, exact-source assertion, workflow guard or Undo/Redo assertion was removed to make the tests pass. No skip or timeout increase was introduced. These five regions contain no removed no-op check; broader no-op behavior is not certified by this scoped review.

## Verification limits and pending integration

The owner reports Node v24.22.0 strict E2E TypeScript, exact five-title discovery, 38 focused existing UI/domain semantic checks and clean diff validation. Those recorded gates were inspected, not repeated during concurrent parent work. Neither source review nor test discovery certifies successful execution of the revised browser journeys; the parent owns the next actual browser/CI gate.

The separately owned far-origin SVG repair was still in progress at the first review. Its render-frame integration is recorded below; this review does not freeze or certify the separate production seam.

## Reviewed region SHA-256

| Region | SHA-256 |
| --- | --- |
| `createSketchOnCanvasPlane` | `C3AD591402F8931E7418CD334689C7F7ECDC22396F2A6E9A6965DF64EF77BA26` |
| Compact polygon | `176706AC29787B6D5FD1975564EB167FEA615A09137BEE991171FF3A70BB9DF7` |
| Imported path | `177722AE81CDE9AF7726F67CE3B9D44C2CDA954B257746817439194AAE6320B9` |
| Curve creation | `20F0BBE0F64ED64A36F9C9209170D50E2258F2349B558BBD5D2C7F13C588903C` |
| Mixed path | `61498522789ADB55EB086C6FF86916F47B0332E00FFDFB49B13F4D0705188D1B` |
| Drawing and dimensions | `FD39F5A927A5E97B404CF9C20EEDB272AACB1CE04F1BC2077DFB01B1EB4F98ED` |

The broader CAD goal remains active.

## Local-SVG pointer integration addendum

The new render frame uses a local viewBox around zero while `cad_get_viewport.view.centerMm` retains exact world millimeters. This owner coordinated with both the production frame owner and original test owner, then updated only the imported-path pointer conversion. It reads the version-pinned public center, checks sketch mode and finite coordinates, and passes local SVGPoint `(10 − centerX, centerY − 5)` through the visible element's native getScreenCTM. The target remains world point (10,5) inside the original rectangle; the Y inversion matches the displayed CAD frame. It still performs a real mouse click and retains every accepted-source, continuity rejection, expression, geometry and workflow assertion.

The original owner independently reviewed this small integration and found no issue. Node v24.22.0 strict TypeScript for both CAD specs/helper, one-title discovery and scoped diff checks pass. The complete CAD-spec scan found no other world/viewBox conversion; other sketch inputs use physical pointer/keyboard actions, and separate solid picking belongs to its existing owner. No product code or browser automation was changed or run here.

The imported-path region is now 5,274 characters with the current SHA-256 shown above, replacing the initial 4,527-character `FE343017736ED4079B598E23C323949EFE6426D639F012A1A4DB900DD419769D` snapshot. Only that agreed machine-manifest row was updated; all six current regions revalidate, with the remaining five identical to the original independent review. Actual execution and the production frame's final gate remain parent-owned.
