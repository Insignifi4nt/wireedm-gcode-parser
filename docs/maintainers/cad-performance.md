# CAD performance baseline

`npm run cad:benchmark` measures the CAD kernel and sketch solver on fixed workloads and writes JSON reports to `tmp/cad-benchmark/`. Add `-- --quick` for a shorter run or `-- --runs N` to change the sample count (a positive whole number, default 7). `-- --group legacy` selects the original kernel, solver-scaling and drag-preview groups; `-- --group solver-workloads` selects the public-boundary PlaneGCS/native comparison below. The default, `-- --group all`, runs both. No browser or dev server is needed. Use it before and after a change that claims a speed or memory improvement, and record both reports in the pull request.

## Workloads and correctness

`src/features/cad/benchmark/cadBenchmarkCases.ts` defines the workloads. Kernel cases are complete documents with edit steps and analytic expected volumes. `cadBenchmarkCases.test.ts` builds every step in the normal Vitest suite, so a case that stops producing its analytic geometry fails CI instead of producing misleading timings. The script also marks such a step `INCORRECT` and exits non-zero.

| Case | What it isolates |
| --- | --- |
| `plate-hole-pattern` | Ordinary sketch, extrude, linear pattern and boolean cut; the width edit invalidates every feature. |
| `gear-and-plate` | A gear plugin profile (hundreds of faces) beside an independent holed plate. The plate edit rebuilds the unchanged gear. `affectedBodies` is the plate alone, with its unchanged hole pattern, and has its own analytic volume. |
| `box-fillet-all-edges` | Rolling-ball fillet of all twelve box edges and a radius edit. |

Solver workloads are independent, fully constrained rectangles (4 lines and 7 relations each). The connected capacity workload instead places each rectangle by two axis distances from the previous one, so all rectangles form one solver group. The drag preview uses documents with 1, 4 and 8 independent graph sketches of 10 rectangles. The first rectangle of the first sketch has its fixed corner released, and one corner move is prepared through `prepareCadEdits`, as a sketch drag preview does. The suite checks that the rectangle follows the drag and that every other sketch is unchanged. A dependent workload adds a second sketch that uses the first rectangle's bottom edge. It drags the referenced rectangle, which must re-solve the dependent, and a second released rectangle, which must not.

## Metrics

- `buildMs`: uncached `buildCadKernelModel` of the full document. `coldMs` is the first build of the first step in a fresh module.
- `shippedEditMs`: the previous step followed by this step through `createCadKernelRuntime`, which caches only a whole document.
- `affectedBodiesMs`: uncached build of only the bodies the edit changes, including unchanged inputs they need. It is sampled alternately with `shippedEditMs` so both see the same clock speed. A rebuild that reuses unaffected bodies should take no longer than this; it can be faster by also reusing unchanged inputs.
- `payload`: triangles, plain-array numbers and JSON size of the build result that crosses the worker boundary.
- `mainThread`: `structuredClone` of the reply, `isCadKernelReply` validation and `prepareCadMeshDisplay` for every mesh. The app pays these on the main thread for each build.
- `memoryBytesAfterRebuilds`: OpenCascade linear-memory capacity after 1, 10 and 50 edits through one shipped runtime, alternating the case steps so each edit replaces the cached model. WASM memory grows but never shrinks, so this is a high-water mark. Each case runs in a fresh OpenCascade module, so its numbers do not depend on the cases before it.
- Solver `scaling`, `drag`, `dragPreview` and `capacity`. Each drag preview reports `solvesPerPreview` (solver calls for one preview), `prepareMs` for the whole preparation and `solverCallMs` for the solver calls inside it (constraint compilation, the native solve and reply validation); the difference is document parsing, reference refresh and checks. PlaneGCS has fixed linear memory and aborts with OOM, so capacity uses a fresh module per size. It probes independent and connected rectangles separately, records each size's native parameters and constraints, and reports the largest rectangle count that solved and the first that did not, with its rejection reason.
- `cpuCalibrationMs`: a fixed JavaScript loop timed before and after each measurement group: full builds, edits and main-thread work for each kernel step, and each solver size, the solver drag and each drag-preview size. Laptops reduce clock speed under sustained load; the development host below ran the same loop 3.5 times slower after about three seconds. The script marks a group `THROTTLED` when its calibrations differ by more than 1.5 times and warns when they do across the run. Use only unthrottled groups, compare groups with similar calibration, and never compare across hosts.

## Baseline

