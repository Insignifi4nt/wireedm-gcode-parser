# CAD projects in the shared dashboard

Saved CAD files now appear beside path projects and machine programs. The dashboard reads the existing `cad/documents/` files directly, so earlier saves appear without migration or an additional index. CAD rows open the guarded CAD workflow, rename through optimistic save checks, and download an importable `.cad.json` document with its embedded source data.

The main library has active, archived and all-project filters, plus a separate source filter. It replaces the sidebar archive with the same compact rows used for active projects. CAM restore and permanent deletion retain their existing operations and confirmation. CAD archive and restore use the shared exact file transaction; permanent CAD deletion is not offered. Narrow grid columns, shrinkable names and bounded Start work controls address the reported Firefox overflow.

CAD archives retain exact original bytes under `cad/trash/<id>/<milliseconds>-<SHA-256>.cad.json`. Archive checks the reviewed saved fingerprint before writing. Restore verifies the archive identity and fingerprint and rejects an existing active ID. Interrupted moves roll back through the existing journal. All `cad/` files remain included in full backups and excluded from unreferenced-file cleanup. No CAM manifest, post processor, machine package, saved revision or pinned CAD plugin is migrated or rewritten.

Inventory errors become the app's recorded status notifications without hiding CAM projects. Refresh keeps current CAD rows visible, while cancelled or late results from a previous adapter cannot populate the new storage connection. Downloading does not rebuild the inventory. The former separate 500-document enumeration limit is removed; adapter-level incomplete inventories still report diagnostics.

## Verification

- Six domain cases exercise cache and folder adapters: optimistic rename and archive, exact-byte archive/restore, backup transfer to the opposite adapter, conflicting destinations, malformed originals, interrupted writes and cancellation.
- Two dashboard integration cases exercise mixed persisted projects, guarded open, portable document download, malformed-original reporting, archive/restore, and storage-switch cancellation.
- Existing project-list and action-dialog cases remain. The two archive behavior tests moved to the shared list and confirmation dialog with their duplicate-submission, failure/retry and permanent-deletion protections preserved. No copy snapshots or UI absence tests were added.
- Local focused runs passed 30 domain tests across the new lifecycle and existing storage-budget suites, and eight dashboard tests across the new integration, archive and existing project-list suites. Final combined browser journeys and type/build checks are owned by the integrating task.

The existing full-backup format and summary fields are unchanged. Its size/count limits and the adapter's bounded inventory remain existing storage policies; this change does not silently alter those unrelated formats.
