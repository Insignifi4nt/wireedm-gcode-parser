# Arc-stop and numerical calculation corrections

## Scope and authorization

This local follow-up starts at `6a7771d` on branch `fix/arc-stop-numerics-2026-10-11`. The preceding repository audit remains recorded separately. The user explicitly authorized corrected arithmetic without retaining historical arc calculations, requested complex contour regression tests, and asked for further supported calculation fixes and measured optimizations.

No deployment, push, merge, remote workflow, shared database operation, dependency update, credential change or historical file rewrite is part of this change. App release `0.0.696` remains unchanged until a reviewed release. New saved revisions and artifacts record calculation engine `3`; post engine API `1` and persisted schema numbers remain unchanged.

## Confirmed defects and corrections

| Subsystem | Evidence and correction | Compatibility and risk |
| --- | --- | --- |
| Remaining-cut stops | A radius-1 arc with sweep `1e-16` produced split parameter `0.4853028997290862` instead of `0.5`. Endpoint-angle reconstruction is removed. The resolver returns the accepted source segment and parameter together with the point. Compiler source ranges use that same location. | Circular source ranges, stop points and plan hashes can change. No old-arithmetic fallback is retained. |
| Mixed contour distances | A one-millimeter line followed by a `1e-16` arc lost its halfway stop when subtracting the remaining distance from the whole contour. Resolution now walks backward using the remaining distance directly. | Stops use active accepted geometry. Exact internal joins remain supported. An unrepresentable whole-contour boundary stop is explicitly rejected instead of omitting a complete circle. |
| Source boundaries | Reversed rounded contours generated a source range below zero followed by a forward fragment at a join. Linear interpolation could also replace an exact stored line endpoint with zero. Shared stop locations and exact endpoint handling preserve bounds, direction and identity. | Event shapes and vocabulary remain unchanged. Internal location metadata is not serialized into execution events. |
| Circles and partial ranges | Circle sampling ignored the selected start point. Radius-`1e14` sampling introduced a `0.006123` mm start displacement and `0.012246` mm half-turn residual. Circle stops, clipping and approximation now use the existing exact-start rotation calculation. | Existing geometry is retained. Corrected derived endpoints and sampling can change output and displayed geometry. |
| Simulation and clearance | A one-millimeter shallow arc played back at midpoint `x=0.0979693` instead of `0.5`. Absolute angles also extended a cut beyond its endpoints, and subtracting large radii hid a `0.1` mm transverse offset. Stable endpoint displacement and radial-distance identities fix these cases, including rotated and overflowing radial products. Shared rotation multiplies the radial component before squaring a tiny sine, preserving a radius-`1e200` arc's analytic midpoint sag. | Playback and obstruction warnings can change. Simulation remains an approximate analysis, with its existing assumptions. |
| Continuous wire state | Simulation treated continuous positioning as unthreaded because the transition's dormant separation field said `already-separated`. The pre-separated condition now applies to noncontinuous transitions. | Compiler manufacturing events remain unchanged. Continuous-wire positioning and clearance warnings now reflect `wire-continue`; manual pre-separated positioning remains unthreaded. |
| Controller audit | Valid shallow-arc subdivisions were rejected, while a `0.1` mm transverse detour could pass because large radius subtraction lost the discrepancy. Simulation and auditing share the same stable angle and radial-distance functions. | Audit acceptance and rejection can change. No tolerance is widened. Exact post formatting and installation remain authoritative. |
| Transformations and tangencies | Twelve-decimal coordinate rounding turned rigidly transformed tangent joins into crossings. Rotations and reflections retain precision, with exact cardinal and identity handling. An exact declared arc endpoint with a bounded local radial residual supplies one quadratic root. Endpoint-anchored factorization retains the second root, including a real ten-millimeter crossing on a large 3-4-5 circle. | Newly transformed coordinates can differ. Existing saved coordinates are not rewritten. No coincidence tolerance is widened and adjacent segments receive no crossing exemption. |

## Performance evidence

Simulation polyline sampling previously recalculated sweep and radius for every interior point. The corrected sampler computes its sweep and radial displacement once per motion.

The final local Node `22.23.2` benchmark uses 10,000 semicircles, three warmups and seven measured runs. Median time is `305.897 ms` before and `43.874 ms` after, about seven times faster. The measured ranges are `301.405–315.915 ms` and `42.659–45.143 ms`. This is a sampler benchmark, not a claim that the whole application is seven times faster.

For 100 ordinary angle/direction/center/sweep combinations, corresponding continuous interpolation points differ by at most `1.61e-13 mm`. Five quarter-arc cases gain one polyline sample because corrected sweep calculations cross the existing ceiling threshold. Source endpoints and the angular sampling rule remain unchanged. Benchmark scripts and measurements are retained under ignored `tmp/arc-stop-2026-10-11/numerical-audit/`.

