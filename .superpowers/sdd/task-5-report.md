# Task 5 Report: Structural UPID validation and fail-closed export

Date: 2026-07-12
Branch: `codex/upid-correctness-safety`
Start commit: `8b859ba`
Commit: `fix: validate and gate UPID exports`

## Status

Task 5 is implemented under strict TDD. Persisted UPID graphs now have a pure structural/export validator, project loading rejects structural corruption while retaining inspectable topology errors, and both low-level and document-level posting fail closed. Machine coordinate precision is normalized, persisted, editable, and threaded into every posted X/Y/I/J word.

The protected Contour Workbook worktree files were not edited or staged by Task 5.

## Implementation

### Structural validation

- Added `validateUpidDocument(document): UpidValidationReport` with `valid`, `structurallyValid`, `diagnostics`, `blockingDiagnostics`, and `structuralDiagnostics`.
- Indexed segment, endpoint-cluster, chain, contour, path-element, operation, and diagnostic IDs once and diagnosed duplicate IDs in every collection.
- Validated schema, source/options values, executable and derived geometry, bounds, metrics, operation/override points, DXF/source numeric provenance, diagnostic IDs, manual refs, parent/child/root refs, and every live graph edge.
- Validated endpoint ownership and cluster metrics, chain endpoint-cluster identity, chain/operation adjacency, closed-loop closure, operation endpoint agreement, and chain/contour/path-element/operation identity.
- Kept validation passes indexed/linear; parent-cycle validation caches resolved paths and endpoint-cluster checks avoid global or per-cluster quadratic scans.
- Made validation total for malformed persisted collection members, child lists, diagnostics, circular fields, and manual-start override arrays; corrupt input returns structural diagnostics instead of leaking `TypeError`.
- Checked circular center/radius/endpoint executability plus stored arc angle/sweep agreement while preserving representable tiny/huge explicit sweeps.
- Used the document healing envelope `max(endpointTolerance, coincidenceEpsilon, recorded within-tolerance toleranceUsed)` while rejecting inflated/stale cluster healing metadata.
- Kept removed duplicate segment IDs in diagnostic provenance legal; historical diagnostic refs are not mistaken for missing live graph refs.
- De-duplicated diagnostics by ID so each existing error is blocking exactly once.
- Kept projectless transient documents valid for direct domain APIs. Project wrappers still require/match `source.projectId`.
- Made `projectUpidDocument` throw `Invalid UPID document: ...` for structural corruption before dereferencing project identity; topology-blocked documents still load for inspection.

### Atomic fail-closed posting and export

- Added `status: 'ready' | 'blocked'` to `GcodePostResult`.
- Added low-level segment/operation preflight for duplicate/missing IDs, invalid tolerances, non-finite geometry, invalid circular derivations, endpoint disagreement, and invalid X/Y/I/J formatting.
- Tracked the actual formatted machine position across moves. Raw-coincident joins that round to different machine coordinates now block atomically instead of starting an arc from a different programmed point.
- Removed the old intra-operation `unexpected-gap` rapid. A gap over the effective tolerance now returns an error-level `post-unexpected-gap` and atomically clears body, moves, operations, and metrics.
- Retained explicit within-tolerance `G1` bridges with `post-bridged-gap` warnings.
- Retained valid `G0` positioning between operations and valid open G40 centreline operations.
- Ran document validation before UPID posting and passed the recorded compatibility-healing envelope into the low-level post.
- Made `postUpidToGcodeBody` return `''` whenever the post is blocked.
- Added `canDownload` and `blockingDiagnostics` to `UpidGCodeExport`.
- Kept blocked preview context by composing the configured header/footer around an empty body, with zero posted/program operations and de-duplicated diagnostics.

### Coordinate precision and migration

- Added required `OutputFormat.coordinatePrecision` and set the default machine to `3`.
- Added normalization for integer precision `0..6`; absent, fractional, non-numeric, non-finite, negative, and over-range values all become `3` rather than being clamped or coerced.
- Updated the workbench manifest output boundary so legacy manifests/profiles without precision normalize and persist as `3`.
- Added precision to settings draft identity, save input, active machine output, imported-project profile fixtures, and project UPID export composition.
- Added a labelled numeric settings control with `min=0`, `max=6`, and `step=1`.
- Created one coordinate formatter per post and applied it to every X/Y/I/J word in absolute and incremental IJ modes.
- Rejected non-finite inputs and derived subtraction/opposite-point overflow before interpolation.
- Rejected coordinate precisions that collapse circular moves or produce materially inconsistent programmed start/end radii, with a bounded decimal-quantization allowance so ordinary precision-3 arcs and the compatibility fixture remain postable.
- Normalized rounded negative zero at every supported precision, including precision `0`.
- Preserved very large finite legacy coordinates by expanding scientific notation into deterministic fixed-decimal words; no non-finite/exponential word is emitted.
- Left output extension as a filename-only choice.

## TDD Evidence

### Initial RED

Command:

```text
npm test -- --run src/domain/upid/__tests__/validateUpidDocument.test.ts src/domain/upid/__tests__/upidDocument.test.ts src/domain/path-intel/__tests__/pathPlanning.test.ts src/domain/machine src/app/workbenchSettings.test.ts src/domain/storage/__tests__/workbenchStorage.test.ts src/domain/storage/__tests__/updateWorkbenchSettings.test.ts src/__tests__/appWorkbenchDashboard.test.tsx
```

Result: exit `1`; 33 expected failures and 122 passes across 155 discovered tests. The missing validator module failed to load, and the remaining assertions reproduced:

