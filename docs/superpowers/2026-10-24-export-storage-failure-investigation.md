# Export storage failure investigation

Date: 24 October 2026. The measurements and proposal below record the original investigation. The resulting implementation ships in app 0.0.727; see the storage maintenance map and release compatibility record. The investigation did not modify project geometry or installed packages.

## Cause and scope

The hosted app 0.0.726 stores logical workbench files in localStorage. `browserCacheAdapter.ts` already compresses larger strings with gzip and base64. The root problem is using a small Web Storage endpoint for the project database, combined with the peak space needed by the saved-revision journal. This is an application persistence failure, not evidence of a post-processor rejection.

Export creates a revision candidate, then saves that revision before executing the post. `saveStoredWireEdmJobRevision` writes a journal containing exact previous/next project and catalog images plus the new revision. It then writes the revision, replaces the project and catalog, verifies the results, and removes the journal. These exact originals are required for recovery; removing the journal to force export would discard the integrity guarantee.

`handleGenerateControllerArtifact` maps the save failure to `CONTROLLER_ARTIFACT_REVISION_UNVALIDATED`. The dialog offers a machine-package repair prompt even though post execution has not started. This misidentifies the action the user needs to take.

Sources: `src/domain/storage/browserCacheAdapter.ts`, `src/domain/storage/savedRevisionTransaction.ts`, `src/domain/wire-edm-job/savedWireEdmJobRevision.ts`, `src/app/useWorkbenchAppController.ts`, and `src/features/editor/EditorControllerArtifactDialog.tsx`.

## Evidence

The user's downloaded recovery export contained all 21 inventoried files, with no omissions. Every per-file UTF-8 and logical-string checksum was verified during replay. A read-only developer capture of the current encoded localStorage values was also compared with the logical recovery files before replay. The inputs remain outside this repository and are not embedded in these notes or the script.

The original imported UPID occupies 8,008,870 logical UTF-8 bytes and the editable project 8,647,142. A newly compiled saved revision occupies 6,045,648 logical bytes and contains 4,372 execution events. The generated controller file occupies 119,428 bytes. These are different representations with different purposes; their sizes must not be confused with actual compressed storage consumption.

The replay uses the real cache adapter, catalog initialization, project parser, revision creator, active machine setup checks, and catalog revision save. Only the browser's `Storage` interface is replaced by an instrumented private Map that enforces a pinned capacity. Live browser data is never mutated by replay.

| Scenario | Initial stored code units | Peak stored code units with capacity unrestricted | Final stored code units after successful save | Outcome under 5,242,880 code-unit model |
| --- | ---: | ---: | ---: | --- |
| Exact current origin snapshot | 2,940,587 | 6,793,827 | 3,979,931 | Journal write rejected; original entries unchanged |
| Only rose project, its source, and installed catalogs | 1,771,196 | 5,623,846 | 2,810,690 | Journal fits; revision write rejected and rolled back; original files unchanged |

The actual origin's starting consumption was read from the browser. The peak and capacity-failure numbers come from replay, not from browser quota telemetry. The model counts `key.length + value.length` in UTF-16 code units; those figures are not disk bytes or a portable quota specification. Even with this explicit modeling limit, the full replay produces the exact reported `SAVED_REVISION_TRANSACTION_STORAGE_FAILED` message at `transactions/saved-revision.json`, and the single-project replay demonstrates why starting in a clean browser does not solve this workload.

The fresh-project final state would fit the model, but the transient commit state does not. In the exact full snapshot, the first failed journal insertion would bring use to 5,754,483 code units. The journal alone is 2,813,840 encoded code units. Both quota-failure scenarios preserved all existing logical file contents; the fresh scenario additionally created harmless directory metadata before rollback. The full snapshot was unchanged even physically.

The capture includes unrelated UI preference strings, while the fresh scenario includes only this project's logical files and necessary installed catalogs. Small differences between fresh and full totals are therefore expected. Re-encoding legacy plain files also changes physical size, so the exact physical snapshot is important when reproducing the original workbench.

