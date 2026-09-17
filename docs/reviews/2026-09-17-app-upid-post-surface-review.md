# App, UPID, and post ownership review — 2026-09-17

Reviewed branch: `codex/post-processor-architecture`.
Reviewed HEAD: `a52bf467896c9ba16c5516712fea4578af606183`.
Fixed base (HEAD~15): `a16f267352af0a5902510b04fb4b389abfda0bd8`.
Aggregate comparison: `git diff a16f267...a52bf46` (71 files). No review subagents were used. Production code was not changed by this review.

## Decision

The architecture is mostly on the right surfaces. Keep controller-neutral geometry, machining choices, event ordering, validation, storage, and artifact auditing in the app. Keep the exact Robofil command sequence, compensation persistence, manual rethread realization, arc representation, number formatting, and controller-file serialization rules in the versioned post package.

The main corrections are not to move the Robofil renderer back into the app. They are to stop the generic editor assuming Robofil separation behavior, make package capabilities precise enough to describe that behavior, and enforce shared manufacturing invariants in the host instead of relying on every post author to implement them. A remaining external-program parser also interprets a dialect-specific command globally.

Standards/spec sources: root AGENTS.md; ADR-0002 and the portions of ADR-0001 it retains; the controller-neutral runtime and safety requirements in the 2026-08-28 post platform design (subject to the superseding complete-machine-package design); and the compatibility policy in docs/upid/v1/README.md. Findings below distinguish confirmed defects, contract/standards gaps, and improvement opportunities. Priorities are implementation order, not claims of physical machine certification.

## Correct ownership to preserve

| Change | Decision |
| --- | --- |
| App selects finished-contour as the default for new DXF geometry | App/import decision. Do not make this a Robofil default or rewrite existing documents. Address missing intent in F02. |
| Automatic kept-material intent and winding-to-wire-side resolution | App/UPID. These are manufacturing intent and geometry, not controller syntax. |
| Entry/exit distances and source-material route analysis | App domain. The post must not invent lead geometry or decide part topology. |
| `after-positioning` stop and separation-during-positioning intent | Legitimate neutral intent when explicitly chosen and supported; version and publish the contract properly. Literal G0/M00 behavior remains package-owned. |
| Retain Robofil compensation between contours; change side with G41/G42 and G38; G40/G39 at program end | Exact post policy. Do not require universal cancellation at each contour. Candidate evidence must remain candid about what has and has not been machine-verified. |
| Robofil emits a full circle as two arcs | Appropriate post-level representation of the same host-owned path. Host audit must verify equivalence. |
| Coordinate quantization allowance | Shared host audit, derived from the exact post's formats. It should not be patched into each post or relaxed across the whole program. |
| Revision history, archive/purge, browser compression, downloads, settings layout | Application/storage/UI responsibilities; none belong in a post or portable UPID. |
| Extension, encoding, line endings, wrappers, numbering | Exact post package owns the rules; generic host serializer applies them. Keep workbench preferences out of this. |

## Confirmed defects and contract gaps

### F01 — P1: One coarse motion format weakens the audit for all cutting moves

Owner: host runtime and motion audit. Introduced in `c23a529`.
Locations: src/domain/post-processor/custom-runtime/customPostRuntime.ts:286; src/domain/post-processor/controllerProgram.ts:147 and :164.

`emittedCoordinateQuantumMm` takes the largest quantum across every motion block and all coordinate roles, then supplies it to every event's audit. A single positioning command with zero decimal digits allows approximately 0.707 mm endpoint deviation in unrelated three-decimal cuts. The recorded `mixed-precision-wrong-fine-cut` probe changes a requested `(10,0)` cut endpoint to `(10,0.1)` and the runtime returns `ok:true`.

Carry representability allowances per block and coordinate role, including the previous block's rounded endpoint and incremental-center error propagation. Do not allow a coarse axis/center/unrelated event to enlarge another coordinate's allowable error. Test mixed formats, absolute/incremental arc centers, near-full/tiny arcs and rounded-away motion; preserve the valid decimal DXF regression.

