# Shared controls integration review

Independent bounded review against `6e85fd84ac85893fd0eff516031f223aeab507d8`, including the complete current source diff and untracked shared controls in `cad-shared-controls/Wire_EDM`. Scope follows the CAD migration and workbench foundation records: uniform controls, customizable native picker, stable help/menu triggers, native editing contracts, dense source fields and retained workflow guards.

## Regressions repaired during review

- **Escape ownership:** focusing the titled CAD Length input mounted Radix's document-capture dismissal layer. The first Escape consumed the event without cancelling the scalar draft; composing Escape was also prevented. This violated the requirement to preserve keyboard behavior. The existing Save/native-undo/IME regression now actually focuses the input, and a separate first-Escape regression exercises draft cancellation. Both failed before repair. `src/components/ui/tooltip.tsx:16` now installs a listener only while help is open; window capture synchronously closes help before Radix consumes the original event. It neither modifies nor redispatches that event, and removes the listener on close/unmount. This preserves the native/IME and feature-owner handlers without CAD exceptions.
- **Multiline tree density:** the shared 24px button height compressed endpoint-topology, cut-sequence and endpoint-detail commands containing multiple text rows. Root restored content-driven height with `h-auto min-h-6` on those three consumers in `EditorPathNavigatorPanel.tsx:1433`, `:1925` and `:2856`. The gapped-rectangle fixture already exercises the additional endpoint cluster/diagnostic rows. Compact single-line defaults remain appropriate.
- **Compact workflow heading:** the Categories Back command inherited full-width menu styling inside a flex header, pushing its group title out. `EditorWorkflowMenuBar.tsx:195` now supplies `w-auto` for that command.

## Verification and limits

Reviewer rerun after repair: **3 passed**, covering focused scalar Save/native Undo/IME, first-Escape cancellation and help dismissal inside an isolated keyboard handler. The adapter's lifetime and event ordering were independently inspected. Native host elements, forwarded refs, form/reset/disabled contracts, source typography, stable trigger composition, menu command guards and the CSS `base-select` progressive enhancement showed no further actionable source regression in this pass.

The main agent owns full unit/type/build gates and actual-browser picker, disabled-hover, layout and cross-app acceptance. This review made test/evidence changes only; no browser/storage operations, production edits, commits or pushes. No remaining actionable finding within the bounded source review; final integration acceptance depends on those main-agent gates.

## Pointer-interception addendum

The main agent's first full browser run reported 116 passed, eight failed and one skipped. Three failures used stale CAD File menu selectors, one exercised the repaired Escape regression, and four exposed shared help intercepting pointer actions over compact Back/CAM commands.

The final shared Tooltip uses Radix's public `disableHoverableContent` provider behavior and `.ui-tooltip-content { pointer-events: none; }`. Inspection of the pinned Radix implementation confirms that leaving the trigger closes help and bypasses the content-hover grace area. The CSS also keeps a still-mounted, focus-open help surface from receiving a command's click. Existing shared tooltip payloads are descriptive text or noninteractive markup; no help action is lost. Trigger identity, native handlers, names/descriptions, focus behavior and the Escape adapter are unchanged. Rich illustrated CAD help keeps its separate `CadContextHelp` disclosure, pinning and interactive close control.

This is a scoped repair for the observed pointer obstruction. No additional actionable source finding arose. The main agent is rerunning the eight failed browser journeys against the final production build and owns their results and final full gates; this addendum does not claim those pending runs passed. No extra test run or production edit was performed by this addendum.

### Final browser follow-up

The first pointer repair exposed one further hit-test owner: Radix's positioning wrapper also has a box. The shared tooltip stylesheet now makes both the owned tooltip content and its exact Radix wrapper pointer-transparent; no other popover is affected. The final five failed journeys pass in 15.9 seconds with ordinary clicks and unchanged timeouts. The preceding three repaired journeys also pass, covering native import/export and first-Escape cancellation. Across the original complete 125-journey run and targeted repairs, all 124 supported journeys pass; the unchanged optional folder smoke is skipped. This is a combined-run result, not a claim that one final complete run was executed.

React checklist: imports remain focused, field state stays native, tooltip state is local and stable, no render-time mutation/storage or new data fetch was introduced, and the Escape listener exists only for open help and cleans up on close/unmount. Shared disabled/invalid/focus states and accessible labels were retained. The tooltip's noninteractive contract keeps hover help from competing with commands; rich pinned CAD help remains separate.
