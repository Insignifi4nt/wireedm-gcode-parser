# Independent keyboard Extend review

Bounded read-only review of the working-tree patch against `029f48d`, 16 October 2026. Reviewed `CadSketchBoundaryPreview`, Canvas ownership/menu integration, the added existing Canvas regressions, the eleven-line production-journey augmentation and public documentation against the [keyboard Extend seams](2026-10-16-sketch-keyboard-extend-seams.md). No production edits, test runs, builds, package writes or repeated domain certification by this reviewer. Unwired arrangement is excluded.

## Result

No actionable defect found. The keyboard handler passes the actual focused SVG entity ID, which is checked against the current prepared graph as a line and excluded by the Points filter. The synthetic projected position anchors the menu and pins its frame; it does not select the entity, choose an end or supply a cut parameter. Focused points, background and nonline geometry retain the previous selection/fallback behavior.

Both explicit end alternatives use the same factored query/allocation/error helper as pointer Extend. They are prepared once on opening; focus and activation reuse their stored witnesses and endpoint IDs. The active end is typed state and participates in capture identity with the alternatives. Hover/focus changes only preview; it neither changes source nor silently substitutes the other end when one is unavailable. Keyboard Extend offers no Split/Trim operation from its synthetic anchor.

Pointer behavior retains the original nearest-end decision, exact midpoint rejection and pointer Split/Trim path. The common Extend item closure submits the captured edit after synchronous menu close using the existing submission owner and AbortSignal. Source/document/version/filter/cancel/tool/preview checks still guard the menu, and actual frame and foreign-operation checks still protect activation and pending completion. Accepted-only endpoint selection and existing focus restoration remain in place. No schema, public operation or domain algorithm changed.

## Evidence and limits

Inspected the two meaningful RED cases in `tmp/sketch-keyboard-extend-red.log` and the related three-file 97-case GREEN in `tmp/sketch-keyboard-extend-focused.log`. The focused fixture puts competing geometry at the synthetic anchor, checks that the real focused line owns both ends, verifies differing exact previews and stable IDs across focus changes, and checks one exact submission. The second case exercises Shift+F10 dismissal/focus restoration, replaced-version menu invalidation, and an actual frame change aborting deferred acceptance without late selection. Existing pointer tests remain in that focused set.

The existing complete Extend production journey now previews keyboard start/end availability, dismisses with restored line focus, and checks that keyboard acceptance produces the exact same source as pointer acceptance before retaining its previous agent, material, Undo/Redo and save/reopen checks. Root's final rebuilt production/native evidence follows. This slice does not make Split/Trim location-independent, change numerical acceptance or claim sketch completion.

## Root production acceptance

Full app TypeScript/build, documentation/discovery/source distribution, shared UI and icon integration pass. All three complete Split/Trim/Extend journeys pass in Chromium and Firefox on the frozen final build (`tmp/sketch-keyboard-extend-{chromium,firefox}.log`). The augmented Extend journey first failed on the prior frozen build at its missing keyboard end action (`tmp/sketch-keyboard-extend-journey-red.log`). Focused types pass. No broad test-suite rerun.

Native browser proof uses a plate with a short bottom edge and a real transverse construction edge at its start, so a screen repick there would encounter competing geometry. A native click focuses the actual bottom line; Shift+F10 opens both end choices. Arrow focus changes the preview from existing endpoint `f` to existing endpoint `c` while the complete source stays exact. Escape restores focus to `ab`. Reopening and using Arrow/Enter extends the end to `c`, then a second keyboard action extends the start to `f`. All eight original points, three other directional relations and all other edges remain exact. Only the bottom line's endpoint operands and its own H/V operands change, under the already accepted direction policy.

The resulting cell is 200 mm². A normal native WebMCP explicit-area Pad with distance text ` 5e0 ` creates one solid, volume `999.9999999999998` mm³, bounds `[0,0,0]`–`[20,10,5]`, and no diagnostics. Four Undo operations restore the disposable native draft to zero features, no parameters, no undo history and no pending workflow. No user record was saved. Images: ignored `tmp/sketch-keyboard-extend-preview.png` and `tmp/sketch-keyboard-extend-solid.png`.

No broader active-source publication policy changed, and no accepted-controller defect was demonstrated. Normal controller version guards remain authoritative. No persistent schema/storage/native rebuild, installed post/machine change, app version bump or remote action. The next planned slice is relative X/Y dimensions; the overall local-only goal remains active and incomplete.
