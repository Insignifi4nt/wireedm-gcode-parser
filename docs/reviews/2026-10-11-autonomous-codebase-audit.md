# Autonomous codebase audit, 2026-10-11

## Scope and baseline

The audit started from a clean `main` at `3e3fce9d06a0911898826e893af324951c00f7cf`, app version 0.0.696. All implementation is on local branch `audit/behavior-preserving-maintenance-2026-10-11`. No remote commands, pushes, pull requests, deployments, infrastructure changes, database migrations, credential changes or dependency changes were performed. Existing project instructions and maintenance/compatibility records governed the review.

The objective was repository-wide understanding followed by selective improvements that preserve behavior, public signatures, serialized formats, historical readers, diagnostics and exact controller output. Four investigations covered UPID, storage/output, app/UI/workers, and geometry/planning/simulation. This is an architecture and regression audit, not proof that every defect has been found or physical controller certification.

## Architecture and contracts reviewed

| Subsystem | Data flow and responsibilities | Contracts retained |
| --- | --- | --- |
| Startup and app composition | Browser-cache initialization and recovery precede optional folder persistence. App services defer installation/artifact/deletion code until invocation. Controller owns mutation identity, DXF preparation and cancellation. | Eager stored-schema/hash/binding checks, temporary fallback, folder-free import, committed-action receipts. |
| DXF and geometry | Parse and normalize units/entities, bound spline/INSERT expansion, convert segments, sanitize, cluster endpoints, construct chains/contours, classify containment and plan operations. | Clean internal DXF geometry, import provenance, resource budgets, tolerance and deterministic ordering. |
| UPID | Portable shape checking and semantic validation distinguish structural integrity from executable readiness. Source geometry, topology and explicit machining decisions feed editor/compiler views. | Strict portable v1/v2/v3 shapes, optional historical metadata, local legacy-v1 recovery, version promotion on detached export, opaque IDs and unchanged originals. |
| Editor | Typed domain mutations rebuild topology while preserving authored identities/decisions. Feature history, command and workflow sessions manage drafts, selection, undo and atomic agent edits. | External-program cleanup/display, loaded-text conflict checks, bounded history, explicit transition guards and no inferred machining approval. |
| Execution and compensation | Participation derives active source intervals before the compiler validates intent, compensation, threading, stops and exact source traces. | Current and legacy-snapshot compilation rules, no default feeds, event ordering and exact floating-point calculations. |
| Storage and catalogs | Cache/folder adapters implement logical files. Web Locks and specialized journals coordinate exact-state writes/recovery; catalogs validate package snapshots, bindings and project ownership. | Exact before/after strings, BOM preservation, conflict rejection, retries, trash/legacy retention and existing migration rules. |
| Packages and saved output | Complete package preview captures fingerprints; commit rereads authoritative state. Saved revisions retain UPID, plan, machine/post snapshots and hashes. Artifacts require a persisted validated revision. | Exact installed post, engine/version integrity checks, controller encoding/wrappers/numbering, capability checks and audit rules. |
| Simulation and machine import | Saved execution events drive material/release views. STEP and collision workers have separate limits and cancellation; viewport/scene code manages rendering resources. | Viewing assumptions remain outside UPID; approximate collisions and playback do not authorize machining. |
| WebMCP and authoring tools | Narrow TypeBox arguments call shared app operations with draft/saved distinctions, version checks, cancellation and bounded result pages. Hosted package tools use a worker. | Same UI workflow guards, input freshness, byte-adaptive continuation, exact receipts, unchanged public tool arguments/results. |
| Build and documentation | Strict TypeScript, separate Node/jsdom test projects, Chromium workflow tests, generated contract/public-doc checks and local package conformance. | Ports 3777/3778 and Playwright 3107; generated contracts and historical release records remain unchanged. |

## Prioritization and implementation

Each selected change had a narrow compatibility boundary and practical characterization evidence. Broad rewrites, new dependencies and unmeasured performance changes were rejected.

