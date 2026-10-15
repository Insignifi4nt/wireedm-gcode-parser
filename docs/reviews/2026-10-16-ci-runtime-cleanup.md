# CI runtime and React test warnings

## Findings

The screenshots contain test-environment warnings, rather than production build
errors. Both exact warning patterns reproduced locally with Node 24.22.0 and the
existing polygon-property and preview-selection tests:

```powershell
npx vitest run src/features/editor/__tests__/EditorPreviewSelection.test.tsx src/features/cad/CadPolygonVertexFields.test.tsx
```

The five existing cases passed in 2.91 seconds but emitted 46 missing-act-environment
warnings and three unwrapped Tooltip update warnings. The output is retained in
`tmp/ci-warning-baseline.log` for this checkout.

The missing shared `IS_REACT_ACT_ENVIRONMENT` flag caused the first pattern. Adding
the flag in the jsdom setup removed those 46 warnings while leaving the three
Tooltip warnings visible. Two direct focus calls in the polygon test caused those
remaining updates. Running those real focus events inside React's async `act`
removed the warnings. The same five cases passed in 2.86 seconds with no warning
matches. No console filter, Tooltip mock, or assertion removal was used.

This follows [React's act guidance](https://react.dev/reference/react/act), including
its shared test-environment flag and event-update boundary.

The completed GitHub log exposed the same lifecycle issues in other existing
cases. Across the icon preflight and full unit run there were 146 environment
warnings and 25 unwrapped updates. The latter came from direct focus events,
an undo operation, and deferred CAD build completion while a large-save test
awaited exact-original verification. Those existing actions now settle inside
`act`; assertions and coverage remain intact. The final focused run covered all
17 affected cases across nine files in 9.69 seconds with no act-warning matches,
recorded in `tmp/ci-all-warning-repros-fixed.log`.

## Measured costs and changes

GitHub review run [38812231394](https://github.com/Insignifi4nt/wireedm-gcode-parser/actions/runs/38812231394)
separately recorded:

| Step | Time |
| --- | ---: |
| Complete unit suite | 284 seconds |
| Production build, types, public docs and pinned source distribution | 38 seconds |
| Icon checks | 8 seconds |
| Chromium installation | 22 seconds |
| Chromium journeys | 6.2 minutes, 124 passed and one existing skip |

That review run completed successfully. Its long serial test phases explain the
elapsed time; the actual production build was 38 seconds. The completed job log
is retained locally at `tmp/ci-pr13-job.log`.

PR verification now runs unit/contract checks alongside the production-build and
browser job. The existing `verify` gate requires both jobs to succeed, including
when one fails or is skipped. Every existing suite remains scheduled. This avoids
placing the roughly 4.7-minute unit phase ahead of the roughly 6.2-minute browser
phase on the same critical path. The earlier serial run took about 12.5 minutes.

The Pages deployment repeated the complete unit suite and the UI/icon/post-doc
preflights after the reviewed PR. Deployment now retains the release check and
the real production build. The PR still runs every existing unit test, browser
journey, UI/icon contract, post conformance and package validation. The ordinary
build still builds the icon package, type-checks the app, checks its generated
public docs and distributes the pinned native sources.

Playwright also rebuilt Vite immediately after the CI production build. CI now
sets `PLAYWRIGHT_USE_EXISTING_BUILD=true` and tests that built `dist` directly.
Ordinary local Playwright runs retain their separate `tmp/playwright-dist` build,
so an active development build cannot replace files underneath a test.

The 38 CAD geometry/schema suites in `src/domain/cad/__tests__` were also running
with a separate jsdom environment per file despite having no DOM dependency. A
matched local benchmark with two workers kept all 572 assertions:

| Environment | Cases passed | Time |
| --- | ---: | ---: |
| jsdom | 572 | 24.81 seconds |
| Node | 572 | 22.31 seconds |

Those suites now belong to the existing pure-domain project. CAD storage tests
outside that directory remain in jsdom and retain their browser-cache and folder
adapter coverage. No isolation setting was weakened. See Vitest's
[performance guidance](https://vitest.dev/guide/improving-performance) on unnecessary
DOM setup costs.

The final integrated run exposed one further duplicate: `uiControlStandards.test`
rescanned the entire production source tree even though the explicit `ui:check`
PR gate runs the same checker against the same tree. That scan timed out at
5.013 seconds under parallel suite load. The duplicate unit case was removed.
All six focused parser/fixture cases remain, as does the complete production-tree
CLI gate. No geometry, persistence or interaction coverage was removed. The
longest CAD cases in this sample exercise realistic capacity and exact-source
preservation.

The retained six checker cases pass in 58 milliseconds and the full `npm run
ui:check` passes separately. The final integration log also contains zero matches
for either React act-warning pattern. Its unrelated route assertion failure is
handled in the parent navigation work.

## Scope and limits

The runtime changes are confined to test setup, existing test lifecycle calls,
test-project classification, Playwright build selection and CI workflow composition. They do
not alter geometry, storage formats, saved revisions, machine packages or post
processor contracts.

The local warning reproduction and matched environment timings are measured.
The next CI run must establish the new total wall-clock duration. Removing a
duplicate suite saves that scheduled work, but its precise deployment gain still
depends on runner load. Browser journey results and any later final integration
checks belong in the parent PR's verification record.

## Local worker contention

A later complete run exposed a timeout in the existing large-original storage
cancellation/retry case. The full run used the installed Vitest default of one
worker fewer than available logical CPUs. On this 32-CPU host that meant 31
workers concurrently running jsdom, native kernels and large JSON operations.
The critical browser-cache case timed out at 5.021 seconds.

The same storage suite passed all 24 cases in isolation in 10.27 seconds. The
critical case took 1.526 seconds in browser cache and 0.559 seconds with the folder
adapter. These timings point to contention under the default worker count,
instead of a storage operation that hangs in isolation.

Vitest now uses at most four workers, or the host's available parallelism when
smaller. Tests retain isolation, all existing assertions and their original
timeouts. The storage cancellation/recovery case is unchanged. CI still runs the
same coverage, and smaller runners do not inherit a many-core desktop's worker
count. Process inspection during the run confirmed exactly four Vitest workers.

The complete bounded run passed all 398 files and 4,175 cases in 155.56 seconds,
with no React act-warning matches. Its log is
`tmp/project-navigation-all-tests-bounded.log`. This is slower than the unreliable
58-second many-worker run on this desktop; the cap is a resource/reliability fix.
CI's overall time savings come from concurrent verification jobs and eliminating
duplicate deployment tests and browser rebuilds. No cancellation, recovery or
large-original capacity assertion was removed or given a longer timeout.