### F02 — P1: Missing compensation choice on a finished contour silently means uncompensated cutting

Owner: app/UPID executable-readiness policy. Exposed more widely by new DXF default `a52bf46`; compiler behavior predates it.
Locations: src/domain/path-intel/fromDxfEntities.ts:55; src/domain/execution-plan/executionPlan.ts:404; src/features/editor/EditorWorkflowSetupPanels.tsx:84.

New documents now say `finished-contour`, but construction does not initialize compensation intent. The compiler only resolves compensation if the optional intent already says `controller`; absence falls through to no compensation. `fresh-finished-contour-no-intent` creates a closed circle, supplies its initial wire position, and gets `ok:true` with `controllerCompensation:false`. The UI calls this state “Select compensation,” whereas explicit centerline is a separate manual choice. A permissive post can therefore cut the finished boundary as a wire-center path; Robofil instead fails later inside its private state checks.

Keep incomplete documents portable, but make the execution policy explicit: initialize eligible automatic intent through a tested domain creation operation, or block unresolved finished-contour intent until chosen. Explicit centerline must remain supported. Do not ask the post to infer kept material or fix a missing geometric decision. Cover both UI and API-created imports, open paths, manual centerline, and dormant intent on wire-center documents.

### F03 — P1: Required compensation can be consumed without the correct controller state

Owner: shared runtime semantic audit. Existing issue beyond the 15 commits, made relevant by modal compensation changes.
Locations: src/domain/post-processor/custom-runtime/customPostRuntime.ts:311, :321 and :570; src/domain/post-processor/postCapabilityPreflight.ts.

The runtime requires effects for stops/threading/separation, but not compensation. It permits `consume` on compensation-start and checks only that compensation is off at program end. In `consumed-compensation`, a post starts with `G90 G40`, consumes the canonical required compensation events, emits uncompensated cuts, and passes. The separate `required-compensation-ignored` probe also demonstrates that `manifest.execution.compensationRequiredForEveryOperation:true` is not enforced by preflight/runtime.

Audit the actual declared compensation state against the required side at cutting motion, and enforce the execution contract before running the post. For a continuous lifecycle, consuming a redundant start is valid only when that side is already active. Preserve deferred cancellation, and avoid hardcoding G codes in the host. Add negative tests for missing/wrong-side compensation, mixed compensated/centerline operations, and positive tests for Robofil's same-side continuation and explicit side switches. Canonical fixtures alone do not protect arbitrary real jobs.

### F04 — P2: Generic Manual selection automatically chooses a Robofil-specific separation mechanism

Owner: app selection policy plus post capability declaration. Introduced in `78cd591`.
Locations: src/features/editor/EditorBetweenContoursPanel.tsx:161 and :239.

`threadingForMode('manual', true)` stores `automatic-during-positioning` solely because the route crosses finished material. This component receives no selected machine/post capabilities. Its test intentionally asserts that selecting Manual chooses a separating rapid. Crossing material demonstrates a need to resolve wire state; it does not establish that an arbitrary controller/machine separates wire during a rapid.

Require an explicit separation choice or use a neutral, explicitly reviewed default. Show selected-package support as capability feedback without injecting package policy into portable intent. The generic UI may expose the neutral option, but must not imply it is supported universally. Test with no package, a before-positioning-only package, and the Robofil package.

### F05 — P2: The compiler rejects an explicitly already-separated wire for crossing material

Owner: app execution planner. Introduced in `78cd591`.
Location: src/domain/execution-plan/executionPlan.ts:376.

The new material check rejects manual threading with `wireSeparation:'already-separated'`. That choice explicitly says the wire is detached before travel; the error tells the user to separate it again or select rapid separation. The two concentric-circle `already-separated-crossing` probe reproduces `EXECUTION_PLAN_THREADING_INVALID`.

Distinguish a connected continuous wire from an explicitly separated wire. Keep the crossing rejection for connected travel; do not reject already-separated travel on that basis. Controller-specific inability to realize that transition belongs to package preflight. Include the correction when handling old saved revisions in F10.

### F06 — P2: Exact arc intersections are followed by an approximate-polygon material decision