## Saved jobs and recovery limits

Affected engine-1/2 snapshots fail exact corrected canonical-plan validation. Their bytes, hashes and installed packages remain untouched. Compatible historical snapshots still pass their original hash checks. Unknown engine versions remain rejected; older engine-1/2-only apps cannot read new engine-3 revisions.

An active editable project can create a separate reviewed engine-3 revision through **Generate controller artifact**. This recovers machining, but does not migrate immutable historical revisions or restore their reproducibility. Verified backup, backup restoration, historical inspection and Snapshot JSON loading validate indexed snapshots. An incompatible retained revision therefore still blocks those operations. Trash restoration reports the underlying diagnostic and retains the files. The hosted compatibility guide and candidate checklist explain these limits.

Automatic migration is deliberately omitted. Rewriting a plan would change its hash and potentially post-owned controller output; rewriting the stored hash would erase the historical claim. A broader archival or migration workflow requires a separate storage design and tested user action. No originals are deleted to make validation pass.

## Regression coverage

New tests establish failing cases before their fixes. They cover tiny sweeps, huge radii, reversed source ranges, exact joins, mixed scale, clockwise and counterclockwise traversal, disabled and unordered stops, transformations, partial cuts, circles and nearly full arcs. The 18-case complex contour suite checks public compilation, editor source traces, simulation lengths and pauses, nonmutation, multiple operations and leads, installed Robofil output, serialization, and rejection of corrupted circular output.

Browser-cache and folder saved-job tests preserve exact BOM/CRLF historical originals while creating a separate engine-3 revision. Historical canonical mismatch is tested even when the original stored execution-plan hash is internally consistent. Trash restore validates errors without performing writes or deletions on failure.

## Final local validation and review

| Local validation | Result |
| --- | --- |
| Full Vitest suite, four workers, without a concurrent build | 225 files and 2,553 tests passed. This adds 83 tests across five new files and existing suites relative to the preceding audit. |
| Chromium end-to-end suite, two workers | 96 passed in 2.9 minutes; one existing optional seeded-workbench test skipped because its external local fixture folder is unavailable. Playwright used its configured port `3107` and stopped its server afterward. |
| TypeScript and production build | Passed. Documentation build produced 27 pages and checked 87 source files. Both third-party archives were verified from the existing local cache; no dependency was downloaded. |
| UPID conformance | All three published V1 examples passed, including partial and compensated circles. |
| Post conformance | Minimal post: two fixtures passed. Installed Robofil 100 V2 post: three fixtures passed. |
| Machine package validation | Robofil package `2.6.0` passed with SHA-256 `48bcc0bdf14c197495fd0933b62173d22d598f4d71ae2ca861d0dd2245acde62`. |
| Authoring documentation, release record and whitespace | `post:docs:check`, `release:check` and `git diff --check` passed. App version remains `0.0.696`. |

The first full Vitest run, concurrent with the build, passed 2,552 tests and failed one existing all-line sanitization performance-ratio guard: approximately `8.19`, against a limit below `8`. The unchanged six-case performance suite passed in isolation, and the complete suite then passed without the concurrent build. Contention is the supported explanation, but timing remains environment-dependent. No assertion, tolerance, timeout or type check was weakened.

Fresh independent specification and standards reviews compared the complete candidate against `6a7771d`, including new files. Review exposed four further cases: collapsed full-circle stops, a tangent proposal that hid a real second crossing, underflow in tiny-sweep rotation, and missing historical compile-failure recovery guidance. Each was corrected and regression-tested. Both final reviews reported no remaining actionable findings. Their public-API numerical probes supplement the broad suites; the reviewers did not independently rerun the entire browser suite.

No physical controller has been run, and browsers other than Chromium are outside this validation. Existing bundle-size, optional-module externalization and dynamic-import build warnings remain. There is no standalone lint command; strict TypeScript, domain and browser tests, conformance and documentation checks provide the available static and runtime gates. Passing these checks does not establish absence of all numerical or application defects.

Historical migration and archival/export recovery remain deliberate follow-up work because they require a storage design that preserves exact originals and validates interruption/retry behavior. Broader numerical rewrites and unmeasured optimization proposals were not implemented. The [preceding repository audit](2026-10-11-autonomous-codebase-audit.md) and [adversarial review](2026-10-11-adversarial-codebase-audit.md) remain the records for unrelated deferred opportunities.

## Local delivery

Implementation is recorded in local commit `fef38c9`. All implementation, fixtures, conformance runs and browser validation stayed local on `fix/arc-stop-numerics-2026-10-11`. Main remains at `3e3fce9d06a0911898826e893af324951c00f7cf`. Installed fixture/package bytes, package locks, app release files and credentials were not modified. The task's diagnostic scripts and logs remain ignored under `tmp/arc-stop-2026-10-11/`. No deployment, push, merge, PR publication or remote workflow was performed.
