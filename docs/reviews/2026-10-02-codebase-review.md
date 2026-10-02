# Codebase review — 2 October 2026

## Scope and branch selection

Reviewed release **0.0.688**, `main` / `origin/main` at `c45991a66becafdd9849c3b7859b450ddab2bb1d`. After fetching origin, this was the latest substantive application branch. The checkout was clean and was fast-forwarded from the already merged recovery branch to main. PRs 1–3 were merged; there were no open PRs at inspection time.

The review covered storage and migrations, imports, geometry/topology, editing/history, execution and compensation, machine packages/posts, simulation, WebMCP, app composition, tests, build/release automation and public documentation. The source inventory contained 253 non-test TypeScript/TSX files, approximately 62,920 lines, plus approximately 42,536 test lines. This is a system-wide source and behavior review with targeted adversarial probes, not a claim that every input or physical controller has been verified.

During the review, the user requested immediate fixes using Astra High agents. Fixes are collected on `fix/codebase-review-integrity`; the remaining work is recorded below. Baseline source references use the audited commit so line numbers remain stable after fixes.

## Prioritized findings and disposition

| ID | Priority | Finding | Disposition in this branch |
| --- | --- | --- | --- |
| F1 | P1 | Concave contour centroid can falsely establish nesting and reverse automatic compensation intent | Fixed; new geometry regressions |
| F2 | P1 | Revision/trash recovery overwrites unknown contents and can delete conflicting files | Fixed; exact-state checks and deletion fingerprints |
| F3 | P2 | A new controller revision can use an obsolete active machine setup | Fixed in the controller save operation |
| F4 | P2 | Cancellation while waiting for a mutation lock still creates a revision | Fixed; checks run immediately before journal writing |
| F5 | P2 | Journal cleanup failure hides an already committed revision receipt | Fixed; committed result reports pending cleanup |
| F6 | P2 | Exact backups reject valid BOM-prefixed folder catalogs | Fixed; semantic parsing preserves exact backup strings |
| F7 | P2 | Saving external G-code compares metadata but not the opened program text | Fixed for editor saves; checked under the mutation lock |
| F8 | P2 | DXF block arrays have no global expansion budget and run synchronously | Open; highest remaining import robustness task |
| F9 | P2 | Endpoint topology scans are quadratic and repeated during navigator renders | Fixed for endpoint derivation; broader rendering work remains |
| F10 | P2 | Closed-contour start selection allocates a full rotated chain for every candidate | Fixed; rank lightweight candidates and copy the winner |
| F11 | P2 | Undo history retains unlimited deep copies of the full document | Open; needs an explicit history and memory policy |

### F1 — Use boundary containment, not a concave polygon's centroid