App 0.0.736, Node 24.22, Intel Core i9-14900HX laptop on the Balanced power plan, 7 runs. Every measurement group was bracketed at 57 to 84 ms of calibration, so none was throttled.

| Measurement | Result |
| --- | --- |
| OpenCascade WASM | 23.0 MB, 7.3 MB gzip, 86 ms initialization |
| PlaneGCS WASM | 0.5 MB, 0.2 MB gzip, 21 MiB fixed linear memory, 5 ms initialization |
| occt-import-js WASM (machine STEP import, lazily loaded) | 7.6 MB, 3.1 MB gzip |
| Gear and plate, plate width edit (shipped) | 456 ms p50; the plate alone builds in 65 ms (7.0 times headroom) |
| Gear and plate build result | 5792 triangles, 1.1 MiB JSON; main-thread clone, validation and display preparation 2.4, 0.6 and 2.2 ms |
| Holed plate, width edit (shipped) | 63 ms p50 |
| Box fillet, all edges, radius edit (shipped) | 37 ms p50 |
| OpenCascade memory after 1, 10 and 50 edits, fresh module per case | holed plate 100, 100 and 127 MiB; gear and plate 199 MiB throughout; box fillet 100 MiB throughout |
| Solver warm solve | 1 rectangle 0.5 ms, 10 rectangles 2.7 ms, 40 rectangles 9.3 ms, 60 rectangles 17 ms |
| Drag preview, one corner move | 1 sketch: 1 solve, 4.1 ms; 4 sketches: 4 solves, 16 ms; 8 sketches: 8 solves, 30 ms |
| Solver capacity, fresh module | 80 rectangles solved; 100 rectangles aborted with OOM |

## Findings that set the order of work

1. Drag previews re-solve every graph sketch in the document, so preview cost grows with unrelated sketches.
2. PlaneGCS aborts on a few hundred constrained entities because its memory cannot grow; the worker reports the raw abort text and restarts. Measured with one solver group, the abort depends on unfixed parameters times constraints: 760 x 760 solved and 800 x 800 aborted for independent rectangles, while a connected chain solved 800 x 800 and aborted at 1000 x 1000.
3. Every edit rebuilds every feature. Unchanged expensive bodies dominate edits of cheap ones. OpenCascade memory already grows from 100 to 127 MiB between the 10th and 50th edit of the holed plate, so a feature cache must show no more growth than that over the same 50 edits.
4. Build results cross the worker as plain arrays (1.1 MiB JSON for 5.8k triangles) and are validated and prepared for display again on the main thread. That costs about 5 ms a build here, so it is a payload and memory cleanup, not the main latency.

Proposed order: solve only edited sketches and their reference dependents, then solve independent sketch components separately with a clear limit message; incremental feature rebuilds keyed by a chain hash with bounded memory after 50 rebuilds as a gate; typed-array transfer with display preparation in the worker. Rust or kernel replacements are considered only where this benchmark shows the remaining time is inside the native kernel or solver.

## Measured changes

Each row compares runs on the same host whose compared groups were bracketed at 57 to 67 ms of calibration.

| Version | Change | Before | After |
| --- | --- | --- | --- |
| 0.0.737 | Preparation re-solves only edited sketches and the reference dependents whose refreshed references changed | Drag preview with 8 sketches: 8 solver calls, 28.6 ms (14.8 ms in solver calls); dependent workload, unreferenced drag: 2 calls, 8.1 ms | 8 sketches: 1 call, 16.6 ms (2.1 ms in solver calls); unreferenced drag: 1 call, 6.2 ms; referenced drag still 2 calls, 8.5 ms |

| 0.0.738 | Each connected group of relations solves in its own native system; groups without relations skip native code; one group above 500,000 unfixed parameters times scalar equations is rejected as too large before native code runs | Independent rectangles: 80 solved, 100 aborted with OOM; connected chain: 100 solved, 125 aborted | Independent rectangles: 400 solved (largest probed); connected chain: 88 solved, 89 (712 x 712) rejected as too large without an abort. Warm solve of 60 rectangles 30.3 ms before and 22.9 ms after, and drag previews unchanged within noise, from a pair of runs equally throttled at 115 to 150 ms of calibration |

The limit stays about a fifth below the smallest measured abort, so a connected group of 89 to about 100 fully constrained rectangles, which solved before, is now refused with a message instead of risking an abort.

After 0.0.737, most of a drag preview with several sketches is the final `parseCadDocument` of the prepared document: about 13.5 ms for the 8-sketch workload, because the boundary parser clones and validates every feature again even when only one sketch changed.

