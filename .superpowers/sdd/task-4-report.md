# Task 4 Report: UPID compensation intent and pure resolver

Date: 2026-07-13

## Status

Implemented Task 4 on the current branch using strict RED-GREEN-REFACTOR. No machine-post text or G-code emission behavior was changed.

## RED evidence

The first focused run failed for the intended missing behavior:

- `src/domain/compensation/__tests__/intent.test.ts` could not resolve the not-yet-created `intent` module.
- `src/domain/compensation/__tests__/resolveControllerCompensation.test.ts` could not resolve the not-yet-created resolver.
- legacy migration failed because `normalizeLegacyProjectUpidDocument` was not exported and did not synthesize `geometryBasis`;
- structural validation accepted invalid basis/intent shapes.

A later legacy hardening test was also observed failing before implementation when an absent-basis record carried a stray automatic intent.

## Implemented behavior

- Added required `PathPlanningDocument.geometryBasis` with `finished-contour` and `wire-centre` values. Fresh generic path documents start safely as `wire-centre` until project/profile initialization explicitly upgrades them.
- Added optional semantic `compensationIntent` to operations and their path-element projection. Intent stores kept-material semantics and decision source; it never stores G41/G42.
- Added `suggestCompensationIntent`, `initializeProjectCompensationIntents`, and `setManualCompensationIntent`.
- Profile initialization enables automatic intent only when the project machine snapshot is supported, enabled-by-default, and still validly user-verified against its current controller-sensitive fingerprint.
- Automatic suggestions require finished-contour basis, an eligible closed chain/contour, exact finite nonzero signed area, a supported contour classification, complete segment refs, and no associated blocking topology diagnostics.
- Manual inside/outside/centerline decisions persist independently of classification. Automatic decisions refresh after a classification edit; manual decisions do not.
- Added pure `resolveControllerCompensation({ document, operation })`. It computes signed area from final oriented refs with the existing exact line/arc/circle area implementation, ignores stale contour orientation, and returns a typed ready/blocked union.
- Implemented the exact mapping:
  - inside + CCW -> right / G42
  - inside + CW -> left / G41
  - outside + CCW -> left / G41
  - outside + CW -> right / G42
- Reversal changes winding/code while preserving kept material. Start rotation preserves area/code.
- Legacy documents with absent basis normalize immutably to `wire-centre` and have any stray operation/path-element compensation intent removed.
- Structural validation checks only legal basis/intent record shapes, including rejection of persisted literal compensation codes. It does not perform machine-profile or export-readiness checks.
- Manual-decision summaries/details now include manual compensation.

## Coverage

Focused coverage includes:

- all four mapping combinations;
- line, arc, circle, and mixed line/arc exact area;
- reversal and start rotation;
- stale contour orientation;
- wire-centre basis, absent intent, centerline intent, open path, missing ref, degenerate area, non-finite area, and ineligible topology;
- automatic classification suggestions and profile verification gating;
- manual intent across classification/reversal/start edits;
- save/reload persistence;
- legacy normalization and structural shape validation.

## Compatibility changes

The brief's minimum compatibility surface required these additional focused files:

- `src/domain/path-intel/fromDxfEntities.ts` supplies the safe basis for newly constructed documents.
- `src/domain/path-intel/pathElements.ts` mirrors operation intent into the existing path-element projection.
- `src/domain/upid/projectUpid.ts` owns and now exports the required legacy normalization.
- UPID document/project-rail tests were updated for the additive `compensation` manual-decision counter and migration contract.

## Verification

- Focused: 7 files, 222 tests passed.
- Full Vitest: 54 files, 870 tests passed.
- Production build: TypeScript and Vite build passed.
- `git diff --check`: passed.

Vite continues to report its existing non-failing large-chunk advisory. No Task 4 correctness concern remains known. Structured compensated posting, transition safety, and emitted G41/G42 text remain deliberately deferred to the later post task.
