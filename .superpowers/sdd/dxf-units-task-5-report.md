# DXF Units Task 5 Report

## Delivered

- Added raw-DXF unit reimport preparation and commit APIs.
- Requires one persisted DXF source, rechecks it at commit, and locks review to the project machine snapshot.
- Rebuilds changed-unit geometry under the existing project identity without rewriting raw source.
- Preserves project name, creation time, source refs, editor state, and machine snapshot.
- Atomically replaces project JSON and manifest with rollback on write failure.
- Requires confirmation, declared-unit override acknowledgement, and independent destructive-rebuild acknowledgement.
- Supports metadata-only confirmation of legacy assumed scale-1 millimetres while preserving edited geometry.
- Added raw/applied unit provenance to export trace, editor inspector, status bar, and export preview.
- Added accessible reimport dialog mode, locked machine selection, destructive warning, unsaved-change gating, latest-import reconciliation, and editor remount after success.

## TDD evidence

- Domain tests were observed failing on the missing module, then passed after implementation.
- Trace tests were observed failing on missing applied/raw fields, then passed.
- Dialog tests were observed failing on missing reimport mode, then passed.
- App tests were observed failing on the missing reimport action/controller, then passed.
- Unreadable-source and stale-raw tests were separately observed red before their guards were implemented.

## Verification

- `npm test -- --run`: 63 files, 1124 tests passed.
- `npm run build`: passed; only the existing Vite chunk-size advisory remains.
- `npm run test:e2e`: 29 passed, 1 expected environment-dependent skip.
- `git diff --check`: passed.
