# CAD final Spec review

Reviewed against `docs/reviews/2026-10-14-cad-hardening-checklist.md` and the referenced usability, plugin, ownership and interaction records. Baseline and HEAD are `c16a15eb9f9805622ccaeda5b39dc2698ddfda8c`; there are no added commits. Scope is the HEAD working-tree diff and complete untracked files pinned by the 143-path source manifest, followed by the coordinated review fixes below. No browser, saved record, PR or deployment mutation was performed by this reviewer.

## Findings resolved

1. **Precision and unchanged edits.** The brief says "Preserve exact numeric/expression inputs" at checklist line 11. On-part Diameter initialized from six-decimal text, so unchanged Apply could turn radius `1/3` into `0.3333335`. Editable plugin aliases also rounded their text; unchanged fx Keep relation converted numbers into strings and created history. Full-precision editor text and unchanged-action guards now preserve the source and history. Final locations: `CadSketchDimensionControls.tsx:81,108,113`, `CadPluginFields.tsx:54`, `CadExpressionBinding.tsx:24–25`. Regressions cover literal numbers, numeric strings, aliases, unchanged numeric relations and compound expressions.

2. **Measurement scope and density.** "Prioritize correctness, direct interaction, clean geometry/lighting and compact UI" at checklist line 7. A selected profile's measurement heading included an unlabeled whole-sketch contour count and full coordinate rows. Area/perimeter remain visible; Measurements discloses bounds and labels the aggregate "Sketch closed contours". Curve length remains visible with Coordinates disclosed. Final locations: `CadSketchMeasurements.tsx:19–20`, `CadCurveMeasurements.tsx:13–22`. Worked ring and placed 3–4–5 rail cases verify values, scope and disclosure interaction.

3. **Partial reference research.** "Research official Onshape, CATIA/3DEXPERIENCE and SketchUp interactions across existing feature families" at checklist line 11. The initial comparison covered extrusion/general interaction. `2026-10-14-cad-reference-interactions.md:28–44` now covers Revolve, Loft/Sweep, edge/Shell, Boolean and placement/pattern families with official primary sources, current local semantics and explicit unsupported/access limits. No runtime feature was added for vendor parity.

## Verification and limits

The first focused run failed seven regressions; the repaired six-file run passed 93 cases. `tsc -b` passed. React component checks found no added hook, focus or accessibility issue. The bundled-plugin repair rejects collisions before writes and preserves diagnosed originals. Final Tree/Workbench follow-up uses the owned eligibility set to disable ineligible rows/links while retaining disclosures (`CadFeatureTree.tsx:43,93,110`, `CadWorkbench.tsx:527`).

No remaining actionable Spec finding was identified in this pass. The root owns final production build, complete suite, actual browser QA and draft/package preservation evidence. Native capacity still rises during the recorded 24-build observation; ownership record lines 23–29 distinguishes capacity from live bytes and retains the upstream destructor limitation. Neither complete native deallocation, current CATIA parity nor physical manufacturing certification is claimed.

## Scoped Fit follow-up

Reviewed the Fit changes after the 147-path checkpoint: `cadFitArea.ts` and its tests, 2D Sketch/Curve and 3D framing, Workbench DOM bounds, and shared capture identity. Native repair scripts/source pairs and the candidate binary were excluded. The applicable requirement is "Selection and inspector minimization leave canvas columns unchanged. Every inspector floats" in the usability record, line 15.

The shared helper computes clear viewport pixels on initial/explicit Fit. Panel changes do not resize columns or trigger a camera fit; the existing guarded viewport operation remains shared. Far-origin, narrow-area, minimized-panel and capture identity regressions cover the change.

One additional defect was reproduced and fixed. A 10,000 mm part fitted into 60 clear pixels at zoom `0.0010187131593365516`; changing to Top recreated OrbitControls and clamped it to `0.01`. `CadViewport.tsx:90` now retains the fitted minimum zoom during recreation. The real-controls regression was red before this change and verifies Top/Front/Top/Isometric plus capture afterward. Five focused files / 123 tests and `tsc -b` pass. No remaining actionable Fit finding. Final production browser/build evidence remains root-owned; the original pending gear tab was untouched.
