# Workbench evolution implementation ledger

This is an internal working record for the comprehensive work requested on 2026-09-21. Keep it current at meaningful checkpoints so work can continue across sessions.

## Scope and operating rules

- Prioritize tested functionality behind shared domain operations before controls.
- Work locally on `feat/upid-simulation-workbench`, based on `fcdfd3c` on `feat/post-compatibility-and-agent-documentation`.
- Commit reviewable checkpoints. **No deployment, publishing, pushes, or main-branch changes.**
- Preserve existing editor behavior, cached/folder storage, exact originals, installed posts, and immutable revisions.
- App release, UPID schema, post schema, execution schema, and engine versions remain independent. Record compatibility effects explicitly; do not silently upgrade saved data.
- Parallel agents own separable paths; parent integrates and commits. Communicate interface decisions, blockers, and completed checkpoints, not each step. Avoid repeated polling.

## Required outcomes

- [x] Reverify and commit the earlier staged normalization/cache fixes (`fcdfd3c`; 269 focused tests on current checkout).
- [x] Create the dedicated feature branch and arm the durable conversation goal.
- [x] Audit real editor workflows, screenshots, accessibility, responsive behavior, and friction; implement justified simplifications/features.
- [x] Find/fix concrete bugs and measured performance problems; improve maintainability through focused tested modules rather than cosmetic rewrites.
- [x] Review UPID semantics/validation/authoring and implement evidence-backed standard improvements with docs and compatibility tests.
- [x] Separate, polished 3D simulation tab based on **saved** UPID processes, with explicit stale/unsaved state.
- [x] Rough rectangular stock input, wire/guide visualization, line/arc motion, seek/play/pause/speed, operation/event feedback.
- [x] Visible cutting and release of fully separated pieces, nested holes, falling/support/retention assumptions; partial/open cuts must not release complete pieces.
- [x] Local machine STEP import, millimeter geometry, bounded/cancellable parsing, placement, fit/reset/visibility controls.
- [x] Collision/obstruction diagnostics for wire motion, imported geometry and released pieces; distinguish geometric approximations and assumptions from machine verification.
- [x] Rendering with WebGPU where supported, fallback, graceful failure, resource disposal, capped rendering cost and lazy loading.
- [x] WebMCP discoverability/readiness, precise atomic edits, stale/cancellation checks and UI parity, including native export verification below.
- [x] Direct saved-UPID and controller exports through guarded shared operations; capture of the actual active editor preview.
- [x] Hosted public guides, relevant internal architecture notes, compatibility record, independent review and complete validation.

## Work ownership

| Owner | Paths / work | State |
| --- | --- | --- |
| root | Integration, dependencies, EditorPage, simulation UI/rendering, real-browser verification, ledger/commits | Complete |
| storage_bug_hunt | Simulation domain, import identities, DXF integrity and storage recovery | Complete |
| review_normalizer | STEP/scan workers, geometry review, compiler performance, WebMCP receipts, focused-panel and mobile review | Complete |
| editor_bug_hunt | WebMCP/controller guards, editor draft/entry fixes, exact-byte storage review and renderer outline regression | Complete |

All agents have handed off their completed implementations and tests. Root completed integration, native verification, documentation and local commits. Agents never stage/commit shared work. The user's later feedback explicitly prioritized removing the cluttered simulation sidebar, correcting visible geometry artifacts and continuing substantial parallel work on the existing app; the checkpoints below cover that direction.

## Decisions

