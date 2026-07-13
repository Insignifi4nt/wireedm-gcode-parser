# Bug Hunt Ledger - 2026-07-08

Goal: bug-hunt until no new findings remain, deduplicating repeated symptoms before user triage.

## Verification Runs

- `npm test -- --run`: passed, 42 files / 369 tests.
- `npm run build`: passed, with existing Vite chunk-size warning.
- `npm run test:e2e -- --reporter=line`: failed, 10 passed / 2 skipped / 8 failed.
- Fresh final `npm test -- --run`: passed, 42 files / 369 tests.
- Fresh final `npm run build`: passed, with existing Vite chunk-size warning.
- Fresh final `npm run test:e2e -- --reporter=line`: failed 18 / skipped 2 after Playwright reused an unrelated local server on port 3000 (`StandardGP...`), so those failures are recorded as BH-021 rather than app behavior.
- Final follow-up sweep around Playwright/Vite port and base-path configuration produced no additional distinct findings.

### Closure audit runs - 2026-07-12

- Ledger-focused regressions (`npm test -- --run src/features/editor/__tests__/EditorWorkspacePanels.test.tsx src/__tests__/appDxfProjects.test.tsx src/__tests__/appWorkbenchDashboard.test.tsx src/__tests__/editorImportExport.test.tsx src/domain/post/__tests__/gcodeTemplates.test.ts src/__tests__/editorMeasurement.test.tsx src/__tests__/editorConstructionRegression.test.tsx src/domain/storage/__tests__/connectWorkbenchDirectory.test.ts src/app/workbenchSettings.test.ts src/domain/editor/__tests__/gcodeParser.test.ts src/domain/editor/__tests__/gcodeStructure.test.ts src/domain/dxf/__tests__/parseDxf.test.ts src/domain/dxf/__tests__/parseDxfSplineFallback.test.ts`): passed, 13 files / 221 tests.
- `npm test -- --run`: passed, 50 files / 757 tests.
- `npm run build`: passed, with the existing Vite chunk-size advisory for the 723.86 kB main JavaScript chunk.
- `npx playwright test --list`: passed and listed 29 tests in 5 files.
- `npm run test:e2e -- --reporter=line`: passed, 28 passed / 1 explicitly skipped in 10.5 seconds. The current harness started its own strict server on port 3107, and the `e2e/app-shell.spec.ts` application-title assertion passed.
- Real-fixture regression (`npm test -- --run src/domain/dxf/__tests__/dxfToUpid.test.ts -t "keeps the bundled z18f25 fixture" --reporter=verbose`): passed in 6 ms with 72 exact finite segments, one closed contour, and no error diagnostics.
- Performance regression (`npm test -- --run src/domain/path-intel/__tests__/pathPlanningPerformance.test.ts --reporter=verbose`): passed, 5 tests. Median timings were 11.38 ms / 26.04 ms for 1,000 / 4,000 endpoint clustering (2.29x), 7.15 ms / 32.74 ms for 4,000 / 16,000 oversized-bound queries (4.58x), 1.87 ms / 5.78 ms for 1,000 / 4,000 mixed-location point queries (3.08x), 48.91 ms / 304.26 ms for 1,000 / 4,000 mixed-size sanitization (6.22x), and 15.92 ms / 72.43 ms for live validation of 1,000 / 4,000 disjoint G40 open paths (4.55x).

### Final whole-branch review hardening

- `a7edb17` updated the committed Playwright expectations for the compact Contour Workbook and progressive endpoint disclosure.
- `b40af20` made compact modal headers such as `G90.1G17` share parser/post IJ semantics and normalized omitted schema-v1 layer filters without masking explicit malformed values.
- `8293363` retained lossy import diagnostics across geometry edits, recomputed edit-created duplicates, and persisted DXF parser warnings into UPID/export diagnostics.
- `d70ac60` added a non-mutating live topology audit for legacy schema-v1 documents, so empty, missing, or downgraded historical diagnostics cannot make duplicate, overlapping, intersecting, branching, invalid-arc, or non-finite geometry downloadable. Valid open G40 centrelines remain postable.
- The live legacy audit uses fresh endpoint clusters and linear synthetic junction adjacency rather than persisted chains; its 1,000-to-4,000 disjoint-path benchmark improved from the reproduced 12.53x regression to 4.55x in the final root run.
- Final whole-branch review at `d70ac60` returned **APPROVE** with zero Critical and zero Important findings. Its one Minor finding was a cold-start browser-upload race; `8dfd15b` now waits for both workbench file inputs to become enabled before every dashboard upload. The reproduced scenario passed 10/10 parallel repeats and the full browser suite passed afterward.