Owner: app geometry classification. Introduced in `78cd591`.
Location: src/domain/path-intel/positioningMaterial.ts:18–44.

The classifier intersects exact source curves, then tests interval midpoints against `approximatePolygon`. A short route entirely inside an exact circle but in the gap between its arc and an inscribed polygon chord is returned as `unknown`. `exact-circle-interior` records a radius-100 circle, both endpoints at radius about 99.999900005, and the incorrect unknown result. Unknown does not trigger the compiler's known-material rejection. This is a missed geometric finding, not evidence that unknown stock is safe.

Use consistent exact containment for supported lines/arcs/circles, or an explicit conservative/error-bounded method. Test thin curved regions, holes/islands, boundary tangencies and overlaps. Also examine how manual contour-role/kept-material overrides and inactive/reference geometry should affect the claimed finished-solid region: current parity comes only from stored containment depth. Resolve those semantics before claiming stock clearance; stock and fixtures are not modeled.

### F07 — P2: Separation capabilities claim support for transitions the package rejects

Owner: public post capability model, host preflight/conformance, and truthful example manifest. Introduced/exposed in `78cd591`.
Locations: src/domain/post-processor/postCapabilityPreflight.ts:67; src/domain/post-processor/custom-runtime/customPostConformance.ts:268; tests/fixtures/machine-packages/robofil-100-v2/cristian-robofil-100-v2.wireedm-post.json (`source.code`, wire-separate handler).

Robofil advertises `threading:'manual'` and `wireSeparation:true`, but always throws for `wire-separate`; it only realizes separation embedded in positioning. Conformance now accepts either kind of separation as coverage for the same boolean. `robofil-manual-preflight` returns no diagnostics for `core.multi-compensated-manual.v1`, then `robofil-manual-run` fails with “Wire separation is not verified.”

Declare supported separation mechanisms/transitions precisely and require matching fixture coverage. Preflight should diagnose the unsupported operation before save/generation; source guards remain defense in depth. Do not implement an unevidenced Robofil manual-before-positioning command to make the boolean appear true. Update published schemas/SDK/docs/package versions together, with F09/F10.

### F08 — P2: External G-code still treats G60 as a universal absolute arc-center mode

Owner: external-program dialect interpretation. Existing issue outside the 15 commits.
Location: src/domain/editor/gcodeBlockInterpreter.ts:82.

The generic parser sets `state.ijMode='absolute'` for `word.value===60` without a selected dialect. This directly conflicts with the post-platform spec's explicit requirement to put external G60 interpretation behind a selected dialect adapter. A source program from another dialect can receive the wrong arc preview after G60.

Preserve raw source and the old cleanup/display pipeline, but scope dialect-specific interpretation to an explicit interpreter profile or adapter. A generation post and an import interpreter have different contracts; do not blindly reuse generation callbacks to parse source text. Test legacy Robofil behavior under an explicit profile and neutral/unknown G60 behavior without one.

### F09 — P2: Published post SDK omits `position.separatesWire`

Owner: host authoring contract generation. Introduced in `78cd591`.
Locations: src/domain/execution-plan/executionPlan.ts:90; src/domain/post-processor/custom-runtime/postAuthoringContract.ts:50; docs/post-authoring/v1/sdk/wire-edm-post-sdk.d.ts.

The runtime sends `separatesWire?:true` and requires a wire-separated effect for that event, but both the SDK template and generated declaration publish only `from`/`to`. A post written against the supplied TypeScript contract cannot correctly narrow this field. `post:docs:check` passes because it compares two copies of the same incomplete template; the exhaustiveness check only compares event kind names.

Publish the field and its semantics, and add structural parity validation between runtime event payloads and SDK declarations, preferably generating both from one authoritative contract. Ensure examples and conformance exercise the distinguishing field, not only the event kind.

### F10 — P2: New manufacturing vocabulary shipped under the frozen v1 contract

