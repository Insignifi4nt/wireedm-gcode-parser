# Workbench improvement review — 4 October 2026

This is the first implementation checkpoint of the [application-wide plan](../plans/2026-10-04-application-improvement.md), not a claim that every input or physical controller is verified. Baseline: `ab2c2d9` / release 0.0.689, the newest production main after fetching origin.

## Correctness and storage

### Preserve unknown catalogs during immediate package rollback

Restart recovery already accepted only exact recorded before/after states, but failed installation used a separate unconditional rollback. Injecting an independent post-catalog edit during a failed machine-catalog write erased that edit and removed the journal. Immediate rollback now shares the exact-state checks with recovery and also checks that the journal still belongs to this installation. Unknown catalog or journal bytes block writes and remain available for recovery.

Existing tests that expected unknown BOM/corruption to be overwritten contradicted the preserve-data rule. Their readback-failure detection remains; assertions now require retained conflicting bytes, retained journal and conservative recovery. The rollback-readback regression still tests corrupted restoration by first causing a failed write in a recognized state.

### Journal active-setup changes and machine removal

These operations previously saved and rolled back the machine library without durable recovery; ordinary folder decoding also discarded an original BOM. They now use the existing file transaction with size preflight and exact originals. This removes duplicate rollback code without adding a storage schema. Fault tests cover both adapters, independent edits, write interruption, rollback interruption, journal quota failure and successful retry.

Pending recovery requires the current release. Installed post snapshots, saved revisions, capabilities, execution events, output formatting and audit rules are unchanged. Stricter conflict handling and the journal space requirement are explicit in the [release compatibility record](../releases/0.0.690.json).

### Validate preferences against current machine libraries

A stale tab could select a machine removed by another tab because preference validation used the old in-memory machine library. The write succeeded, then reopening failed with `WORKBENCH_CATALOG_MACHINE_NOT_FOUND`. Reproductions exercise the actual install/remove/preference APIs on both storage adapters. Preference saves now recover pending package transactions and read authoritative libraries under the mutation lock before validating either manifest. The saved result returns those current libraries and retains the existing stale-manifest rejection.

Preference persistence also uses the existing file journal. Unknown concurrent bytes and interrupted writes follow the same preserve-data rules as other file transactions. The corrupt-write fixture was narrowed to its target manifest so the new preceding journal write does not consume its injected fault. Tests retain mismatch detection and exact known-state BOM restoration while replacing unsafe overwrite expectations with retained-conflict assertions.

## Agent workflows

### Keep successful build receipts and complete evidence accessible

A real valid package with 120 referenced evidence files produced a 51,125-byte report. Build succeeded, but the outer tool returned `OUTPUT_TOO_LARGE`; context exposed only its first 50 evidence files with no continuation.

Package context now returns complete rows within the existing byte budget, optional input-version pins and an actual continuation offset. Check/build/inspect summaries preserve result status and exact receipt hashes and explicitly mark shortened or omitted detail. A new reader returns the complete original report as bounded JSON text chunks without rerunning conformance. It pins a separate report identity, so repeating a check with unchanged inputs cannot mix reports. Ordinary page and agent operations share the same live busy guard.

Meaningful regressions use the real many-file package, successful fixture output and large escaped/multibyte failure details. They verify complete reconstruction, exact hashes, no repeated execution, stale continuation rejection and busy-state behavior. Hosted and maintainer guides document the additive contract.

## Human UX walkthrough

Current screenshots were captured in the in-app browser, initially at 1280 × 720 and at the compact 640 × 800 breakpoint. Existing projects were observed without editing; a new `UX-review-October4` project was imported from the 10 × 10 mm rectangle fixture for editor review. Images and detailed local notes are under `tmp/oct04-review/ux/` and are not committed with local library data.

