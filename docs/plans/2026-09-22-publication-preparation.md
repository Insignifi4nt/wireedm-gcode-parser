# Publication preparation, 2026-09-22

User requested direct agent file input without the dedicated header picker, a Robofil upgrade assessment, a final review of all undeployed work, and a public-facing README with real editor/simulator screenshots of the supplied 45-tooth spur gear UPID.

## Boundaries and baseline

- Local feature branch: `feat/upid-simulation-workbench`; starting HEAD `f912af8`.
- Fetched release baseline: `87118ca816bdad202d8ff87586fe07cc0e28d3d9` (`origin/main`, app 0.0.686). The merge-base is `599e25fdaef948bc71ee13dc8e3b0e78d6a31316`; review uses `git diff 87118ca816bdad202d8ff87586fe07cc0e28d3d9...HEAD` plus final working changes.
- Initial preparation stayed local, without deployment or a main-branch change. The user subsequently authorized merging and automatic publication; that final step follows the reviewed PR and CI gates below. Existing installed packages and original input files stay intact.
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
- Preparation checkpoint suite: 1,788 tests across 185 files passed before the header follow-up. Production build/TypeScript, documentation checks (17 pages, 58 files), UPID conformance, post documentation consistency and release 0.0.687 compatibility checks passed. Final browser warning/error log was empty.
- Local checkpoints: `5805244` direct agent inputs and import safeguards; `df2bad5` guide-body collision checks and stock-label formatting; `0746ac2` Robofil compatibility assessment/regressions. README images, release metadata and this review are grouped in the final publication-preparation commit.
- The initial preparation checkpoint remained local. Publication was subsequently authorized as recorded below; no physical-machine verification is claimed.

## Final UI feedback

- Moved Editor/Simulation to an animated pill in the existing header, removing its separate row. Shared keyboard-accessible tabs respect reduced motion; simulation availability checks are unchanged.
- Moved agent readiness, history and Preview PNG into the notification popover's Agent tab. Every opening defaults to Notifications.
- Checked native header layouts at 320/520/641/1024/1355 pixels and fixed the intermediate-width overlap. Refreshed both README screenshots and the public agent/simulation guides.
- Independent UI review found no substantive regressions. Focused integration checks and production build/documentation checks pass. This remains part of proposed release 0.0.687; no additional version bump or deployment.

## Merge and publication authorization

- The user explicitly authorized merging the completed work and the resulting automatic publication. [PR #2](https://github.com/Insignifi4nt/wireedm-gcode-parser/pull/2) contains the release; final CI, merge and Pages deployment outcomes are recorded there and in its linked Actions runs.
- Current main is still `87118ca`; all code commits from the earlier local branches and detached worktree are already included. The detached worktree's three untracked 2026-09-17 WebMCP research/planning documents are superseded drafts, preserved in place.
- The full suite before source-distribution additions passed 1,794 tests across 187 files. The first complete PR workflow also passed 78 browser tests, with one optional pre-seeded local-project smoke test skipped.
- Final review found and completed the remaining STEP source-distribution checkpoint. Production postbuild now packages both complete pinned upstream archives, exact licenses, checksums and rebuild/relink instructions alongside the binary. Independent review, 25 focused tests and actual archive verification passed; the third-party record documents the mandatory build gate. Final integrated CI must pass on the exact commit before merge.
