# CAD local resource checkpoint

Verified on 14 October 2026 against the source after `09795ec5e0e404f5ce69ff2173dea119a69f66ce`. The ongoing CAD improvement goal remains active. This checkpoint closes the user's request to remove arbitrary CAD exchange and saved-file policy caps, with native component feedback from the preceding solid interaction slice.

## Result and contract

CAD JSON, original STEP/STL/DXF sources, complete stored documents, native import roots/solids, STL facets and preview/topology inventories no longer have fixed size/count policy ceilings. Exact CAD DXF parsing is an explicit shared-parser mode; existing CAM parsing policies remain separate. Full-workbench backup/rescue limits also remain separate. No document schema, installed post package, saved revision or native geometry tolerance is silently changed.

Malformed encoding, units, incomplete geometry, nonfinite numbers, invalid native pointers, real heap bounds, manifoldness, exact topology identity, stale versions and active workflows still reject before acceptance. Cancellation owns active file reads and native work. Healthy native workers retain their model across successful jobs; the old two-minute deadline and fixed job-count recycling are removed. The native library remains the previously repaired and source-pinned pair.

Cache and folder adapters now expose cancellable exact UTF-8 reads. Shared gzip decoding preserves BOM and Unicode without allocating a full binary string and inflated byte array together. The incremental fallback checks each gzip member's CRC/length. The existing file journal retains exact before/after images, conflicts, readback, rollback and durable receipts without its former 384 MiB gate. Its recovery format is unchanged. No journal, trash, backup or old package is deleted.

Large tool contexts and committed receipts use one formatter for whole parameter/group entries within actual UTF-8 response budgets, with exact total and omission counts. The complete stored document remains available through versioned parameter pages and exact document text chunks. This response contract prevents a committed edit from becoming an ambiguous oversized receipt.

The unit investigation uncovered a separate native defect. Nested conversion-based STEP length units can silently fall back to the wrong scale. The importer now reports `step-units-unsupported` for that unsupported structure before transfer; original source is retained. SI units and supported direct conversions keep their existing accurate behavior. Release diagnostics and compatibility notes explicitly identify the potential change for previously accepted nested-unit imports.

## Independent evidence

- [Exact source/import review](2026-10-14-cad-source-capacity-repair.md) includes unchanged default-gear STEP/STL round trips, the actual 1,001-solid STEP assembly and native unit-transfer evidence.
- [Storage/resource review](2026-10-14-cad-local-resource-audit.md) covers both adapters, large journal recovery, cancellation, physical platform constraints and remaining copy amplification.
- [Worker/subshape review](2026-10-14-cad-worker-subshape-resource-review.md) verifies indexed map ordering/location/collisions and constructor-failure cleanup.
- [Native capacity/section review](2026-10-14-cad-native-capacity-section-review.md) covers complete large mesh tails, sparse replies, actual 37,512-element pagination and current document-read offsets.
- [Context receipt review](2026-10-14-cad-bounded-context-receipt-review.md) and [independent review](2026-10-14-cad-context-receipt-independent-review.md) verify truthful summaries, fresh committed versions, stale/no-op retries, single Undo/Redo and exact save/import/reopen state.
- [Native component feedback review](2026-10-14-cad-native-component-feedback-review.md) verifies derived physical-solid counts, compact preview/selection feedback and unchanged Join material semantics.

## Current combined gate

All **354 files / 3,795 tests pass**. Browser project: 311 files / 3,447 tests, 277.88 seconds with two workers. Pure-domain: 43 files / 348 tests, 6.30 seconds. The native cases are part of the browser project and are not counted twice. Logs are `tmp/cad-local-resource-browser-rerun.log` and `tmp/cad-local-resource-pure-final.log` in the CAD checkout.

Production TypeScript/Vite, all 92 documentation/discovery/schema/link checks, release compatibility, and exact paired native corresponding-source checks pass. `tmp/cad-local-resource-build.log` records the build. The 69 modified/new/deleted source/test paths match their gate freeze before and after validation. No requested accuracy, behavioral assertion or performance threshold was lowered. The two earlier whole-suite failures were a retired parameter-cap expectation and a Save test observing microtasks before the actual durable receipt. Their replacements check accepted plugin creation and real cache/folder save outcomes.

## Actual production browser

In disposable tabs at port 3778, the human File import accepted a **5,566,171-byte STEP**. The fixture is the existing 3,469,018-byte default gear export with 2 MiB of trailing spaces; the original fixture remains unchanged. The native build reports one solid, 4,080 triangles and volume 10,681.229997581098 mm³. Independent original fixture volume is 10,681.229997579672 mm³; the difference is numerical roundoff.

The human Download CAD action produced **5,645,069 bytes**. Human file import in a fresh tab rebuilt that portable document with a fresh identity, exactly equal feature definitions and the same native volume. The original STEP hash stayed `140ea3ecedb25466462ae0c9a177874f732f2b6d69105ece30f39e857a300ad2` through both imports and subsequent edits. Actual browser downloads were read and compared; download-request receipts alone were not treated as saved files.

Live WebMCP batches added 1,001 stored parameters. Context retained 49 whole entries and reported 952 omissions. Every exact stored value was read through pagination and compared to the exported document. Unused parameters reused the native build. A named parameter drove a Transform from 143 to 144 mm; the body bounds moved exactly 1 mm with unchanged material within numerical roundoff. A stale retry rejected, a no-op retained its version, and one Undo restored the complete preceding placement and values. The final exported original source and parameter map match exactly.

Proof is in the primary workspace `tmp/cad-local-resource-browser-report.json`, `cad-local-resource-large-gear-import.png` and the recorded actual download paths. No test CAD document was saved. Disposable tabs were closed. The current user tab was reread and matched its zero-feature, zero-parameter, no-history backup before an intentional refresh; the current bundle now shows a fresh empty CAD draft. Its ephemeral identity/camera reset during refresh. Trackpad navigation and hidden on-part dimensions persist. Modeled content, saved records and the preserved original gear backups were not replaced.

## Continuing work

The icon catalogue is refreshed to 452 production files, 419 parsed code files, 89 canonical drawings, 282 resolved references and 206 shared routes, retaining duplicate call sites, purposes and source hashes. Original icon creation remains a separate user-owned task.

The next resource audit measures large native sections, ordered endpoint-degree broadphase and STEP byte ownership. It must address actual cost without changing curve predicates or geometry. Immutable source serialization, typed preview transfers, source identity and journal staging remain measured architecture follow-ups. General geometric constraints, multi-shell STL reconstruction and unrelated feature kinds are outside this checkpoint's implementation; the broader CAD goal is not complete.