1. Reuse `compileWireEdmExecutionPlan`; never infer missing reviewed machining intent or reparse posted G-code for simulation.
2. Start with separately validated simulation settings. Do not bump UPID merely to store rendering preferences. Decide portable process/stock metadata changes based on semantics and compatibility evidence.
3. Three.js `WebGPURenderer` provides WebGPU with automatic WebGL2 fallback. Raw WebGPU would add graphics maintenance unrelated to machining semantics. Load rendering code only when simulation is opened.
4. STEP import uses local `occt-import-js@0.0.23` in a cancellable worker, with output units explicitly millimeters. Imported model placement is explicit; no silent source-geometry recentering. Session-local model initially; durable storage remains an explicit later decision.
5. Playback times use named simulation speeds, not controller feeds or validated cycle-time estimates. Falling geometry uses disclosed support/retention assumptions; exact collision capability and limitations must be visible.
6. Preview capture is the actual app-owned rendered 2D SVG or 3D canvas, not a screen recording or fabricated app screenshot.
7. The revised simulator uses a full-width scene and one focused Stock/Machine/Checks/information popover. Remove redundant captions, repeated source titles, inactive editor status and always-visible assumptions. Preserve editable drafts across popover changes and make incomplete checks discoverable.
8. Nominal contour material is a supported approximation, not a substitute for a kerf/compensation or rigid-body solver. Reject unsupported sampled topology explicitly rather than displaying invalid overlapping polygons.

## Public interfaces being implemented

- Simulation: `compileSimulation(document, settings)` -> typed plan/diagnostics; `sampleSimulation(plan, elapsedSeconds)` -> deterministic wire/pieces/stock-hole/event/warning snapshot. Read exact exported types in `src/domain/simulation/index.ts`.
- Machine import: `importMachineModel(file, {signal, onProgress?})` -> typed result with mm indexed triangle meshes, hierarchy, source identity and bounds. Machine placement/collision helpers are renderer-independent.
- WebMCP preview: `DraftReadSnapshot.capture?(signal)` -> `{dataUrl,width,height}` PNG <=1600px and <=1MiB; adapter validates input freshness after asynchronous capture.

## Evidence / checkpoints

