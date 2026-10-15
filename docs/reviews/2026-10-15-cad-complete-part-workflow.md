# Complete human part-building workflow

Root exercised the published `3f70f4dc32374b44351942ce88289d7c3ce55874` production bundle (`main-CweyXtyn.js`) through the actual in-app browser. Geometry was drawn with the human tools; public agent tools only inspected exact source, native results and saved metadata. QA used `http://[::1]:3778/wireedm-gcode-parser/`, with browser-cache storage isolated from the user's `localhost` origin.

## Finished workflow

1. Start a new part, select XY, draw an 80×50 rectangle, apply the contextual R3 sketch fillet, then explicitly dimension width 80. Draw a centred R5 bore and explicitly dimension diameter 10; rename it through the tree context menu. Free geometry had no invented driving dimensions.
2. Finish through the panel checkmark. Preview Pad 10 with the original nested bore. Physically select the outer bounded area and Shift-select the bore interior: the two selected areas correctly fill the bore. Return to Whole sketch and Apply the annular plate.
3. Physically pick the bore's two top native semicircle edges, choose Chamfer 0.5 and Apply. One Undo restores the exact pre-chamfer JSON; one Redo restores the exact feature definition. Rename the feature **Bore edge chamfer** through the tree.
4. Export real STEP and standalone File → Export DXF, with an XY section at height 5. The section preview reports two closed contours and ten analytic curves. Download the CAD history, Save, and inspect its actual browser-cache record.
5. Import the downloaded STEP through the human file chooser and reviewed import dialog. Its exact source text is retained in the new document. Rename and save **Imported plate round trip**, then Open the original plate from the real library. Reopened source and saved fingerprint match exactly; the library retains both independent documents. The native body remains valid.

| Native result | Independently expected, mm³ | Actual, mm³ |
| --- | ---: | ---: |
| Original rounded/bored Pad | `39640 − 160π` | 39137.34517542563 |
| Bore chamfer, removing `31π/24` | `39640 − 160π − 31π/24` | 39133.28728491475 |
| Exported STEP reimport | Same chamfered plate | 39133.28728491482 |

The plate bounds remain `[0,0,0]..[80,50,10]`. Chamfered and imported results each contain one native solid, 14 faces and 34 edges. The downloaded CAD history parses to the exact saved document. STEP bytes match the source embedded by the human import. The active Import dialog correctly refuses background `cad_build` with `WORKFLOW_OPEN`; building succeeds after human acceptance.

The actual 850-byte section-DXF download also passes the shared strict CAD importer: two contours, ten analytic entities, declared millimetres, and material area `3913.7345175425635 mm²`, matching `(39640 − 160π)/10` within `1e-8 mm²`. Its SHA-256 is `e35a6c50caf98fa378d1facedbb28171ebc49ee5469c5c41d4715c78bb9bd654`; the detached receipt is `tmp/cad-part-workflow-downloaded-dxf-report.json`.

Saved original: `cad_6f84975c-5a62-4932-9700-e6299ce76a9d`, saved version `103b830907a05379534275f1502c405c43f89fdf050fb51bdb98d316758dfda2`. Imported copy: `cad_bada1431-b1fd-4f19-95a8-e8c893474347`, saved version `4fbb3ca1622bf8c47c2469494ee63c2fbd74aa6fec2f7f27390ddd47ae406b29`.

## Concrete usability finding

Picking the 74 mm straight top rim and choosing Chamfer 0.5 truthfully refuses an incomplete tangent chain. A visually continuous R5 bore has the same friction because the native circle consists of two arcs. Cancel in both cases preserves the exact accepted source/version. Manually selecting both semicircles works, but exposes native segmentation during an ordinary human operation.

The bounded repair is an explicit **Follow tangent edges** option using the existing builder's native contours. Strict selection remains the default. Its implementation/review/browser evidence is separate in `2026-10-15-cad-tangent-chain-workflow-repair.md`; this original workflow is already finished and is not held open behind that repair or the parked Copy experiment.

## Preserved evidence and user state

- Public receipts: `tmp/cad-part-workflow-public-report.json`; exact original human-built source: `tmp/cad-part-workflow-original-ui.cad.json`.
- Actual screenshots: `tmp/cad-part-workflow-{two-areas,tangent-chain-refusal,standalone-dxf,finished-plate}.png`.
- Actual downloads remain in `C:/Users/cristian/Downloads/`: `Bored mounting plate.step`, `Bored mounting plate.cad.json`, `Bored mounting plate-section-XY.dxf`. They are browser downloads, not generated test substitutes.
- Fresh main-user preservation receipt: `tmp/cad-part-workflow-main-preservation.json`. Its unchanged 156-character empty draft retains version `15219e3b-5e51-4513-8317-88fdb355ba5d`, no history/workflow, and the original saved **Isolated cut verification** fingerprint/timestamp. No main-user data, settings or saved library writes occurred.

This verifies one complete human workflow and its corresponding agent inspections. It does not claim every supported CAD scenario, universal native precision, or completion of the broad CAD hardening goal.