Owner: UPID/post contract versioning and saved-revision compatibility. Introduced in `78cd591`; broader engine version policy needs attention.
Locations: src/domain/path-intel/types.ts:268 and :394; src/domain/upid/validateUpidDocument.ts:2183 and :2244; docs/upid/v1/README.md:76; src/domain/wire-edm-job/savedWireEdmJobRevision.ts:66 and :548.

New `automatic-during-positioning` and `after-positioning` enum values are serialized as schema version 1, although the published policy freezes v1 vocabulary and older strict v1 readers reject these values. The UPID stop table is also stale. The engine remains version `'1'` while saved-revision parsing recompiles with the current compiler; new route validation can make formerly valid stored revisions unreadable rather than merely declining a new generation attempt.

Make an explicit version/capability compatibility decision, implement the required reader/migration behavior, and document it. Do not silently rewrite saved package hashes, revision bytes or manufacturing choices, and do not delete the compiler-integrity check without replacing its guarantees. Test an old portable file, a newly extended file against the compatibility policy, an old saved revision affected by route checks, and a newly generated artifact. Retain honest errors for unsupported versions. Coordinate with F05 and F09 so one coherent contract change covers them.

### F11 — P2: Revision listing eagerly loads and recompiles every full snapshot

Owner: app revision query/read model. Introduced in `a16a1d1`.
Locations: src/features/dashboard/ProjectRevisionsDialog.tsx:54; src/domain/wire-edm-job/savedWireEdmJobRevision.ts:451 and :548.

Opening history performs unbounded `Promise.all` over all revision IDs and retains every full parsed revision in React state. Each parse validates geometry, recompiles the execution plan, resolves bindings and hashes full snapshots. A many-revision gear project multiplies memory and CPU cost just to display timestamps and names; browser-cache decompression is synchronous too.

Add a tested, paginated or bounded revision-summary query, then load and fully validate only the requested download/generation snapshot. If summaries are persisted, treat them as non-authoritative metadata and verify against the actual revision at use. Preserve corrupt/unavailable-row behavior and stale-request cancellation. Measure a realistic multi-revision geometry fixture; do not merely lower a concurrency number while still retaining all snapshots.

### F12 — P2: Motion audit scans all blocks for every motion event

Owner: shared audit implementation. Existing issue, adjacent to `c23a529`.
Location: src/domain/post-processor/controllerProgram.ts:133.

Each event uses `program.blocks.filter(...)` to find its motions. E events and B blocks produce O(E×B) scanning; the 20,000-event runtime allowance permits hundreds of millions of comparisons, and deterministic posting executes the audit twice. This is unnecessary work outside the QuickJS execution interrupt budget.

Index blocks/motions by event once while validating block order/identity, then audit each sequence in O(E+B) plus its geometry. Keep all existing diagnostics. Include a scaling/performance check with realistic event counts rather than timing a tiny fixture, and avoid broad runtime rewrites unrelated to this issue.

### F13 — P2: Explicit deletion cannot remove an index entry whose file is already missing

Owner: storage deletion/recovery APIs. New deletion surface in `a727622`.
Locations: src/domain/wire-edm-job/deleteSavedWireEdmJobRevisions.ts:47; src/domain/workbench-catalog/workbenchCatalogMutations.ts:442; src/domain/workbench-catalog/workbenchProjectStorage.ts:160.

The revision dialog presents unavailable revisions with selectable deletion controls. Deletion first runs full path-ownership validation, which fails when an indexed revision is missing. Purge similarly requires every source/revision file to exist. Thus an explicitly selected missing revision or archived project with a missing owned file cannot be cleaned up through those actions. This conclusion follows the call paths; the current automated suite covers healthy files, not this repair case.

Separate validated ownership from file existence for explicit deletion. Missing files in the selected deletion set can be treated as already deleted, while path collisions, invalid ownership and unrelated corruption must still fail. Keep recoverable journal behavior and scope strictly to the selected project/revision. Test both missing selected files and unrelated missing files; do not weaken ordinary read/save validation.

## Code-quality and efficiency opportunities

### C01 — P3: Move distance-based lead calculations into the domain API

Locations: src/features/editor/EditorEntryExitPanel.tsx:394 and :405.

