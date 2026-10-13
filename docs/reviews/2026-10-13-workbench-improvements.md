# Workbench usability and performance improvements

## Objective and baseline

The user authorized a new research and implementation pass with five substantial goals across usability, useful features, code maintenance and measured performance. The selected goals below come from current workflow probes and comparisons against `395b23c`, the completed numerical correction branch. Work stays local on `improve/workbench-usability-performance-2026-10-13`.

| Goal | Before | Required result and evidence |
| --- | --- | --- |
| Recovery copy from connected storage | Verified backup rejects incompatible indexed revisions, while readable-file recovery export appears only for failed connection sources. | Settings and WebMCP can capture connected cache, folder and temporary-session files through the existing guarded read-only operation. Exact originals, bounded reads, omissions, cancellation and prepared-download retries remain intact. Verified backup and restore remain strict. |
| Actionable execution diagnostics | A derived partial contour's compensation blocker opens Contour Setup, which cannot set its explicit controller left/right side. Rows otherwise have generic repair labels and no contour name. | Open Machining Participation for partial compensation, name the actual review decision and show source contour context. Real repair clears the compiler blocker; pending forms, Escape, Discard, Undo and Redo retain existing behavior. |
| Partial-contour preview preparation | Repeated linear searches associate displayed fragments with sources, authored operations, refs and active spans. | Build local first-match indexes and extract source endpoint preparation. Preserve ordering, original endpoint ownership, duplicate-ID behavior, missing owners and all preview output. Measure representative large drawings against the pinned baseline. |
| Simulation preparation and seeks | Parent assignment repeatedly calculates polygon areas. Obstruction samples and repeated seeks rebuild piece lookups and walk the same ancestry. | Reuse calculated areas and ancestor metadata while preserving comparisons, stable sort, snapshots, warning order and boundary times. Refresh mutable metadata, including Worker-cloned plans. Compare complete serialized outputs and measure preparation/playback work. |
| Worker task ownership | Five clients separately manage settlement, deadline, abort, message handlers and termination. Package message errors can leave a check running until timeout. | One owned-worker task handles resource cleanup and settles once. Keep worker creation, protocol, progress, domain errors, deadlines, fallback and result/rejection policy in each client. Handle native message-error events and receiver exceptions promptly; ignore late events and preserve cancellation precedence. |

## Compatibility and scope

This candidate does not ship a release. App `0.0.696`, calculation engine `3`, post engine API `1`, UPID/post/package/saved-revision/storage schemas and execution events remain unchanged. No installed packages, historical snapshots, controller-file rules, machining decisions or numerical tolerances are rewritten. There are no dependency or credential changes.

Recovery export keeps format `wire-edm-recovery-export`, schema `1`, and its existing exact-text/hash and omission rules. Its observation text now describes either connected or failed storage; the source diagnostic identifies a connected copy. It remains evidence for manual recovery and cannot be supplied to verified Restore. A retained failed selection still takes precedence over the active location. Changing connection invalidates the source ID and receipt; retrying a prepared download returns the original archive.

Diagnostic changes concern navigation and presentation. Preview and simulation optimizations retain existing formulas and ordering. Worker fault handling now reports message errors and progress receiver exceptions instead of waiting or leaking a task. It does not weaken package validation or execute posts during recovery capture. Installed post capabilities, output and installation contracts remain authoritative.

No push, deployment, merge, pull-request publication, remote workflow, external-service mutation, shared-database operation or production migration is authorized or performed.

