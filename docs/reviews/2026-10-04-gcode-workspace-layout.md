# G-code workspace layout and coverage review

## Scope and intended tasks

Follow-up to 0.0.695: generalize recognition beyond the example G39 and replace the crowded Machine Program sidebar and stacked inspection layout. UPID remains the geometry and machining-intent editor. Standalone inspection and exact controller-export inspection use one read-only workspace; editable Machine Programs retain their established import, save and normalized-export behavior.

## Visual audit

The running 0.0.695 UI was inspected at 1440 × 900 with a 126-line editable program. Fresh screenshots are saved under `tmp/gcode-layout-review/` as `before-editor-desktop.png` and `before-inspector-desktop.png`.

1. **Editable program — crowded.** A 360-pixel sidebar stacked grouped lines, a collapsible 240-pixel text editor, statistics, parse issues and construction points. Separate vertical scrollers competed for height; opening text further reduced the line list. Repeated section labels consumed code width.
2. **Inspection — constrained.** The source had useful search, paging and linking, but four permanent assumption controls used the top bar and a forced half-height preview left modal details scrolling in a small lower pane.
3. **Compact layout — poor fit.** Fixed minimum heights stacked code and preview into a small window. The redesign must keep the final source line, settings, and bottom actions reachable while preserving the draft and focus.

Keyboard and layout checks supplement visual inspection. This is a scoped usability/accessibility review, not a claim of full WCAG compliance or physical controller verification.

## Changes

- Editable programs get full-height Lines, Text, Summary and Points views. Existing line operations, grouped folding, selection, pins, undo/save and construction actions remain; the redundant line-drawer toggle is replaced by switching views. The desktop code pane starts wider and remains resizable. Small screens switch between Code and Preview.
- The inspector shows source beside a single full-height companion view. Preview, Line, Commands, Issues and Context replace the stacked preview/details split. Compact screens display one pane at a time; command/issue navigation reveals the referenced source.
- Context contains preview assumptions and provenance. Coverage and current source position remain visible. Source and preview stay mounted to retain local navigation state while hidden controls stay out of focus order.
- All numeric G/M commands remain visible in the inventory. The shared catalog expands recognition with scoped descriptions and explicit preview effects. Unsupported motion, unknown control flow and ambiguous numeric blocks do not inherit a stale move. Existing editable-import interpretation is retained where new stricter checks apply specifically to inspection.

## Verification

Baseline: five focused editor suites, 41 tests, passed before the layout changes. Existing behavioral assertions are retained; obsolete drawer/disclosure and stacked-pane expectations now exercise their replacement view controls. The revised compact tests verify actual end-of-program scrolling, draft retention, keyboard tab navigation and reachable construction actions. A new expectation initially assumed the editable importer retained terminal M02; the longstanding cleanup removes it, so the test checks the actual last move without changing the importer.

Final integrated regression run: 210 suites / 2,098 tests pass. The first broad run also exposed one obsolete guide-copy assertion and a 8.14x timing result against the existing path-planning 8x limit. The guide assertion now checks the replacement view instructions; the performance test and its threshold are unchanged and pass both the focused rerun and final full run.

Production build and TypeScript pass, including 27 static documentation pages / 87 checked files and STEP corresponding-source distribution. Generated post-contract parity, all three unchanged Robofil 2.6.0 conformance fixtures and complete machine-package validation pass. Independent implementation and final-delta review found no actionable regressions in draft/save guards, source identity, mounted view state, focus navigation, scoped typography or conservative interpretation.

Fresh after screenshots are `after-editor-desktop.png`, `after-editor-text.png`, `after-inspector-desktop.png` and `after-inspector-compact.png` under the same local review directory. The 1440 × 900 text view has a 746-pixel source editor with verified 12-pixel monospace text; the 360 × 500 inspector shows source and reachable paging without an outer page scroll. The complete Chromium run passes 89 cases; the existing externally seeded-workbench case is skipped without a supplied seed. Coverage includes compact 320/767-pixel editor panes, 360-pixel inspection navigation/focus, standalone exact source, editable save/reload/normalized export, UPID layouts, package installation and exact fresh/saved artifact inspection/download with unchanged cache.

## Command references

The command catalog uses the [LinuxCNC G-code reference](https://linuxcnc.org/docs/stable/html/gcode/g-code.html), [LinuxCNC M-code reference](https://linuxcnc.org/docs/stable/html/gcode/m-code.html) and [Haas mill G-code reference](https://www.haascnc.com/service/online-operator-s-manuals/mill-operator-s-manual/mill---g-codes.html), including [G68 rotation](https://www.haascnc.com/service/codes-settings.type%3Dgcode.machine%3Dmill.value%3DG68.html) and [M97 local subprograms](https://www.haascnc.com/service/codes-settings.type%3Dmcode.machine%3Dmill.value%3DM97.html). These supply scoped descriptions, not universal controller semantics or geometry support. Exact saved post context retains precedence for command labels.

## Compatibility

Release 0.0.696 changes no post/package/UPID/engine or storage schema, controller output rule, installed package or saved revision. Broader inspection recognition is distinct from simulation. Conservative handling can omit fragments that previous inspection drew; the release warning and affected diagnostics disclose this limitation. Public authoring guidance remains usable entirely within the hosted browser app.
