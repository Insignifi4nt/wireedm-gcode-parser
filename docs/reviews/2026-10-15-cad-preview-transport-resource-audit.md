# CAD candidate preparation and transport audit

Read-only audit of checkpoint `6e2113fa0151ef7d0b378ad3de7635664b2fab82`, after the reviewed region/depth implementation. No tracked production/test source, public documentation, release/checklist, native package, build, server or browser was changed. Measurement scripts and fixture outputs are ignored files in `tmp/`.

## Result and first bounded improvement

The strongest immediate finding is duplicate closed-area preparation during an unrelated named extrusion-depth edit. The actual editor regenerated the unchanged 120-tooth gear source once for each of twelve input events. Its optional depth interaction already caches that same preparation by immutable source and relevant scalar dependencies. Share this preparation in the domain, retain the depth model's latest selected-material bounds cache, and keep placement resolution separate. This requires no transport, feature, precision, validation-timing or public-schema change.

The coordinator also performs complete document validation/cloning before its native debounce. This is measurable but remains an open design issue: the existing immediate validation-error contract must survive. Moving all validation behind the debounce would delay unknown-driver/zero-distance and other errors and is not an authorized equivalent repair.

Repeated retained STEP compilation is a larger native cost than its transport or string keys. Record it for a later independently reviewed native-source cache investigation; do not mix that ownership change into the preparation repair.

## Reproducible measurements

Node v24.22.0, the pinned current OCCT package, real current shared domain operations. Timing host: see `tmp/cad-preview-resource-audit.json` (`cpu`). Each pure operation used two warm-up calls and seven recorded calls, without elapsed-time acceptance assertions. Native builds were three independently checked material cases per fixture. Real editor observation used React/jsdom and only replaced the unavailable native callback; it did not mock fields, scalar intent, geometry, cell preparation or depth-model code. Cross-thread numbers used a real Node Worker/V8 structured-clone echo and **are not browser timing claims**.

| Fixture | Exact portable JSON bytes | Retained source/recipe bytes | Candidate `applyCadEdits` median | Worker boundary parse median | Twelve synchronous coordinator updates | Full cell preparation median | Warm depth-model median |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Pinned V3, module3,18 teeth, radius6 bore | 7,189 | 6,608 | 3.056ms | 2.817ms | 33.753ms | 2.508ms | 0.014ms |
| Same pinned package,120 teeth | 7,192 | 6,609 | 9.453ms | 9.816ms | 114.828ms | 12.784ms | 0.010ms |
| Actual DXF round-trip of a2048-edge radius100 polygon | 491,024 | 236,031 | 11.879ms | 12.663ms | 149.970ms | 6.027ms | 0.006ms |
| Actual retained STEP export of the18-tooth gear; edit a named transform translation | 3,547,952 | 3,469,018 | 5.055ms | 5.184ms | 65.515ms | n/a | n/a |

The gear recipe byte values are the exact JSON of the embedded geometry/inputs, not a separate external file. The DXF fixture is a complete actual export/import with original text and2048 line segments; it has no artificial padding. The STEP fixture is the existing real exported solid, with868 faces and2598 edges, not a synthetic text payload. Current STEP SHA-256 is `a501c92cae766d9b4c518b5fd6cc571c89fd5970cf397c115e594ae82b52f182`.

The coordinator burst used its real default200ms debounce and `applyCadEdits`. It captured **12 complete document `structuredClone` calls,12 waiting publications and1 dispatched build**, retaining only the latest value7.1. All original document/source content remained exact. The native transport callback was the only fake boundary; these timings measure synchronous candidate preparation, not native elapsed time. Gear rule inspection additionally clones small field-rule records; those were counted separately (`allStructuredCloneCalls`) rather than called full-document copies.

### Actual editor evidence

`tmp/cad-preview-field-resource.test.tsx` mounts the current `CadFeatureEditor` with the parsed120-tooth fixture, a literal pinned gear source and named `distance:'depth'`. Twelve real input events change only the numeric named depth, preserving the exact feature definition/alias and accepted source. The final callback is the same feature plus `set-parameter depth7.1`; the depth model agrees at7.1. No Apply/history/write/native operation occurs.

Observed preparation calls:3 during mount (1 depth model,2 area field), then **12 area-field preparations and0 new depth-model preparations** during the twelve depth edits. Those repeated preparations consumed260.044ms total, with20.306ms median; median whole input event was25.813ms in this jsdom run. Pure Node cell timing was12.784ms: do not add these separate-environment timings or treat either as a universal frame budget. Invocation/source identity evidence is the substantive result.