| Subsystem | Benefit | Principal regression risk and check |
| --- | --- | --- |
| Recovery | Copy readable files even when a historical revision prevents verified backup. | Exporting the wrong location or changing original text. Source identity, retained failed-selection precedence, exact cache/folder text and prepared retry tests cover these paths. Raw archives still need manual recovery. |
| Diagnostics | Navigate directly to the decision that clears the blocker, with named contour context. | Losing pending input or pointing at the wrong authored operation. Native Escape/Discard/Undo/Redo and partial/full-contour tests cover the shared workflow guards. |
| Preview | Reduce repeated searches for large partial drawings. | Changing duplicate-ID ownership, source endpoints or fragment ordering. First-match regressions and complete output comparisons preserve these choices. |
| Simulation | Reduce redundant polygon/ancestry work during compilation and repeated playback seeks. | Stale lookups for mutable Worker-cloned plans or changed release/removal boundaries. Metadata validation, mutation regressions and forward/reverse corpus comparisons cover these cases. |
| Worker ownership | Centralize cleanup and finish failures promptly across five consumers. | Different settlement, cancellation, deadlines or late-result behavior. Consumer, STEP UI and real-Worker probes cover these paths; other browser faults are not exhaustively tested. |

## Implementation and validation record

Focused recovery validation passes 85 tests across app, agent, recovery and backup interfaces. Two further cache/folder integrations prove that an indexed engine-2 revision with an internally consistent stored hash but a noncanonical plan remains byte-for-byte in a recovery archive while verified backup still rejects it. Chromium exercises both blocked startup and connected-storage copies, exact hashes, download retry, backup failure, compact settings and focus behavior.

The diagnostic improvement passes eight focused tests, four existing native workflow regressions and three Chromium diagnostic workflows. The new partial-circle journey uses the real domain operations and owning tool, clears execution review after choosing the explicit side, and verifies Undo/Redo and held transitions with pending input.

The pinned performance corpus compares 17 fixture variants and 6,008 complete serialized outputs, including 168 successful and 36 identically rejected simulation compilations. It covers published UPID examples, mixed primitives, nested contours, coordinate translation, disabled stops, partial/blocked participation, duplicate identities, retention/waste policies, support floors, removal/release boundaries, reverse seeks and Worker-cloned plans. Baseline and candidate corpus SHA-256 both equal `3ead6ef35dfc3c510bdeb7b67652415aed69e4f79c89431a93c8ebf64b3db544`. These finite comparisons are evidence for compatibility, not proof for every input.

## Measured performance

The final local Node comparison uses the pinned baseline and final production modules, two warmup pairs and alternating baseline/candidate order. Timings below are medians in milliseconds. The sample ranges are retained because these measurements depend on the machine and runtime.

| Workload | Samples | Baseline median and range | Candidate median and range | Ratio |
| --- | --- | --- | --- | --- |
| Source endpoint handles, 5,000 segments | 7 | 122.90, 98.29–171.98 | 5.47, 3.35–6.60 | 22.46× |
| Full partial preview, 5,000 segments | 5 | 275.63, 226.44–334.23 | 127.25, 104.57–162.23 | 2.17× |
| Released-piece compilation, 300 circles | 5 | 650.48, 509.26–693.75 | 398.33, 331.30–457.53 | 1.63× |
| 300 seeks across 256 mutable nested pieces | 7 | 131.41, 102.32–164.05 | 15.23, 14.26–23.85 | 8.63× |
| Complete obstruction scan, 100 rectangles | 5 | 876.47, 797.77–935.93 | 597.27, 449.14–637.93 | 1.47× |
| Complete simulation, 100 rectangles | 5 | 760.10, 702.50–774.91 | 536.06, 440.44–623.64 | 1.42× |

The smaller 1,000-segment full-preview measurement has overlapping ranges and medians of 27.65 ms before and 31.77 ms after. It does not demonstrate a speedup. Endpoint preparation at that size does improve, but no blanket claim is made for every drawing, native render/frame rate or the whole app. Scripts and all distributions remain under ignored `tmp/2026-10-13-improvements/`.

## Worker reliability and maintenance

The shared owner replaces five separately maintained cleanup and settlement implementations. Clients remove 51 physical lines and the shared helper adds 54, for a net addition of three production lines. The benefit is one tested place to manage worker lifetime; this is not a net line-count reduction. Worker creation, requests, fallback and fault diagnostics remain at each client.