## Candidate Findings

The status column is the current closure state. `fixed before correctness branch` means the fix is present at or before base commit `eefc712`; `fixed in correctness branch` means the fix is in `eefc712..HEAD`. The discovery-time evidence and candidate descriptions are intentionally preserved.

| ID | Status | Area | Evidence | Candidate bug |
| --- | --- | --- | --- | --- |
| BH-001 | fixed before correctness branch | Editor panel menu | `src/features/editor/EditorWorkspacePanels.tsx:65`; six e2e failures report header panel menu intercepting clicks/hover after helper tries to close it. | Panels dropdown opens but does not toggle closed on summary click, leaving its overlay active over editor workspace controls. |
| BH-002 | fixed before correctness branch | Transform panel | `src/features/editor/EditorPathNavigatorPanel.tsx:251`; `e2e/editor-workspace-panels.spec.ts:494`; `pathDocument.source.drawing` is preserved but unused in the panel. | DXF source extents/base point metadata is not rendered in Transform. |
| BH-003 | fixed before correctness branch | Transform panel | `src/features/editor/EditorPathNavigatorPanel.tsx:752`; `e2e/editor-workspace-panels.spec.ts:456`. | Document placement help text is missing from Transform. |
| BH-004 | fixed before correctness branch | Workbench shell | `src/app/AppShell.tsx:201`; `src/domain/post/gcodeTemplates.ts:71`. | Custom output extensions display as `.custom` in the sidebar instead of the normalized extension. |
| BH-005 | fixed in correctness branch | Editor shortcuts | `src/features/editor/EditorPage.tsx:816`. | Global `Ctrl/Cmd+C` clears measurement points and prevents normal copy whenever points exist. |
| BH-006 | fixed in correctness branch | DXF parser | `src/domain/dxf/parseDxf.ts:224`; scratch Vitest showed a blank LINE layer is read back as `null`. | DXF pair tokenizer drops blank value lines, so explicit blank metadata values are lost and may affect group-code pairing in edge cases. |
| BH-007 | fixed in correctness branch | External G-code parser | `src/domain/editor/gcodeParser.ts:238`; scratch Vitest reproduced `G1 X1 (note) Y2` parsing as `Y0`. | Parenthesized inline comments are treated like semicolon comments, so valid G-code after `(...)` is dropped from cleanup/parsing. |
| BH-008 | fixed before correctness branch | Editor rail | `src/features/editor/EditorPage.tsx:772`; `src/features/editor/EditorPage.tsx:1476`. | Expanded left workspace dock collapses after every path-document edit because the rail-collapse effect runs on every new draft object. |
| BH-009 | fixed in correctness branch | Editor construction mode | `src/features/editor/EditorPage.tsx:571`; `src/features/editor/EditorPage.tsx:1103`; `src/features/editor/EditorPage.tsx:2048`. | Perpendicular/tangent construction can show a canvas preview but click no-ops when no operation is selected. |
| BH-010 | fixed before correctness branch | Editor floating panels | `src/features/editor/EditorWorkspacePanels.tsx:246`; `src/features/editor/EditorPage.tsx:1816`. | Floating panels can be dragged or resized off the right/bottom viewport because live geometry updates bypass the viewport clamp. |
| BH-011 | fixed in correctness branch | Storage startup | `src/domain/storage/connectWorkbenchDirectory.ts:73`; `src/app/useWorkbenchAppController.ts:116`. | A remembered-folder handle read error can prevent browser-cache fallback during startup. |
| BH-012 | fixed before correctness branch | Storage switch/editor state | `src/app/useWorkbenchAppController.ts:150`; `src/app/useWorkbenchAppController.ts:335`. | Connecting a folder workbench leaves stale cache editor/latest-import state active, so a later save can write the old project into the new adapter. |
| BH-013 | fixed before correctness branch | Storage switch/race | `src/app/useWorkbenchAppController.ts:146`; `src/features/dashboard/DashboardHeader.tsx:25`. | While folder connection is in progress, dashboard imports stay enabled against the old connected workbench. |
| BH-014 | fixed before correctness branch | Optional folder connect | `src/app/useWorkbenchAppController.ts:164`; `src/app/AppShell.tsx:43`. | A failed optional folder connection sets global status to `error`, making the existing cache workbench unusable. |
| BH-015 | fixed in correctness branch | Settings draft | `src/features/dashboard/dashboardSettings.ts:41`; `src/features/dashboard/WorkbenchSettingsPanel.tsx:35`. | Unsaved settings edits reset after unrelated manifest updates because `manifest.updatedAt` is part of the settings draft source key. |
| BH-016 | fixed in correctness branch | External G-code parser | `src/domain/editor/gcodeParser.ts:143`; scratch Vitest reproduced `G91/G0 X10/G1 X1/G1 X1` as `10,1,1`. | External incremental `G91` XY programs display wrong because XY distance mode is accepted but not tracked. |
| BH-017 | fixed in correctness branch | External G-code parser/structure | `src/domain/editor/gcodeParser.ts:13`; `src/domain/editor/gcodeStructure.ts:86`; scratch Vitest reproduced `G90 G0 X5 Y5` as no parsed path. | Lines that combine setup codes and motion are dropped from preview and mis-sectioned as header because motion detection only checks the line start. |
| BH-018 | fixed in correctness branch | Program Lines metrics | `src/domain/editor/gcodeStructure.ts:247`; `src/domain/editor/gcodeStructure.ts:362`; scratch Vitest reproduced `G1 X3 Y0` + `X3 Y4` length as `3` instead of `7`. | Contour length calculation undercounts modal continuation lines because grouping tracks modal state but length re-parses each line without it. |
| BH-019 | fixed in correctness branch | DXF fallback provenance | `src/domain/dxf/parseDxf.ts:890`; `src/domain/path-intel/fromDxfEntities.ts:91`. | Flattened unsupported DXF curves lose layer metadata because fallback line entities are emitted with `layer: null`. |
| BH-020 | fixed in correctness branch | External G-code parser | `src/domain/editor/gcodeParser.ts:166`; scratch Vitest reproduced `G2 X10 Y0 R5` with center `0,0` instead of `5,0`. | R-word arcs are silently parsed as zero/incorrect-center I/J arcs. |
| BH-021 | fixed in correctness branch | E2E harness | `playwright.config.ts:9`; `playwright.config.ts:15`; fresh Playwright run loaded page title `StandardGP...` instead of `Wire EDM Workbench`. | Local Playwright can silently reuse an unrelated server on `127.0.0.1:3000`, making the suite test the wrong app. |

