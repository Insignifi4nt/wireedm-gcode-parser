# Browser workbench storage options

Research date: 24 October 2026. This is a design investigation, not an implemented migration. No project geometry or installed post source is included.

## Recommendation

Use IndexedDB for the default browser workbench. Keep localStorage for small preferences and as a preserved legacy recovery source. Keep user-selected folders as an optional persistence choice. Initially retain the existing exact-state journals and mutation lock; then add a shared atomic mutation operation so the IndexedDB adapter can commit related logical files in one database transaction while the folder adapter retains its verified journal implementation.

This recommendation follows from the app's logical-file model and IndexedDB's atomic multi-record transactions. It is not a claim that browser storage becomes unlimited or immune to deletion. The Storage Standard gives localStorage its own 5 MiB endpoint limit, whereas IndexedDB uses browser-managed quota. Changing eviction persistence does not remove localStorage's endpoint limit. [Storage Standard, storage endpoints](https://storage.spec.whatwg.org/#storage-endpoints), [IndexedDB transactions](https://w3c.github.io/IndexedDB/#transaction-concept)

## Current code facts

- `src/domain/storage/browserCacheAdapter.ts` writes every logical file into localStorage, with an optional gzip/base64 envelope. Compression already exists; recommending compression alone would repeat the current architecture.
- `src/domain/storage/connectCachedWorkbench.ts` probes a tiny write and opens the existing adapter even if full. That probe establishes neither the ability to save a large revision nor transaction headroom.
- `src/domain/storage/workbenchStorageAdapter.ts` exposes individual asynchronous file reads/writes. Simply replacing its backing store does not make a sequence of writes atomic.
- `src/domain/storage/workbenchMutationLock.ts` holds a Web Lock around a domain mutation and recovery. Retain this for existing multi-call operations. Web Locks coordinate cooperating same-origin tabs and workers; they do not replace crash recovery. [Web Locks API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API)

## Options

| Option | Fit | Remaining costs and limits |
| --- | --- | --- |
| IndexedDB logical-file records | Best first replacement. Store exact strings or lossless binary envelopes by path. Native transactions can later group revision, project and catalog changes. | Quota/I/O errors still occur. Wait for transaction completion, not an individual request's success. New database versions can be blocked by open clients. |
| OPFS | Suitable for future large binary geometry, streaming files or a database engine requiring file access. No folder picker is required. | Still subject to origin quota and deletion with site data. File locks are per file; a multi-file domain commit still needs a publication/recovery protocol. |
| CacheStorage | Appropriate for app resources and reproducible fetched content. | Its request/response model is an awkward fit for authoritative project records. It uses browser-managed storage too. No capacity advantage over choosing IndexedDB justifies this mismatch. |
| User-selected folder | Valuable optional independent copy and visible files. Existing folder adapter can remain supported. | Requires supported picker APIs and user permission. Folder writers outside the app can race its checks; disk-full and permission failures still need recovery. It cannot be the only supported path. |
| More compression in localStorage | Possible short-term space reduction. | Keeps the small endpoint limit, base64 representation and duplicated journal images. Compression ratios depend on data; this cannot guarantee a normal project remains exportable. |