## Native sketch solver (in progress)

`packages/sketch-solver` is our own Rust constraint solver, compiled to an 81 kB WebAssembly module (29 kB gzip) with no dependencies. From 0.0.739 it is built, tested and compared with PlaneGCS, but the app does not load it yet.

- `compileCadSketchEquations` turns a sketch into scalar parameters and twelve kinds of scalar equation, and the module solves them.
  - Each connected group of unknowns gets its own damped Gauss-Newton solve, with exact gradients from dual numbers.
  - Each equation is divided by its gradient norm over the unknowns, so every residual reads as the distance they must move.
  - Each step comes from a Givens QR of the weighted Jacobian, not the normal equations, so roundoff does not move the free directions of an under-constrained sketch.
  - From 0.0.740 the QR is sparse:
    - Rows keep their authoring order. Columns take a minimum-degree order fixed by the structure, so a chain of profiles fills like a band.
    - Each damping trial refactors from `sqrt(mu) I` and then rotates in the Jacobian rows. A row meeting a diagonal-only row carries on with only its own entries, so most rows stop near their own length. Rotating the damping in after the Jacobian, as MINPACK does, would run each damping row down the whole elimination tree: about 300 million updates per trial for a 5,000-link chain.
    - In that order, the motion along directions the Jacobian leaves free depends on roundoff whenever dependent rows disagree within a step. Conflicting relations always do. Redundant ones also do before the solve converges, when their linearizations are different functions of the same motion: an angle of 90° plus a perpendicular relation on the same lines, far from the origin, moves a free midpoint by about 0.4 µm. The same relation entered twice does not, because its rows agree exactly. Both kinds of sketch are rejected by diagnosis. From 0.0.742 rows dependent at the start stay out of the first solve, which removes this drift (see below).
    - For sketch-like structure, where profiles join in chains and trees and shared parameters such as a radius are eliminated last, time and memory grow about linearly with the size of a group. A group whose columns are all coupled at random fills almost completely, as in a dense factorization.
  - Native code cannot be interrupted, so each group has limits:
    - The ordering gives the exact fill of the factor before any numeric work. A group above 2,000,000 entries (about 32 MiB) is left in place. The ordering stops as soon as the fill so far, plus the edges still present and the diagonals still to come, passes that limit, so its own memory stays within about twice the limit.
    - The ordering, and every rotation after it, count the entries they write against 400,000,000. Rotations check the count before every step, so a group stops within one step of the limit, where it got to.
    - In a native probe, random groups of 2,000 to 4,200 unknowns whose factors would be dense are refused in under half a second.
    - Either reports `too-large`. This replaces the PlaneGCS limit of 500,000 unfixed parameters times equations, which a chain of 89 rectangles already exceeds.
  - Convergence is judged apart from that weighting:
    - each residual must be within the driver tolerance in millimetres;
    - each direction error must be within 1e-12 radians, or the roundoff of its coordinates at the far end of the longer line.
  - The solver status only reports convergence of its own equations. As with PlaneGCS, the graph checks decide whether a result is accepted, including degenerate lines, angle sectors and the distance between collinear segments.
  - Iteration continues to roundoff, because the graph checks require coincident points to agree within 8 ulp of their coordinates.
