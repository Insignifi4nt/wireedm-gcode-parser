# PR #1 final application review

Baseline: `45f142c93dfd1cbc92ddb2afa183b6b1d5d0e4f5` (`origin/main`). Release: 0.0.686. Reviewed the PR against the requests recorded in `docs/plans/2026-09-17-agent-authoring-and-compatibility.md`, root AGENTS.md, and current application behavior. No subagents used.

## Standards and data integrity

- **Fixed P1: interrupted journal creation blocked reopening.** File System Access can leave a new empty journal handle before its first write commits. All four recovery readers treated this as invalid recovery data, blocking the whole workbench even though the transaction had not begun changing owned files. Recovery now removes an exactly empty journal and verifies removal. Nonempty malformed journals still fail closed. Sixteen cache/folder regressions cover all four journal types, preserving the catalog and unrelated files; all eight empty-journal cases failed before the fix. Commit: `b0422f0`.
- **Fixed test reliability:** the CLI integration test starts three Node processes and exceeded its default five-second deadline on a highly parallel Windows run. Give this integration test an explicit 30-second timeout. No geometric performance thresholds were weakened. The complete suite passed with two workers before this change as well.
- **Simplified browser storage assertions:** use one test helper to decode both plain and gzip cache files independently with Node's gzip decoder. Tests no longer repeatedly assume every localStorage value is JSON.
- No further P1 issue was identified in the examined storage transactions, backup/restore/cleanup, saved-content conflict checks, agent mutation guards, controller serialization, package workers, or release workflow. This is a release review, not an exhaustive security or physical-machine certification.

## Requested behavior and browser coverage

- The full Chromium suite exposed nine stale tests: old dashboard/archive labels, pre-compression storage reads, an old Robofil version, a no-op geometry setup save, old post-level compensation diagnostics, incomplete intent review, and assertions before asynchronous project reopening finished. Updated these to the current intentional behavior. Retained the missing-compensation rejection and exact downloaded ASCII/CRLF controller-byte checks.
- The execution-diagnostic journey now proves that resolving initial wire position exposes the next compensation decision instead of silently authorizing it. The test repairs that decision through its owning workflow before expecting an executable plan.
- Add the full Chromium suite and retained failure reports to PR CI. Existing checks already cover release records, contract parity, post conformance, archive validation, unit tests and the production build.
- No controller, UPID, post capability or installed-package semantics changed in this review. The recovery correction needs no additional release bump within PR #1.

## Verification

Final local and CI results are recorded in PR #1. One optional browser test requires an external workbench folder and is skipped when that fixture is unavailable. The ordinary browser flows use isolated test contexts, not the user's live project storage.

## Remaining maintenance

- `npm audit` reports eight existing dependency advisories (five high, three moderate). Dependency paths are the Vite/PostCSS/nanoid build chain, Babel/Browserslist mapping, and Vitest/jsdom/undici test tooling. No affected server runs on the static Pages deployment. Update these in the already recorded dependency-maintenance work; do not present this review as a clean dependency audit.
- The existing large-bundle build warning remains. Prefer measuring startup before splitting shared modules or introducing a broader architecture change.
- Keep the previously recorded UI-preference migration/consolidation work separate. No unrelated browser-origin files were removed.