Platform facts supporting this comparison: [IndexedDB transactions and scheduling](https://w3c.github.io/IndexedDB/#transaction-concept), [OPFS overview and restrictions](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system), [File System Standard file locking](https://fs.spec.whatwg.org/#file-entry-lock), [Cache request/response API](https://developer.mozilla.org/en-US/docs/Web/API/Cache), [Chrome File System Access guide](https://developer.chrome.com/docs/capabilities/web-apis/file-system-access). The ranking and architectural tradeoffs are engineering judgments for this repository.

## Capacity and durability contracts

`navigator.storage.estimate()` reports approximate usage and quota. Compression, deduplication and privacy measures make the figures imprecise. Use the result to warn about anticipated peak writes, not to promise or reserve capacity. Every actual write must still handle failure. [StorageManager.estimate](https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/estimate)

Request persistent storage and display whether it was granted. `persist()` can return false or reject when storage is unavailable. Persistence reduces eviction risk; it is not an exported backup or a guarantee against user-cleared site data, device failure or a private session ending. [StorageManager.persist](https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/persist), [MDN storage quotas and eviction](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria)

Do not hard-code a large guaranteed allowance for embedded/cloud browsers. WebKit documents different quota policies for browser apps, embedded applications and cross-origin frames, and explicitly says a stated quota is not guaranteed writable capacity. Private browsing can use different quotas and discard data when the session ends. Probe real availability, report failures honestly, and provide a read-only recovery download before any migration or cleanup is necessary. [WebKit storage policy](https://webkit.org/blog/14403/updates-to-storage-policy/), [MDN private browsing storage](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria#private_browsing)

For critical immutable revision commits, request IndexedDB transaction durability `strict` where supported and wait for `complete`. The standard calls this a hint; it improves confidence after power loss rather than establishing a universal hardware guarantee. [IDBDatabase.transaction durability](https://developer.mozilla.org/en-US/docs/Web/API/IDBDatabase/transaction), [IndexedDB durability hint](https://w3c.github.io/IndexedDB/#transaction-durability-hint)

## Migration requirements

The following is a proposed application protocol, not behavior supplied automatically by IndexedDB.

1. Acquire the existing workbench mutation lock. Inventory legacy keys read-only. Do not require a successful localStorage write to start migration, because the source may already be full.
2. Preserve exact legacy physical strings as well as decoded logical originals. This includes compressed envelopes, BOMs, malformed text, retained backups and pending journals. Capture exact fingerprints and the full bounded inventory; an incomplete scan is not evidence of absence. A source that cannot be decoded remains available for recovery and blocks an automatic writable upgrade.
3. Stage the new database under an explicit incomplete state. Copy every required file, verify exact readback and fingerprints, validate the candidate catalogs and ownership, and verify installed packages and historical revisions under existing compatibility rules. Never rewrite post snapshots or manufacturing intent to make migration validate.
4. Publish an authoritative completed migration receipt only after the destination is verified. On retry, reuse only a matching staged destination. Conflicting destination data blocks migration. Quota, denial or interruption leaves the original localStorage keys intact and downloadable.
5. Preserve the source after cutover. Old app builds can still write localStorage because they do not understand the new marker. Detect changes to the legacy inventory before resuming or promoting data; do not silently merge the two libraries. Add an explicit older-build conflict/recovery flow and a separate reviewed policy for any eventual source removal.
6. Never fall back from an inaccessible nonempty database to a new empty persistent workbench. Offer the existing recovery source and a clearly labeled temporary session if necessary. Handle `blocked`, `versionchange` and aborted database opens explicitly. IndexedDB documents that open clients must close connections to permit version upgrades. [IndexedDB version-change coordination](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API/Using_IndexedDB#version_changes_while_a_web_app_is_open_in_another_tab)

Do not combine legacy migration, native atomic commits, content-addressed deduplication and a saved-revision schema redesign in one patch. A first adapter migration can preserve logical schemas and journals. Optimizations then get separate regression evidence and compatibility review.

## Reducing write amplification after migration

Add an adapter-supported atomic compare-and-write operation behind the domain mutation interface. In IndexedDB, read expected originals and apply all replacements within one `readwrite` transaction. Preserve the folder adapter's exact-state journal behavior behind the same operation. Prepare expensive hashes, compression and post compilation before opening the database transaction; transactions become inactive outside their request-processing tasks and should remain short. Publish success after the commit completes. [IndexedDB transaction lifetime](https://developer.mozilla.org/en-US/docs/Web/API/IDBTransaction)

The database still needs internal write-ahead storage, so removing application JSON before/after images reduces amplification without guaranteeing a fixed peak disk requirement. A later content-addressed store could share unchanged immutable geometry and exact post packages across revisions. That is a larger persistence-format change requiring independent ownership, retention, backup and downgrade design.

Retrying a completed generation should reuse the exact committed revision receipt, not append another identical revision because the final download or journal cleanup failed. A new revision remains necessary when saved intent or exact setup changes. Never recover capacity by deleting old revisions, originals or journals automatically.

## Acceptance evidence before shipping

- A realistic large project imports, saves, exports and reopens in a fresh browser without a directory picker; test the actual browser adapter and real persisted state.
- Exhaust quota at every migration/commit phase; restart and retry. Source hashes remain exact and catalogs reference only complete revisions.
- Inject failures during copy, verification, migration publication, revision publication, journal cleanup and download. The user receives an actionable diagnostic and can rescue readable files without additional writes.
- Exercise legacy compressed/BOM originals, malformed input, pending transactions, conflicting staged copies, blocked database upgrades, denied storage, missing Web Locks, two tabs and an older app changing the legacy cache.
- Run the same domain mutation integrity cases against the folder adapter. Benchmark peak memory and peak stored bytes for import, save and first/repeated export using representative large and poorly compressible data.
- Keep installed post identity, schema and output contracts unchanged during the storage migration. Compare the generated artifact hash using the same saved intent and exact post; document any output difference as a separate issue.

The achievable promise is that a supported project does not fail merely because the app chose localStorage for its database, and that a real capacity or persistence failure preserves data and has an in-app recovery path. No client-only storage API can honestly promise that physical capacity never runs out or that browser-held data can never be lost.
