# Task 7 Report: Verified Robofil operation review UI

Date: 2026-07-13

## Status

Implemented and verified on the current `codex/upid-correctness-safety` branch. The checked-in Task 10 z39 fixture was reused; it was not copied or duplicated.

## Delivered behavior

- Added a visible project geometry-basis selector. Choosing `finished-contour` with a current verified compensation-capable project snapshot initializes eligible automatic intent; ambiguous contours remain unresolved until the operator chooses manually.
- Added persistent manual keep-inside, keep-outside, and centreline controls. The UPID draft stores semantic intent only; no literal G41/G42 text is persisted.
- Added an operation review showing the intent source, winding calculated from the final oriented refs, physical wire side, derived G41/G42 with the snapshotted D-register index, snapshot verification state, or the resolver's typed blocker.
- Reversal immediately changes the derived G41/G42 result while preserving kept material and manual/automatic source.
- Added a structured export trace row for every posted setup, compensation activation, lead-in, contour, and program-end block. The displayed rows use the actual `programBlocks` trace and show M02 as the Robofil terminator.
- Added a future-compatible `lead-out` preview role without creating any Robofil lead-out geometry. The verified program-end lifecycle continues directly to M02.
- Added a pure verified-Robofil preview policy that draws only the real G92 origin-to-entry G1 approach as `lead-in`. It validates the current project snapshot against the exact Task 10 post envelope and resolves compensation from semantic geometry without composing or persisting program text.
- Kept generic rapid and manually authored lead-in previews unchanged and retained the existing contract that machine posting happens only when export preview is explicitly opened.
- Closed a machine-safety gap at the post boundary: verified Robofil wire-centre/missing-intent documents and unverified Robofil snapshots can no longer fall through to generic downloadable centreline output. Failures remain atomic with empty body/move/block traces and clear diagnostics.

## TDD evidence

### RED

The first focused run produced five expected failures:

- posted lead-in/lead-out roles were ignored and replaced by the generic rapid preview;
- geometry-basis and compensation review controls did not exist;
- structured export block rows did not exist.

A separate post-boundary RED cycle proved that verified and unverified Robofil wire-centre documents incorrectly returned ready generic output. A later pure-preview RED cycle failed because the verified origin-approach derivation API did not yet exist.

The expanded app regression set then caught three compatibility failures caused by an initial eager-post approach: generic rapid/manual lead-in previews disappeared and the existing explicit-export-only composition spy fired early. The implementation was corrected to use pure preview policy and lazy posting; no regression was waived.

### GREEN

- Final full Vitest: 58 files, 958 tests passed.
- Production build: TypeScript and Vite passed.
- Full Playwright: 29 passed, 1 existing environment-dependent seeded-workbench test skipped.
- Real z39 browser acceptance: passed in Chromium. It imports the checked-in fixture under a verified project snapshot, selects finished-contour basis, observes automatic keep-inside, verifies reversal changes G41/G42 D0, inspects structured setup/activation/contour/M02 rows, confirms no lead-out row, and confirms download is enabled only when ready.
- `git diff --check`: passed.

The first two z39 Playwright attempts failed only in test setup: one ambiguous title locator and one attempt to click `Show Path Actions` while that panel was already visible. Both locators were corrected and the complete flow passed without changing product behavior or weakening assertions.

## Real z39 acceptance

- 156 canonical segments and one exterior operation.
- Cut length approximately `178.637007` mm.
- Canonical area approximately `1216.888483` mm².
- Automatic keep-inside intent resolves in both directions; reversal changes the derived code and preserves kept material.
- The physical Task 10 placement/start produces the real G92-origin `lead-in`, no rapid while compensated, no fabricated lead-out, and M02 program end.
- The only import diagnostic is the existing assumed-millimetres unit diagnostic.
- A manual keep-outside decision survives reversal, and serialized UPID contains no literal G41/G42 value.

## Compatibility files

The brief's minimum file list was expanded only where the existing architecture required it:

- `src/domain/post/upidMachinePost.ts` and its test own download gating and expose exact verified-envelope readiness to the pure preview policy.
- `src/domain/upid/projectRail.ts` extends the shared travel-role type with future-compatible `lead-out`.
- `src/features/editor/EditorCanvasPanel.tsx` and `src/features/editor/EditorPreview.tsx` pass pure transition geometry to the existing canvas.

