# Projects, navigation and CI

Base: main `10ac04b`, merge of PR #13. Continuation branch: `feature/project-navigation`.

## Delivery

- [x] Merge icon PR with a merge commit, update the checkout and branch from main.
- [x] Reproduce both React warning types and separate test time from production build time.
- [x] Show existing and newly saved CAD parts alongside CAM projects, without rewriting stored originals.
- [x] Open, rename, download and safely archive/restore CAD projects through shared storage operations.
- [x] Add bookmarkable dashboard, CAD, editor and settings URLs under the deployment base.
- [x] Preserve browser Back/Forward, draft protection, asynchronous loading and missing-project recovery.
- [x] Support direct links and refresh on the static hosted app, including worker/asset URLs.
- [x] Exercise save → dashboard → reopen → reload → export with a real part, using the public agent tools and human UI.
- [x] Remove reproduced test lifecycle warnings and measured duplicate CI work while preserving critical coverage.
- [x] Complete focused checks, one integrated unit run, a production build and relevant browser journeys.
- [x] Review the finished change, record compatibility and prepare the next PR.

## Decisions and evidence

- CAD already persists under `cad/documents/`. The dashboard reads the CAM manifest only. Use a combined read model, preserving the existing formats and save conflict checks.
- PR #13 unit step took 284 seconds, production build 38 seconds. Pages repeats the complete unit suite, and browser verification rebuilds Vite once more. Fix duplication before deleting behavior coverage.
- Navigation uses React Router data APIs, including browser history and blocking. Reference: [client routing](https://reactrouter.com/start/data/custom), [navigation blocking](https://reactrouter.com/api/hooks/useBlocker).
- A static-host fallback can serve the same built app document at deep URLs; keep emitted assets absolute to the configured base. No server or account is needed to open a locally saved project.
- Existing project data stays local to the selected browser cache or folder. A URL identifies a project; it does not copy its data to another device.

Detailed bounded work: `2026-10-16-ci-runtime-cleanup.md` and `2026-10-16-cad-project-dashboard.md`.

## Browser and integrity checkpoint

Eight Chromium journeys pass, including save, dashboard reopen, browser history, refresh, STEP export, missing projects through the static 404 document, settings, archive and keyboard interaction. Six corresponding Firefox 150 journeys pass. The archive journey also covers a long unbroken name at 1705, 1280, 700 and 390 pixels without horizontal page overflow.

The actual in-app preview now lists the three earlier CAD saves alongside the existing CAM archive. The saved module 3 gear opens from its row and survives a project-URL reload with no alerts. WebMCP reports its unchanged saved fingerprint 68478d8934b638195b4e856c4225de0193516a852e72a3bc6cd661780b19f18d, one solid and volume 21,344.063921829482 mm³. No user project was edited, archived or restored for this check. Screenshot: tmp/project-library-final.png; deep-link gear: tmp/project-gear-deep-link.png.

Review fixes cover Save/alias Back loops, canonical reopen after rename, cancelled editor reads, loading cleanup, background imports completing under Settings, dirty saved-empty parts and global mutation guards shared with agents. Four focused ownership regressions and the existing editor/settings checks pass. The final complete suite passes: 398 files, 4,175 cases in 155.56 seconds, with no React act warnings. Its four-worker budget avoids the starvation reproduced with 31 local workers; the critical storage capacity, cancellation and recovery assertions and their five-second deadline remain unchanged.

The production build, public documentation, icon package and shared-control gates, release compatibility check, post conformance and machine-package validation pass. Existing Vite chunk-size and ineffective dynamic-import advisories remain visible; they are separate from the corrected React lifecycle warnings. CI duration improvements from concurrent jobs and removed duplicate work need confirmation on the next hosted run.

The former icon migration control-text comparison is kept as a historical audit, outside the recurring icon gate. A new CAD operation must be able to change its API and interface text. Generated icon parity, geometry, mappings, package behavior and shared-control ownership remain enforced.

## Hosted follow-up

The first hosted run exposed one composite large-original storage timeout and twelve browser cases that still assumed refresh returned saved projects to the dashboard. No merge was performed on that failed run. The storage follow-up separates pre-write cancellation from the complete interruption → exact recovery → retry → stale-write sequence, using a scoped saved-original fixture. All original assertions, both real adapters, the 4 MiB payload and five-second fixture/case deadlines remain. The revised storage suite passes 26 cases; a native-kernel contention batch passes 47 cases. Detailed timings are in the CI runtime record.

Existing browser cases now wait for the saved CAD identity after refresh, or explicitly return from the reopened editor to the library before exercising manual reopen. Geometry, exact originals, export, rendering, layout and recovery assertions remain. The full affected CAD workflow file passes 32 cases in 52.2 seconds; the affected editor/layout/legacy files pass 26 cases in one minute. Logs: tmp/project-cad-workflows-final.log and tmp/project-editor-workflows-final.log. The first failed hosted run's other 114 browser cases passed. Final hosted confirmation belongs to the PR checks on the follow-up commit.