The field's memo currently depends on `source, document.features, document.parameters` (`CadSketchRegionsField.tsx:18–30`). The editor preserves accepted feature/source identities and creates a new effective parameter map (`CadFeatureEditor.tsx:103`). Thus unrelated named depth changes invalidate the field memo even though no profile scalar references depth. The depth cache already collects `profiles.*` scalar parameter names and compares their values using `Object.is` (`cadExtrudeDepthInteraction.ts:47–61`).

### Native and transfer separation

Warm direct-runtime native model times in the first measurement:

| Fixture/edit | Native model, recorded calls | Independent material result |
| --- | --- | --- |
| Gear depth5/6/7 | 1619.622/1486.580/1454.092ms | 10681.229997580/12817.475997096/14953.721996612mm³; complete analytic cell area × requested depth |
| DXF polygon depth5/6/7 | 3791.337/3820.419/3774.830ms | `(2048/2) ×100² ×sin(2π/2048) ×depth`, within1e-4mm³ |
| Retained STEP, X translation0/1/2 | 3591.015/3341.521/3357.343ms | invariant10681.229997581mm³, matching the independent original export material |

A second small source-instrumented native observation (`tmp/cad-preview-native-phases.*`) wrapped real import/meshing functions without changing arguments, outputs or ownership. Gear build925.847ms included245.499ms face/edge meshing. Retained STEP transform0→1 built3622.889→3305.031ms; **unchanged source read/transfer/import validation alone repeated1818.904→1582.181ms**, and each model meshed both the imported intermediate and final transformed solid (~293–323ms each). Complete source and material stayed unchanged; all models were disposed. The timing variation between runs illustrates why these are observations, not guaranteed latencies.

For the3.47MiB STEP document, the median outgoing Node Worker call was1.602ms and outgoing-payload/acknowledgement round trip3.157ms. Full runtime string key median3.131ms, geometry-key/active-parameter projection4.662ms. With native geometry actually reused for document-only rename, runtime key work still took13.464–14.769ms. Each full/geometry key contains~3.548 million UTF-16 code units. That is logical content size, **not a measured JS heap allocation**; V8 may store ASCII compactly or share strings.

The built18-tooth gear reply is953,084 JSON bytes; its number-array `structuredClone` median3.740ms. Node echo of this reply in both directions took23.892ms median, not a one-way browser measurement. The2048-edge polygon reply is2,067,352 bytes, clone8.765ms and two-direction Node echo49.888ms median. Real `isCadKernelReply` validation measured roughly0.7–3.5ms in the separate phase observation. No mesh precision, source simplification, invalid-data acceptance or binary transfer policy changed.

## Exact current ownership/copy trace

1. Editor owns provisional feature plus numeric parameter overrides; its candidate edit definition is small for scalar extrusion/transform edits (255/226 bytes for the large retained-source fixtures).
2. `createCadFeaturePreviewCoordinator.update` calls `applyCadEdits` synchronously before setting its debounce (`cadFeaturePreview.ts:113–116`). `applyCadEdits` constructs a candidate and calls the strict document parser (`cadOperations.ts:172`). The parser owns/validates/detaches/freeze-checks the complete graph and validates full sketch geometry/source encoding (`cadSchema.ts:81–91` and144–177).
3. The client recognizes this parser's detached frozen output and does not add another full explicit clone. Actual `postMessage` crosses the worker boundary. A mutable clone/lookalike never receives the parser's trusted fast path.
4. The worker parses/detaches the received graph and computes both exact full accepted key and conservative native geometry key (`cadKernelRuntime.ts:29–54`). Full accepted key still pins stale topology/queries; active named parameters remain conservative, including geometrically active generic locked inputs.
5. A changed native feature definition rebuilds the complete model, including unchanged imported source. Source parsing writes the complete file, native transfer validates complete roots/material/units, and every accepted body stage gets exact topology validation and a preview mesh.
6. Native BRep stays in the worker. Built DTOs contain plain number arrays, so `cadKernel.worker.ts:19` clones a reply without a transfer list; the UI client validates it. Native model/cache retains its own arrays and exact topology owners.
7. The coordinator keeps at most an active job, latest candidate and same-owner/version last-valid result. A later normal edit does not kill the warm worker: stale native success cannot publish, then latest work runs. Clear/owner/document/storage/version changes dispose it; blocked intent aborts active work. This is sound coalescing/lifecycle behavior and must remain.

