# CAD integrated Spec review

Reviewed the working-tree diff from `c16a15eb9f9805622ccaeda5b39dc2698ddfda8c`, complete untracked sources, AGENTS.md, the hardening checklist, prior Spec review and reference-interaction record. HEAD remains the baseline. All 181 manifest paths initially matched their SHA-256 values; comparison with the previous 147-path manifest identified the integration delta. Subsequent coordinated changes require the root's final manifest refresh.

## Finding resolved

The checklist requires "Run representative actual browser journeys and inspect screenshots" at line 34. The usability record states "Selection and inspector minimization leave canvas columns unchanged. Every inspector floats" at line 15.

Existing browser journeys still required the removed properties-column separator and bottom Ready strip. Original locations were `e2e/cad-workflow.spec.ts:621,823,1464`; the root independently confirmed both obsolete controls are absent in the production browser. With root authorization, the same file now checks pending dimensions, remembered model-tree width, narrow-window containment, exact 1,400 mm³ material and unchanged public viewport identity/canvas bounds across inspector minimize/restore. The two Ready waits now poll current draft/build versions and diagnostics through `cad_get_context`. Final locations are `e2e/cad-workflow.spec.ts:615,838,1480`.

## Integration assessment

No additional actionable Spec issue was found. Indexed map identities and `ModifiedShape` connect every localized mesh group to the exact source inventory without widening stored geometric selectors (`cadKernelMeshing.ts:28,97`, `cadKernelTopology.ts:135,175`). Section and named STEP ownership remain scoped around borrowed accepted bodies, including native failures (`cadKernelSection.ts:40`, `cadKernelExport.ts:8`). Original extractor methods, geometry, sampling and precision remain compatible. All three installed loader/WASM/declaration fingerprints and five modified-source artifacts independently matched their source record.

Inspector-aware explicit/initial Fit reads current occlusion without reacting to panel changes. Recreated OrbitControls preserve tiny fitted zoom (`CadWorkbench.tsx:117`, `CadViewport.tsx:90,162`). Shared preview, picking, agent discovery/authoring and export checks retain cancellation, ownership and draft-version guards. No new modeling kind was introduced by this integration.

Playwright lists all 32 journeys and `git diff --check` passes. This reviewer started no server or browser and ran no competing native suite. Root-owned production browser evidence and the final test/build rerun complete verification after coordinated fixes. Native reserve reuse covers exercised cases, not universal allocation bounds, CAD parity or physical manufacturing certification.
