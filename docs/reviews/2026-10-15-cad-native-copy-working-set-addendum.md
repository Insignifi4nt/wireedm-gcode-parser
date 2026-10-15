# Native Copy: lean actual-model working-set observation

Follow-on to `2026-10-15-cad-native-copy-resource-audit.md`; its frozen 18 files and all earlier 70 protected rows remain unchanged. Checkpoint `3f70f4dc32374b44351942ce88289d7c3ce55874`, Node `v24.22.0`, explicitly selected matching `tmp/cad-native-copy-candidate` pair. No production/package/native/install/cache changes.

This new ignored Vitest assay uses **the unchanged `buildCadKernelModel`**, normal native validation, topology indexing, meshing and retained result arrays. Its isolated import-module wrapper supplies an independent `BRepBuilderAPI_Copy(..., true, true)` and detached current analysis from explicitly prevalidated pristine originals. There is no deployed source store, new model signature or implemented runtime transaction. The test driver decides which actual model to retain/dispose. Separate observation wrappers delegate validity/disposal unchanged and count shape handoffs/results; internal helper/topology temporaries are not individually intercepted.

The sources are the exact retained 3,469,018-byte STEP gear, the previously sealed real box/cylinder STEP sources and the sealed replacement box. Four import occurrences use gear twice plus box and cylinder, followed by a stock translation. Only compact original native volume/bounds/source-hash checks are retained; exhaustive edge/surface/pcurve snapshots belong to the earlier sealed proof.

## Observations

One native-owning process completed the scenarios in 10.54 seconds including initialization/import; the synchronous scenario itself took 8.07 seconds. Both accepted and candidate models retain real topology and mesh output, with independently expected native stock volume/bounds from ordinary import/transform controls. Original and duplicate gear/cylinder material/bounds match bitwise. All normal mesh/group arrays are retained during the simultaneous-model checkpoints.

| Phase | Pristine shapes | Actual models / visible bodies | Reserved WASM, MiB | Current RSS, MiB | OS lifetime RSS high-water, MiB | JS heap used, MiB |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Modules, before WASM | 0 | 0 / 0 | — | 94.781 | 95.203 | 20.278 |
| WASM initialized | 0 | 0 / 0 | 100.000 | 205.781 | 205.781 | 53.555 |
| Three pristine originals, before models | 3 | 0 / 0 | 100.000 | 260.855 | 443.016 | 41.627 |
| Accepted model | 3 | 1 / 4 | 199.063 | 420.223 | 443.016 | 65.317 |
| Accepted + changed candidate | 3 | 2 / 8 | 199.063 | 448.855 | 452.215 | 95.561 |
| Accepted + diagnosed Cut prefix | 3 | 2 / 8 | 199.063 | 464.230 | 464.230 | 126.729 |
| Old accepted + distinct replacement candidate | 4 | 2 / 8 | 199.063 | 477.160 | 480.484 | 96.582 |
| All explicit owners/models disposed | 0 | 0 / 0 | 199.063 | 478.305 | 480.520 | 107.283 |

The simultaneous eight-body models retain **266,772 mesh scalar values**, plus their normal topology groups/indices and exact native shapes. The extra **99.063 MiB** of WASM reservation appears during the first actual accepted model build. It was absent from the earlier geometry-bag simulation, demonstrating why normal validation/topology/meshing must be included. It cannot be attributed solely to Copy/cache overhead: no ordinary-reread actual-model memory comparator was run.

The process high-water is **492,052 KiB / 480.520 MiB**. Actual STEP prevalidation already reached **443.016 MiB**, before either model existed; the later process high-water is 37.504 MiB above that prior high-water. This is not a measured live-set difference. RSS includes V8/module/runner/WASM/source/normal arrays and earlier work; disposal does not shrink reserved WASM or force JS/native allocator pages back to the OS. These numbers describe the native-owning Node process, not every runner/browser process or whole-device memory. **Allocated live native peak remains unavailable**, with no allocator guesses, instrumentation, GC or memory reset.

The completed scenario checks cover:

- Real candidate section rejection (`empty-section`), candidate disposal and unchanged accepted result identity/exact native edge inspection afterward.
- Real diagnosed no-material Cut (`cut-no-material`, then `rebuild-stopped`), truthful four-body valid prefix, export refusal and accepted inspection surviving rollback.
- Actual distinct-source replacement while old/new models coexist, followed by old-model and unused-original disposal; then final gear-source removal and still-usable accepted inspection.
- Disposal of all pristine originals before final independent-model native inspection/section, then final model disposal. Observed source/model shape owners balance **27/27**, explicit Copy/bounds temporaries **67/67**, zero remaining; 18 Copy handoffs, peak two models and 13 observed full-shape wrappers.

## Runner result and scope stop

The initial ignored config omitted the app's `@` alias and ran zero tests; that setup failure is preserved. Adding the existing app alias allowed the native run above. Its receipt records every scenario assertion and cleanup completed, but **Vitest reports one failed test because its unchanged five-second timeout expired**. No timeout or assertion was changed, and no rerun was used to manufacture a passing gate. This is completed observational evidence, **not a passing CI/acceptance test**.

Scoped TypeScript checking passes. Before/after seal checks verify all **88** earlier candidate/original/resource evidence/helper rows unchanged. New evidence is `tmp/cad-native-copy-resource-working-set-{report.json,model.log,test.ts}`; the earlier setup log is `tmp/cad-native-copy-resource-working-set.log`. The separate `tmp/cad-native-copy-resource-working-set-freeze.json` seals all new evidence and exact shared input sources. Test SHA-256 `75B554C1D1DC6AE2418D6794236AB381104FF16BB9D861B1C6A0C99673C6AC11`; receipt `3F01149F5A26B358FCA2F6ED90E277E452DD355C6FA5A7FB7B5F9593B8925F80`.

The earlier observed gear construction benefit remains substantial (35.5 ms Copy versus 1,664.7 ms full reread, with separate validation), but actual model work has meaningful memory and compute costs. Source-cache adoption is deferred behind visible product work; any later decision should weigh this benefit against retained originals, old/new native models and implementation size. No further allocator experiments, optimization requirements, implementation or generic exactness acceptance are opened by this addendum. This resource slice stops here.
