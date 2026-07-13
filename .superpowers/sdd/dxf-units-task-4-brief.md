# DXF units Task 4 brief

Base commit: `cc2c2f9`

Implement the import-confirmation dialog and app controller flow from Task 4 of
`docs/superpowers/plans/2026-07-13-dxf-import-units.md` and the binding design in
`docs/superpowers/specs/2026-07-13-dxf-import-units-design.md`.

## Required behavior

- Replace the app controller's legacy one-call DXF import with the reviewed
  `prepareDxfProjectImport` -> `previewDxfProjectImport` ->
  `commitDxfProjectImport` flow.
- Selecting a DXF only reads and prepares it. It must show a review dialog and
  perform no project/storage writes or editor navigation.
- Do not hold the global workbench busy operation while the user reviews the
  dialog. Preparation and confirmed commit are separate guarded operations.
- The dialog shows filename, supported/unsupported/warning counts, source badge,
  DXF-unit selector, resulting width/length and bounds in millimetres, selected
  machine profile, machine-fit status/issues, and Cancel / Import and open.
- Unit and machine changes recompute the preview immediately. Preserve a unit
  candidate across machine changes only while its stable ID remains available;
  otherwise use the selected machine's first candidate.
- Recognized `$INSUNITS` is preselected and labelled `Declared by DXF`.
  Selecting a different scale is a `User override` and requires the explicit
  `Override declared DXF units` acknowledgement. Reset acknowledgement when the
  selected unit changes.
- Unresolved source units use `Machine suggestion` or `Not declared` badges.
  Pressing `Import and open` is their explicit confirmation.
- A selected machine belongs only to the pending import. Committing deep-snapshots
  it into the project and must not change the workbench default machine.
- Cancel clears pending state and performs zero writes. Commit errors keep the
  dialog reviewable. A successful commit followed by editor-load failure must not
  allow a duplicate commit retry: retain the committed project/latest import,
  close the pending review, and report that opening failed.
- The modal must be accessible: labelled `role=dialog`, `aria-modal`, initial
  focus, trapped Tab/Shift+Tab, inert/hidden background with exact restoration,
  Escape/backdrop cancel while idle, focus restoration, alert errors, and a polite
  live region for preview size/fit.
- Do not let Escape, backdrop, or Cancel dismiss a commit in progress.
- Preserve the urgent gear flow with one explicit millimetre confirmation.

## Integration

- Add injectable prepare/preview/candidate/commit services in
  `src/app/appServices.ts`; the controller must stop calling legacy
  `importDxfProject`.
- Export pending state and handlers from `useWorkbenchAppController`, wire through
  `App.tsx` and `DashboardPage.tsx`, and render the dialog from the dashboard.
- Keep the file-input reset behavior in `StartWorkPanel`.
- Add explicit test helpers for preparation/confirmation. Mechanically migrate
  every existing app DXF happy path; do not auto-confirm inside `flushAsync`.

## Verification

- Follow strict RED/GREEN TDD.
- Add focused component tests and app-flow tests for review/no writes, cancel/no
  writes, live preview, override acknowledgement, selected machine/default
  separation, success, errors, and modal keyboard/focus behavior.
- Run focused tests, the full Vitest suite, production build, and relevant
  Playwright coverage.
- Write `.superpowers/sdd/dxf-units-task-4-report.md` and commit the exact task
  files separately.
- Do not access `D:` or mutate external persistence.
