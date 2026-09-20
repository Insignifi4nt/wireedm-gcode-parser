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
| `transactions/workbench-files.json` | Exact before/after images for project add/rename/save, backup restore and reviewed cleanup |

Trash retains project-owned files. A missing index reference is not authorization to delete a file. Backups and journals must not be removed by generic cache cleanup.

## Current safeguards

- All persistent mutations use Web Locks; in-process serialization also protects adapter operations. External programs writing a folder are not coordinated.
- Both legacy migrations validate the proposed catalog and project ownership before replacing data. V1 preserves catalog/project originals and supports interrupted migration checkpoints. V2 verifies its exact catalog backup before its single manifest replacement; a matching backup allows retry, a conflicting backup blocks it. Backup/quota failures leave the original manifest intact.
- Opening a missing catalog checks known workbench directories before creating a new one. Existing data or an incomplete inventory blocks empty-workbench creation. Unknown future schemas are rejected with a preserve-data diagnostic.
- Package installation, revisions and trash operations retain their existing durable journals. Ordinary project add/rename/save, backup restore and cleanup use a shared bounded file journal, verified before writing data. Each mutation acquires the workbench lock and first recovers a pending file transaction. Recovery retains all exact next images when every write completed; otherwise it restores prior images and removes newly created files. Unexpected external contents block recovery without overwriting them. Inventory and backup reads explicitly skip recovery and remain read-only.
- Machine-package catalog-pair recovery also compares exact current bytes against both recorded states before changing either installed catalog. Unexpected contents, including a newly added BOM, block recovery and retain both catalogs and the journal. Recognized interrupted states still roll back; fully committed pairs still finalize. Preference rollback preserves exact manifest text, including a folder BOM, and verifies restoration before treating rollback as complete.
- Machine-package installation captures exact before-images and verifies installation and rollback with the same exact reader used by recovery. Browser-cache exact reads retain a BOM through gzip decompression; ordinary text reads keep their existing decoding behavior. Earlier journals that omitted an original BOM remain blocked on mismatch because the missing original bytes cannot be inferred safely.
- Settings → Storage → Review storage is read-only and works for cache and folder storage. Its downloadable JSON contains paths/categories and diagnostics, not file contents. It includes trash ownership, labels legacy files for retention and flags pending transactions. Traversal is bounded to 10,000 entries and 16 directory levels; partial scans are explicit. This is an inventory, not a full content/hash audit or backup.

## Backup, restoration and cleanup

- Settings downloads `.wireedm-backup.json`, a versioned inventory of exact logical text files, per-file SHA-256 and an inventory hash. Backup validates catalogs, active/trash ownership, installed package hashes and every indexed saved revision. The original strings are retained rather than reserialized. It does not execute post code. Hashes detect corruption, not the identity of a backup's author.
- Backup requires a complete inventory with no pending transaction files. Limits: 128 MiB archive, 10,000 entries, portable relative paths, UTF-8 text. Folder reads preserve a BOM and reject non-UTF-8 binary data. Empty directories, localStorage UI preferences, remembered directory handles and unsaved drafts are outside the backup. Installed state is preserved; original installer archives/evidence not retained by the workbench must still be kept separately by their owner.
- Restore previews counts and validates first, then accepts only an empty initialized destination containing the three catalogs. It never merges project IDs or replaces an existing library. File transactions retain the destination's originals for rollback, including quota failures. Successful UI restore reloads the app into the restored catalog. Current backup format accepts storage schema 3; migrate older workbenches normally before export.
- Cleanup is opt-in after a verified backup download request and the user's saved-download acknowledgement. Every path must be selected individually. Re-read/hash the complete storage snapshot under the mutation lock before deleting; any change invalidates the backup for cleanup. Protect active/trash ownership, `legacy/`, `posts/`, `machines/`, `transactions/` and every `.wireedm-job.json` file. Recovery of removed data uses the downloaded complete backup in an empty destination. Browser download requests are not on-disk receipts.
- Durable journals temporarily require space for recovery images. If the journal cannot fit, the operation fails before changing project files. Older app versions do not understand the new journal: complete recovery with the current release before downgrading.
- An empty journal can be the new folder handle left before its first atomic write. Recovery removes that handle: no owned-file change starts before a complete journal reads back. Nonempty malformed journals still block opening and remain available for investigation.

## Separate maintenance

Consolidate legacy UI preference keys only with lazy reads of old keys and a tested forward migration. These small preferences do not justify deleting unrelated origin storage. Streaming larger/binary backup archives and merging into nonempty destinations are not part of the current backup contract.

For every future schema migration: reject unsupported versions, preflight the complete proposed data, retain exact originals, verify backup readback, publish the replacement last, and test quota errors, interrupted writes, retries and conflicts on both adapters. Preserve installed packages and saved revisions byte-for-byte unless their own explicit migration is designed and reviewed.