1. **Library — improved.** At the compact breakpoint, baseline project rows spilled into the import controls. A browser regression measured the last row bottom at 639px against its panel bottom of 541px. Content-sized grid rows fix the overlap; denser project rows keep names and actions prominent. Exact storage paths remain available in name tooltips and search.
2. **Storage settings — improved.** Duplicate location/adapter metadata buried backup controls. Connection information is consolidated, browser/session/folder persistence is described accurately, and backup precedes advanced inspection.
3. **Compact settings — improved.** Navigation consumed about 220px vertically. It now shares rows at small widths while preserving the existing modal focus/isolation behavior. The browser test exercises a real backup download, section navigation and focus restoration.
4. **Machine settings — healthy in the exercised empty-library state.** The package installer and declared preferences remain available; this checkpoint preserves existing package-install UI guards.
5. **DXF review — healthy for the rectangle fixture.** Source layers, explicit unit selection and resulting millimeter dimensions are visible before saving. Long-running processing is a separate workstream.
6. **Editor diagnostic route — healthy in the exercised flow.** The missing initial-wire diagnostic leads to actual coordinate-review controls. Selection, editing, simulation and larger-model work remain in the wider review plan.

These observations do not establish a complete screen-reader or accessibility certification. Browser tests provide behavioral evidence beyond screenshots.

## Test quality and independent review

One removed jsdom test asserted CSS class strings while the actual overlap defect still existed. Its purpose is now covered by the real compact-browser regression, strengthened to twelve imported programs after row compaction. Existing settings focus, storage status, keyboard and import tests remain intact.

Sol 6.1 High reviewers independently examined the integrity and agent changes and the UI diff. Review caught a missing per-fixture omission marker in successful conformance summaries; the implementer added it and a real successful-post regression. No blocking issues remained in those reviewed diffs.

Baseline: 199 unit/integration files / 1,963 tests pass. Final integrated candidate: 200 files / 1,989 tests pass with four workers (121.80 seconds). Chromium: 84 pass, one optional preseeded case skipped. TypeScript/production build, documentation discovery/parity, three UPID fixtures, three unchanged Robofil 2.6.0 post fixtures and complete package validation pass. Production dependency audit reports zero known vulnerabilities at this checkpoint. A concurrent unbounded test run hit timing failures and stopped progressing; it was stopped and rerun with bounded workers after the overlapping CPU-heavy verification finished. No assertion or timeout was relaxed; the interrupted log remains in local evidence.

## Remaining work

The coverage plan retains cancellable DXF processing, post/editor responsiveness, deeper domain review, hosted recovery, developer-test efficiency and further human/agent workflows. Confirmed additional cancellation gaps are tracked rather than silently excluded. No speculative geometry or post-output change is included here.

## Checkpoint 2: responsive DXF processing

A valid 5,000-line drawing of only 164 kB spent about 1.97 seconds in planning in an isolated probe and up to 9.82 seconds during concurrent test load. That work previously blocked the browser. The change moves parsing, candidate unit previews and confirmed planning into disposable local workers, with a 90-second acceptance deadline and cancellation. This improves responsiveness; it does not claim a faster or different geometry algorithm.

UI imports, source-unit reimports and agent imports share the processor seam. Worker payloads contain source/preferences or geometry/metadata, never storage adapters. Pure domain APIs retain their synchronous default. Worker results preserve exact source, unit review, diagnostics and geometry; the browser reports failure rather than falling back to blocking execution. Preparation replies are frozen again after structured cloning.

Cancellation runs before the journal begins, including after waiting for the storage lock and final transaction preparation. The shared optional guard preserves its original rejection. Once journaling starts, the transaction's durable outcome remains authoritative, even if cancellation arrives or opening the resulting editor fails. Reimport checks the full reviewed project and exact source under lock after planning so independent edits are retained.

Independent source review found no actionable introduced regression. Two separate real-operation probes verified late-cancel and failed-editor-open receipts. Owner verification: TypeScript and 19 focused files / 296 tests pass. Two native Chromium tests use real workers, preserve CRLF/Unicode source and geometry, cancel a 5,000-line plan without a saved project, and successfully import a smaller drawing afterward. Final integrated results are recorded in the 0.0.691 release record.