## Reproduction

The original maintainer-only reproduction tool was run with a complete downloaded recovery export and an optional private raw localStorage snapshot. Its private output remains outside the repository. The committed regression suites now exercise the migration and native save paths without including the user's geometry.

The reproduction verified source checksums, reported sizes and paths without outputting file contents, and performed all writes in a private Map. Its JSON report recorded the failing write and data-preservation result. It refused to overwrite an existing report or continue if a failed save changed an original file or if the two supplied snapshots disagreed.

This command was run against the user's preserved inputs. The full scenario reproduced the exact error, and the fresh scenario reproduced a quota failure at the next write. Both unrestricted-capacity scenarios passed. Private reports are saved in the user's Downloads directory, outside Git.

The existing focused cache, revision/trash recovery, and readable recovery suites passed 62 tests across three files. Their green result does not establish adequate capacity for real projects. Existing compression tests use repeated characters or abbreviated geometry records instead of a complete project/revision/catalog transaction. A permanent regression fixture should be synthetic or explicitly approved for inclusion, with realistic varied geometry and snapshot structure. Do not commit the user's geometry as a fixture.

## How the emergency ISO was generated

1. Download the app's complete read-only recovery export and verify its archive hash.
2. Copy the 21 logical files into a new local folder, verify every file hash, and open the catalog through the normal domain initializer.
3. Parse the saved editable project and resolve its exact active Robofil setup and pinned installed post.
4. Create a revision through `createSavedWireEdmJobRevision`, then persist and verify it through `saveStoredWireEdmJobRevision` using the isolated folder. The folder avoids the localStorage endpoint limit; it does not bypass revision validation.
5. Run `generateControllerArtifact`, which executes the isolated post twice for deterministic results, performs the controller-program audit, serializes according to the exact post's controller-file rules, and hashes the output. Write the file and verify its on-disk SHA-256.

The post remains package `cristian.robofil-100.v2-candidate`, version `2.6.0`, content hash `95b530e9a22abbf4ba1f8a80bbdaa1536abd6380ac9165348a82afb1d4c45a5f`. The artifact hash is `2914868a95f85b73a536540c8b84d4956cb7c2594bda1c74fbddc824a95d39bf` and the saved revision is `revision.cc65584d-8bf4-42ff-92c1-343d97acf010`. The local checkout reports app 0.0.727; a comparison against tag `v0.0.726` found no differences in the execution-plan, post-processor, or saved-job/artifact domain directories used for generation.

No manufacturing intent, offsets, post source, or output rules were repaired or altered. The exact setup's verification record is `unverified`. Software validation and deterministic audited output do not establish physical machine/controller verification.

## Another confirmed recovery defect

`src/App.tsx` sets `storageSwitchDisabled` whenever the editor is active. `WorkbenchSettingsDialog` passes that same flag to the whole `WorkbenchBackupPanel`. The panel then disables both backup download and restore/cleanup. As a result, the error tells the user to make a backup, but the backup button is disabled from the editor even when its saved data could be read. The separate readable recovery export remains enabled and rescued the files in this incident.

Separate read-only backup availability from guards for switching storage, restore, and cleanup. Keep a verified backup constrained by its normal catalog/history validation, and keep readable recovery available when validation blocks verified backup. Unsaved drafts must be labeled as excluded; relaxing a read-only backup guard must not relax draft protection for storage changes. Explain the actual disabled reason beside any unavailable action.

## Recommended sequence

### 1. Correct recovery and diagnostics

- Preserve the typed storage failure through controller export and show it as a revision-save/storage failure, with the failing stage and path. Do not send users to package repair for a quota failure before post execution.
- Enable read-only verified backup from a saved editor project when no conflicting operation is active. Keep restore, cleanup and switching storage protected by their existing guards.
- Keep a no-write recovery download reachable from the failure dialog. When there are no unreferenced files, do not imply cleanup will solve the problem.
- Make a completed artifact download retry reuse the same artifact/revision receipt. Reopening or retrying a completed generation should not needlessly append revisions. Reuse must check current saved intent, compiled plan, machine, post content hash, setup properties, and applicable engine compatibility; never select a merely similar historical revision.

