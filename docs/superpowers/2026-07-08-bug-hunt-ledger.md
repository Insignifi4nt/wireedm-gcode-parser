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

## Candidate Findings

| ID | Status | Area | Evidence | Candidate bug |
| --- | --- | --- | --- | --- |
| BH-001 | open | Editor panel menu | `src/features/editor/EditorWorkspacePanels.tsx:65`; six e2e failures report header panel menu intercepting clicks/hover after helper tries to close it. | Panels dropdown opens but does not toggle closed on summary click, leaving its overlay active over editor workspace controls. |
| BH-002 | open | Transform panel | `src/features/editor/EditorPathNavigatorPanel.tsx:251`; `e2e/editor-workspace-panels.spec.ts:494`; `pathDocument.source.drawing` is preserved but unused in the panel. | DXF source extents/base point metadata is not rendered in Transform. |
| BH-003 | open | Transform panel | `src/features/editor/EditorPathNavigatorPanel.tsx:752`; `e2e/editor-workspace-panels.spec.ts:456`. | Document placement help text is missing from Transform. |
| BH-004 | open | Workbench shell | `src/app/AppShell.tsx:201`; `src/domain/post/gcodeTemplates.ts:71`. | Custom output extensions display as `.custom` in the sidebar instead of the normalized extension. |
| BH-005 | open | Editor shortcuts | `src/features/editor/EditorPage.tsx:816`. | Global `Ctrl/Cmd+C` clears measurement points and prevents normal copy whenever points exist. |
| BH-006 | open | DXF parser | `src/domain/dxf/parseDxf.ts:224`; scratch Vitest showed a blank LINE layer is read back as `null`. | DXF pair tokenizer drops blank value lines, so explicit blank metadata values are lost and may affect group-code pairing in edge cases. |
| BH-007 | open | External G-code parser | `src/domain/editor/gcodeParser.ts:238`; scratch Vitest reproduced `G1 X1 (note) Y2` parsing as `Y0`. | Parenthesized inline comments are treated like semicolon comments, so valid G-code after `(...)` is dropped from cleanup/parsing. |
| BH-008 | open | Editor rail | `src/features/editor/EditorPage.tsx:772`; `src/features/editor/EditorPage.tsx:1476`. | Expanded left workspace dock collapses after every path-document edit because the rail-collapse effect runs on every new draft object. |
| BH-009 | open | Editor construction mode | `src/features/editor/EditorPage.tsx:571`; `src/features/editor/EditorPage.tsx:1103`; `src/features/editor/EditorPage.tsx:2048`. | Perpendicular/tangent construction can show a canvas preview but click no-ops when no operation is selected. |
| BH-010 | open | Editor floating panels | `src/features/editor/EditorWorkspacePanels.tsx:246`; `src/features/editor/EditorPage.tsx:1816`. | Floating panels can be dragged or resized off the right/bottom viewport because live geometry updates bypass the viewport clamp. |
| BH-011 | open | Storage startup | `src/domain/storage/connectWorkbenchDirectory.ts:73`; `src/app/useWorkbenchAppController.ts:116`. | A remembered-folder handle read error can prevent browser-cache fallback during startup. |
| BH-012 | open | Storage switch/editor state | `src/app/useWorkbenchAppController.ts:150`; `src/app/useWorkbenchAppController.ts:335`. | Connecting a folder workbench leaves stale cache editor/latest-import state active, so a later save can write the old project into the new adapter. |
| BH-013 | open | Storage switch/race | `src/app/useWorkbenchAppController.ts:146`; `src/features/dashboard/DashboardHeader.tsx:25`. | While folder connection is in progress, dashboard imports stay enabled against the old connected workbench. |
| BH-014 | open | Optional folder connect | `src/app/useWorkbenchAppController.ts:164`; `src/app/AppShell.tsx:43`. | A failed optional folder connection sets global status to `error`, making the existing cache workbench unusable. |
| BH-015 | open | Settings draft | `src/features/dashboard/dashboardSettings.ts:41`; `src/features/dashboard/WorkbenchSettingsPanel.tsx:35`. | Unsaved settings edits reset after unrelated manifest updates because `manifest.updatedAt` is part of the settings draft source key. |
| BH-016 | open | External G-code parser | `src/domain/editor/gcodeParser.ts:143`; scratch Vitest reproduced `G91/G0 X10/G1 X1/G1 X1` as `10,1,1`. | External incremental `G91` XY programs display wrong because XY distance mode is accepted but not tracked. |
| BH-017 | open | External G-code parser/structure | `src/domain/editor/gcodeParser.ts:13`; `src/domain/editor/gcodeStructure.ts:86`; scratch Vitest reproduced `G90 G0 X5 Y5` as no parsed path. | Lines that combine setup codes and motion are dropped from preview and mis-sectioned as header because motion detection only checks the line start. |
| BH-018 | open | Program Lines metrics | `src/domain/editor/gcodeStructure.ts:247`; `src/domain/editor/gcodeStructure.ts:362`; scratch Vitest reproduced `G1 X3 Y0` + `X3 Y4` length as `3` instead of `7`. | Contour length calculation undercounts modal continuation lines because grouping tracks modal state but length re-parses each line without it. |
| BH-019 | open | DXF fallback provenance | `src/domain/dxf/parseDxf.ts:890`; `src/domain/path-intel/fromDxfEntities.ts:91`. | Flattened unsupported DXF curves lose layer metadata because fallback line entities are emitted with `layer: null`. |
| BH-020 | open | External G-code parser | `src/domain/editor/gcodeParser.ts:166`; scratch Vitest reproduced `G2 X10 Y0 R5` with center `0,0` instead of `5,0`. | R-word arcs are silently parsed as zero/incorrect-center I/J arcs. |
| BH-021 | open | E2E harness | `playwright.config.ts:9`; `playwright.config.ts:15`; fresh Playwright run loaded page title `StandardGP...` instead of `Wire EDM Workbench`. | Local Playwright can silently reuse an unrelated server on `127.0.0.1:3000`, making the suite test the wrong app. |

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
