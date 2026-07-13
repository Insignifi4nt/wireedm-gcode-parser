# DXF units Task 3 report

## Delivered

- Added `commitDxfProjectImport`, the confirmed review-to-write boundary for DXF projects.
- Re-resolves the selected machine and unit candidate from the current workbench state before any write.
- Rejects unconfirmed decisions, stale machine choices, stale unit candidates, and unacknowledged declared-unit overrides before storage activity.
- Allocates project IDs at commit time and writes the raw DXF, project JSON, and manifest exactly once each.
- Deep-snapshots the selected machine while leaving the active/default workbench machine unchanged.
- Stores raw DXF declaration metadata separately from confirmed applied-unit metadata.
- Makes applied units the normalization authority, with raw units retained as the legacy fallback.
- Adds durable override warnings and suppresses the old assumed-millimeters warning after explicit confirmation.
- Validates applied-unit shape, finite scale, basis, confirmation metadata, machine suggestion provenance, and coordinate-scale agreement.
- Clone-synthesizes safe applied-unit/declaration metadata when loading legacy UPID project documents without changing segment geometry.
- Keeps the legacy one-call `importDxfProject` API operational and gives new legacy imports explicit provenance so editor object identity remains stable.

## Test evidence

- Strict Task 3 focused tests: 203 passed.
- Preparation/editor/Z39/Robofil/post regressions: 83 passed.
- Full Vitest suite: 1068 passed.
- Production TypeScript/Vite build: passed.
- `git diff --check`: passed.

The existing Vite large-chunk advisory remains unchanged and non-blocking.

## Independent review follow-up

An independent review identified three write-safety/provenance gaps. The follow-up closes them with additional TDD coverage:

- Commit now compares the fully normalized current machine profile with the reviewed snapshot and compares the selected candidate's complete reviewed semantics before any adapter call. Machine or candidate drift requires a fresh review.
- UPID validation now checks declaration shape, declaration/raw-unit agreement, and basis-specific applied-unit invariants for confirmation state, timestamp, label, scale, and suggestion provenance. Schema-v1 documents that predate both metadata fields remain accepted; the project load migration supplies internally consistent metadata on a clone.
- Confirmed commits are serialized per workbench adapter. Project IDs are reserved before writes, successful manifests are merged into the next queued commit, and the manifest remains the last write. Simultaneous same-snapshot commits now receive distinct IDs and retain both project entries without overwriting raw or project files.

Follow-up verification:

- Focused DXF/UPID/editor/Z39 tests: 246 passed.
- Full Vitest suite: 1087 passed.
- Production TypeScript/Vite build: passed.
- `git diff --check`: passed.
