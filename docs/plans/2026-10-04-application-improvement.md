# Application review and improvement — 4 October 2026

## Objective and constraints

Review the whole production application and materially improve correctness, data integrity, responsiveness, maintainability, agent workflows and the human experience. The requested working horizon is 5 October 2026 (Europe/Bucharest). Use at most five focused reviewed PRs, with one app patch release per merged PR. Preserve installed packages, immutable revisions, real test contracts and optional folder access. No direct main pushes, speculative package migrations, destructive cleanup or decorative controls.

## Baseline and branch decision

- Fetched origin on 4 October. `main` and `origin/main` are `ab2c2d9`, release `0.0.689`, clean at start and newest production source.
- PRs 1–4 are merged; no open PR existed. `codex/3d-simulation-spike` has experimental unique commits and is excluded. `gh-pages` is deployment history, not source.
- Working branch: `improve/workbench-reliability`. Existing detached worktree belongs to other work and is retained.
- Prior review: `docs/reviews/2026-10-02-codebase-review.md`. Recheck the current source and exercise uncovered scenarios; do not repeat old findings as new work.
- Baseline tests: 199 files, 1,963 tests pass (42.85 seconds). TypeScript/production build, documentation checks and STEP source distribution pass. Prior full-browser evidence is recorded in the 2 October review; current focused browser regressions are recorded below.

## Approach and coverage ledger

Each workstream records inspected modules, reproducible findings, disposition and verification. Findings drive PR scope; candidate grouping below is not a commitment to fill five PRs.

| Area | First-pass owner | Required evidence | Status |
| --- | --- | --- | --- |
| Branches and release workflow | Primary | Current refs, ancestry, PR state, release gates | Production baseline confirmed; five merged remote branches cleaned |
| Storage, recovery and revisions | Integrity reviewer | Exact-byte, conflict, interrupted-write and adapter behavior | Conflict/preference fixes merged; hosted recovery implemented, independently reviewed and verified on both adapters |
| Geometry, UPID, planning, execution and posts | Integrity reviewer | Relevant invariants, realistic edge cases, unchanged conformance | Broad domain review completed without further confirmed output defects; conformance preserved |
| Agent tools, cancellation, freshness, state and docs | Agent-workflow reviewer | Shared guard paths, tool-level repros, hosted documentation | Complete: final guards, shared busy state, truthful receipts, bounded complete reports/setup discovery and recovery tools |
| Imports, editor and simulation performance | Performance reviewer | Bounded measurements and semantic regression checks | Cancellable DXF worker merged; simulation/history reviewed; measured startup split verified; route-sensitive planner optimization deferred explicitly |
| Human UX and visual design | Primary | Current screenshots, keyboard behavior, complete workflows at different sizes | Complete: compact library/settings, Apply/Save clarity, markers, keyboard focus, recovery and agent activity; native workflows verified |
| Test quality and verification cost | Primary | Existing contract inspection, measured runtime, remove only proved waste | Complete: one ineffective layout assertion replaced by real regression; complete test inventory retained across conservative Node/jsdom partition |
| Architecture, bundles, dependencies and maintainability | Primary + performance reviewer | Import graph, actual usage, build evidence, cohesive boundaries | Complete: shared transaction/action guards, typed worker/services, bounded read helpers and measured static import reduction; no added dependencies |
| Integration and independent review | Rotating reviewers | Frozen diff, focused then broad checks, browser walkthrough, PR checks | Independent review completed for every checkpoint; final PRs use the same complete GitHub merge/deployment gates |

## Candidate delivery sequence

1. **Reliability and workflow clarity:** merged exact-state rollback, current preference validation, complete agent reports and compact UX fixes.
2. **Responsive DXF import:** reviewed cancellable worker preparation/planning with persistence and reimport freshness guards.
3. **Editor and agent workflow state:** distinguish Apply from project Save, separate closed-path marker labels, fix reproduced save/open/setup cancellation and draft-freshness gaps; improve shared busy state and bounded setup discovery where confirmed.
4. **Hosted recovery and portability:** retain failed readable storage separately and export bounded exact logical-file evidence without initialization, repair or deletion.
5. **Startup and verification efficiency:** measured bundle boundaries and pure-domain test environments; implement only improvements supported by evidence.