- 2026-09-21 baseline: staged fixes unchanged since previous session; 29 files / 269 focused tests pass. Commit `fcdfd3c` contains six prior files only.
- Earlier baseline before new comprehensive work: 151 files / 1,453 tests passed, production bundle and docs passed; subsequent storage fix passed 107 storage tests and TypeScript. New changes require fresh appropriate verification.
- `b59c8ae`: stale derived UPID bounds rejected; temporary machining IDs cannot replace source geometry; repeated participation edits preserve authored IDs/reviews. Agent ran 313 tests / 15 files plus all executable fixtures; parent repeated 25 key regressions. Compatibility record includes original/revision preservation and affected exceptional plans.
- `2f7a0ed`: deterministic simulation and STEP/placement/collision APIs; 61 focused tests / 8 files pass. Real Chromium development and production workers import authored STEP, convert units and cancel without network uploads. Local LGPL notices/source records included.
- `fe14d5b`: controller preview discards output and pending results from changed machine setups; 12 regression tests.
- `0daaa8c`: direct exports, capture receipts, precise-edit discovery and bounded visible activity; 77 API tests / 9 files plus 19 controller/capture tests.
- `64528a4`: compatible toolchain lockfile refresh and ESM config; npm audit reports zero vulnerabilities. No global npm/config changes.
- `2d0a6ce`: conservative polygon broadphase and binary timeline seek. Measured 40-circle compilation 18,438 ms → 227 ms; 5,000 seeks over 5,006 events 924 ms → 7 ms. Stress budgets remain explicit; browser compilation and machine scanning now run in disposable workers with 60-second deadlines.
- `1cf3f0f`: agent readiness waits for all registration acknowledgements and preserves meaningful activity during registration.
- Native IAB: imported a separate `simulation-verification-2026-09-20` fixture via actual WebMCP, leaving both original library projects untouched. Real WebGPU renderer displays stock/wire/guides, full-cut circle falls, guide obstruction appears. Native 2D capture 79,612 bytes and 3D capture 374,950 bytes pass PNG receipts. Screenshots under ignored `tmp/editor-audit/` (01 baseline, 02 scene, 03 release).
- Independent review fixed same-count nested-hole invalidation, STEP face colors/two-sided surfaces, empty active-trail shader warning and timeline endpoint rounding; negative alignment drafts now have an explicit apply action. No pushes or deployment.
- Full suite after worker/performance/dependency changes: **174 files / 1,630 tests passed** (34.86 s). UPID executable examples and Robofil post conformance passed; generated post-authoring docs match.
- Latest native development checks: real compiler worker produces WebGPU scene; real STEP collision worker finds two tetrahedron contacts; machine fit/visibility and saved-operation selector work; timeline End reaches Complete with a released slug/guide observation. Tablet 900×700 and mobile 390×844 were visually checked and viewport reset.
- Native production WebMCP: unsupported wire-centre/manual-separation job correctly rejected by the exact installed Robofil post with its saved revision receipt. Separate compensated-circle fixture exports successfully (169 characters, ASCII, CRLF, numbered ISO, SHA-256 `bcd67376bbe874ae0bcad28aafb4ba2bdb0470a7ae79815719381c71e3c6cdef`); reading the returned artifact preserves exact bytes/text without regeneration. Saved UPID export reports a download request. IAB's download event was not observed, so no on-disk delivery claim is made; the public tools explicitly report requests, not disk receipts.
- Final integration review reproduced and fixed hidden-editor keyboard undo/redo, explicit header actions remaining on the wrong tab, and viewport failures retaining resources or escaping React. 175 relevant tests passed. The subsequent full suite passed **175 files / 1,636 tests**; TypeScript, production build, and 16 documentation pages / 55 linked files passed.
- Final production browser loaded the compiled preparation, STEP and collision workers; full-cut playback and imported contacts work with no captured console warnings/errors. A dirty translation stayed excluded from 3D capture (`contentSource: saved-project`, `dirty: true`); the verification edit was undone without saving.
- WebGPU was verified on real hardware/browser. WebGL2 fallback is delegated to Three.js and startup/retry behavior has unit coverage; a forced native fallback was not exercised because the browser tool does not expose the required emulation method. No browser override was applied.
- `f597956`: skip unused material-position classification for separated wire travel while preserving continuous-travel validation. The 800-contour execution benchmark improved from 377 ms to 28 ms; 47 focused compiler/post tests passed.
- `df80026`: shared import identities accept numeric filenames and trailing punctuation at the slug truncation boundary. DXF, UPID and machine-program imports retain cache/folder coverage.
- `a2e3cc8`: reject inconsistent, repeated or invalid declared DXF lightweight-polyline vertex counts instead of silently turning a truncated four-vertex closed contour into a triangle. Missing-count legacy inputs remain supported; 147 DXF tests passed.
- `ebc03dc`: preserve and verify exact catalog/backup bytes, including BOMs, across cache and folder adapters. Recovery checks both catalog states against the journal before any rollback and preserves conflicting external changes. Independent review corrected package-install before-images and compressed-cache decoding; preference rollback corruption is reported truthfully. No migration or original deletion was introduced.
- `8dd0cc6`: retain pending stop notes/distance/focus when another row changes, avoid stop ID collisions, and target the first active entry contour after exclusions or partial participation. The remaining exact-coordinate transform fix preserves untouched fractional coordinates and pending absolute targets when relative translation is applied; 210 editor tests passed during review.
- `baa3771`: reject stock-edge contact and unsupported crossing sampled material boundaries before extrusion. Real geometry regressions cover nested curves, all outer/hole winding combinations, retained caps, reverse seeks and local Float32 upload origins. The original clockwise nested mesh had an incorrect 827.118 mm³ volume; corrected winding produces 659.600 mm³ without overlapping caps. Near-origin-offset fixtures preserve 0.02 mm details at 999,999 mm.
- `c55c4de`: bound serialized post diagnostic summaries while retaining durable revision receipts, even for oversized messages. Exact UPID source IDs no longer inherit an unrelated 160-character tool-handle limit. 44 WebMCP tests passed; the public guide describes truncation.
- Integrated full suite after this second parallel audit: **180 files / 1,713 tests passed** in 28.04 seconds. TypeScript, production build, documentation links, all three executable UPID fixtures, Robofil post conformance and generated post docs passed. An earlier run caught long-ID tests before their implementation landed; the completed integrated run supersedes it.
- Native revised UI: separate imported nested-cut fixture shows the inner cylinder falling through its opening while the outer cut remains pending. A final real-browser rendering check exposed 180 decorative facet edges on that hole. A real Three.js regression confirmed that a 25-degree crease threshold retains the circular rims and four stock corners while eliminating those facet lines, including reverse seeking.
- Final independent UI review fixes dialog focus when a panel has no interactive content and includes failed/incomplete machine scans in the Checks badge. Four regressions and 32 focused UI tests passed. Native 390×844 review also found an empty mobile launcher wrapper consuming a grid row; conditional rendering removes it while preserving modal state and unsaved input. Nineteen focused layout/rail/panel tests passed.
- `316ba2a`: the empty mobile launcher-row fix is committed independently. Native final build confirms the Simulation canvas fills the 390×844 viewport, with tablet 900×700 also checked. Stock input survives Escape/reopening, Apply stock restarts the worker-backed scenario, and focus returns to the trigger. The temporary width change was restored to 50 mm without editing the saved project.
- `348855a`: integrates the focused saved-UPID workspace, verified renderer geometry, background preparation/scanning, local STEP controls, active-view PNG capture and exact transform drafts. Domain APIs and earlier compatibility fixes remain separate checkpoints.
- Final follow-up verification after the focused-panel, outline and mobile fixes: **203 tests / 14 files passed**, including all simulation feature tests, actual preview capture, native editor draft regressions and rail state. TypeScript and production build passed; all 16 documentation pages and 55 linked files passed the documentation checker. Latest native production renderer logs contain no warnings or errors. Final screenshots: `tmp/editor-audit/11-mobile-focused.png`, `12-tablet-focused.png`, and `13-final-simulation.png`; the accepted desktop image shows the cutting wire, clean nested opening and released inner cylinder. Viewport overrides were reset.
- All scoped changes are local checkpoints on `feat/upid-simulation-workbench`. App version remains 0.0.686 until a reviewed release merge. No deployment, publishing, push or main-branch change occurred. Development and production-preview servers remain on the configured 3777/3778 ports for user review.

