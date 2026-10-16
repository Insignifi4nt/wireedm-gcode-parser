# Independent legacy profile position snap review

Bounded read-only review against `a07a948`, 16 October 2026, following the [accepted-position plan](2026-10-16-sketch-legacy-profile-position-snaps-plan.md). Reviewed the new profile-position preparer and tests, shared ranking, Canvas/chooser/hint/label integration, focused picking cases and the new complete production journey. No production edits, added tests, builds, package commands or arrangement review by this reviewer.

## Result

No actionable defect found. The preparer resolves accepted profile geometry once per source profile/parameter snapshot and enumerates its analytic boundaries. Rotated slots use their actual cap centers/tangency joints and signed half-turn midpoints; rounded rectangles use actual boundaries rather than virtual grip corners. Major path arcs use signed sweep midpoints. The existing converter represents complete circular contours as circles, exposing only their centers. Plugin positions come from current generated output; no guessed plugin centroid or semantic input anchor is introduced.

Same-role coalescing uses exact numeric coordinates within one profile only. Other source targets remain distinct, including nearby cap centers and targets from different profiles. Out-of-range numeric positions are omitted rather than advertised as unusable fresh points. New targets are detached/frozen, contain no graph `pointId`/`entityId`, and carry empty graph entity ownership. Transient profile/boundary descriptors therefore cannot become a Path join or inferred coincidence. Existing graph dragging keeps its graph-only preparer.

Canvas prepares from accepted `sourceSketch.profiles` and accepted parameters, separately from visual preview profiles. Memoized numeric source copies and query closures avoid per-pointer plugin resolution. The existing distance/tie ranking includes profile positions alongside graph points; it retains cross-owner ambiguity and preserves the existing exact graph-point-over-graph-midpoint rule. Ctrl/Cmd bypass and owned closure precedence remain intact.

Legacy-only choices no longer require a synthetic graph. The captured drawing owner now includes combined snap preparation, while source/document/version/parameter, draft/settings, cancellation and actual-frame checks remain. Highlighting uses the owner profile and precise marker without changing selection. Shared paged choices retain all candidates; profile labels remain position-only. A placed numeric pick remains detached when its source subsequently moves. Capture identity includes the target descriptor, coordinate and displayed label.

## Evidence and limits

Inspected owner RED/GREEN evidence and meaningful source assertions: 34 pure/prepared cases in `tmp/sketch-profile-position-snaps-final.log`; four new UI failures before implementation in `tmp/sketch-legacy-position-ui-red.log`, followed by the related 101-case GREEN in `tmp/sketch-legacy-position-ui-focused.log`. Owner scoped type checks are clean. Cases cover slot/rounded/path/circle/plugin math, immutable source/package retention, mixed ties, legacy-only choice invalidation, detached drawing with inference enabled and modifier bypass.

The new production journey retains an exact legacy slot, cancels an initial attempt, creates a detached circle, moves the slot parameter, checks unchanged new geometry, and retains Undo/Redo, solid and saved-reopen checks. Final build/browser/native acceptance belongs to root and is recorded below when complete. Persistent legacy/plugin references, arbitrary WebMCP anchor enumeration and exact theoretical generator-curve certification are not delivered. Sketch mode and the overall goal remain incomplete.

## Root production acceptance

Production TypeScript/build, public documentation/discovery/schema checks across 98 files, corresponding-source distributions, shared UI checks and icon integration pass. The three affected complete journeys pass in Chromium and Firefox: the new legacy-slot drawing journey, stacked graph snap choice and the existing off-grid plate/bore workflow. The new journey is RED on the preceding frozen build because no profile-position hint exists. Its final form uses one exact keyboard grid step for radius 5 after acquiring the off-grid center, then verifies the detached source, reference movement, Undo/Redo, native solid and exact save/reopen. An intermediate mouse-radius assertion incorrectly expected an unsnapped screen pick to have ten-decimal nominal precision; the retained log records that test-only failure. The final exact keyboard input avoids a pixel-dependent oracle without changing any geometry acceptance tolerance.

Native in-app browser acceptance separately picks the real rotated construction-slot center at [2.1,3.2] with Create relations checked. The visible hint says Reference slot / Center / Position only / No relation. Escape retains the original feature, and repeating the pick plus a keyboard step accepts one fresh circle point, radius 5 and no relations. Changing exact parameter `slotX` from 2.1 to 12.1 leaves the complete accepted sketch definition structurally identical, including the detached center. Explicit area Pad retains ` 5e0 ` and builds one 392.69908169872417 mm³ solid (125π) with bounds [-2.9,-1.8,0]–[7.1,8.2,5] and no diagnostics. Four Undo operations restore the empty test draft; no user record was saved and no display/navigation preferences were changed. Proof: `tmp/sketch-legacy-profile-position.png` and `tmp/sketch-legacy-profile-solid.png`.

Root logs: `tmp/sketch-legacy-position-journey-red.log`, `tmp/sketch-legacy-position-build.log`, `tmp/sketch-legacy-position-{chromium,chromium-exact,firefox,firefox-exact}.log`, `tmp/sketch-legacy-position-ui-standard.log` and `tmp/sketch-legacy-position-icons.log`. Browser follow-ups change only test input to exact keyboard radius; the tested production build remains frozen.

## Pending-release compatibility checklist

| Surface | Result |
| --- | --- |
| CAD saved schema and existing documents | Unchanged. New snap descriptors are transient numeric-source metadata; no migration or persistent reference is introduced. |
| Existing graph Path joins, coincidence and point drag | Their original identity contracts remain; profile positions cannot supply graph IDs. Related complete browser workflows pass. |
| Plugin packages and generated geometry | Exact packages/scalars remain authoritative; current generated boundary positions are copied once per accepted snapshot, with no new approximation. |
| Agent tools | No new write/read contract. Existing numeric append and checked application operations remain supported; arbitrary generated-anchor enumeration remains unavailable. |
| Storage and installed machine/post packages | No adapter, stored revision, package schema, execution, output, installation or audit change. |
| Release actions | Local checkpoint only: app version remains 0.0.699; no push, PR, merge or deployment. |
