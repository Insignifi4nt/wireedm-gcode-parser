# DXF units Task 4 report

Base commit: `cc2c2f9`

## Delivered

- Replaced the app controller's legacy one-call DXF import with injectable
  prepare, candidate, preview, and confirmed-commit services.
- Added pending DXF review state with a separate short preparation operation and
  fresh confirmed-commit operation. The workbench is not held busy during user
  review.
- Added an accessible DXF import confirmation modal with source status, entity
  and warning counts, unit and machine selectors, three-decimal millimetre size
  and bounds, machine fit/issues, override acknowledgement, error feedback, and
  live preview announcements.
- Added initial focus, Tab/Shift+Tab trapping, inert/hidden background handling
  with exact restoration, focus restoration, idle Escape/backdrop cancellation,
  and commit-time dismissal blocking.
- Unit changes recompute preview and reset declared-unit acknowledgement. Machine
  changes preserve a stable candidate when available or choose the new first
  candidate, then recompute preview without changing the workbench default.
- Confirmed imports use the Task 3 current-state verification and selected
  machine snapshot. Commit failures keep review open. A successful commit whose
  editor load fails closes review, retains the project/latest import, reports the
  partial success, and cannot be committed twice.
- Cancel clears review without commit or storage writes.
- Migrated 69 existing Vitest DXF app paths to explicit confirmation via test
  helpers. There is no hidden confirmation in `flushAsync`.
- Migrated all 23 Playwright DXF uploads to explicit confirmation. The real z39
  gear flow explicitly verifies millimetres before import and still produces the
  verified Robofil compensated program.

## TDD evidence

### RED

Before production changes:

```bash
npm test -- --run src/features/dashboard/__tests__/DxfImportConfirmationDialog.test.tsx src/__tests__/appDxfProjects.test.tsx
```

The component suite failed because the dialog did not exist. Three new app-flow
tests failed because file selection still wrote/opened immediately and no review
or confirmation action existed.

### GREEN

Focused confirmation and migrated app coverage:

```bash
npm test -- --run src/features/dashboard/__tests__/DxfImportConfirmationDialog.test.tsx src/__tests__/appDxfProjects.test.tsx src/__tests__/appWorkbenchDashboard.test.tsx src/__tests__/editorConstructionRegression.test.tsx src/__tests__/editorDensityCleanup.test.tsx
```

Result: 5 files, 100/100 tests passed.

The focused coverage includes no-write prepare/cancel, confirmed millimetres,
live one-off machine/inch preview and fit, unchanged default machine, selected
machine provenance, commit retry, successful-commit/editor-load failure, modal
source badges, override acknowledgement, preview errors, focus trap/restoration,
background inert restoration, Escape, and commit-time dismissal blocking.

## Full verification

- Full Vitest: 62 files, 1110/1110 tests passed.
- Production TypeScript/Vite build: passed; only the existing large-chunk
  advisory remains.
- Real z39 compensated-gear Playwright test: 1/1 passed.
- Full Playwright: 29 passed, 1 existing environment/seed-dependent skip.
- `git diff --check`: passed.

## Scope notes

- The legacy domain `importDxfProject` remains available for compatibility, but
  the app controller no longer calls it.
- No DXF reinterpretation UI, editor unit summary, external persistence, or
  `D:` access was added.
