# Storage integrity compatibility — unreleased

These changes are awaiting reviewed integration. They do not advance an app, storage, UPID, post-package, or engine version.

## Potentially breaking recovery behavior

Machine-package recovery now stops when an installed post or machine catalog matches neither exact image recorded by its pending transaction. Previously recovery could overwrite unrelated changes with the older catalog. The existing `CATALOG_PAIR_TRANSACTION_RECOVERY_MISMATCH` diagnostic explains that both catalogs and the journal remain preserved. Opening or editing that workbench stays blocked until its recovery conflict is resolved; installed packages are never silently rewritten to resolve it. Include this warning in the integration PR and release compatibility record.

Recognized interrupted catalog pairs still restore both previous images, and fully committed pairs still finish journal cleanup. A changed BOM counts as changed bytes. Tests cover both storage adapters and recovery retry.

The installer now records and verifies exact catalog text, including folder BOMs, so an unchanged original remains a recognized recovery state. Older pending journals that already omitted an original BOM still block on an exact mismatch; recovery does not guess missing original bytes or rewrite that journal.

## Compatibility checklist

- **Schemas and migrations:** no schema changes or data migrations. Existing journal shapes remain readable.
- **Capabilities, execution events and audit rules:** unchanged.
- **Controller output and saved revisions:** unchanged; no revision or post snapshots are rewritten.
- **Installation:** only automatic recovery of conflicting catalog bytes changes, as described above.
- **Project identity:** new numeric filename-derived IDs receive a letter prefix, and truncation removes a trailing separator. Previously valid generated IDs and all stored IDs stay unchanged. Display names and source filenames stay unchanged.
- **Preference failures:** rollback retains the original manifest bytes, including a folder UTF-8 BOM. Failed restoration readback returns the existing rollback-failed error instead of reporting only the original write failure. This does not add crash recovery to preference changes.
- **Exact cache reads:** compressed text retains its UTF-8 BOM for backups, transaction snapshots and readback verification. The gzip envelope version and ordinary text-reader behavior are unchanged; no stored strings are rewritten.
- **Storage adapters:** cache and folder regression tests cover the changed behavior.