These are exact graph/string/array operations from source and measured costs; this audit did not measure peak resident JS/WASM allocations. A sequence of document clones does not prove a particular physical source-string duplication count.

## Smallest first change and red-first plan

Own only domain preparation reuse and its two current human/depth consumers:

- Centralize the preparation dependency projection in the existing domain preparation module. Cache one latest successful `CadPreparedSketchCells` per **verified immutable source identity**, with `profiles.*` referenced parameter names and exact `Object.is` values (including absent values). Use all syntactic profile dependencies conservatively; do not interpret disabled generic inputs as dormant.
- Trusted source identity must have a real immutable boundary proof, not an outer `Object.isFrozen` assertion or TypeScript `readonly`. The document parser already produces detached deeply frozen sources. A private WeakSet registration/query at that boundary is one small option. Arbitrary mutable/shallow-frozen inputs retain the uncached complete resolver, so later alias mutation cannot return stale geometry. Do not add a public wire flag/schema to claim trust.
- Keep `prepareCadSketchCells`' complete forest/contact/nesting/precision and pinned-package validation contract. A successful reused source preparation certifies source geometry only; full document/history/native validation still runs at its existing boundaries.
- Both area field and depth model obtain the same prepared object. Remove the duplicated dependency/cell preparation from the depth module; retain one latest selected-union bounds entry associated with that preparation/selection. Placement/offset/datum resolution remains separate and current. A depth relation that also drives width changes its preparation; a depth relation used only by placement changes placement without regenerating local cells.
- Weak source ownership and one latest dependency result avoid retaining every typed value. Adopt only successful preparation; invalid new relevant values reject rather than returning the prior cells. Restoring valid values remains deterministic; cache presence is never required for correctness.

Meaningful regressions before implementation: (1) real120-tooth named-depth editor reuses the same physical picker cells while depth/preview quantity advances and Cancel leaves accepted history/source exact; (2) relevant width/module aliases change actual bounds/area, including same alias driving depth+source; (3) missing/invalid relevant parameters, changed nesting and stale region references still reject; (4) datum/offset-only driver updates actual placement without stale geometry; (5) exact pinned V1/V2/V3 and generic locked input semantics; (6) mutable and shallow-frozen lookalikes cannot poison/reuse trusted results; (7) two consumers share one preparation, source replacement/reorder/rename establishes a new identity, and selected-material bounds update when selection changes. Assert material/reference/identity behavior and call counts on this specific expensive operation, never latency thresholds or cache internals.

Keep existing immediate candidate validation-error tests unchanged. Coordinator coalescing work needs its own later design: immutable narrow edit capture, immediate blocked/invalid feedback, fresh owner/document/storage/version checks before dispatch, unchanged Apply readiness/error stage and obsolete-success suppression. Deferring all `applyCadEdits` fails the current error timing contract. Structural reuse of verified unchanged source subgraphs/compiled forests may preserve that contract, but requires a proper boundary design and separate review.

An exact imported native-source cache is another later investigation justified by the1.58s repeated native transfer observation. It must own validated immutable source/BRep independently of a disposable candidate model, hand out safe caller-owned copies, invalidate on exact source/units/package changes, and release on worker/cancel/clear. No imported-source substitution, approximate tolerance fallback or body/tool ownership shortcut is justified. Do not introduce that cache or a document-token protocol in this first UI preparation change.

## Evidence files and scope

- `tmp/cad-preview-resource-fixtures.ts`, `cad-preview-resource-audit.ts/.log/.json`, `cad-preview-transport-echo.mjs` — real domain fixtures,12→1 coordinator observation, worker proxy, native/material results.
- `tmp/cad-preview-field-resource.test.tsx/.config.ts/.log/.json` — actual editor observation,1 case passed; final repeat after removing stack-capture time from the measured preparation.
- `tmp/cad-preview-native-phases.test.ts/.config.ts/.log/.json` — real native import/meshing/reply validation observation,1 case passed in10.31s total.
- `tmp/cad-preview-resource-audit-source-hashes.json` — exact inspected production source, measurement and real STEP fixture hashes.

This is a bounded next-slice proposal. The already reviewed CAD checkpoint and overall active goal remain separate; no whole-app instant performance or production completion claim follows from these measurements.