- From 0.0.742 the module diagnoses every solve, as PlaneGCS does (`src/diagnose.rs`, wire protocol 2):
  - Each equation carries the tag of its source constraint (coincident, midpoint and symmetric relations have two equations) and a temporary flag for drag targets, which are solved but not diagnosed.
  - **Rows dependent at the start.** Before each group is solved, its lasting rows go into a rank-only factor at the input values. Rows within `TAU = 1e-10` of the span of earlier ones (once each row has unit norm) stay out of a first solve. That result stands if every row is then accepted. Otherwise the group is restored and solved with every row, sharing the 100 iterations and the work limit. Unclear rank or an exhausted budget solves every row.
  - **Diagnosis at the result.** Rows go in authoring order into an undamped sparse factor in the solve's column order. A dependent row gets a witness: the earlier rows that reproduce it, by seminormal equations, verified by reconstruction. A witness agrees when the same combination of residuals is within the rows' acceptance tolerances. A lead between `TAU` and `1e-7`, or a smallest singular value estimate below `1e-7`, makes rank unclear and the diagnosis `unavailable`.
  - **Labels.** Each witness sets aside one equation: one of the constraint with fewer equations, then of the later constraint, then the earlier equation. Witnesses of one constraint can lie in different groups, as with the two axes of a coincidence, so this runs across all groups. An equation set aside whose witnesses all agree is redundant; every constraint of a witness without a redundant equation conflicts. TypeScript maps the label bits to source ids, including partial redundancy. Degrees of freedom are the unknowns less the rank, reported only without conflicts.
  - **Stalled conflicts.** The nearest point of a conflicting sketch often collapses geometry, as a triangle too long for its sides flattens. Gauss-Newton approaches it only linearly and stops about `sqrt(epsilon)` short relatively, where rank at `TAU` is unclear. A group that did not converge and whose rank is unclear is diagnosed again with dependence at `1e-6` (`STALLED`), with the singular value gate unchanged. Such a diagnosis is `suspected`: it reports conflicts only, with no freedom. A row near a conflict without being in it can be blamed too, and a satisfiable sketch stuck at a stationary point is blamed as conflicting. The application message for it is "could not be met together from this start".
  - **Nothing free.** With no unknowns, relations that are not met conflict and met ones are left unlabelled.
  - Large conflicting groups can still stop at the iteration limit far from their collapsed nearest point. They are then diagnosed there, usually with no ids, as PlaneGCS does at its start; an 11-point chain is diagnosed and a 31-point one is not.
  - Compared with PlaneGCS on every solve in the differential suites (409 diagnosed), 394 results are identical in freedom and conflicting, redundant and partially redundant ids. Four are reviewed differences: three where PlaneGCS's unnormalized perpendicular and parallel gradients also blame a line's length, and one where PlaneGCS sets aside the earlier of two collinear relations because it is in more dependencies. Eleven are relations not met with nothing free, which PlaneGCS reports as success and the graph checks reject; native names them. Hand probes found two more PlaneGCS gaps, a midpoint with two horizontals where PlaneGCS blames only one and a coincidence before a midpoint that PlaneGCS calls conflicting although the sketch is consistent.
- The `native-differential` test project runs the real PlaneGCS sketch suites through both solvers. Every compiled input must give the same equations. Every solved sketch must also solve natively and pass the graph checks, and well-constrained sketches must match PlaneGCS within 1e-8.
- Not built yet, in order:
  1. exact elimination of simple equalities;
  2. drag targets;
  3. switching the runtime over.
- A direct probe of warm solves with this module, on the same host and not bracketed by calibration, against the PlaneGCS runtime with its diagnosis:

  | Workload | Unknowns | PlaneGCS | Native, dense QR (0.0.739) | Native, sparse QR (0.0.740) |
  | --- | --- | --- | --- | --- |
  | 10 independent rectangles | 80 | 4.2 ms | 0.4 ms | 0.6 ms |
  | 60 independent rectangles | 480 | 12.6 ms | 1.3 ms | 1.6 ms |
  | 200 independent rectangles | 1,600 | 38.0 ms | 6.0 ms | 4.1 ms |
  | 60-rectangle connected chain | 480 | 42.2 ms | 55.9 ms | 1.4 ms |
  | 88-rectangle connected chain | 704 | 109.2 ms | 171.7 ms | 1.8 ms |
  | 400-rectangle connected chain | 3,200 | rejected as too large | not run | 11.1 ms |
  | 1000-rectangle connected chain | 8,000 | rejected as too large | not run | 34.0 ms |
  | 2500-rectangle connected chain | 20,000 | rejected as too large | not run | 92.7 ms |

  The dense column comes from earlier runs, and differences below a millisecond are within noise. These probes timed native equation solving alone, without the TypeScript boundary. PlaneGCS diagnoses redundant and conflicting relations and degrees of freedom on every solve, and the native solver did not before 0.0.742, so they are not equivalent jobs. Use the calibrated public-boundary suite below for new measurements.
- A start far outside the linear range of an equation can take one long step. For example, a perpendicular line that starts nearly antiparallel can be stretched to a valid but very long solution. A step bound comes with drag targets, where the solution must stay near the start.

## Sketch-solver workloads, step 2c

Run `npm run cad:benchmark -- --group solver-workloads`. A full run takes about two minutes on the development laptop; the recorded run below took 121.7 seconds. It uses seven latency samples, seven 60-frame trajectories, 1000 repeated solves per solver and an adaptive capacity search. `--quick` uses three latency samples and 100 repeated solves; `--runs N` changes latency samples and trajectory count but leaves the full-run memory count at 1000. Capacity always uses three samples per size and searches at most 4096 connected rectangles. Keep the host idle during the run. Reports include Node version, CPU, sample order, all calibration brackets, outcomes, source diagnostics, stage statistics, resource observations and correctness failures. A Markdown summary is written beside the JSON.