## Closure Evidence - 2026-07-12

Audit result: all 21 historical findings are fixed in the current tree; no ledger finding remains open.

| ID | Fix provenance | Regression evidence | Current implementation evidence |
| --- | --- | --- | --- |
| BH-001 | Before branch: `33458a7` | `src/features/editor/__tests__/EditorWorkspacePanels.test.tsx:28` toggles the summary closed; `:99` proves a pending hover timer cannot reopen it. | `EditorPanelToolbar.handleSummaryClick` clears the timer and toggles controlled `menuOpen`; `handlePanelClick` closes it (`src/features/editor/EditorWorkspacePanels.tsx:141-183`). |
| BH-002 | Before branch: `be76eff` | `src/__tests__/appDxfProjects.test.tsx:3790` and `e2e/editor-workspace-panels.spec.ts:589` assert unchanged source extents and base point. | Transform renders `pathDocument.source.drawing.extents` and `.basePoint` (`src/features/editor/EditorPathNavigatorPanel.tsx:811-821`). |
| BH-003 | Before branch: `be76eff` | The same app regression at `src/__tests__/appDxfProjects.test.tsx:3790` asserts the placement help; `e2e/editor-workspace-panels.spec.ts:553,589` covers both help contexts. | `data-upid-transform-document-placement-help` explains reference/selection placement and DXF metadata (`src/features/editor/EditorPathNavigatorPanel.tsx:775-781`). |
| BH-004 | Before branch: `45ed1d6` | `src/domain/post/__tests__/gcodeTemplates.test.ts:98` covers built-in/custom normalization; `src/__tests__/appWorkbenchDashboard.test.tsx:251` persists `.CUT` as `cut`. | The shell displays `normalizeOutputExtension(extension, customExtension)` rather than the enum literal (`src/app/AppShell.tsx:85-90`). |
| BH-005 | Correctness branch: `bb2b884`, refined by `eb9f939` | `src/__tests__/editorMeasurement.test.tsx:212,233,269` proves native Ctrl/Cmd copy variants remain untouched and only Alt/Option+Shift+C clears points. | The clear predicate requires Alt+Shift, rejects Ctrl/Meta, and checks physical `KeyC` (`src/features/editor/EditorPage.tsx:974-989`). |
| BH-006 | Correctness branch: `db07c32` | `src/domain/dxf/__tests__/parseDxf.test.ts:503` preserves `layer: ''` and later coordinates without pair shift. | `toPairs` trims only group-code lines and retains the raw following value, including blank strings (`src/domain/dxf/parseDxf.ts:229-240`). |
| BH-007 | Correctness branch: `0b9f580`, hardened by `4e35c56` | `src/domain/editor/__tests__/gcodeParser.test.ts:6,10,81` covers words after balanced comments, semicolons inside parentheses, and unclosed comments. | Both public consumers use `interpretGCodeBlock`; its in-place comment stripper is at `src/domain/editor/gcodeBlockInterpreter.ts:213`. |
| BH-008 | Before branch: `3b2ed39` (with workspace-state regression from `33458a7`) | `src/__tests__/appDxfProjects.test.tsx:872` keeps workspace choices through a same-document edit/save; `e2e/editor-layout.spec.ts:247` exercises repeated dock collapse/restore. | Workspace defaults and `setRailCollapsed(false)` now run only when `program.filePath` or `program.model` changes (`src/features/editor/EditorPage.tsx:879-886`), not for each draft object. |
| BH-009 | Correctness branch: `bb2b884` | `src/__tests__/editorConstructionRegression.test.tsx:29` creates a preview with no preselection, clicks it, and asserts the saved point owns the preview operation. | Preview and commit both consume `constructMagnetizedPoint`; commit stores the returned `MagnetizedPathPoint`, including `operationId` (`src/features/editor/EditorPage.tsx:603-633,1266-1311`). |
| BH-010 | Before branch: `3b2ed39` | `src/features/editor/__tests__/EditorWorkspacePanels.test.tsx:441` covers dragged/resized bounds; `e2e/editor-workspace-panels.spec.ts:392` drags and resizes beyond the viewport and then resizes the viewport. | Every live geometry update passes through `clampEditorFloatingPanelGeometry`, and resize reclamps existing floating panels (`src/features/editor/EditorPage.tsx:888-909,2013-2025`). |
| BH-011 | Correctness branch: `bb2b884` | `src/domain/storage/__tests__/connectWorkbenchDirectory.test.ts:127` asserts a rejecting handle store returns `{ status: 'error' }`. | `handleStore.read()` is inside the recoverable `try`, allowing startup to continue to the cache fallback (`src/domain/storage/connectWorkbenchDirectory.ts:64-99`). |
| BH-012 | Before branch: `3b2ed39` | `src/__tests__/appWorkbenchDashboard.test.tsx:495` switches from a cache-loaded program to a folder and proves the later editor is empty. | Successful storage switch clears both `loadedEditorProgram` and `latestImport` before returning to the dashboard (`src/app/useWorkbenchAppController.ts:167-178`). |
| BH-013 | Before branch: `3b2ed39` | The shared-lock regression `src/__tests__/editorImportExport.test.tsx:732` proves dashboard imports, project actions, settings save, and storage connect are all disabled while a workbench operation is pending. | Folder connect enters the same operation lock with `beginWorkbenchOperation('storage-switch')`; `workbenchInteractionLocked` is true for every active operation and is propagated by `src/App.tsx` (`src/app/useWorkbenchAppController.ts:158-192,534`; `src/App.tsx:19-53`). |
| BH-014 | Before branch: `3b2ed39` | `src/__tests__/appWorkbenchDashboard.test.tsx:459` asserts a rejected folder upgrade leaves Browser cache active, the Workbench rendered, and DXF import enabled. | Connect failure keeps status `ready` whenever an existing workbench is present (`src/app/useWorkbenchAppController.ts:180-190`). |
| BH-015 | Correctness branch: `bb2b884`, adapter-identity hardening in `eb9f939` | `src/app/workbenchSettings.test.ts:12` proves `manifest.updatedAt` alone leaves `sourceKey` unchanged; `:26` distinguishes adapters. | The key is built from adapter identity and persisted setting values only (`src/app/workbenchSettings.ts:34-57`). |
| BH-016 | Correctness branch: `0b9f580` | `src/domain/editor/__tests__/gcodeParser.test.ts:17` expects `G91 / X10 / X1 / X1` to resolve to X `10, 11, 12`; `:70` proves IJ mode remains independent. | Interpreter state has separate `xyMode` and `ijMode`, updated independently (`src/domain/editor/gcodeBlockInterpreter.ts:5-6,54-70`). |
| BH-017 | Correctness branch: `0b9f580` | `src/domain/editor/__tests__/gcodeParser.test.ts:24` parses `G90 G0 X5 Y5`; `src/domain/editor/__tests__/gcodeStructure.test.ts:39` classifies it as body. | Parser and structure analyzer both scan the full block through the shared interpreter (`src/domain/editor/gcodeParser.ts:72-89`; `src/domain/editor/gcodeStructure.ts:92-100`). |
| BH-018 | Correctness branch: `0b9f580` | `src/domain/editor/__tests__/gcodeStructure.test.ts:43` expects modal `G1 X3 Y0` + `X3 Y4` contour length `7`; `:48` checks arc length from interpreted geometry. | Structure grouping and metrics share one interpreter state across lines (`src/domain/editor/gcodeStructure.ts:92-149`). |
| BH-019 | Correctness branch: `db07c32`, with later DXF hardening retained | `src/domain/dxf/__tests__/parseDxfSplineFallback.test.ts:8,27` preserves fallback layers; `:150` asserts nested lineage and UPID `source.exact === false`. | SPLINE-derived lines retain `layer`, handle, approximation, and insert lineage; UPID source maps approximation to `exact: false` (`src/domain/dxf/parseDxf.ts:696-752`; `src/domain/path-intel/fromDxfEntities.ts:109-117`). |
| BH-020 | Correctness branch: `0b9f580`, hardened by `4e35c56` | `src/domain/editor/__tests__/gcodeParser.test.ts:28,36,46,56,88` covers semicircle, minor/major sign selection, large radii, and invalid R geometry. | `interpretGCodeBlock` resolves R-format centers and reports invalid geometry instead of falling through to I/J (`src/domain/editor/gcodeBlockInterpreter.ts:54-207`). |
| BH-021 | Correctness branch: `bb2b884` | `e2e/app-shell.spec.ts:3` asserts the Wire EDM Workbench page title; the closure run passed 28 / skipped 1, and `npx playwright test --list` found 29 tests. | `playwright.config.ts:9,15-17` uses owned port 3107, `--strictPort`, and `reuseExistingServer: false`, so port 3000 cannot be reused. |

## Duplicate / Collapsed Symptoms

- E2E failures at `editor-workspace-panels.spec.ts:153`, `:200`, `:364`, `:551`, `:591`, and the cross-highlight hover failure are collapsed into BH-001 because each reports the same header menu overlay intercepting pointer events.
- Reviewer A duplicates for BH-001/BH-002/BH-003/BH-005 were dismissed after matching the same source lines.
- Reviewer C duplicate for BH-004 was dismissed after matching the same sidebar custom-extension display issue.
- Reviewer B duplicates for BH-004 and BH-006 were dismissed after matching filename-only export behavior and the known DXF blank-value tokenizer issue.
- Fresh e2e timeout cascade after the wrong page loaded is collapsed into BH-021; it did not produce additional app findings.

## Reviewer Notes

- Reviewer A added BH-008, BH-009, BH-010.
- Reviewer C added BH-011, BH-012, BH-013, BH-014, BH-015.
- Reviewer B added BH-016, BH-017, BH-018, BH-019.
