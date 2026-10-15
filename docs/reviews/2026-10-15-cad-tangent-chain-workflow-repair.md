# Explicit native tangent continuation for selected edge operations

Owner scope against `3f70f4dc32374b44351942ce88289d7c3ce55874`. This closes the physically observed plate workflow refusal, not the deferred source-cache investigation. Root built an 80×50 plate with R3 corners, R5 bore and 10 mm Pad; picking one 74 mm top straight edge and choosing Chamfer 0.5 produced the truthful tangent-chain refusal without a direct continuation option. A bore rim also splits into two native semicircles. Original source: `tmp/cad-part-workflow-original-ui.cad.json`; root screenshot: `tmp/cad-part-workflow-tangent-chain-refusal.png`.

## Small accepted behavior

- Existing Fillet/Chamfer features gain optional boolean `tangentPropagation`. Absent/false preserves strict selected-edge behavior; accepted documents do not receive an implicit default field. The strict shared schema rejects nonbooleans and the field on unrelated feature kinds.
- Exact seed selection queries, expected counts, topology ownership and body availability are resolved unchanged before the native edge helper. Explicit `true` allows only the tangent contours already computed by the existing OC builder; there is no new geometric solver, selection service, native operation kind, tolerance or approximation.
- The model forwards the flag only through its selected-edge branch. Whole-body Fillet/Chamfer follows the unchanged path. Unsupported face selection, stale picks, Shell and native builder/result cleanup are untouched.
- The selected-scope editor offers **Follow tangent edges**, initially unchecked unless the accepted feature explicitly stored true. Existing contextual help explains seed counts and split circular rims. Enabled scope reads `Picked edges (n) + tangent chains`. Unchecking removes newly introduced intent and preserves an already authored boolean slot; choosing all body edges clears the selected-chain flag.
- The existing full feature candidate key includes the flag. Old strict ready previews, other owners and stale document versions cannot authorize a changed chain. Preview stays provisional; Apply uses the existing shared atomic feature edit and one Undo restores the exact source document.

This is additive current-app schema support without a storage migration or native/package/worker protocol change. Older strict app readers may reject a document using the new field; root owns release compatibility and public agent-guide integration. Tools obtain it from the shared feature schema, with no bypass handler.

## Red-first and final evidence

All commands use `tmp/toolchains/node-v24.22.0-win-x64/node.exe`.

| Seam | Preserved red | Green / final |
| --- | --- | --- |
| Shared schema/edit | `cad-tangent-propagation-domain-red.log`: two positive intent cases rejected by old schema; 27 controls pass | Full domain topology 29/29 |
| Real native model | `cad-tangent-propagation-native-red.log`: both kinds still reject the explicitly enabled chain | New cases pass; full native topology + model 39/39 |
| Real editor/session | `cad-tangent-propagation-editor-red.log`: three meaningful scenarios lack the continuation control | Initial 3/3; final new 5/5 with explicit-false and owner/version cases |

The real native fixture is the same worked plate, with independently expected original volume `39640 − 160π mm³`. For each operation, the one-edge outer seed and one semicircular bore seed are compared against explicitly selecting their complete existing rims. Partial absent/false policies still refuse; true succeeds with the complete-control material. Exact unchanged edge descriptors prove bottom and unrelated rims are preserved. Bore Chamfer additionally matches its analytic removed volume `π(5·0.5² + 0.5³/3)`. Wrong seed counts still reject, the original source stays byte-for-byte unchanged, and its retained topology remains usable.

Editor/session cases cover both kinds and the circular seed; exact radius alias `' edgeSize '` and selector intent are preserved. They exercise old-ready rejection, exact Cancel/source/version/history, one Apply/Undo/Redo, absent and explicit-false net no-ops, clearing intent for all-body scope, wrong preview owner and accepted-version replacement.

Final focused commands:

```powershell
node.exe node_modules/vitest/vitest.mjs run --project browser src/features/cad/CadTangentPropagationEditor.test.tsx src/features/cad/CadFeaturePreviewEditor.test.tsx src/domain/cad/__tests__/cadTopology.test.ts
node.exe node_modules/vitest/vitest.mjs run --project browser src/features/cad/kernel/cadKernelTopology.test.ts src/features/cad/kernel/cadKernelModel.test.ts
node.exe node_modules/typescript/bin/tsc -p tsconfig.app.json --noEmit
```

Results: **78 distinct cases / five complete affected files**, all pass; app TypeScript exit 0; scoped diff check clean. Final logs: `tmp/cad-tangent-propagation-{ui-domain-final,native-final,typecheck}.log`. No existing limits, timeouts or assertions were weakened. No build, server, browser automation, commit, install or native-candidate changes by this owner. Root owns fresh native-backed physical UI proof, release/discovery integration and the checkpoint.

`tmp/cad-tangent-propagation-source-freeze.json` pins the eight changed production/test paths, this record, red/green logs, exact root fixture and unchanged native/candidate artifact seals. The production change is confined to the domain feature/schema, native edge helper/model forwarding and selected-edge editor. This one workflow repair is frozen for independent review; it does not claim overall CAD completion.

## Independent-review correction: accepted-false key order

Explicit's unchanged ignored derivative reproduced a meaningful no-op failure when accepted `tangentPropagation: false` precedes `selection` in JSON: checking then unchecking appended the restored key, so JSON-based draft identity stayed changed. The original false fixture placed the key last. The tracked suite now includes absent, false-before-selection and false-after-selection cases; before repair it gives **one failure / two passes**. Restoring accepted false by spreading the current draft and overwriting the boolean preserves its key position and all other draft changes. No domain/native/preview-controller behavior changed.

`tmp/cad-tangent-property-order-owner-{red,green}.log` preserves the regression and final **40/40 UI/domain cases across three files**; app TypeScript still exits 0. The earlier unchanged 39 native cases give **79 distinct affected cases overall**. The previous 78-case manifest/logs remain intact, and its exact owner record is retained as `tmp/cad-tangent-propagation-owner-record-before-property-order.md`. Current source/evidence is re-frozen separately in `tmp/cad-tangent-propagation-property-order-source-freeze.json` for independent rerun. No timeout/assertion weakening, build/server/commit or broader change.

The same review then identified the symmetric accepted-true off/on ordering case before final handoff. The tracked roundtrip matrix now covers absent plus both true/false positions around `selection`. The false-only fix gives **one failure / four passes** in this matrix. Preserving any already authored boolean slot on explicit uncheck fixes both directions; absent features still remove only their newly introduced flag. The change remains one editor condition and its draft spread, without a broader identity/equality refactor.

Final current UI/domain gate is **42/42** (`cad-tangent-property-slot-owner-green.log`), with app TypeScript exit 0. The six other production/test paths and the existing native 39-case gate remain unchanged: **81 distinct affected cases overall**. Both earlier manifests and owner records are retained. `tmp/cad-tangent-propagation-property-slot-source-freeze.json` is the final current source/evidence handoff, superseding the intermediate false-only freeze. Reviewer originals remain untouched.