`cadSolverWorkloadCases.ts` defines 29 fixtures. `cadSolverWorkloadCases.test.ts` runs each through real PlaneGCS and pins the result kind, rejection reason, DOF, status and diagnostic lists in reviewed snapshots. Accepted graphs must preserve source intent and pass independent graph checks. The die's fully constrained result, free variant and shuffled hub also have explicit geometry/intent tests. Do not update snapshots merely to make a changed fixture pass; explain changed acceptance or diagnosis in the review.

| Fixtures | Job |
| --- | --- |
| `rectangles-10/60/200` | Independent fully constrained rectangles, using the existing perturbed generator. |
| `connected-60/88` | The existing fully constrained connected chain, including the largest size below PlaneGCS's group limit. |
| `topology-open/loop/branch` | A long 99-segment open profile with collinear and equal-length relations, a 64-edge closed loop, and a 63-edge branching tree. |
| `topology-hub`, `topology-hub-shuffled` | A gear-like alternating-radius outline with 63 spokes tied to one center; the identical graph with seeded permutations of points, entities and relations. |
| `die-constrained` | A 30-segment stepped die with fillet and chamfer corners, a tangent capsule slot, equal radii, a shoulder angle, symmetry axis, midpoint and six patterned holes. Perturbed numeric start, DOF 0. |
| `die-free` | Same die with 30% of its axis dimensions removed, plus free geometry, exact expression-owned coordinate text and an external line snapshot. Perturbed start, DOF 21. |
| `redundant-distances`, `partial-coincident-horizontal`, `partial-symmetry-midpoint` | Duplicate scalar equations and partly overlapping multi-equation relations, with mapped source ids. |
| `conflicting-distances/triangle`, `fixed-point-vs-dimension`, `overlapping-conflicts`, `impossible-triangle` | Conflicting dimensions, over-dimensioning, overlapping conflict sets and geometrically impossible distances. First-call totals are time to rejection, including diagnosis where available. |
| `fully-fixed-satisfied/conflict`, each also `-with-free` | Relations on expression-owned coordinates, with and without a separate unknown. |
| `numeric-tiny/far-origin/mixed-scales` | A 0.01 mm height, an offset of 500,000 mm, and tiny/ordinary geometry in one connected group. |
| `tangency-exact/near` | The die at exact tangency and with one slot endpoint displaced 0.00001 mm. |

### Timing and comparison rules

Both adapters implement the existing `CadSketchSolver` interface. Every timer encloses its public `solve(input)`, including boundary parsing, compilation, solving, mapping and the same `cadSketchSolutionMatchesInput` / `checkCadSketchGraph` acceptance. The PlaneGCS adapter uses the current runtime, including connected components, the group-size guard, temporary drag constraints and **always-on diagnosis**. The native adapter uses `compileCadSketchEquations`, `loadCadSketchNativeSolver` and `applyCadSketchEquationSolution`. Neither adapter changes the application's solver selection.

From 0.0.742 native rows are the **full job**: the native adapter maps the module's diagnosis to the same source ids and rejects in the same order as the PlaneGCS runtime, conflicting first, then redundant or partially redundant, then a convergence failure. An unavailable diagnosis is a failure, never a clean result. A suspected diagnosis rejects with its conflicts only and no freedom. `cadSolverWorkloadBenchmark.test.ts` compares every fixture with PlaneGCS; four differences are reviewed, each with the native result the better one: `tangency-near` solves where PlaneGCS fails the graph check, `overlapping-conflicts` also blames the vertical offset, `impossible-triangle` blames all three sides where PlaneGCS gives none, and `fully-fixed-conflict` names the unmet relation. The native compiler refuses drag, so drag is explicitly unsupported, without a fabricated latency. Runs recorded before 0.0.742 measured native solving without diagnosis and are not full-job comparisons.

Each workload has an untimed warmup per solver, followed by paired repetitions in a CPU calibration bracket. The solver order reverses every repetition and the starting order reverses across workloads. Fixtures, edits, cloning, correctness checks and statistics are outside timing. Each workload starts with fresh WASM instances; initialization is outside warm timings. Reusing one PlaneGCS instance across many unrelated workloads caused heap exhaustion before the 88-rectangle chain in an initial probe, even though it solves in a fresh instance. This suite avoids carrying that allocation history between workloads; repeated-instance memory gets its own measurement.