Limitations are explicit: browser project validation, transaction snapshots, serialization and persistence still perform main-thread work. A pending `File.text()` read cannot itself be interrupted; its obsolete result is ignored. Existing resource limits still apply. No geometry order, post, output, schema or installed-package change is intended.

Integrated verification passes 203 files / 2,016 tests (82.13 seconds, four workers), app/tooling TypeScript checks, production build, documentation discovery/parity (22 pages / 72 files), all three UPID and Robofil fixtures, and complete package validation. The full Chromium run passed 85 cases and skipped one optional preseeded case. Its remaining installation case used `setInputFiles` while the input was disabled and installation still held the mutation guard. Unlike the adjacent case, it did not await completion. It now waits for the existing verified-install receipt before importing; both native installation cases pass on rerun, preserving all compensation/export-byte assertions. CI repeats the complete candidate suite before merge.

## Checkpoint 3: editor and agent state clarity

The human walkthrough continued through a saved rectangle, initial-wire and contour setup, unsaved versus saved simulation, revision history and keyboard navigation. The editor workflow footer previously said **Save**, although it only accepted changes into the unsaved draft. It now says **Apply**, with an explicit reminder to save the project. The transition dialog and both language guides use the same distinction. Existing workflow, cancellation and persistence tests retain their behavior; the native initial-wire case additionally verifies Apply leaves the project unsaved, Save persists it, and reopening retains the edit.

Closed-path START/END labels overlapped at their common point; they now sit above and below it, with a native label-bound regression. Keyboard navigation in the execution tree moved focus invisibly because its rows suppressed browser outlines. A scoped indicator now marks only the focused row, independently of selection or expanded children. The existing UPID round-trip browser case checks keyboard focus and its rendered indicator while retaining complete import/export verification. The separate machine-program edit/save/reload/export case still passes. Actual before/after screenshots are retained in local review evidence.

Revision history accurately explains that snapshots are made by controller generation; its empty state and focus restoration worked in the walkthrough. The delete confirmation explicitly describes recoverable Archive behavior and initially focuses Cancel. Repeated contour-event labels are disambiguated on selection by the canvas geometry labels and exact endpoint coordinates; no unmeasured tree redesign is included.

Actual storage-lock and deferred-read probes reproduced agent saves and setup activations proceeding after cancellation, saves persisting an obsolete draft, and cancelled opens replacing the visible editor. The shared controller/domain operations now check cancellation and current reviewed state immediately before the first journal write, or before applying a read-only open. Activation compares the exact reviewed machine with authoritative storage, including same-ID setup replacement. Durable success and failure receipts survive late cancellation; both agent context surfaces report the same live busy state.

Independent review found two introduced regressions before publication: semantic save/activation failure receipts appeared successful in Agent activity, and a presentation-only Simulation-to-Editor switch changed the draft read version during ordinary Save. Activity now recognizes those failures. Ordinary UPID Save checks exact document/payload identity separately from presentation changes, while agent Save retains its strict version pin. Unchanged view-only workflows remain saveable through the UI. The same independent real-App persistence probe now passes; tracked tests verify actual saved geometry rather than mocking the save callback.

A further cache/folder probe found that activation refreshed machine rows but retained stale post data. A machine installed in another tab became visible yet could not generate. Successful activation now returns the matching post library already read under lock. Two real controller regressions exercise complete package installation, activation, exact-post generation and preserved post bytes on both adapters. The existing captured manifest and rejection of unrelated stale manifest writes remain intact. This avoids additional reads or relaxing output checks.

Capability discovery also failed on valid installed data: one 100-setup machine measured 45,922 UTF-8 bytes, and a valid single setup with eight large escaped property values measured 246,616 bytes. Both failed with `OUTPUT_TOO_LARGE` even at a page size of one. Version-pinned machine/setup pages now retain every ID and exact post reference. Large details have explicit omission markers and a narrow complete-setup reader, preserving properties, compatibility acknowledgements and verification claims without clipping. Existing small default responses retain their fields. A library-keyed digest cache and one retained setup serialization bound repeated work and retained detail data.

