# DXF units Task 6 app/E2E follow-up report

## Delivered

- Added binding app coverage for a project-snapshotted `unitsCode: G20` profile.
- Proved the UPID export preview exposes `post-inch-units-unsupported`, reports blocked readiness, zeros operation/rapid/cut output, hides body/move/operation traces, disables Download, and never invokes the download service.
- Added `e2e/dxf-import-units.spec.ts` with real-browser coverage for:
  - recognized declared inch units and millimetre preview dimensions;
  - no editor navigation before explicit confirmation;
  - persisted raw/applied provenance after dashboard reopen;
  - unitless explicit confirmation;
  - one-off machine selection with live unit/fit recomputation;
  - selected project-machine snapshot while the workbench default remains unchanged;
  - Cancel with an exact no-write browser-cache snapshot and no navigation;
  - project-snapshotted G20 preview/download blocking.
- Reused the Task 4 browser confirmation helper and verified the migrated app-shell and physical z39 gear flows.

## Verification evidence

- App binding: `src/__tests__/appDxfProjects.test.tsx` — 75/75 passed.
- UPID/machine/post domains — 373/373 passed.
- New browser spec — 4/4 passed.
- New browser spec + app shell + real z39 gear — 7/7 passed.
- Production TypeScript/Vite build passed; only the existing large-chunk advisory remains.
- `git diff --check` passed before staging.

## Concurrent full-suite note

The DXF domain/full Vitest run is temporarily blocked by six deliberate RED tests in the concurrently active Task 5 reinterpretation hardening work (`src/domain/dxf/__tests__/reimportDxfProjectUnits.test.ts`). This follow-up does not edit or stage that file and does not alter Task 5 semantics. Integrated full Vitest, build, and full Playwright will be rerun after that hardening lands.
