# Storage layout and migrations

App release numbers do not version persisted data. The current workbench catalog is schema 3; project documents are schema 2. UPID, saved revisions, post libraries, machine libraries and transaction records each validate their own formats. An app release must explicitly record any storage compatibility change.

## Where data lives

| Surface | Location | Contents |
| --- | --- | --- |
| Browser workbench | localStorage `wire-edm-workbench:file:<relative-path>` | Same logical files as a folder workbench; larger strings may use the versioned gzip envelope |
| Browser directory metadata | `wire-edm-workbench:directories` | Rebuildable directory names; never authoritative for file existence |
| Folder workbench | Selected directory | Plain text logical files; File System Access permission is optional |
| Remembered folder | IndexedDB `wire-edm-workbench-directory`, store `handles`, key `workbench-directory` | Directory handle, not a second project copy |
| Temporary fallback | In-memory Storage adapter | Session-only files when persistent storage or Web Locks is unavailable; existing persistent cache stays untouched |
| UI preferences | `wire-edm.editor-workspace-layout.v1`, `wireedm.onboarding.dismissed`, `wireedm.guideLanguage`, `gcodeDrawerMode`, `gcodeDrawer.folder.*`, `gcodeDrawer.contour.*` | Layout, language, onboarding and disclosure state; no machining geometry |

Browser storage belongs to its origin. Production GitHub Pages, local preview and local development have separate workbenches. Switching to a folder does not migrate browser projects. The app has no active service-worker/CacheStorage persistence layer. Workers used for parsing, compression and post execution are not storage backups.

## Logical files

| Path | Owner / retention |
| --- | --- |
| `workbench.json` | Active and trashed project index, workbench preferences |
| `projects/<id>.json` | Saved editable project and revision IDs |
| Project-declared source paths, often under `imports/` or `projects/` | Exact original input; use the project document's ownership list |
| `projects/<id>/revisions/<revision-id>.wireedm-job.json` | Immutable job snapshot with exact machine/post state |
| `posts/library.json` | Validated installed post snapshots and exact references |
| `machines/library.json` | Physical machines, exact setups and active binding |
| `exports/` | Retained output if present; not proof of a disposable orphan |
| `legacy/v1/` | Exact pre-migration catalog and projects |
| `legacy/v2/workbench.json` | Exact pre-migration v2 catalog |
| `transactions/machine-package-install.json` | Recovery for paired post/machine writes |
| `transactions/saved-revision.json` | Recovery for saving a job and indexing it |
| `transactions/project-trash.json` | Recovery for trash, restore and permanent removal |

Trash retains project-owned files. A missing index reference is not authorization to delete a file. Backups and journals must not be removed by generic cache cleanup.

## Current safeguards

- All persistent mutations use Web Locks; in-process serialization also protects adapter operations. External programs writing a folder are not coordinated.
- Both legacy migrations validate the proposed catalog and project ownership before replacing data. V1 preserves catalog/project originals and supports interrupted migration checkpoints. V2 verifies its exact catalog backup before its single manifest replacement; a matching backup allows retry, a conflicting backup blocks it. Backup/quota failures leave the original manifest intact.
- Opening a missing catalog checks known workbench directories before creating a new one. Existing data or an incomplete inventory blocks empty-workbench creation. Unknown future schemas are rejected with a preserve-data diagnostic.
- Package installation, revisions and trash operations have durable recovery journals. Ordinary add, rename and editable-project save still use in-session rollback; an abrupt browser/process exit between their writes can require recovery. Do not claim full transactional durability for those operations.
- Settings → Storage → Review storage is read-only and works for cache and folder storage. Its downloadable JSON contains paths/categories and diagnostics, not file contents. It includes trash ownership, labels legacy files for retention and flags pending transactions. Traversal is bounded to 10,000 entries and 16 directory levels; partial scans are explicit. This is an inventory, not a full content/hash audit or backup.

## Next recovery work

1. Design a complete browser-workbench backup/import flow before offering cleanup. Portable UPID export alone does not preserve every installed package, revision or external-program project.
2. Extend durable recovery to ordinary project add/rename/save using the existing transaction approach, with crash-at-each-write tests; do not add a second generic migration framework.
3. Add explicit, reviewable orphan recovery/removal only after a complete inventory and verified backup. Protect both active and trashed ownership. Unknown files remain untouched by default.
4. Consolidate legacy UI preference keys only with lazy reads of old keys and a tested forward migration. These small preferences do not justify deleting unrelated origin storage.

For every future schema migration: reject unsupported versions, preflight the complete proposed data, retain exact originals, verify backup readback, publish the replacement last, and test quota errors, interrupted writes, retries and conflicts on both adapters. Preserve installed packages and saved revisions byte-for-byte unless their own explicit migration is designed and reviewed.