Independent review found no actionable capability defect. Real complete-package regressions verify all 100 setup IDs in order, exact reconstruction of large escaped/Unicode details and claimed verification notes within 32 KiB envelopes, unchanged stored data, stale machine/post rejection and preference-only pin retention. Focused verification passes 102 WebMCP tests, followed by 10 focused cases after strengthening the claimed-verification fixture. Native in-app discovery also registered and returned the new catalog pin; the full large-data contract is exercised through actual domain installation and tool execution. Final integrated verification follows the frozen checkpoint.

Frozen integrated checkpoint: 204 files / 2,041 unit and integration tests pass (72.82 seconds, four workers); full Chromium passes 86 cases with one optional preseeded case skipped (2.6 minutes). App and tooling TypeScript, production build, generated post contract parity, 23 documentation pages / 75 files, STEP distribution, three UPID fixtures, three unchanged Robofil 2.6.0 fixtures and complete package validation pass. Native in-app WebMCP against the frozen production build additionally verifies actual installed machine/setup discovery, the complete setup reader, stale-catalog rejection and corresponding visible Agent activity. These browser reads did not change existing projects or installed packages.

## Checkpoint 4: recovery from a hosted browser

When a malformed catalog or blocked transaction prevented startup, the ordinary backup UI could not open either. Failed cache/folder connections now retain a separate readable recovery source. A failed folder selected while cache remains healthy is identified as that failed folder, avoiding an export of the wrong location. Startup and Storage settings expose the same capture/download operation as `edm_export_recovery`; no repository checkout, terminal or access to another browser's files is required.

The distinct recovery archive preserves exact available logical text, including malformed JSON, journals, BOM and CRLF. It neither initializes nor repairs storage, validates a restore backup, runs installed posts or deletes files. Per-file logical hashes, valid UTF-8 hashes and the serialized archive hash have explicit semantics. Unpaired UTF-16 cache code units remain exact through JSON escaping. Physical compression envelopes, empty directories, unrelated browser preferences and unsaved drafts are outside this logical export; that exclusion never establishes deletion authority.

Folder reads check byte size before decoding and reject invalid UTF-8. Compressed cache reads use a capped cancellable native stream, with explicit omission when support is unavailable. Limits cover each file, actual escaped JSON archive bytes, inventory count, path length and directory depth. Oversized or unreadable files are omitted whole rather than silently shortened. Inventory changes and Web Lock availability are reported; capture is explicitly non-atomic against external writers.

The controller guards source identity, cancellation and workbench changes, and retains the exact captured archive for download retries. Integration with the earlier agent changes exposed recovery starting while DXF preparation already reported busy. A real deferred-preparation regression failed before the fix; recovery now checks and owns the same live busy guard without requiring a healthy catalog. It still exports the failed folder after preparation finishes and leaves healthy cache untouched.

Both original source and the rebased controller/agent integration received independent review, including separate cancellation and escaped-budget probes. Focused integration passes 13 files / 200 tests and isolated TypeScript. Existing native corrupt-cache/download acceptance also passed at 1280 × 720 and 640 × 800, with exact originals and archive hashes verified; screenshots confirm the source, action, limitations and retry receipt remain readable. Final candidate-wide results follow below.

Final recovery candidate: 206 files / 2,063 tests pass (65.23 seconds, four workers), app/tooling TypeScript and production build pass, generated documentation checks cover 24 pages / 78 files, and STEP distribution remains valid. Eight targeted native Chromium cases pass (18.8 seconds), covering recovery's actual downloaded originals/hash alongside unavailable locks, cross-tab locking, normal backup/focus, complete package installation and saved controller output. Three UPID fixtures, three unchanged Robofil 2.6.0 conformance fixtures and complete package validation pass. GitHub runs the full candidate verification before merge.
