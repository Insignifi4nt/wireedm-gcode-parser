# Publication preparation, 2026-09-22

User requested direct agent file input without the dedicated header picker, a Robofil upgrade assessment, a final review of all undeployed work, and a public-facing README with real editor/simulator screenshots of the supplied 45-tooth spur gear UPID.

## Boundaries and baseline

- Local feature branch: `feat/upid-simulation-workbench`; starting HEAD `f912af8`.
- Fetched release baseline: `87118ca816bdad202d8ff87586fe07cc0e28d3d9` (`origin/main`, app 0.0.686). The merge-base is `599e25fdaef948bc71ee13dc8e3b0e78d6a31316`; review uses `git diff 87118ca816bdad202d8ff87586fe07cc0e28d3d9...HEAD` plus final working changes.
- Prepare the next release and a reviewable local branch; do not deploy, merge main or publish during this task. Existing installed packages and original input files stay intact.
- Keep the Agent activity/readiness indicator. Direct imports retain shared validation, explicit installation resolution, freshness and cancellation guards.

## Ownership and checkpoints

- Root: integration, README, native screenshot/import verification, release compatibility record and final verification.
- editor_bug_hunt: direct file inputs, removal of dedicated picker, documented public tool contract and cancellation guards. Standards review follows implementation handoff.
- storage_bug_hunt: Robofil compatibility/upgrade assessment, evidenced fixes only, regression coverage and internal assessment.
- review_normalizer: independent behavior/specification review of all undeployed simulation/editor/storage changes, implementing verified defects with regressions.

## Evidence

- Supplied gear imported unchanged through native `edm_import_upid` into a new browser-cache project `spur-gear-45-teeth-work-2026-09-22`. Original Downloads file was only read.
- Supplied UPID v2 validates and compiles: 254 line/arc segments, two operations, 274 execution events; no diagnostics. It requires CW/CCW arcs, controller compensation, manual threading, separation and program stops.
- With the user's approval, corrected the imported project's kept-material choices to retain the gear body and remove its center cutout; saved through the shared edit tools. The original Downloads file remains unchanged.
- Direct package input verified in the native browser: the exact Robofil 2.6.0 archive decoded, validated and matched the existing installed package. No package installation or replacement was needed.
- Controller generation for the corrected gear succeeded with the unchanged Robofil post (8,804-character ISO, SHA-256 `b136b515e00ec7099671be344772bd63969c623cd52081b659d5d4894f60affa`).
- Independent standards review found no material violations. Behavior review fixed a guide-body height omission in released-piece collision checks and added a regression. Direct-input review added coverage for invalidating a previous package preview after failed preparation.
- README shortened to a public-facing app overview per the user's final guidance. Both images are real, unedited captures of the corrected gear in the editor and simulator.
- App version and compatibility record prepared for 0.0.687. Detailed evidence and remaining verification limits are in [the publication review](../reviews/2026-09-22-publication-review.md).
- Final integrated suite: 1,788 tests across 185 files passed. Production build/TypeScript, documentation checks (17 pages, 58 files), UPID conformance, post documentation consistency and release 0.0.687 compatibility checks passed. Final browser warning/error log was empty.
- Local checkpoints: `5805244` direct agent inputs and import safeguards; `df2bad5` guide-body collision checks and stock-label formatting; `0746ac2` Robofil compatibility assessment/regressions. README images, release metadata and this review are grouped in the final publication-preparation commit.
- Preparation is complete. Nothing was pushed, merged or deployed. A reviewed PR and its browser CI remain the publication gate; no physical-machine verification is claimed.
