# Closed areas and direct depth checkpoint

Status: active CAD hardening goal. Reviewed product checkpoint awaits the complete new-head CI gate. The prior complete clean CI result belongs to fba236e and does not certify this candidate.

## Verification

- Node 24.22.0/npm 11.19.1; integrated local gate: 381 files / 4,034 tests pass in 263.76 seconds. Log: `tmp/cad-region-depth-integrated-unit-final.log`.
- TypeScript/Vite production build, all 92 documentation/discovery/schema/link checks and native corresponding-source distribution pass. Log: `tmp/cad-region-depth-candidate-build-final.log`; bundle `main-D0eehPRX.js`.
- Frozen candidate contains 51 changed source/test/script paths. Domain/API, effective frame selection, editor ownership, ray geometry, physical renderer routing and root integration have independent source-hashed reviews. Description-only discovery repair has separate parity and independent review records.
- Fresh actual CUA/browser QA uses `http://[::1]:3778/wireedm-gcode-parser/`, independently isolated from the user's localhost storage/preferences. Imported synthetic fixtures stay unsaved; the test library remains empty. The user's open localhost draft and saved records are not modified.

## Physical source and area picking

On an 80 × 40 × 10 mm stock, a source sketch at Z5 is visible and physically selectable through its opaque target during the owned source picker. The mode's rust outline has visible contrast on the selected cyan stock; ordinary model occlusion is unchanged.

Selecting a bore annulus with R4 outside/R2 inside produces volume `32,000 − 120π = 31,623.008881569225 mm³` and two solids. Shift-selecting its centre merges adjacent selected cells, producing `32,000 − 160π = 31,497.345175425635 mm³` and one solid. The actual accepted native result is `31,497.34517542563 mm³`. The original outside rectangle and disconnected rectangle are not cut in that explicit selection.

The whole-sketch default retains its existing material parity: `19,376.991118430768 mm³` and two solids. Cancel restores the original Single sketch reference and accepted version. Apply records only the explicitly chosen exact cell references. One Undo restores the complete original JSON text, including exact DXF source and expressions. No Save occurs; library total remains zero.

Evidence: `tmp/cad-pocket-selected-areas-current-browser-report.json`, `tmp/cad-pocket-source-rust-current.png`, `tmp/cad-pocket-annular-area-preview-current.png`, `tmp/cad-pocket-adjacent-area-preview-current.png`.

## Physical depth interaction

The CAD Display checkbox is off initially. Enabling it exposes a constant-screen-size arrow on the selected Pad. An actual pointer drag from [518,367] to [518,284] changes the provisional named driver from 10 to `19.844262327110005 mm`; the accepted version and `depth=10` remain unchanged until Apply. Cancel preserves complete original document text.

Repeating and applying that physical drag retains the exact ` depth ` expression. Native stock volume is `7,937.704930844002 mm³` with Z0 to depth. A compound `depth * 2` follower remains read-only, has volume `992.2131163555002 mm³`, and follows the driver with Z bounds depth to 3 × depth. These independently match 400 × depth and 50 × depth. One Undo restores complete original JSON. Disabling the isolated test preference removes the label/handle. No saved part or CAM record is created.

Evidence: `tmp/cad-depth-handle-current-browser-report.json`, `tmp/cad-depth-handle-before-current.png`, `tmp/cad-depth-handle-drag-preview-current.png`.

Actual QA found two final presentation defects: idle arrow contrast on cyan selected material and the transient label's raw floating-point precision. Both are now repaired with display-only palette/format changes, independently reviewed and verified against the rebuilt production bundle `main-BDwNJSjZ.js`. The idle and hovered arrows use rust contrast; the label reads Length 19.844262 mm while the editable field retains 19.844262327110005. Accepted tiny nonzero lengths such as ±4e-7 mm use compact scientific notation rather than displaying zero. No geometry or gesture policy changes. Owner and independent gates pass 93 focused cases plus app TypeScript; an exact in-memory reversal recovers the original functional helper. The final actual drag/Cancel again preserves complete original JSON, test settings are restored and the disposable tab is closed without Save.

Final raster/report evidence: `tmp/cad-depth-handle-final-idle.png`, `tmp/cad-depth-handle-final-preview.png`, `tmp/cad-depth-handle-final-presentation-browser-report.json`. Final build log: `tmp/cad-region-depth-presentation-build.log`; TypeScript/Vite, all 92 documentation checks, native corresponding sources and the 51-path source freeze pass. The preceding complete unit gate covers all 4,034 pre-presentation cases; the focused final 93-case gate includes 12 additional presentation cases. The complete new-head CI must verify the combined final count; these overlapping gates are not summed as independent cases.

## Remaining gate

The new public agent region workflow passes in actual Chromium (one journey, 3.1 seconds; full command 8.3 seconds). It repairs two correlated selected sources using discovered proposed-source reads, preserves complete original text and aliases, confirms exact native volumes/bounds and one-step Undo/Redo. Log: `tmp/cad-region-workflow-local-e2e.log`. Its first local attempt correctly refused to reuse port 3107; the separate icon chat verified and stopped only its own finished test preview, PID 46380. No unrelated server was stopped and no test port/configuration fallback was used. Reviewed checkpoint commit/push and complete new-head CI remain required. The broad CAD hardening goal remains active while the next measured resource audit proceeds.
