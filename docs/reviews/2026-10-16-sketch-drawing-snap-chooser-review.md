# Independent drawing snap chooser review

Bounded read-only review of the working-tree patch against `aeb61d3`, 16 October 2026. Scope: `CadSketchCanvas`, new `CadSketchSnapChooser`, the additive context-menu paging behavior, focused picking regressions and the new stacked-identity production journey. No production edits, package/build commands, broad tests or arrangement review were performed by this reviewer.

## Repaired parent feedback

During review, the implementation author's self-review found a real parent integration failure: the chooser publishes drawing pending, Workbench consequently sets `viewLocked`, and the chooser had treated that camera-navigation lock as a foreign operation. Its own pending publication therefore dismissed the menu. The focused parent-like regression fails before the repair in `tmp/sketch-drawing-snap-chooser-owned-lock-red.log`; root's actual production journey also fails to find the menu in `tmp/sketch-snap-choice-parent-red.log`.

The repair removes only `viewLocked` from the chooser's foreign-lock predicate. Read-only source recheck confirms that actual SVG-frame equality, captured source/parameters/document/version, draft/tool/settings ownership, external interaction locks, submission/graph activity, overlap ownership and displayed-preview guards remain. Camera controls still honor their existing navigation lock. The final related three-file set passes 85 cases in `tmp/sketch-drawing-snap-chooser-focused-final.log`, including the parent feedback variation.

## Final bounded result

No remaining actionable defect found. A chosen Path target retains its exact source point ID; numeric position-only placement and opt-in fresh-shape coincidence keep their existing semantics, including position-only circle radius placement. Ambiguity does not select an arbitrary ID, merge points or silently fall back to the grid. Dismissal preserves the existing unfinished path and swallows the outside trailing canvas click.

The synchronous close-before-action menu behavior uses the latest placement handler, so the chooser's own pending state cannot block its choice while normal foreign/submission guards remain active. Acceptance rechecks the captured owner and actual DOM frame. Source replacement, settings/draft changes, cancellation, blur, resize and frame movement close or reject the old choice. The captured intent is independent of pointer movement over the menu.

Paging mounts at most twelve candidates plus navigation rows, keeps every tied candidate reachable and focuses the new page. Existing menu consumers retain close-on-select behavior. Source owner strokes and the exact candidate glyph are highlighted without changing accepted selection or geometry. Chooser presence and candidate highlight enter the rendered-view revision, so capture guards see those canvas changes. Escape/Tab dismissal returns focus to the canvas.

The new production journey checks exact stacked endpoint choice, untouched source during cancelled choices, foreign-operation rejection, human/agent structural equality, material, save and reopen. Root's final rebuilt acceptance is recorded below; passing this slice does not claim full sketch completion.

## Root production acceptance

The final rebuilt journey passes in Chromium and Firefox (`tmp/sketch-snap-choice-{chromium,firefox}.log`). The original frozen build and the first integration build both fail at the intended missing-menu assertion. Full app TypeScript/build, documentation/discovery/source distribution, shared UI standard and icon integration pass. Focused Canvas/picking/Path cases pass 85/85; scoped types pass. No wholesale test suite was rerun.

Native in-app browser verification on the final build opens the chooser at actual painted off-grid coordinates. The first focused item highlights the actual endpoint and owner, while the separate orphan point remains an explicit alternative. Escape closes the first choice with the source unchanged and no pending workflow; Escape on the second choice retains the unfinished first Path pick and keeps Finish unavailable. Deliberate Point 1/Point 2 choices append exactly one line from `a` to `b`, retaining all six original point records and all three directional relations.

After Undo, native WebMCP proposal inspection and an ordinary exact-ID append recreate the human sketch structurally, with one 200 mm² cell. An explicit-area Pad with distance text ` 5e0 ` produces one native solid, volume exactly 1000 mm³, no diagnostics and bounds approximately `[2.1,3.2,0]`–`[22.1,13.2,5]` (the kernel reports the lower Y as `3.1999999999999993`). No saved user record was changed: two Undo operations restore zero features, no parameters, no undo history and no pending workflow. Screenshots: ignored `tmp/sketch-snap-choice-menu.png` and `tmp/sketch-snap-choice-solid.png`.

No domain algorithm, persistent schema/storage migration, native rebuild, installed post/machine change, version bump or remote action. The unrelated arrangement files remain unwired. Next: the bounded keyboard Extend plan, then relative dimensions and remaining reference/geometry inventory. The overall local-only sketch goal remains active and incomplete.