- duplicate IDs in all seven collections;
- missing refs at every graph layer;
- invalid schema/source/options and non-finite segment/cluster/chain/contour/path-element/operation/plan/override fields;
- endpoint mismatch, discontinuity, and broken closure;
- structurally valid but blocking branch/duplicate/overlap/intersection/non-finite-diagnostic documents;
- project-load structural rejection versus topology inspection;
- large-gap rapid insertion, missing-ref throws, non-finite and overflowed I/J;
- missing post readiness/atomicity/export gating;
- fixed precision, rounded negative zero, and missing absolute/incremental precision control;
- missing machine/workbench migration and settings/UI threading.

Additional focused RED/GREEN cycles covered wrong-but-existing chain endpoint clusters, inflated/stale healing metrics, path-element point/endpoint identity, and operation/contour role disagreement. Each assertion failed before its validator check was added.

### First focused GREEN

The exact initial command passed 202/202 tests after the first implementation slice.

### Compatibility debugging

The first full-domain gate exposed the existing `1e20`-chord bulge regression: JavaScript `toFixed` switches finite center values above its threshold to exponent notation. The existing regression failed before the compatibility fix. A fixed-decimal exponent expander preserved finite huge coordinates while the new subtraction-overflow regression continued to block Infinity. The five huge signed-sweep cases then passed.

### Review-driven RED/GREEN cycles

The bounded read-only review found no Critical issues and exposed Important fail-closed edges. Each was reproduced with a failing regression before implementation:

- missing/non-array diagnostics and malformed nested collection members that could throw;
- incomplete path-element identity and finite but non-executable circular geometry;
- residual quadratic parent-child membership checks;
- precision-rounded zero-radius arcs/circles and inconsistent formatted radii;
- persisted arc angle/sweep metadata that disagreed with executable endpoints;
- malformed manual-start override arrays and a `source:null` project wrapper path;
- raw-coincident endpoints that rounded to different actual machine positions.

The focused validator/path/UPID boundary slice passed 195/195 after the graph, numeric, project-wrapper, and totality fixes. The final continuity/precision regression failed with the unsafe `G1 X0 Y0` then `G2 X2 Y1 I1 J0` output and passed after formatted machine-position tracking was added. Full path-intel then passed 104/104.

### Final focused GREEN

Command:

```text
npm test -- --run src/domain/upid src/domain/path-intel src/domain/machine src/domain/storage/__tests__/workbenchStorage.test.ts src/domain/storage/__tests__/updateWorkbenchSettings.test.ts src/app/workbenchSettings.test.ts src/__tests__/appWorkbenchDashboard.test.tsx src/domain/dxf/__tests__/importDxfProject.test.ts
```

Result: 14 files passed, 275/275 tests passed.

### Final gates

- Validator suite: 69/69 passed.
- Path-intel planning/post suite: 104/104 passed.
- All `src/domain`: 35 files, 535/535 tests passed.
- Explicit `z18f25.dxf`: both DXF and UPID compatibility tests passed; 72 segments, structurally valid, export-valid, post `ready`, and exactly one initial `G0` with no `post-unexpected-gap`.
- Relevant app/settings/storage component coverage is included in the 275/275 focused gate.
- `npm run build`: TypeScript and Vite production build passed.
- `git diff --check`: passed.

Vite emitted only its existing advisory that the main minified chunk exceeds 500 kB.

## Pre-stage read-only review

A single bounded read-only reviewer checked graph completeness, atomic blocking, numeric formatting, migration, malformed persisted input, and linearity. Every Important finding was put under RED tests and fixed. Its final live-tree verdict was **APPROVE**, with no Critical or Important findings; it independently reran path-intel 104/104 and verified atomic formatted-position blocking plus valid inter-operation `G0` positioning.

## Files intended for commit

- `.superpowers/sdd/task-5-report.md`
- `src/__tests__/appWorkbenchDashboard.test.tsx`
- `src/app/MachineOutputSettingsPanel.tsx`
- `src/app/workbenchSettings.test.ts`
- `src/app/workbenchSettings.ts`
- `src/domain/dxf/__tests__/importDxfProject.test.ts`
- `src/domain/machine/__tests__/machineProfiles.test.ts`
- `src/domain/machine/machineProfiles.ts`
- `src/domain/path-intel/__tests__/pathPlanning.test.ts`
- `src/domain/path-intel/postGcode.ts`
- `src/domain/path-intel/sanitizeSegments.ts`
- `src/domain/path-intel/types.ts`
- `src/domain/storage/__tests__/updateWorkbenchSettings.test.ts`
- `src/domain/storage/__tests__/workbenchStorage.test.ts`
- `src/domain/storage/workbenchStorage.ts`
- `src/domain/upid/__tests__/upidDocument.test.ts`
- `src/domain/upid/__tests__/validateUpidDocument.test.ts`
- `src/domain/upid/projectUpid.ts`
- `src/domain/upid/upidDocument.ts`
- `src/domain/upid/validateUpidDocument.ts`
- `src/domain/workbench/defaultProject.ts`
- `src/domain/workbench/types.ts`

The storage files are a narrow Task 5 addition beyond the plan's initial file list: `WorkbenchManifest.output` had a separate inline legacy shape, so migration/default persistence could not be correct without updating that boundary and its tests.

## Residual caveats

- The repository-wide app/UI visibility run passed 145/165 tests. Its 20 failures are confined to `src/__tests__/editorPathNativeDraft.test.tsx` and `src/__tests__/appDxfProjects.test.tsx`, covering the already-protected/in-progress Contour Workbook glyph, disclosure, diagnostic-count, hover, selection, and inspector expectations owned by Task 6. Task 5 did not change the protected UI/test files. The Task 5 dashboard/settings component test is green.
- Machine-specific thread/cut/stop/rethread lifecycle commands remain intentionally absent.
- Current output remains G40 wire-centre geometry; Task 5 does not add G41/G42, compensation registers, feed, or automatic lead moves.
