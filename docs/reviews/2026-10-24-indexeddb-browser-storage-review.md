# Browser storage implementation review

Baseline: `0dd0bc58`, main release 0.0.726. Initial implementation reviewed at `ad86b647`, followed by the corrections below. The scope is the requested IndexedDB default, exact legacy preservation, atomic saved-revision persistence, backup access, error classification and public API verification.

## Standards axis

The independent standards reviewer identified two regressions against the repository's exact-original preservation and truthful-diagnostic rules:

1. IndexedDB ordinary reads stripped a leading BOM. A BOM-only external program change could therefore pass an expected-text comparison and be overwritten. Ordinary database reads now retain the original string, editor loads and save snapshots use exact readers, and semantic JSON parsers strip a BOM only while parsing. Regression tests cover legacy cache, IndexedDB and folder adapters, an exact reviewed retry, and migration/backup of BOM catalogs, installed libraries and revisions with unchanged artifact hashes.
2. A thrown database error before the durable-write callback was classified as revision validation failure. Controller generation now tracks the save phase separately from whether writing has begun, returning `CONTROLLER_ARTIFACT_REVISION_SAVE_FAILED` for unexpected pre-write storage failures while retaining cancellation propagation. The public tool regression exercises a rejected database read and a successful retry.

After those fixes, the reviewer reported no remaining concrete standards or data-integrity findings. Focused tests, typecheck, lint and whitespace checks passed.

The exact-load fix also retains the previous display pipeline for non-UTF-8 folder programs. Exact decoding is preferred; the ordinary reader can still display legacy encodings when exact decoding fails. Save snapshots remain exact and refuse to overwrite unrepresentable originals before any write. A real invalid-byte fixture verifies parsed motion, original bytes, project/catalog preservation and absent journals.

## Spec axis

The independent requirements reviewer identified two recovery/API issues:

1. A denied legacy inventory could prevent composite recovery from listing healthy database files. Each observation is now isolated. Readable files remain downloadable, denied individual reads become explicit omissions, and an unknown source makes the inventory incomplete rather than silently empty. Tests cover failures of legacy `length`, `key`, and `getItem`, and an unavailable database with readable legacy files, with no source writes.
2. Bounded recovery originally read size and text in separate transactions. A concurrent writer could replace a small file with a large one between those reads, defeating the preflight memory bound. Size and conditional data retrieval now share one readonly transaction. Missing/corrupt size metadata cannot authorize cloning the value. The regression queues a 1 MB replacement between requests and proves the read uses the earlier 1-byte snapshot; a separate test verifies late cancellation before returning data.

After those fixes, the reviewer reported no remaining requirement gaps in the inspected changes. All 41 focused adapter/connection tests, typecheck, lint and whitespace checks passed.

Parent review additionally proved that a foreign pending journal appearing after recovery must not become an accepted non-null guard image. A regression first reproduced the incorrect successful commit; native save now requires all known recovery paths to remain absent inside the atomic transaction and retains any unexpected journal unchanged.

## Acceptance evidence

The private source snapshot remains outside the repository. In isolated Chromium and Firefox profiles, migration preserved its files and original cache, and the public export tools produced ISO SHA-256 `2914868a95f85b73a536540c8b84d4956cb7c2594bda1c74fbddc824a95d39bf`, identical to the pre-fix folder-generated artifact. A synthetic complete 6,000-segment job also imported, exported, reopened, reused its exact revision and downloaded a verified backup without folder access. The real-engine test additionally aborts a native revision/index transaction and checks the unchanged project, absent partial revision and successful retry.

The full release checklist records final verification totals. Browser-managed quota, user-cleared site data, noncooperating external writers and physical machine verification remain outside a promise of unlimited or infallible storage. No physical verification is inferred from deterministic software output.