Each fixture measures the first solve and a re-solve of each solver's own accepted graph. Re-solving an already-solved graph approximates diagnosis cost but still includes parse/compile, convergence detection, mapping and validation. It is not an isolated diagnosis timer. Rejected first solves have no already-solved input, so their re-solve rows are skipped. Two edit sequences start from the same accepted PlaneGCS graph for both adapters: slot radius 3 to 3.5 mm, then to 4.2 mm, and adding then removing one released die dimension. Every accepted result feeds the next edit. Failed edits never become the next input.

The connected-die drag releases only the slot radius, then moves its upper-left endpoint through 60 frames with a reversal. Frame 45 targets an unreachable x coordinate; PlaneGCS projects it onto the remaining freedom. Every accepted graph feeds the next frame, including that projection. The report records every target, outcome and target error, frame p50/p95/p99, accepted/projected counts and raw counts over 8 ms. Percentiles use `cadBenchmarkStats` nearest ranks, with the same rule for p99. Seven trajectories give 420 samples; they are measured back-to-back without frame pacing or a rendering budget.

`totalMs` is the public-call total. `stagesMs` partitions it into `parseCompile` (including component preparation), `nativeCall` (wrapper/buffer work, native solve and PlaneGCS diagnosis), `mapping` (diagnostic source ids and geometry), and `validation`. Observer and promise overhead remain in totals; stage medians need not sum to the total median. The bundled PlaneGCS module logs some rejection paths directly to the console, and those paths retain that cost. The suite checks every accepted graph again outside timing and detects input mutation. Zero correctness failures means those geometry/integrity checks passed; diagnosis agreement is checked by the tests above.

Use the existing 1.5-times calibration drift rule. Each workload/edit sequence and drag trajectory group records before/after calibration; capacity pairs also have brackets. Cold resource probes have a separate bracket. A `THROTTLED` group is unsuitable for a latency comparison even if its geometry is correct. Cross-group comparisons also need similar calibration, and cross-host comparisons remain invalid.

### Resource measurements and limits

- Cold probes run in a separate Node process per solver to avoid V8 WASM compilation-cache reuse. They record local file read, explicit `WebAssembly.compile`, instantiation/glue and their sum, plus raw/gzip WASM bytes. OS disk caches are not flushed. Browser/network fetch time, download caching and browser cold startup are unavailable here; a local file read is not a network benchmark.
- Each workload's memory probe uses a fresh instance and records `WebAssembly.Memory.buffer.byteLength` before and after the solve. This is retained linear-memory capacity, a high-water allocation, not live allocator usage. It remains useful when C++ or Rust allocations are freed. Node RSS, JS heap, external-memory and ArrayBuffer deltas are sampled at the call boundaries. GC is uncontrolled and deltas can be negative; they are not attributable peaks. Temporary process-allocation peaks are unavailable while the synchronous WASM call runs.
- The repeat probe seeds an accepted die and re-solves it 1000 times in the same instance. Memory is recorded after 1, 10, 100 and 1000 calls. Independent checks happen outside solving, so process deltas also include checker allocations. This does not measure dragging or a succession of different large workloads.
- Capacity uses connected rectangle chains, three public solves per candidate in fresh initialized instances, and the median total below 1000 ms. Both solvers receive the same candidate, in alternating order within each bracket. It brackets then binary-searches the integer boundary, up to 4096 rectangles. The report retains every acceptance, rejection, calibration and sample. A result at the search cap is a lower bound. A boundary is throttled when the calibrations of its two probes, taken together, differ by more than 1.5 times; it is flagged in the limit and console summary, alongside the largest unthrottled solved probe. Timing noise near one second can move the measured boundary; it is not a product limit. PlaneGCS's 500,000 parameter/equation product guard remains authoritative even when a larger solve might be fast enough. Native capacity includes diagnosis from 0.0.742.

The historical baseline above is unchanged. There is no committed solver baseline JSON to regenerate. New full-run measurements belong in the release-specific table below; retain their JSON/Markdown reports with review evidence.

### Recorded 0.0.741 run

Node v24.22.1, Windows x64, Intel(R) Core(TM) i9-14900HX, seven samples, 121.7 seconds. Full report: `tmp/cad-benchmark/2026-10-25T19-53-10-892Z-solver-workloads.json`, with its adjacent Markdown summary. This is a release-specific record; the historical baseline was not regenerated.

CPU calibration ranged from 62.51 to 258.1 ms, so the host changed speed during the run. An asterisk marks a bracket that drifted more than 1.5 times; exclude those timings from performance comparisons. Other rows are comparable only to their paired solver under similar calibration, not to other rows or the old baseline. The flagged group stays in the record so slow or unstable measurements cannot disappear.