### 2. Replace the default database with IndexedDB

Add an IndexedDB adapter behind the existing logical-file interface and make it the default persistent browser workbench. Keep localStorage for small preferences and preserved migration originals. Keep folder storage optional and fully tested. Do not silently fall back to a fresh empty persistent library when an existing database cannot open.

Migrate without requiring free space in localStorage. Inventory and preserve exact physical originals, stage a destination copy, validate catalogs, ownership, package hashes, and historical revisions, verify readback, then publish the migration receipt last. Preserve source entries and detect conflicting legacy changes, including an older build writing after cutover. Interrupted or denied migration must be resumable or remain read-only with complete recovery access. Pending journals need explicit staging/recovery tests; do not delete them to make migration proceed.

Keep logical schemas, immutable packages, saved revisions, and the existing journal protocol unchanged in this first migration. Test denied storage, incomplete inventories, conflicting staged data, old tabs, blocked upgrades, BOM/compressed/malformed originals, full destination quota, and reloads at every publication point. The report linked below provides the platform rationale and migration constraints.

### 3. Reduce commit amplification with a shared atomic mutation operation

The current file-by-file interface cannot express a native multi-record transaction. Add a domain operation that takes expected originals and proposed changes. IndexedDB can compare and commit the revision, project and catalog in one `readwrite` transaction; folders retain exact verified journals behind the same operation.

Prepare geometry compilation, serialization, hashes and compression before opening the database transaction. Do not keep an IndexedDB transaction alive across arbitrary awaited work. Check expected records and apply writes inside the transaction, and report success only after transaction completion. Preserve cancellation before durable writes, stale-input checks, conflict behavior and committed receipts. Request strict durability where supported without promising an absolute hardware guarantee.

This removes application-level duplication of huge before/after JSON images for the database. Browser storage engines can still require internal commit space. A separate content-addressed snapshot design may share immutable geometry and posts later, but it needs independent backup, ownership, retention, and downgrade design. Do not bundle that schema change into the initial migration.

### 4. Establish an explicit capacity and durability contract

Use usage estimates to warn about headroom, request persistent storage where available, and report the result honestly. Neither API reserves space or removes localStorage's small limit. OPFS is an option for future streamed/binary assets, not a mandatory alternative database for this JSON file model.

Shipping criteria must include fresh-browser import/save/export/reopen of realistic large and poorly compressible projects, repeated export without unbounded identical snapshots, two-tab races, interrupted migration/commit/retry, deterministic artifact hash comparisons, and both browser and folder adapters. Validate behavior in real Chromium, Firefox and WebKit where available, plus the embedded browser, rather than treating a Map or jsdom quota model as complete browser coverage.

The enforceable goal is no artificial localStorage capacity failure for supported projects, no corruption or loss on actual storage exhaustion, and an actionable in-app recovery path. No client-only app can promise that physical capacity never runs out or that user-cleared browser data survives. Backups remain necessary.

## Platform sources and implementation status

See [browser storage options research](2026-10-24-browser-storage-options-research.md) for primary-source citations comparing IndexedDB, OPFS, persistence, quotas, and transaction lifetime. The research skill delegated that platform investigation while the parent agent reproduced the application path.

The implementation adds the IndexedDB adapter/migration, atomic saved-revision commits, exact repeated-export reuse, backup guard separation and storage-specific export diagnostics. The release checklist records unchanged post schemas, capabilities, execution events, audit rules, controller bytes and package contents, with storage migration/downgrade effects separately. The private cache was migrated in an isolated real Chromium profile and generated the same recorded ISO SHA-256 through the public tools.
