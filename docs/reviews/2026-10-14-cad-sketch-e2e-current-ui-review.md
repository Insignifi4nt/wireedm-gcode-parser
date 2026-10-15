# Sketch E2E current-UI repair review

Base checkpoint: `8375c294d09e0a43b48b7c37d977cc59fd9a4065`. This private record covers only `createSketchOnCanvasPlane` and the five delegated test blocks in `e2e/cad-workflow.spec.ts`. Shared helper extraction, Shell, native kernel, and far-origin test repairs belong to other owners. No product code, server, browser session, user draft, release, or public documentation was changed by this repair.

## Actual failed CI evidence

CI run `38606111258` ran 124 cases: 10 failed, 113 passed, 1 preexisting skip. The saved evidence is `tmp/cad-node24-ci-e2e-failed-plain.log`. The five delegated failures reproduced on both retries:

| Original test location | Observed failure | Current supported behavior and repair |
| --- | --- | --- |
| 165, compact polygon | An arbitrary count expected 5 inputs and received 6. | The compact contour panel has its own construction control and a disclosed exact editor. Open `Exact geometry` explicitly; assert the selected vertex and visible X/Y fields instead of counting unrelated inputs. Keep both vertex expressions and their shared parameter unchanged. |
| 766, imported path | `Fit sketch` remained unavailable until the 30 s timeout. | View controls are intentionally inert while collapsed. Open View before Fit; after the genuine interior pointer pick, open `Exact geometry` before editing segments. |
| 1378, Curve creation | Expected numeric offset `5`; actual stored offset was string `"5"`. | The provisional Curve uses the existing plain scalar editor, which preserves the entered scalar string. Assert that representation and separately measure exact 5 mm YZ placement, world endpoints, and analytic length. |
| 1419, mixed path | The shared helper waited for obsolete button `Select XY plane`. | Current public design-area label is `Select XY plane in design area`. Use that exact named button and retain the visible drawing-canvas check. |
| 1467, drawing/dimensions | The same obsolete plane-button label blocked setup. | Repair the shared helper; retain explicit Dimension creation. Drawing remains free until the user adds a driving dimension. |

No production defect was established from these five failures. Restoring old numeric forms or automatic dimensions would contradict the current supported interaction and the user's requirements.

## Preserved and strengthened behavioral checks

All existing geometry, analytic area/volume, original DXF source, workflow blocking, undo/redo, save, and version assertions remain. The polygon count assertion was replaced by useful authoring-state checks, not weakened to a new arbitrary count.

The polygon still edits two separate vertices before one Apply, holds the accepted version during the pending edit, rejects an agent mutation, and returns areas 250 → 200 → 250 through Undo/Redo. New readback verifies exact `width + 5` expressions and the unchanged numeric `width` parameter.

The imported path still selects through an actual interior pointer click, rejects an open/discontinuous draft without changing accepted geometry, repairs the neighboring endpoint, retains exact original source, returns area 250, and builds volume 1250.

Curve creation still cancels without committing provisional name/plane/geometry, rejects agent edits during drawing, commits one feature, preserves Undo/Redo, saves, exports DXF, and imports exact source text. New measurement checks distinguish stored scalar representation from resolved geometry, and Redo returns the exact accepted Curve.

The mixed arc/line path still rejects a degenerate through-point without discarding its draft, remains unpublished until closure, produces a radius-10 half-circle plus closing line, measures area `50π`, undoes to an empty sketch, restores the exact full accepted sketch on Redo, and pads to `500π`.

The drawn rectangle now explicitly verifies no constraint record or width annotation exists before Dimension. A width constraint is deliberately added at 53 mm; the dimension draft blocks agent mutations; its accepted annotation becomes visible. Exact Undo restores the complete free sketch, including absence of constraints, and Redo restores the complete constrained sketch. Pad volume uses the actual unchanged drawn height (`53 × height × 10`), followed by the existing ready-build and save checks.

No case was skipped, and no timeout was increased. Existing timeouts were left unchanged.

## Verification and limits

Node 24.22.0 was selected through the approved task-local toolchain path.

- Strict E2E type check using the existing ignored `tmp/cad-e2e-kernel-tsconfig.json`: passed. Log `tmp/cad-sketch-e2e-current-ui-tsc.log`.
- Playwright discovery with the five delegated titles: exactly 5 tests discovered. Log `tmp/cad-sketch-e2e-current-ui-discovery.log`.
- Focused existing current-UI semantics across Workbench, profile panel, exact profile editor, plane flow, and path drawing: 38 passed, 64 intentionally filtered out, 5 files. Log `tmp/cad-sketch-e2e-current-ui-semantics.log`.
- `git diff --check`: clean.

The repaired Playwright cases have not been executed by this agent: root owns the combined actual browser/CI gate. Discovery and DOM/domain tests are not presented as equivalent to end-to-end browser success. The original failing CI establishes red evidence only for the obsolete interactions described above.

## Scoped frozen hashes

The whole shared spec at this snapshot is SHA-256 `0A9B5BD59A92E73FA77DC3BC3FE3F8A1317E575465C5DF27AB2D7E8491BD08B0`; other owners may legitimately alter their regions afterward. Scoped hashes use the exact UTF-8 source text from each top-level helper/test declaration through the next top-level declaration, retaining line endings. Machine-readable snapshot: `tmp/cad-sketch-e2e-owned-region-hashes.json`.

| Owned region | SHA-256 |
| --- | --- |
| `createSketchOnCanvasPlane` | `C3AD591402F8931E7418CD334689C7F7ECDC22396F2A6E9A6965DF64EF77BA26` |
| Compact polygon | `176706AC29787B6D5FD1975564EB167FEA615A09137BEE991171FF3A70BB9DF7` |
| Imported path | `177722AE81CDE9AF7726F67CE3B9D44C2CDA954B257746817439194AAE6320B9` |
| Curve creation | `20F0BBE0F64ED64A36F9C9209170D50E2258F2349B558BBD5D2C7F13C588903C` |
| Mixed path | `61498522789ADB55EB086C6FF86916F47B0332E00FFDFB49B13F4D0705188D1B` |
| Drawing/dimensions | `FD39F5A927A5E97B404CF9C20EEDB272AACB1CE04F1BC2077DFB01B1EB4F98ED` |

## Reviewed local-SVG integration

The separately owned genuine far-origin SVG repair makes the visible viewBox relative to the public world center. With the original owner's agreement, `sketch_reference_research` updated only the imported-path pointer conversion after its test source was frozen and reviewed: version-pinned `cad_get_viewport.view.centerMm` supplies the world center, and native SVGPoint/getScreenCTM maps local `(10 − centerX, centerY − 5)` to physical pixels. The test still clicks the same world-interior point (10,5), then preserves every exact-editor, invalid-continuity, source, workflow, area and volume assertion. The original owner independently read this integration and found no issue. No product code, browser execution, timeout or skip was added.

The imported-path region changed from 4,527 characters / SHA-256 `FE343017736ED4079B598E23C323949EFE6426D639F012A1A4DB900DD419769D` to 5,274 characters / `177722AE81CDE9AF7726F67CE3B9D44C2CDA954B257746817439194AAE6320B9`. Only that agreed manifest row changed; independent extraction verifies all six current regions and the other five hashes remain unchanged. Focused Node 24 strict two-spec TypeScript, one-title discovery and diff checks pass. Actual combined browser execution remains the parent's gate. Logs: `tmp/cad-imported-path-svg-integration-type.log`, `tmp/cad-imported-path-svg-integration-discovery.log`, `tmp/cad-imported-path-svg-integration-region-check.log`.