All timings below are public-call p50 milliseconds. Each pair is first solve / re-solve. Native is **solve only, no diagnosis** throughout. S = geometry accepted; R = redundant rejection; C = conflicting rejection; F = convergence failure; I = independent graph-check rejection. An S in the native column does not imply clean diagnosis.

| Workload | PlaneGCS full job | Native solve only, no diagnosis | Outcome Plane/native | CPU before/after ms |
| --- | ---: | ---: | --- | --- |
| rectangles-10 | 2.67 / 2.54 | 2.23 / 1.8 | S/S | 67.6/65.93 |
| rectangles-60 | 12.46 / 11.95 | 10.11 / 8.55 | S/S | 65.78/62.51 |
| rectangles-200 * | 82.44 / 82.04 | 84.55 / 73.77 | S/S | 66.95/144.29 |
| connected-60 | 121.67 / 70.79 | 24.83 / 26.08 | S/S | 146.53/161.49 |
| connected-88 | 297.61 / 162.7 | 39.54 / 36.75 | S/S | 172.78/200.46 |
| topology-open | 40.25 / 19.45 | 16.79 / 11.29 | S/S | 196.74/180.58 |
| topology-loop | 15.73 / 16.24 | 10.58 / 10.16 | S/S | 221.54/175.41 |
| topology-branch | 15.07 / 10.23 | 8.01 / 6.32 | S/S | 170.2/188.53 |
| topology-hub | 9.25 / 9.86 | 7.67 / 8.07 | S/S | 124.35/134.41 |
| topology-hub-shuffled | 15.34 / 13.75 | 13.83 / 11.39 | S/S | 224.71/166.94 |
| die-constrained | 13.45 / 11.25 | 9.89 / 8.91 | S/S | 171.76/244.65 |
| die-free | 9.5 / 8.63 | 8.1 / 6.28 | S/S | 169.12/212.53 |
| numeric-tiny | 1.16 / 0.9 | 0.75 / 0.63 | S/S | 175.21/179.14 |
| numeric-far-origin | 0.67 / 0.51 | 0.42 / 0.35 | S/S | 196.87/150.96 |
| numeric-mixed-scales | 1.79 / 1.87 | 1.68 / 1.07 | S/S | 183.98/161.73 |
| tangency-exact | 9.3 / 8.42 | 7.43 / 6.9 | S/S | 183.27/196.28 |
| tangency-near | 11.3 / skipped | 7.87 / 6.71 | I/S | 179.57/147.37 |
| redundant-distances | 0.5 / skipped | 0.38 / 0.38 | R/S | 191.58/186.28 |
| partial-coincident-horizontal | 0.4 / skipped | 0.36 / 0.29 | R/S | 173.52/202.79 |
| partial-symmetry-midpoint | 0.66 / skipped | 0.45 / 0.39 | R/S | 191.27/200.59 |
| conflicting-distances | 0.47 / skipped | 0.24 / skipped | C/F | 165.41/178.74 |
| conflicting-triangle | 0.59 / skipped | 0.5 / skipped | C/F | 246.1/202.41 |
| fixed-point-vs-dimension | 0.47 / skipped | 0.61 / skipped | C/F | 216.18/176.05 |
| overlapping-conflicts | 0.52 / skipped | 0.46 / skipped | C/F | 194.67/219.77 |
| impossible-triangle | 0.3 / skipped | 0.4 / skipped | F/F | 135.96/128.19 |
| fully-fixed-conflict | 0.17 / skipped | 0.1 / skipped | I/F | 153.11/153.95 |
| fully-fixed-satisfied | 0.22 / 0.23 | 0.29 / 0.25 | S/S | 128.25/151.84 |
| fully-fixed-conflict-with-free | 0.53 / skipped | 0.32 / skipped | C/F | 137.02/159.07 |
| fully-fixed-satisfied-with-free | 0.27 / skipped | 0.22 / 0.24 | R/S | 140.8/167.62 |

| Edit from previous accepted solution | PlaneGCS full job p50 ms | Native solve only, no diagnosis p50 ms | CPU before/after ms |
| --- | ---: | ---: | --- |
| dimension-plus-0.5-mm | 8.63 | 10.66 | 146.49/178.73 |
| dimension-plus-20-percent | 10.37 | 5.41 | 146.49/178.73 |
| constraint-addition | 5.54 | 3.99 | 133.05/165.96 |
| constraint-removal | 5.11 | 4.09 | 133.05/165.96 |