At each checkpoint revisit the full ledger before going deeper into one area. No agent creates branches, commits, releases or PRs independently; primary coordinates shared-file ownership and integration. Reviewers use Sol 6.1 High with no inherited turns and receive explicit context.

## Verification policy

Keep baseline tests intact while reproducing defects. Add tests for the real failing behavior, not the shape of the fix. Start with focused tests and type/build checks. Freeze source before the complete suite and browser integration run. Compare relevant post fixtures, schema/docs parity and release compatibility. Report environmental limitations and untested controller behavior accurately.

## PR budget

4 of 5 created and merged: [PR #5](https://github.com/Insignifi4nt/wireedm-gcode-parser/pull/5), app 0.0.690, merge `6d1e673`; [PR #6](https://github.com/Insignifi4nt/wireedm-gcode-parser/pull/6), app 0.0.691, merge `56fad6e`; [PR #7](https://github.com/Insignifi4nt/wireedm-gcode-parser/pull/7), app 0.0.692, merge e8b8177; [PR #8](https://github.com/Insignifi4nt/wireedm-gcode-parser/pull/8), app 0.0.693, merge 9dcea85. All four passed complete GitHub verification; the first three deployed and recovery deployment is underway. The final startup/test efficiency candidate 0.0.694 uses the fifth and last PR slot. Update this record with links, checkpoints, review findings and final coverage rather than creating duplicate planning documents.

## Local evidence

Scratch logs, bounded probes and current UX screenshots live under ignored `tmp/oct04-review/`. Accepted findings and reproducible regression coverage are retained in the repository; avoid committing local user data.

## Checkpoint 1: reliability and recovery access

- Package rollback reproduced overwriting unexpected bytes; immediate rollback now validates the same exact states as restart recovery and retains conflicts.
- Machine activation/removal previously used an unjournaled rollback that lost an original folder BOM. Reuse the existing file transaction with size preflight and exact originals, including interrupted retries.
- Preference saves could select a removed machine from a stale tab and make the catalog fail reopening. Validate against authoritative libraries under lock and use the existing file journal, preserving stale-manifest rejection and unknown conflicting bytes.
- A valid package with 120 referenced evidence files produced a 51,125-byte report, exceeding the agent response budget. Add complete versioned report reading and evidence continuation; preserve explicit summaries and receipts.
- At 640 × 800, four baseline project rows overflowed the library into import controls (last row bottom 639px versus library bottom 541px). The browser regression failed before fixing automatic grid row sizing. Compact project rows now emphasize names and actions, retaining paths in the name tooltip/search.
- Settings navigation occupied about 220px on a compact viewport. Compact navigation now shares rows; duplicate storage metadata is consolidated and backup controls precede advanced storage inspection. Focus and native download behavior are exercised in browser tests.
- Removed one CSS-class-only layout test after a real browser regression demonstrated its protected intent more directly. Existing keyboard/storage/settings tests remain intact.
- Independent review complete for integrity, preferences, agent reports and UI. Final unit/integration suite: 200 files / 1,989 tests pass with four workers; Chromium: 84 pass and one optional case skipped. A concurrent unbounded run hit timing failures and was stopped; bounded verification passes without relaxed assertions or timeouts.
- A separate managed worktree, `improve/responsive-dxf-import`, implements cancellable CPU work. A bounded 5,000-line/164 kB drawing showed seconds of planning on the main thread; measured duration varies under parallel test load. Keep this scope in the next PR.

## Completed branch cleanup

Remote refs were deleted with leases pinned to these tips after every tip passed the ancestor check against `origin/main`. All commits remain reachable from main. No experiment, deployment history or unrelated worktree was removed.

| Former remote branch | Retained commit |
| --- | --- |
| `codex/post-processor-architecture` | `a52bf467896c9ba16c5516712fea4578af606183` |
| `feat/post-compatibility-and-agent-documentation` | `599e25fdaef948bc71ee13dc8e3b0e78d6a31316` |
| `feat/upid-simulation-workbench` | `188b1bdeda9a8a2d344fe1f4d16fd98153be1112` |
| `fix/compensation-wording-startup-recovery` | `469d0e11158ff660c3099e426ba5af143d36f8b4` |
| `refactor` | `e29927ba02974bdee84faf27a5dfe4784e570ff9` |

The completed improvement branches `improve/workbench-reliability` (`a9bdbad`) and `improve/responsive-dxf-import` (`7b560b3`) were also removed locally and remotely after their merged ancestry was verified against `56fad6e`, using exact remote-tip leases. Active improvement worktrees remain in use. Both merged releases completed deployment successfully.

## Checkpoint 3: editor and agent state

- Apply versus Save is explicit in workflow controls, transitions, help and accessibility labels. Closed-path markers and keyboard tree focus are readable. Existing persistence, undo and external-program/UPID round trips remain covered.
- Final save/open/setup guards reject cancelled or stale work; started journals retain truthful outcomes. Both agent context surfaces agree on busy state. Setup activation refreshes the matching authoritative post library without weakening stale-manifest checks.
- Valid large machine/setup records now have complete version-pinned discovery and exact detail reads. Explicit omissions preserve status, hashes and evidence; bounded retained serialization avoids accumulating copies of every large setup.
- Independent reviews caught and resolved two introduced UI/receipt regressions before publication. Final local verification: 204 files / 2,041 tests; 86 Chromium cases pass, one optional preseeded case skipped; type/build/docs/post/package checks pass. Native in-app production WebMCP discovery and visible activity are verified.

## Checkpoint 4: hosted recovery

- A failed readable storage source is retained separately from a healthy connection. Startup, Settings and agents share an export operation that does not initialize, repair, rewrite, delete or execute posts.
- Exact logical text and diagnostics have bounded reads, explicit whole-file omissions, source identity, per-file/serialized-archive hashes and non-atomic coordination metadata. This is a distinct evidence format, not a validated restore backup.
- Cache and folder adapters cover oversized/invalid/compressed text without unbounded decompression fallback. Missing write access or Web Locks does not make readable cache evidence inaccessible; ordinary mutation restrictions remain intact.
- Source switch, cancellation, workbench identity and live agent busy guards apply before capture/download. A retained receipt retries the exact captured download. Integration review reproduced and fixed a busy-state gap during agent DXF preparation.
- Original source and integration independently reviewed; 200 focused integration tests pass. Existing native corrupt-cache/download acceptance passes at desktop and compact sizes, preserving actual original strings and archive hashes. Final merged-base verification is recorded in the review and release record.

## Checkpoint 5: measured startup and verification efficiency

- Typed optional services defer package preparation/installation, artifact generation and revision deletion; stored integrity validation and recovery remain eager. Pure package limits/freshness checks retain compatible public exports.
- Matched current builds count every initial static JavaScript import and modulepreload: 943,343 to 884,876 raw bytes and 271,604 to 256,755 gzip bytes (6.2%/5.5% lower). Dynamic/worker/image/CSS/WASM assets are excluded; no startup-time claim is made.
- All 206 files / 2,063 tests remain selected exactly once. The 42 pure Node files preserve the same 346 test identities; the remaining 164 files / 1,717 tests keep their browser environment. No test source or threshold changes in this checkpoint.
- Final full suite, app/tooling types and production build pass. Five cold native workflows cover actual DXF workers/cancellation, complete package installation and saved output, plus blocked recovery download. Independent source/integration review verifies retained guards, receipts and eager validation.
- The application-wide review records inspected modules, retained tests, measured outcomes and remaining route-sensitive optimization, recovery and hardware-verification limits. No additional feature or branch-cleanup work is hidden outside this ledger.
