# DXF Units Task 2 Report

Date: 2026-07-13
Base commit: `7a756e0`
Status: implementation complete; exact-scope commit pending at report creation

## Implemented

- Added pure, stable DXF import-unit candidates with exact-scale deduplication and declared > selected-machine suggestion > millimeter fallback priority.
- Candidate identity is stable across machine changes (`millimeters`, `inches`, or `dxf-insunits-<code>`), while source/suggestion metadata is recomputed for the selected profile.
- Added synchronous `prepareDxfProjectImport`, retaining raw input/parse information and normalized profile snapshots without any adapter call.
- Preparation rejects parsed inputs that cannot produce a valid supported path segment.
- Added live `previewDxfProjectImport`, which validates the selected profile/candidate, scales cloned parsed entities through the existing normalization boundary, derives bounds from actual supported segment geometry, and ignores header extents for part size.
- Preview returns min/max millimeter bounds, measured size, candidate/profile context, and machine-fit issues; non-finite scaled geometry and empty scaled results fail clearly.
- Added pure `evaluateMachineFitBounds` and refactored document-based fit evaluation through it. A valid measured size remains available with `unchecked` status when work-area limits are absent.

## TDD evidence

### RED

Command:

```bash
npm test -- --run src/domain/dxf/__tests__/prepareDxfProjectImport.test.ts src/domain/machine/__tests__/machineFit.test.ts
```

Observed before implementation: exit 1. The preparation suite could not resolve the deliberately missing module, and all three new bounds-fit tests failed because `evaluateMachineFitBounds` did not exist.

The first GREEN attempt exposed a test-fixture pairing defect: optional blank HEADER template lines shifted DXF group-code pairs, so valid LINE fixtures parsed empty. The fixture was corrected to build exact pair arrays; production code was not weakened.

### GREEN

The focused command passes 2 files and 13/13 tests, covering:

- selected-machine-dependent priority and deduplication;
- declared-source precedence;
- unitless suggestion/fallback behavior;
- header-extents independence;
- inch scaling and width/length fit;
- raw-entity non-mutation;
- zero adapter activity;
- missing profile/candidate rejection;
- no supported geometry;
- scaled-coordinate overflow;
- finite, unchecked, invalid, and inverted pure bounds.

## Verification

- Focused Task 2 suite: 13/13 passed.
- `npm test -- --run src/domain/dxf src/domain/machine`: 10 files, 225/225 passed.
- `npm run build`: passed; Vite emitted only the existing chunk-size advisory.
- `git diff --check`: passed.
- Repository-wide execution is deferred until the concurrently edited Task 6 post files are committed and stable, per parent direction. No Task 6 file is staged here.

## Scope notes

- No adapter, manifest, project, raw import, or UPID persistence writes were added.
- No applied-unit decision is persisted yet.
- No import dialog/controller state was added.
- No Task 1 file was changed by Task 2.
- No Windows persistence was touched and `D:` was not accessed.