Selected p50 stage timings, also in milliseconds. Each stage has its own distribution, so its median need not add to the total median.

| Workload / solver | Parse/compile | Native call | Mapping | Validation | Total |
| --- | ---: | ---: | ---: | ---: | ---: |
| rectangles-200 / PlaneGCS | 41.64 | 16.45 | 18.88 | 3.62 | 82.44 |
| rectangles-200 / native | 48.97 | 5.7 | 18.01 | 2.96 | 84.55 |
| connected-88 / PlaneGCS | 27.38 | 257.14 | 13.43 | 2.11 | 297.61 |
| connected-88 / native | 20.17 | 5.1 | 9.76 | 1.28 | 39.54 |
| die-constrained / PlaneGCS | 4.92 | 4.53 | 2.54 | 0.91 | 13.45 |
| die-constrained / native | 4.8 | 1.39 | 2.52 | 0.91 | 9.89 |
| dimension-plus-0.5-mm / PlaneGCS | 2.62 | 4.07 | 1.25 | 0.51 | 8.63 |
| dimension-plus-0.5-mm / native | 2.69 | 5.69 | 1.23 | 0.5 | 10.66 |

| Resource / operation | PlaneGCS full job | Native solve only, no diagnosis |
| --- | --- | --- |
| WASM raw / gzip bytes | 484003 / 174403 | 52368 / 19540 |
| Cold local read / compile / instantiate+glue ms | 1.59 / 0.85 / 3.88 | 1.38 / 0.19 / 0.14 |
| Cold sum ms, calibration 70.88/65.25 ms | 6.32 | 1.70 |
| Largest retained WASM capacity across fixture probes, MiB | 21.06 | 1.81, connected-88 |
| Seeded die WASM capacity before / after 1000 solves, MiB | 21.063 / 21.063 | 1.125 / 1.125 |
| RSS / JS heap deltas after 1000 solves, MiB, uncontrolled GC | -0.46 / 32.61 | -1.59 / 25.89 |
| Connected capacity, median under 1 s | 88 rectangles, 292.71 ms; 89 rejected too-large (throttled boundary; largest unthrottled 60) | 1867 rectangles, 977.95 ms; 1868 solved in 1029.93 ms (throttled boundary; largest unthrottled 1867) |
| 60-frame drag, seven trajectories | 16.65 / 20.7 / 28.74 ms p50/p95/p99; 419/420 over 8 ms | Unsupported |

The PlaneGCS capacity boundary bracket was throttled; its largest unthrottled solved probe was 60 rectangles, and 89 is refused by its group-size guard. Each native boundary probe was steady on its own, but the pair ran at different host speeds (calibration 141.64/183.1 ms at 1867 and 237.56/236.26 ms at 1868), so the native boundary is counted as throttled: about 1870 rectangles near one second, not an exact limit. The JSON predates the check across both probes and still reports this boundary unthrottled. All 420 drag frames were accepted and the seven unreachable targets were projected; the drag bracket was 201.56/136.18 ms. The JSON retains raw frame samples and every capacity probe. Process deltas do not establish a leak or allocator live usage. Browser/network cold fetch, temporary process-memory peaks, native diagnosis and native drag could not be measured.

The run produced zero geometry or input-integrity failures. The native solver remains incomplete for the full job here: it accepts the redundant fixtures without diagnosis, reports conflicts as convergence failures and lacks drag. With the sparse solve, the connected chains are much faster at the public boundary: connected-60 takes 24.83 ms against 121.67 ms, and connected-88 39.54 ms against 297.61 ms, where the native call takes 5.1 ms against 257.14 ms for PlaneGCS with its diagnosis. The +0.5 mm die edit is still slower natively, 10.66 ms against 8.63 ms. Where the native call is short, the shared TypeScript stages dominate: rectangles-200 spends 48.97 ms in parse/compile and 18.01 ms in mapping around a 5.7 ms native call, and PlaneGCS pays the same stages.

PlaneGCS reports success and DOF 0 on near tangency before the independent checks reject its arc/tangent residual. Fully fixed satisfied relations are accepted without unknowns, but diagnosed as redundant when free geometry is present. Fully fixed conflicting relations similarly move from graph-check rejection to a mapped conflict when a free unknown is present. Symmetry plus midpoint produces a partially redundant source id; coincident plus horizontal reports the horizontal as entirely redundant. These are pinned observations, not solver changes.
