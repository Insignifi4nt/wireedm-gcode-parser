# Current-interface native kernel journeys

## Scope and diagnosis

The two existing `e2e/cad-kernel.spec.ts` journeys asserted `.cad-statusbar` and `.cad-diagnostics`, which the current CAD interface no longer renders. The application reports build failures through `useCadNotifications`, the header's feature-attention status, tree diagnostic context and the shared notification history. Native body quantities are available through the guarded `cad_build` tool and the selected feature's properties.

The hidden import input and `.cad-solid-info` still exist in the current source, and the strict profile schema still accepts optional legacy `role`. Those are not diagnosed product defects. The revised fixtures omit unnecessary legacy role metadata and use the current `.cad.json` document transport; this does not change legacy application compatibility. The import journey now follows File → Import file and its browser file chooser rather than depending on header placement.

No production, CI, server, schema or timeout changes were made. No browser was launched or manipulated by this owner. The parent owns actual E2E and in-app-browser verification.

## Preserved and strengthened behavior

Both tests use the same guarded production tool registration bridge already used by `cad-workflow.spec.ts`. Its prepare, raw-call, successful-call and context functions were extracted into `e2e/cad-tool-helpers.ts`, and the workflow imports retain their existing local names. No controller bypass or production hook was introduced. Tool data remains unknown until each consumer checks its fields; the helper's record return type makes the previously implicit JSON result shape explicit.

The successful journey starts with an empty CAD document and asserts idle build state, no build identity and no native WASM request. Two independently specified 20 × 10 × 5 mm boxes, whose sketch X origins are 0 and 10 mm, undergo Boolean Cut. The accepted UI import's fresh document identity, complete feature count and closed, idle storage workflow are checked before a version-pinned `cad_build`. The result must contain one final named `Cut_result` body, one native solid, volume 500 mm³ and bounds [0,0,0] to [10,10,5]. The selected feature's UI properties must show the same volume.

Both UI download commands remain real browser downloads. The suggested names must be `Kernel verification.step` and `Kernel verification.stl`. STEP must have the complete ISO-10303-21 opening and closing envelope, a manifold BRep and the exact final body name. STL must have the pinned OpenCascade binary header, a positive facet count and exactly 84 + 50 × facet-count bytes. Independently summing the downloaded triangles' signed tetrahedron volumes must produce 500 mm³. There must be exactly one WASM request across build and both exports, and no page errors.

The failure journey retains an impossible radius-100 mm fillet of the 20 × 10 × 5 mm stock. The version-pinned build must report the stopped `Impossible_fillet` and retain precisely the 1,000 mm³ preceding `Box_A`, with one native solid. Current context must show the same accepted version/build version and error state. Its real toast must include the failed feature and stopped-build context; after dismissal, the same complete message must remain in Notifications. The failed history item must expose its diagnostic, the header must show feature attention and selected preceding-body properties must retain 1,000 mm³. Both STEP and STL exports must be disabled, and no page errors may occur.

## Focused checks and remaining verification

On Node v24.22.0, strict TypeScript checking of the kernel spec, shared helper and complete workflow spec passes. Playwright `--list` discovers 34 tests in the two specification files. Scoped `git diff --check` passes. Logs are `tmp/cad-e2e-kernel-type.log` and `tmp/cad-e2e-kernel-discovery.log`; the temporary configuration extends the application TypeScript settings without adding these tests to the product build.

These static/discovery checks do not certify browser journey success. The parent's full E2E run and real in-app-browser probes remain the execution gate. Original default test timeouts and all geometry checks are retained; no tests were skipped.

## Frozen SHA-256

| File | SHA-256 |
| --- | --- |
| `e2e/cad-kernel.spec.ts` | `7da6190d99d1fb14d03fde0d3fbacdf12a0a893552aebee043c066a1e30ce6f7` |
| `e2e/cad-tool-helpers.ts` | `228165807ed0d5edb06a075e9277c29c7270c5710d7df5ad862d6f025006b618` |
| `e2e/cad-workflow.spec.ts` | `daeaba40a8e3a154a6703a94203a17701fc2dc7aa5f4c2ec7aec6fca4f30aaa6` |

This is a review of the two existing native-kernel journeys. It does not mark the overall CAD goal complete.

## Actual CI artifact and source follow-up

[CI run 38606111258](https://github.com/Insignifi4nt/wireedm-gcode-parser/actions/runs/38606111258) ran commit `8375c294d09e0a43b48b7c37d977cc59fd9a4065`, before the revised kernel journeys. Its completed report records 124 tests: 113 expected, 10 unexpected, zero flaky and one skipped. The single `browser-test-report` artifact, ID 11916102221, is 30,886,392 bytes and was downloaded only into `tmp/ci-kernel-review-38606111258`. The embedded report JSON was decoded without executing HTML or browser code; only validated report-entry filenames were written below that temporary directory.

Both original kernel journeys timed out in all three attempts at the nonexistent `.cad-statusbar`; neither reached its volume assertion or download loop. Screenshot `playwright-report/data/b65b183bef5b13356d0e61c9fd439187db75daf2.png` shows the rendered Boolean result with complete five-feature history. Screenshot `playwright-report/data/9c743cbcf18d8d84d1f20134c0049ebbb29a87a7.png` and context `4298f1e7fdcd88208182077d80b780f53cac5b09.md` show retained stock, a failed `Impossible_fillet` tree item, feature-attention status, notification count one and the complete stopped-build failure toast. This confirms accepted geometry and current failure presentation visually. Pixels and these unselected-body accessibility snapshots do not prove exact 500/1,000 mm³ quantities; the revised guarded tool assertions and the parent's actual execution must do that.

The sole skip is the existing `editor-existing-project.spec.ts` local-workbench smoke journey. Its report annotation matches source line 10: `Set WIREDM_PLAYWRIGHT_WORKBENCH or keep USERPROFILE/Documents/WireEDM_WEB_FOLDER available.` It conditionally skips when neither supplied local fixture path contains `workbench.json`. No new skip was added, and neither kernel journey has skip annotations.

The parent's independent source pass identified one valid upcoming test failure: `acceptImportedDocument` deliberately assigns portable imports a fresh `cad_${crypto.randomUUID()}` identity, retaining the supplied ID only as import lineage in its operation receipt. The first revised test incorrectly waited for source ID `kernel_browser`. The owned helper now captures the blank context before import, waits for a `cad_` identity different from both that blank ID and the source ID, and returns the actual accepted context for subsequent version-pinned operations. This preserves collision avoidance; it does not change application import semantics. Strict two-spec TypeScript, discovery of all 34 tests and scoped diff checks were rerun successfully on Node v24.22.0 after this repair.

The frozen kernel and shared-helper hashes above include the identity correction. The workflow hash records the initial helper-extraction checkpoint; other owners are now repairing separate pre-existing workflow journeys. No further source defect was found in the scoped kernel/helper re-read. No production or timeout mutation and no browser execution was performed during this artifact review.