[Baseline containment](https://github.com/Insignifi4nt/wireedm-gcode-parser/blob/c45991a66becafdd9849c3b7859b450ddab2bb1d/src/domain/path-intel/contours.ts#L244) compares the centroid of each contour with polygons having larger areas. A centroid can lie outside its own concave region.

Reproduction: a closed C with vertices `(0,0), (10,0), (10,.1), (.1,.1), (.1,9.9), (10,9.9), (10,10), (0,10)`, plus a disjoint circle centered at `(3.37,5)` with radius `1.2`. The circle sits in the opening. The baseline calls the C a hole inside the circle, despite its much larger bounds. Validation reports structurally valid, with no diagnostics. Selecting automatic compensation suggests keeping the outside and resolves to left compensation for the counterclockwise C; an exterior should keep the inside and resolve to right. Simulation also calls the C waste.

The fix uses bounds and a point on the already certified disjoint boundary, evaluated against exact line/arc/circle containment. It reuses the existing positioning containment implementation through a shared helper. Regressions include nested concave contours and small holes close to curved boundaries. Existing saved documents/revisions are not reclassified silently. Newly analyzed affected geometry can produce different ordering and output; users must review the resulting compensation and exact controller file.

### F2 — Recover only known exact transaction states

[Saved revision recovery](https://github.com/Insignifi4nt/wireedm-gcode-parser/blob/c45991a66becafdd9849c3b7859b450ddab2bb1d/src/domain/storage/savedRevisionTransaction.ts#L114) and [trash recovery](https://github.com/Insignifi4nt/wireedm-gcode-parser/blob/c45991a66becafdd9849c3b7859b450ddab2bb1d/src/domain/storage/projectTrashTransaction.ts#L108) treat any state other than fully committed as permission to restore old strings. The newer file and catalog-pair journals already reject unknown contents, making the older behavior inconsistent.

Transaction-level fault probes demonstrated overwritten independent catalog edits, deletion of a conflicting revision, and removal of the recovery journal. Deletion recovery also lacked fingerprints for the files it removed. Ordinary decoding could lose an original UTF-8 BOM in before-images.

The fix checks all affected exact contents before recovery or rollback. Unknown contents, including unrecognized partial JSON, retain the data and journal. New deletion/purge journals use version 2 with exact UTF-8 SHA-256 fingerprints. All deletion targets are checked before any deletion; interrupted completed deletions can retry. Legacy committed deletion journals cannot prove remaining files' identities and therefore block while those files exist. This deliberately tightens recovery and requires the current release to finish pending version-2 recovery before downgrade.

### F3 — Validate the selected setup against storage when committing a new export

[Controller generation](https://github.com/Insignifi4nt/wireedm-gcode-parser/blob/c45991a66becafdd9849c3b7859b450ddab2bb1d/src/app/useWorkbenchAppController.ts#L680) used a connected-workbench snapshot. Revision persistence checked the project and main catalog, but setup activation changes a separate machine catalog.

A complete-package fixture with `production` and `alternate` bindings reproduced the issue: create a production candidate, activate alternate through the real storage operation, then save the old candidate. The baseline accepted production while stored active setup was alternate. This affects newly generated revisions, not the intentional immutability of old revisions.

The controller save now requests an under-lock check of the physical machine, active binding, exact post installation and resolved properties. Stale selections fail with a reload/review diagnostic. The generic API can still persist an intentionally fixed candidate; it does not retroactively reinterpret snapshots.

### F4 — Put cancellation and version checks at the actual write boundary

[Baseline guard](https://github.com/Insignifi4nt/wireedm-gcode-parser/blob/c45991a66becafdd9849c3b7859b450ddab2bb1d/src/app/useWorkbenchAppController.ts#L718) ran before the persistence function acquired the workbench lock. A controller/WebMCP integration probe held that lock, queued an export, cancelled it, and released the lock. The baseline still saved a revision and returned a generated artifact.

Checks now run after lock acquisition and preparation, immediately before writing the revision journal. Cancellation or a changed draft at that point writes no revision. Once journal writing starts, the operation completes or reports its actual failure and retains any committed receipt. Tests cover both sides of this boundary.

### F5 — Separate a committed save from journal housekeeping

[Baseline save completion](https://github.com/Insignifi4nt/wireedm-gcode-parser/blob/c45991a66becafdd9849c3b7859b450ddab2bb1d/src/domain/wire-edm-job/savedWireEdmJobRevision.ts#L788) returned failure if deleting the journal failed after the revision and both indexes had read back successfully. An injected journal-delete failure reproduced `ok:false` with an indexed, existing revision. The caller lost the receipt and could generate another revision on retry.

Successful persistence now returns the revision with an optional `cleanupPending` diagnostic. UI and WebMCP retain the artifact/receipt, explain reopening for recovery, and advise reusing the existing revision instead of generating another merely to retry a download.

### F6 — Parse BOM-prefixed JSON semantically without changing backup bytes

[Backup validation](https://github.com/Insignifi4nt/wireedm-gcode-parser/blob/c45991a66becafdd9849c3b7859b450ddab2bb1d/src/domain/storage/workbenchBackup.ts#L60) directly parses strings captured by the exact reader. A folder manifest with a UTF-8 BOM opens normally but failed backup with `Unexpected token U+FEFF`. The validation adapter had the same mismatch for other JSON files.

The fix removes one leading BOM only for semantic reads. Exact strings, hashes and restored contents retain it. Tests cover folder/cache behavior and restore validation.

### F7 — Detect independent edits to an external program

[Editor save](https://github.com/Insignifi4nt/wireedm-gcode-parser/blob/c45991a66becafdd9849c3b7859b450ddab2bb1d/src/domain/editor/saveEditorProgram.ts#L68) compared `project.content`, which for external G-code contains a path/profile, not the text. Editing that file outside the app without changing its catalog allowed the next editor save to discard the external edit. Normal two-tab saves that change the manifest already have a separate stale-manifest guard.

Editor saves now pass the loaded text as an expected value and compare the owned file under the mutation lock. Both adapters reject the conflicting save without a journal or catalog update; reopening permits a deliberate new save. Web Locks cannot coordinate arbitrary external programs, so this is an optimistic check, not a cross-process filesystem lock.

### F8 — Bound DXF expansion before running expensive geometry work

[INSERT expansion](https://github.com/Insignifi4nt/wireedm-gcode-parser/blob/c45991a66becafdd9849c3b7859b450ddab2bb1d/src/domain/dxf/parseDxf.ts#L823) multiplies row count, column count and block entities without a global emitted-entity or nesting budget. A 158-byte DXF expanded into 10,000 lines in a bounded probe. Larger arrays or nested blocks amplify further; a one-megabyte WebMCP source limit does not bound expanded work. Ordinary DXF import calls the parser synchronously after reading the file.

Add shared limits for expanded entities/vertices, nesting and total work, with an explicit import failure rather than silently truncated machining geometry. Move parsing/planning to a cancellable worker after introducing these domain limits. SPLINE already has a subdivision-depth bound; retain that guarantee and add an aggregate budget. Verify small-input/large-expansion rejection, cancellation and ordinary large imports. No destructive or OOM-sized probe was run.

### F9 — Reuse an endpoint lookup and document-derived UI data

[Endpoint row derivation](https://github.com/Insignifi4nt/wireedm-gcode-parser/blob/c45991a66becafdd9849c3b7859b450ddab2bb1d/src/domain/upid/projectRail.ts#L1054) rebuilt the complete segment map and scanned operations/path elements for every cluster. The [navigator](https://github.com/Insignifi4nt/wireedm-gcode-parser/blob/c45991a66becafdd9849c3b7859b450ddab2bb1d/src/features/editor/EditorPathNavigatorPanel.tsx#L232) repeated it on unrelated form renders.

On this review host, warmed median row-derivation times for 250 / 1,000 / 2,000 disjoint lines were approximately **6.4 / 83.9 / 387.4 ms**. These are isolated Node measurements, not browser interaction timings. The implementation explains the quadratic trend independently of timing.

The fix builds one lookup, preserves first-owner/reference semantics, and memoizes document-derived navigator data. A deterministic operation-traversal budget accompanies the existing topology behavior tests. Remaining row-level operation searches, bounds calculations and large DOM lists still deserve browser profiling; this patch is not a claim that the whole editor is linear or fully virtualized.

Repeating the same bounded probe after the fix measured approximately **0.8 / 2.1 / 4.4 ms** at 250 / 1,000 / 2,000 lines. These illustrative same-host measurements were not taken under controlled benchmark conditions; the deterministic traversal test is the regression gate.

### F10 — Materialize only the chosen closed-chain rotation

[Closed start selection](https://github.com/Insignifi4nt/wireedm-gcode-parser/blob/c45991a66becafdd9849c3b7859b450ddab2bb1d/src/domain/path-intel/planOperations.ts#L207) made N arrays of N references, potentially twice for reversal, and recalculated the selected arrangement. A 2,000-segment contour therefore created millions of temporary reference slots.

The fix ranks lightweight start/orientation descriptors with the original deterministic comparator and rotates only the winner. The selected arrangement is reused. Regression tests cover ties, reversal, source ordering and bounded reference work. Overall nearest-contour selection still compares remaining operations; optimizing that is a separate, profiling-driven task.

### F11 — Bound document history memory

[Editor history](https://github.com/Insignifi4nt/wireedm-gcode-parser/blob/c45991a66becafdd9849c3b7859b450ddab2bb1d/src/features/editor/EditorPage.tsx#L2383) deep-clones the complete path document into uncapped undo/redo arrays; draft signatures serialize the full document. A 2,000-segment generated fixture serialized to approximately 1.85 MB before history. JSON size is not a heap measurement, but repeated full snapshots make memory grow with both document size and edit count.

Define a byte-based history budget, coalesce suitable repeated edits, and use structural sharing or operation patches where justified. Preserve one-step undo for atomic agent batches and workflows. Test undo/redo correctness, saved-state identity and bounded retained memory before changing behavior. A generic state-library rewrite is not needed to start.

## Additional optimization and maintainability opportunities

1. **Reduce first-open assets.** Baseline production chunks: main 638.09 kB (180.45 kB gzip), shared JSX/runtime 81.55 kB (21.94 gzip), shared package-tools client chunk 187.03 kB (59.38 gzip). The built main HTML preloads the latter two. Editor is a separate 423.46 kB chunk; simulation is 916.41 kB. The first-run onboarding image alone is 2.64 MB. Resize/re-encode that image and trace startup imports before choosing new lazy boundaries. STEP/WASM/source archives are optional paths; do not count all distribution bytes as startup transfer.
2. **Reduce repeated storage reads without weakening integrity.** `validateWorkbenchProjectPathOwnership` reads all indexed projects, source files and revision contents during many mutations. The cache adapter may decompress each large file. Add adapter existence/metadata primitives and immutable/versioned read models, invalidate them on storage changes, and retain complete validation on open/recovery. Folder external edits prevent assuming a cached manifest proves all files are unchanged.
3. **Keep bounded post execution off the UI thread.** Custom posts use an isolated QuickJS runtime and two deterministic executions, but ordinary controller generation awaits synchronous VM execution on the main thread. Reuse a disposable worker approach while preserving exact revision branding, output audit and late-cancellation receipts. Resource limits remain necessary inside the worker.
4. **Offer hosted recovery access for an unreadable workbench.** Invalid/missing project data correctly blocks normal opening. Current backup requires a valid connected workbench and rejects pending journals, leaving users with limited hosted recovery options. A read-only raw evidence export and recovery preview should preserve exact data without requiring a terminal or repository. Similarly, distinguish quota exhaustion from unavailable storage before falling back to an empty temporary session.
5. **Extract cohesive editor behavior.** `EditorPage` (~3,946 lines), navigator (~2,998), inspector (~1,505) and preview (~2,022) concentrate workflow state and derivation. Extract complete workflow/history/selection modules with narrow interfaces and shared UI/WebMCP guards, rather than splitting files into pass-through hooks. Keep existing interaction tests as the seam's behavioral contract.
6. **Strengthen validation types incrementally.** Strict TypeScript is enabled, but UPID validation uses broad record values and indexed access is not globally checked. Introduce narrowed discriminated structures at parsing boundaries and enable stronger checks incrementally on touched modules. Avoid a repository-wide cast churn that hides rather than resolves unchecked assumptions.
7. **Extend tests around the observed gaps.** Existing Chromium end-to-end tests are substantial. Add targeted real-worker/WebGL failure and cancellation checks, setup changes across tabs, and realistic large-model interaction measurements. Evaluate a small Firefox/WebKit browser-cache smoke suite for the folder-API-free path. Keep deterministic work budgets alongside timing experiments; do not duplicate every unit test in browsers.
8. **Retain the existing architectural strengths.** Production domain code is independent of feature/UI layers. Exact package hashes, explicit capabilities, motion audits, sandbox resource limits, no default feed generation, immutable revision snapshots, on-demand simulation rendering, worker termination and complete-package installation are valuable constraints. Preserve them while optimizing.

## Verification

Baseline at `c45991a`:

- 190 unit/integration test files, **1,841 tests passed**.
- Chromium browser suite: **80 passed, 1 skipped**; the skip is the optional preseeded existing-project smoke test.
- TypeScript/production build, generated authoring-doc parity, release check and public documentation checks passed.
- UPID conformance: 3 fixtures passed. Installed Robofil 2.6.0 post conformance: 3 fixtures passed. Complete fixture machine-package validation passed.
- `npm audit --json`: zero reported vulnerabilities at review time. This does not establish absence of application vulnerabilities.
- Custom probes reproduced the findings above; bounded performance probes used Node 22.23.2. Large memory-exhaustion inputs and physical machine execution were not attempted.

Final fix validation: **195 test files / 1,904 unit and integration tests passed**, **80 Chromium tests passed / one optional preseeded smoke skipped**. TypeScript/production build, documentation and release checks, all three UPID fixtures, all three unchanged Robofil post fixtures and complete package validation passed. The 0.0.689 release record and PR carry the compatibility checklist. The build retains the pre-existing large-chunk and OCCT browser-externalization warnings.

Local investigation scripts, output and baseline logs are retained under `tmp/review-2026-10-02/` (ignored scratch evidence). New regression tests are checked in beside the affected modules. Independent Astra High reviews covered geometry/performance and the two storage/revision implementations, catching and fixing additional empty-revision and untouched-index recovery cases before the final passing run.

## Branch cleanup record

Removed these redundant **local** branch names after verifying every tip is an ancestor of audited main and none is checked out in a worktree:

| Local branch | Retained commit in main |
| --- | --- |
| `codex/post-processor-architecture` | `45f142c93dfd1cbc92ddb2afa183b6b1d5d0e4f5` |
| `feat/post-compatibility-and-agent-documentation` | `fcdfd3c067857f465a432cd5cebaa03bc434a547` |
| `feat/upid-simulation-workbench` | `188b1bdeda9a8a2d344fe1f4d16fd98153be1112` |
| `fix/compensation-wording-startup-recovery` | `469d0e11158ff660c3099e426ba5af143d36f8b4` |

The first two were ahead of their old upstream branches, but those extra commits were also merged into main. No commits were discarded. A local name can be recreated from its recorded commit if needed.

Remote cleanup candidates, all already ancestors of main at inspection: `origin/codex/post-processor-architecture`, `origin/feat/post-compatibility-and-agent-documentation`, `origin/feat/upid-simulation-workbench`, `origin/fix/compensation-wording-startup-recovery`, and `origin/refactor`. Remote branches were not deleted.

`origin/codex/3d-simulation-spike` has unique experimental commits and was excluded from the review baseline, not deleted. `origin/gh-pages` contains deployment output, not the latest application source; the current workflow deploys Pages artifacts. The detached managed worktree at `C:/Users/cristian/.codex/worktrees/6f87/Wire_EDM` was not removed.

## Suggested next PRs

1. DXF expansion limits and cancellable import, with explicit incomplete-geometry rejection.
2. A measured editor responsiveness pass: history memory policy, remaining operation lookups and appropriately virtualized lists.
3. Hosted read-only recovery export and quota-aware startup behavior, designed for both storage adapters.
4. Startup asset reduction and post-worker execution, with browser measurements and unchanged exact-post output fixtures.

Each PR should advance the app version once, retain its compatibility checklist and preserve installed packages and saved revisions. Recovery format changes require explicit downgrade guidance; geometry/output changes require reviewing the resulting controller output with the exact installed setup.
