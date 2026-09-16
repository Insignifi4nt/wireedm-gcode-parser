# Live app workflow review — 2026-09-16

Context: GitHub Pages build at `a16f267`; Cristian installed the Robofil 100 V2 candidate package and imported the current 45-tooth spur gear DXF as a browser-cache path project. Review was performed in the user's existing browser session.

## Observed path after import

- The editor shows two operations, `Hole 1` and `Exterior 1`, and one diagnostic: a reviewed initial wire position is missing.
- The diagnostic's **Review program setup** action opens **Initial wire position**. This is the only explicit next-step guidance visible from the initial editor screen.
- **Source & Machine Setup** shows the Robofil 100 as the planning reference, source span 140.899 × 140.976 mm within known travel, and DXF units confirmed as millimeters. **Geometry Setup** shows `Wire centre` as the current basis.
- **Export → Open UPID export preview** opens **Controller artifact** with the Robofil 2.2.0 setup selected. Generating reports `EXECUTION_PLAN_INITIAL_WIRE_REQUIRED` while the wire position is missing.
- Cristian confirmed that the DXF represents finished part boundaries and that the first wire position is the gear-hole center. We linked the initial wire to a hole arc center (displayed X −62.010 Y 19.370), changed Geometry Setup to `Finished contour`, and saved the project. The next diagnostic became `Operation Exterior 1 requires an explicit threading transition.`
- Cristian wants the exterior approach to begin on an imaginary 145 mm diameter around the 141 mm outer gear, then lead radially into a tooth center. Any tooth is acceptable.

## Finding: initial wire center list obscures the likely choice

The **Initial wire position** panel displays 126 circular-source-center buttons for this gear: 90 from the exterior followed by 36 from the hole. All 36 hole buttons show the same displayed center, X −62.010 Y 19.370, but have separate arc labels. A new user seeking the gear-hole center has to scroll through the exterior choices and then choose among 36 visually identical locations.

Reproduce: open the imported 45-tooth gear, click **Diagnostics 1 → Review program setup**, then scroll the **Or link to a circular source center** list. The implementation in `src/features/editor/EditorInitialWirePositionPanel.tsx` maps every non-line segment to a button without grouping by center or contour.

Expected improvement: present distinct useful center choices first, grouped by contour and coordinate, while retaining an exact source reference for geometry-linked behavior. The first choice should be understandable without knowing an arc index. Preserve manual X/Y entry for arbitrary physical starting positions.

## Finding: diagnostic action names the wrong workflow

After setting the initial wire and finished-contour basis, the diagnostics panel says `Operation Exterior 1 requires an explicit threading transition.` Its action is labeled **Review contour setup**, but clicking it opens **Between Contours**, where the project threading default and operation threading mode are selected. The destination is useful; the action label misdirects the user.

Expected improvement: label this action **Review threading transition** or **Review between contours**. Verify the diagnostic-to-workflow label mapping for other execution issues.

## Finding: requested exterior rethread sequence is not representable/exportable

Cristian's intended sequence is: finish the hole, rapid to an exterior approach on a 145 mm diameter around the 141 mm gear, let the wire separate during that move, pause at the destination for manual rethreading, then lead perpendicularly into the center of a tooth. The **Between Contours** panel offers `Wire already separated` or `Stop to separate wire` before positioning. It has no choice for separation during positioning. The **Program Stops** panel offers `Before positioning`, `Before contour end`, `After contour`, and `After exit`, but no stop after positioning and before the new contour. In `executionPlan.ts`, `before-entry` stops are appended before the position event; `wire-thread` is appended after it. Thus the user cannot add a free-positioned pause at the requested point through Program Stops.

The installed Robofil 100 candidate post declares `threading: none` and `wireSeparation: false` and explicitly rejects `wire-thread` and `wire-separate`. The package evidence records those sequences as unverified. This blocks the requested two-contour controller artifact even if the UI transition is set to Manual. We did not save a manual-transition draft because neither separation choice matches the stated machine sequence.

Follow-up: model and expose the exact event order, then create a new package version only after confirming the controller commands and their order on the machine. The app should disclose this package capability limit as soon as Manual is selected, rather than waiting for export.

## Confirmed behavior: manually entered G92 point needs an explicit review action

With the saved initial wire linked to the hole center, we entered manual X0 Y0 in **Initial wire position**. The canvas `START` marker stayed at the hole center while the form showed `Coordinates are pending. Review and set the point to update START and the first connecting travel in the preview.` Clicking **Review and set manual point** moved `START` to X0 Y0 in the preview. We discarded this test draft and confirmed that the saved hole-center link remained.

This is functioning as implemented; Cristian retracted the suspected preview bug. The pending-versus-applied state may still be easy to miss. G92 assigns coordinates to the wire's physical location and does not move the wire or change the DXF origin.

Cristian then requested the whole part be centered on the hole at X0 Y0. We targeted **Document** in Transform Geometry and applied X +62.010127, Y −19.370286 mm. The project was saved. The geometry-linked initial wire now reads X0.000 Y0.000, and the canvas shows `START` at the grid origin. The document bounding-box center reads X −0.050 Y0.000 because the gear's source extents are slightly asymmetric; the hole center is the intended origin.

We chose the midpoint of a top tooth for Exterior 1's contour start at X −2.460 Y70.457. **Entry / Exit** accepted a reviewed straight entry from X −2.530 Y72.456, on the requested 145 mm diameter, to that tooth midpoint. These changes were saved in the live browser-cache project. The execution diagnostic still reports the missing explicit threading transition, which was left unset because the installed post cannot emit the stated sequence.

## Open workflow questions

- Confirm the exact machine command sequence for wire separation during rapid positioning and the pause for manual rethreading.
- Test the revised machine package and controller preview after those semantics are supported.
