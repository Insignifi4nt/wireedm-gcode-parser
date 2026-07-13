# DXF Units Task 5 Brief

## Scope

Implement persisted DXF unit provenance display and safe units reinterpretation from the project's raw DXF.

## Domain contract

- Resolve exactly one `kind: 'dxf'` source reference and read it through the connected adapter.
- Prepare against the project's snapshotted machine profile; units revision must not switch post configuration.
- Full reinterpretation rebuilds UPID from raw geometry and replaces the existing project in place.
- Preserve project identity, name, creation time, source files, editor state, and machine snapshot.
- Persist only the existing project JSON and manifest; leave raw DXF unchanged and roll both writes back on failure.
- Require import confirmation, declared-unit override acknowledgement when applicable, and a distinct destructive-rebuild acknowledgement.
- Permit one metadata-only exception: confirming unconfirmed legacy-assumed scale-1 millimetres preserves all geometry and edits.
- Reject stale index entries, unavailable/ambiguous raw sources, changed machine IDs, and mutate no caller input.

## UI contract

- Add raw and applied unit provenance to export trace, inspector, status bar, and export preview.
- Reuse the DXF confirmation dialog in locked-machine reimport mode with a destructive warning.
- Block reimport while editor changes are unsaved.
- On success, replace the loaded editor program and reconcile the latest import without creating a new project.

## Verification

- Domain, trace, dialog, app-flow, full Vitest, build, and relevant Playwright coverage.
- Commit separately as `feat: preserve and revise DXF unit provenance` and request a fresh review.