## Research sources

- Three.js WebGPU renderer/fallback: https://threejs.org/docs/pages/WebGPURenderer.html
- Local OCCT import/API/units: https://github.com/kovacsv/occt-import-js

## Outstanding risks and follow-up

- Exact rigid-body collision/slug behavior depends on real clamps, support, gravity direction, wire tension, clearance and technology; do not claim physical certification from a visual approximation.
- Imported-model triangle size and browser memory budgets require validation and cancellation.
- Export/capture operations must respect pending workflow edits and input versions; cancellation after durable saving must retain a truthful receipt.
- The renderer is a lazy ~250 KiB gzip chunk, and STEP adds a lazy ~3.1 MiB gzip WASM asset. Build warnings identify large chunks and OCCT's unused Node-only branches; real production workers were verified. This work does not eliminate every pre-existing application bundle warning.
- Local test fixtures are separate library records: development `simulation-verification-2026-09-20`; production-preview `simulation-production-check-2026-09-20`, `compensated-circle-2026-09-20` and `nested-cut-verification-2026-09-20`. Original user projects and installed packages were not modified. These are verification records, not shipped seeded/demo library content.
- The requested implementation and verification pass is complete within the documented geometric model. Full rigid-body dynamics, kerf/spark-gap simulation, durable scenario storage and physical-machine certification remain explicit capability limits rather than completed features.