| Priority | Change | Benefit | Regression risk and mitigation |
| --- | --- | --- | --- |
| 1 | Isolate UPID source/provenance validation and shared scalar/point checks. | Removes DXF metadata policy from the nearly 3,000-line topology validator and replaces that policy's broad `any` records with `unknown`. Shared diagnostic primitives prevent copied rules drifting. | Metadata acceptance or diagnostic ordering could change. Thirty-five characterization cases passed before extraction; complete before/after reports, parser results and execution results match across 930 comparisons. |
| 2 | Reuse authoritative installed-library serializers. | Installation journals and writers now construct exact post/machine bytes through the same serializer; legacy empty-post creation uses it too. Future writer changes cannot silently diverge from journal next-images. | Ordering, whitespace or escaping could break readback/recovery. Tests fix the historical bytes, installed order, Unicode/escaping and no trailing newline, with cache and folder installation evidence. |
| 3 | Share point-inference result construction. | Scan and direct-segment inference no longer duplicate guide/source copying and result metadata. Formulas and selection loops remain intact. | Tie selection, endpoint ownership or reference sharing could drift. Characterization covers all five modes, lines/arcs/circles, traversal direction, first-candidate ties and detached copies. |
| 4 | Make package-worker completion one-shot and release callbacks. | Success, failure, timeout and cancellation clear the timer/listener/callbacks and terminate once, including queued terminal events. | Cleanup could change the settled result or cancellation semantics. Tests preserve exact report identity, clone/startup failures, error text, pre-abort behavior and the 90-second deadline. Eight cleanup failures were reproduced before the fix. |

## Compatibility checklist

| Area | Audit branch impact |
| --- | --- |
| Schemas | No UPID, post, package, execution-plan, saved-revision, storage, journal or engine API version changes; no public signature changes. New helper exports are internal module organization. |
| Events | Execution event kinds, payloads, source ranges, order, geometry and compiler numerical formulas are unchanged. |
| Capabilities | Exact-post capability declarations, preflight checks and WebMCP contracts are unchanged. |
| Audit and output | Hash/integrity checks and output audit remain strict. Controller file formatting, encoding, extension, wrappers and numbering remain owned by the exact post. |
| Installation and storage | No package/snapshot rewrite, cleanup, migration-rule change or new journal format. Exact original serialization is preserved for both adapters. |
| Diagnostics | UPID diagnostic messages, IDs and ordering remain identical in the comparison corpus. Package worker results, errors and deadline are unchanged; only repeated cleanup is suppressed. |
| Release | No merge or publication occurred, so the app stays at 0.0.696. A future reviewed shipping PR must advance the app once and carry its release compatibility record. Historical releases remain immutable. |

## Verification

Local evidence is retained under ignored `tmp/audit-2026-10-11/`.

- Baseline source was archived from the original commit into an isolated local directory. The original suite has 210 files / 2,098 tests. The run passed 209 files / 2,096 tests; two CLI cases initially failed because their explicit `node_modules/tsx` path was absent in the snapshot. Copying the already installed local runtime restored that path and both cases passed unchanged. The initial sandboxed run could not load Vite because `realpath` returned `EPERM`; validation ran outside that filesystem restriction.
- Characterization before implementation: UPID source 35 tests; point inference 19 tests; storage 47 tests. Package-worker regression tests reproduced eight cleanup failures.
- Focused verification after implementation: UPID and saved-revision integration 13 files / 300 tests; storage/catalog/install/recovery 7 files / 91 tests; inference and dependent editor behavior 4 files / 99 tests; package client/page/WebMCP 3 files / 19 tests.
- The UPID comparison corpus covers 927 metadata/version cases and three published fixtures. It compares complete diagnostic reports, portable parse results, current and legacy execution plans and nonmutation, not just counts. Serialized before/after results are identical, SHA-256 `6fde15acbbb13e4fde14f9c813ef0a37485da4c1c6cf974c923a1f4573f1b9ce`.
- Complete TypeScript/production build passed, including 27 generated public documentation pages / 87 checked files and STEP source-distribution verification.
- Published executable UPID conformance passed for all three fixtures. The unchanged Robofil 2.6.0 post passed all three conformance fixtures, and its complete machine package validated.
- Complete integrated Vitest run passed: 211 files / 2,152 tests, including both `pure-domain` and `browser` projects. No test assertions, type checks or time limits were weakened.
- Complete Chromium workflow run passed: 89 tests, with the existing externally seeded-workbench test skipped. This exercises cache startup, DXF processing, editor workflows, machine installation, saved output, inspection/download equality, recovery export, and native keyboard/layout behavior on Playwright port 3107.
- Generated post-authoring contract parity, current release-record checks, STEP source-distribution checks and `git diff --check` passed. No public contract or historical release files changed.
- Package-worker terminal/fault regressions use a controlled Worker substitute. Native queued-event and serialization-failure delivery were not separately exercised; existing browser authoring flows passed. The comparison corpus and integration tests establish specific preserved outputs, not proof of zero regressions.

