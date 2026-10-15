# Actual Workbench Icon Review — Luna

Reviewed 2026-10-14 in the running app at `http://127.0.0.1:3107/wireedm-gcode-parser/`, release 0.0.698. This pass covered the dashboard, workbench settings, CAD navigation preferences, and the program editor after importing a repository fixture through the user-facing file picker.

## Findings

- **Storage category icon is appropriate.** The settings row uses `BrowserCacheIcon` (database cylinder) at 16 px, matching the default cache-first workbench. The icon integration map’s broad “persistence controls” wording is ambiguous here; `FolderStorageIcon` should identify folder-specific persistence controls. The header’s active cache status glyph also fits.
- **The other settings symbols fit their labels.** “Machines & setups” uses `AdjustIcon`; “CAD” uses `BodyIcon`. CAD Navigation shows mouse and trackpad glyphs beside the corresponding input choices, with Mouse selected. The Display panel’s “On-part dimensions” checkbox is clear and carries the explanatory sentence.
- **The app mark is integrated correctly.** The 16 px header mark is `wire-edm-mark`, matching the purpose-specific app mark.
- **Editor file actions are clear at toolbar size.** At 16 px, the visible names map to `file-inspect`, `undo`, `redo`, `save`, `file-export`, `file-import`, and `help`. The text accessible names are specific. On a clean imported program, Undo, Redo, and Save were disabled while Import, Inspect, and Export remained enabled.
- **Selection, measurement points, and help are distinguishable.** The canvas selection tool is a pointer (`select`); measurement-point mode is a centered circle (`circle-center`) at 12 px and exposes `aria-pressed` plus the cyan selected treatment; the usage guide uses the circled question-mark `help` glyph. With no selection, preview-fit and line movement controls were disabled and visibly subdued.
- **Snap remains a CAD-sketch-specific control.** The current app source pairs `SnapIcon` with the accessible label “Toggle grid snapping.” The actual sketch canvas was not opened during this non-CAD pass; the CAD review owns that surface.

No other concrete optical or meaning issue surfaced in the reviewed non-CAD controls.

## Browser-cache check

The dashboard initially showed zero projects and the header reported “Browser cache active.” Storage settings explained that projects stay in this browser, clearing site data removes the workbench, the folder flow is optional, and backup/restore and storage review are available. I copied `tests/fixtures/machine-packages/robofil-100-v2/evidence/prisma-recommended.iso` to a uniquely named temporary file and imported it through the editor’s visible Import Program control. The editor rendered 33 path items and grouped program lines. Returning to the dashboard showed one Machine Program; Storage settings showed “Local storage · 1 saved project.” That fixture project remains in browser cache as test data; I did not delete or reset it.

## Screenshots

- [Dashboard, initial cache-first state](icon-review/actual-app/workbench-luna-dashboard.png)
- [Storage settings, empty cache](icon-review/actual-app/workbench-luna-settings-storage.png)
- [Machines and setups settings](icon-review/actual-app/workbench-luna-settings-machines.png)
- [CAD Navigation settings](icon-review/actual-app/workbench-luna-settings-cad-navigation.png)
- [CAD Display settings](icon-review/actual-app/workbench-luna-settings-display.png)
- [Editor with imported ISO fixture](icon-review/actual-app/workbench-luna-editor-imported.png)
- [Editor with measurement-point mode selected](icon-review/actual-app/workbench-luna-editor-measure-points-selected.png)
- [Dashboard with the saved fixture project](icon-review/actual-app/workbench-luna-dashboard-persisted-project.png)
- [Storage settings showing the saved fixture project](icon-review/actual-app/workbench-luna-settings-storage-with-test-project.png)