Eight worker and consumer suites pass 63 tests, and strict TypeScript passes. A package message-error regression fails before the fix and completes afterward. Native Chromium probes use real Blob workers for success, cancellation and `postMessage(undefined)`. The message-error probe manually dispatches a native `MessageEvent('messageerror')`; it does not induce a deserialization failure. In that probe the baseline remains pending with zero terminations, while the candidate returns the existing diagnostic and terminates once. EventTarget registration handles browsers where assignment to `onmessageerror` does not register a native handler. STEP callback exceptions now finish with its existing worker failure result, and an abort followed by a callback exception retains cancellation.

## Independent reviews

A fresh independent reviewer read every tracked and new file against `395b23c` and found no actionable specification or compatibility issue. Its separate public-interface probe matched the baseline across 11,550 comparisons, including mutable metadata, object replacements, removal boundaries, reverse seeks, duplicate identities and missing endpoint owners. It did not repeat the full suite or native journeys.

An independent standards and maintenance pass reviewed the four non-worker goals, tests and hosted documentation, with no actionable finding. That reviewer explicitly excluded the worker code it authored. The primary agent reviewed the shared worker and the complete diff, including an undefined-terminal-receipt regression identified during review and corrected before final validation. These coverage limits are part of the evidence; the reviews are not an assertion that every future input is correct.

## Broad local validation

The settled candidate passes all 2,581 Vitest tests across 228 files with four workers. The first broad run exposed five failures in the separate STEP setup UI test double: it did not implement EventTarget registration required by the shared worker owner. The double now extends EventTarget, all original progress, cancellation, replacement and model-retention assertions remain, and an additional message-error regression checks retained model/alignment and ignored queued success. This was a candidate-induced test-fixture failure, not a pre-existing failure or a relaxed assertion.

Strict TypeScript and the production build pass. The build also creates 27 hosted documentation pages, validates documentation and local links across 87 sources, and verifies two already-cached STEP source archives totaling 52,618,541 bytes. Existing bundle-size, OCCT browser externalization and ineffective dynamic-import warnings remain. There is no standalone lint command in this repository.

All three published UPID examples pass executable conformance. The minimal post passes both precision fixtures, and the Robofil candidate post passes all three fixtures. The unchanged Robofil package version `2.6.0` validates with SHA-256 `48bcc0bdf14c197495fd0933b62173d22d598f4d71ae2ca861d0dd2245acde62`. Generated post documentation, the existing `0.0.696` release checklist and whitespace checks pass.

The complete Chromium workflow suite passes 98 tests in three minutes with two workers on Playwright's configured port `3107`. One existing optional test is skipped because its external seeded-workbench folder is unavailable; its existing condition is unchanged. The suite covers the new connected recovery and partial-compensation repair journeys alongside imports, real DXF Workers, saved reopening, output, installed packages, pending forms, Undo/Redo, focus, compact layouts, touch interaction, temporary storage and cross-tab locks. It does not cover every browser or real-controller workflow.

## Local implementation commits

| Commit | Change |
| --- | --- |
| `dc7759a` | Recovery copies from connected storage |
| `1130ea2` | Actionable execution diagnostics |
| `187c4b1` | Indexed partial-preview and endpoint preparation |
| `b3396f5` | Piece-area and validated ancestry reuse |
| `f627781` | Shared Worker lifetime and prompt fault settlement |

The implementation is split into five local commits for separate review. Main remains at `3e3fce9d06a0911898826e893af324951c00f7cf`; this pass starts from `395b23c`. The final report is committed separately and the working tree is checked clean afterward. App version advancement and shipping remain for a reviewed release PR.

## Deliberate follow-ups

Operation search and automatically revealing a canvas selection in long geometry/program trees remain worthwhile follow-ups. They need consistent global selection and workflow target behavior, rather than a finder bolted onto one panel. Historical revision migration and an archive restoration workflow still require a separate storage design that preserves originals and tests interruption/retries. This pass provides a readable copy, not a silent migration.

Physical controllers, real folder crash injection and exhaustive browser/device combinations remain outside local validation. No finite investigation can establish that a future reviewer will find nothing.