The build retains its existing large-chunk, plugin-timing and OCCT browser-externalization warnings. There is no standalone lint command in the package; strict TypeScript, tests, documentation parity and whitespace checks are the available static gates. Validation uses the installed local dependency set without updating it. No performance improvement is claimed without a measurement.

## Opportunities deliberately left untouched

1. **A canonical smaller UPID model.** Source geometry and derived topology/metrics coexist by contract. Rebuilding caches or introducing schema-derived boundary types across the full validator could simplify it further, but must preserve strict outside readers and saved historical plans. This pass isolates one coherent policy; it does not introduce a new representation or weaken validation.
2. **Larger editor and geometry modules.** EditorPage, pathDocumentOperations and saved-revision code own coupled workflow/topology/recovery invariants. Extract complete responsibilities only with dedicated legacy and interaction characterization. Splitting into pass-through hooks would add indirection without resolving those dependencies.
3. **Normal cache decompression limits.** Read-only recovery already has bounded streaming reads. Ordinary open/read paths can expand compressed strings before downstream size checks. Reusing bounded reads requires a deliberate limit/error compatibility decision, including existing large readable workbenches and both adapters.
4. **Generic transaction and worker frameworks.** Installation, revision, trash/purge and ordinary-file journals differ in write order, historic versions and post-commit cleanup. Workers likewise differ in committed receipts, fallback and cancellation. Their differences are warranted. Package `onmessageerror` handling remains unchanged because adding it would change the fault result/timing.
5. **Geometry/compiler numerical consolidation.** Execution and simulation use distinct arc calculations. Planner comparisons use epsilon ties that can be nontransitive. Sharing formulas or replacing sorting with a direct minimum can change historical hashes or operation order despite looking equivalent.
6. **Stronger exported circular-event types.** Optional circular payloads could become a discriminated union, but that type participates in post/engine contracts. This needs separate compatibility design.
7. **Measured rendering/planning optimization.** Clipped preview lookup, simulation parent association and some planning loops have repeated searches. No measured bottleneck justified changing their ordering or adding caches. Existing incremental coverage and spatial indexes should remain the baseline.
8. **Wider native-browser coverage.** Chromium exercises the existing workflows. Firefox/WebKit, real-worker fault paths, screen readers, physical controllers and machine clearance certification remain outside this run. Native tests cannot substitute for manufacturing review.

## Independent final review

Two fresh reviewers inspected the complete implementation diff against the pinned baseline, including every new source/test file and this report. Neither reviewer owned the implementation under review. They independently read the code and assertions; they did not rerun the suites or reproduce the ignored comparison corpus. The broad validation above was executed by the primary audit agent.

## Standards

No actionable documented-standard violations or new Fowler smells were found. UPID source validation is a coherent policy boundary; shared checks preserve diagnostic behavior and `unknown` removes unsafe source-record assumptions. Library serializers remove genuine writer/journal duplication. Point-inference construction preserves detached metadata without moving selection logic. Worker cleanup remains client-specific and marks completion before disposing resources. These changes satisfy focused-module, meaningful-test and preservation rules without introducing a generic framework.

## Spec

No actionable preservation or scope findings were found. Metadata acceptance and diagnostic order are unchanged; serializer property order, indentation, installation order and newline behavior match historical writes. Inference retains numerical formulas, candidate identity, guide copies and tie ordering. Worker startup/clone errors, report identity, cancellation text and deadline remain intact; only repeated cleanup is suppressed. The controlled Worker tests leave native event-delivery fault paths unverified, as disclosed above.

Standards findings: 0. Spec findings: 0. Neither axis identified an outstanding implementation issue.

## Final local state

The four focused changes, their regression tests and this report are retained in one local audit commit. The tracked working tree is clean. Ignored build, browser-test and baseline/comparison evidence remains local. No push, merge, deployment or remote mutation occurred. The deferred opportunities above remain deliberate future work; they do not block this behavior-preserving audit.