`src/__tests__/appDxfProjects.test.tsx` required no source edit; its complete existing suite was used as a compatibility gate. The Task 10 fixture already existed, so Task 7 did not add another copy.

## Remaining concerns

- The operator must still confirm the physical D0 table value for each job; the app deliberately emits only the register selector.
- Generic explicit-linear compensation and multi-operation Robofil lifecycle behavior remain intentionally blocked pending Tasks 5/6 or later verified policy work.
- The raw imported z39 browser flow validates the review/export interaction. The exact translated physical origin approach is additionally covered by the domain acceptance and pure preview tests because placement/start editing is independent editor functionality.
- Vite continues to emit the existing non-failing large-chunk advisory. The full suite also retains pre-existing React `act(...)` warnings in two machine-profile dashboard tests.

## Reviewer follow-up: compensated lead-in safety and real download acceptance

The review fixes supersede the earlier pure-preview note above where the two differ. Verified Robofil preview transitions now come from the actual machine-post block trace, including the real body line number, rather than reconstructing a synthetic line-1 approach. If the post is blocked, the preview emits no fallback transition.

Delivered fixes:

- A circle-center/manual radial lead-in is atomically rejected whenever verified Robofil controller compensation is active. The result has an empty body and empty operation/move/block traces with the typed `unsafe-controller-compensation-lead-in` reason.
- The center-pierce action remains available for generic centreline work, but is disabled with a controller-compensation explanation for the unsafe compensated case.
- `manual-lead-in` posted moves are classified as `lead-in`, not `contour`; the generic centreline regression covers the approach to `leadIn.from` followed by the radial cut to `leadIn.to`.
- The z39 Playwright test now imports the production verified preset, performs the physical translation and reversal through the UI, downloads the actual `.iso`, reads its bytes, and asserts the dated filename, CRLF-only terminators, exact five-line envelope, exact origin approach, exact absolute-I/J arc sample, 78 arc blocks, three-decimal XYIJ words, one D0, M02 termination, and absence of forbidden G21/G17/G54/G40/M30 words.

Follow-up TDD evidence:

- RED: the focused set failed in four expected categories: the UI still enabled center pierce, preview metadata reported hard-coded line 1, the compensated Robofil center-pierce post was ready instead of blocked, and the generic manual radial move was labeled contour.
- GREEN focused compatibility: 6 files, 146 tests passed, including app integration and both z39 domain acceptance suites.
- GREEN full Vitest: 58 files, 962 tests passed.
- Production build: TypeScript and Vite passed.
- Full Playwright: 29 passed, 1 existing environment-dependent test skipped.
- `git diff --check`: passed.

### Completion-review correction

The first follow-up implementation briefly called `postUpidForMachine` while deriving canvas transitions. Completion review correctly identified two consequences: blocked wire-centre/missing-intent Robofil documents could fall back to synthetic travel, and fixing that solely by posting every render would violate the explicit-export-only posting boundary.

A second RED cycle captured both problems: verified wire-centre/missing-intent preview derivation returned `undefined` instead of an empty transition list, and a verified editor review invoked the full machine poster three times before export preview opened. The final implementation uses a pure `deriveVerifiedRobofilPreviewPostBlocks` preflight. It shares the structured Robofil prefix calculation with the real post, returns the same approach block index/points as a ready post, returns an empty list for blocked verified states, and never runs the full poster during editor review. Focused verification passed 4 files/143 tests before the final metadata-equality assertion was added.

Corrective re-review then found two subtler projection cases: fixed three-decimal geometry can be blocked after document validation, and raw-coincident entry points can still format to distinct machine coordinates. A shared `preflightPathPlanToGcode` projection now drives both decisions with the exact production formatting/topology checks while exposing no program body. Regressions cover a non-degenerate sub-precision circle rejected by the real post and a raw-coincident/formatted-distinct origin approach, while the editor-render poster spy remains at zero calls.

Final combined gates after the Task 5 work landed:

- Full Vitest: 60 files, 989 tests passed.
- Production build: TypeScript and Vite passed.
- Full Playwright: 29 passed, 1 existing environment-dependent test skipped.
- The only remaining output is the existing Vite chunk-size advisory and pre-existing React `act(...)` warnings described above.