`pointAtLeadLength` and `pointFromRapidDistance` are new manufacturing geometry operations implemented privately in a React component and tested by UI callbacks. Root AGENTS.md asks for tested APIs before exposing controls. Extract typed pure operations/results usable by UI and future automation, with tests for zero/invalid distances, changed anchors, partial active contours and precision. Keep input strings and presentation formatting in React. Verify that changing input mode does not silently commit rounded/reprojected geometry.

### C02 — P3: Bound main-thread compression and repeated route analysis

Locations: src/domain/storage/browserCacheAdapter.ts:61; src/features/editor/EditorBetweenContoursPanel.tsx:45; src/domain/path-intel/positioningMaterial.ts:24.

`async writeText/readText` wrap synchronous gzip/gunzip and localStorage. Large journals duplicate previous/next geometry, and readback checks decompress repeatedly. The panel also rederives all rapid routes and material intersections on render; interval containment filters and sorts all contours. Profile realistic files, memoize immutable geometry analysis, reuse spatial indexes where useful, and move large compression work off the UI thread if measurements justify it. Preserve exact readback, atomic recovery, cache-only operation and explicit quota errors. The repeated-character quota test is useful for correctness but is not representative compression/performance evidence.

### C03 — P3: Consolidate duplicated public rules without broad cosmetic refactoring

Locations: executionPlan.ts threadingTransitionIssue; pathDocumentOperations.ts threadingIntentIsCompatible; validateUpidDocument.ts validateThreadingIntent; postAuthoringContract.ts.

Compatible threading pairs and event payload shapes are repeated manually. F09 shows the resulting drift. Centralize canonical valid constructions/rules and derive boundary validators, SDK data and UI choices as appropriate; avoid adding multiple independent fallback policies. Keep raw JSON validation at boundaries and typed internal APIs. The roughly 1.24 MB main production JS chunk also merits targeted lazy-loading of editor/post tooling after functional fixes; do not suppress the build warning as the optimization.

## Verification and evidence

- Nine focused Vitest files passed: 85 tests (execution plans, positioning material, controller audit, Robofil package, isolated runtime, browser cache, saved-revision catalog mutation, revision dialog, between-contours panel).
- `npm run build` passed type checking and production bundling. It reports the large main JS chunk warning above.
- `npm run post:docs:check` passed, demonstrating that freshness checks do not catch SDK payload incompleteness.
- `npm run upid:conformance` passed all three portable examples.
- Additional read-only-in-memory probes are in [the reproduction script](2026-09-17-surface-review-reproduction.ts), with [captured results](2026-09-17-surface-review-evidence.jsonl). Run `npx tsx --tsconfig tsconfig.app.json docs/reviews/2026-09-17-surface-review-reproduction.ts`. The script records current behavior; it is not a passing regression suite that endorses defects. Convert the relevant probes into meaningful negative/positive tests during implementation.
- No browser automation, physical machine validation, production storage mutation, deployment or push was performed. This was an aggregate review plus targeted exploration, not a claim that all unrelated application bugs were exhaustively found.

## Implementation handoff

Address F01–F13 and C01–C03, validating each against the actual code before changing it. Own the implementation directly. Prioritize incorrect output/readiness and ownership first, then contract publication/compatibility, deletion integrity, and measured performance/cleanup. Reuse the existing tested APIs and preserve candidate evidence. A finding may be closed with a documented technical reason if further evidence disproves it; do not silently skip it or implement speculative controller behavior.

Implement on `codex/post-processor-architecture` in the existing checkout. The user authorizes local commits and explicitly forbids pushing. Do not deploy or modify the user's live workbench data. Keep a closure checklist with tests and commit IDs in this report or a sibling completion report. GPT-5.6 Sol high owns all actual implementation; it may use GPT-5.6 Luna high subagents for substantial codebase scouting or research only. No need to wake or message the originating review task.

The separate GPT-6 Astra high WebMCP task is research/planning only and should use an isolated worktree. It may use at most two GPT-5.6 Luna high research/scouting subagents. Its work must not race this branch's implementation or implement WebMCP during planning.
