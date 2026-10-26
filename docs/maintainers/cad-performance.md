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
| 0.0.744 | A sketch graph is validated once per parse: the solver input envelope no longer schema-checks the graph its parser checks again, a graph the parser already accepted (detached, checked again and deeply frozen) is returned as it is, and parsed documents keep their accepted graphs | Die, medians of 300 interleaved Node runs at about 70 ms of calibration: input parse about 1.1 ms; first solve 2.49 ms native, 3.10 ms PlaneGCS | Input parse of an accepted graph 0.01 ms; first solve 1.33 to 1.40 ms native, 1.96 to 2.02 ms PlaneGCS. A graph that is not yet accepted is now checked again after it is detached, which costs a second import-data walk |
| 0.0.745 | Solvers write only solved values into the accepted request graph, after checking that reference snapshots (PlaneGCS) or all fixed parameters (native) came back unchanged; the worker replies with those values (versioned by layout), not a graph to validate again | Die at about 70 ms of calibration: first solve 1.33 to 1.40 ms native and 1.96 to 2.02 ms PlaneGCS, solution application 0.77 to 0.79 ms; reply of 12,131 bytes, cloned and parsed in 1.51 to 1.66 ms; rectangles-200 reply of 212,642 bytes, 43 to 48 ms (those runs ended throttled) | Die first solve 0.52 to 0.54 ms native and 1.12 to 1.17 ms PlaneGCS, solution application 0.025 ms; reply of 525 bytes, cloned and parsed in 0.21 to 0.22 ms; rectangles-200 reply of 6,126 bytes, 1.2 to 1.3 ms |
| 0.0.746 | The native solver answers first; PlaneGCS answers drags and the solves native cannot answer for, and loads on first use. Accepted groups keep their exact start values | Die through the PlaneGCS runtime at about 65 to 75 ms of calibration: first solve 1.13 to 1.23 ms, 0.5 mm dimension edit 2.40 to 2.43 ms, drag 1.72 to 1.78 ms; first answer from a fresh process 20 to 22 ms; 21 MiB of WASM memory | Die through the native-first runtime: first solve 0.65 to 0.69 ms, edit 1.09 to 1.10 ms, drag 1.74 to 1.79 ms; first answer from a fresh process 8.1 to 9.0 ms, first drag after native solves 19 to 21 ms (loads PlaneGCS); 1.19 MiB native memory until a drag or fallback loads PlaneGCS |
| 0.0.748 | The native solver answers drags whose target it reached or projected; PlaneGCS answers only drags native cannot | Die at about 65 to 75 ms of calibration: drag answered by PlaneGCS 1.71 to 1.75 ms; first drag after native solves about 19 ms (loads PlaneGCS) | Drag answered by native 1.48 to 1.59 ms; first drag after native solves 6.2 ms, without loading PlaneGCS |

The limit stays about a fifth below the smallest measured abort, so a connected group of 89 to about 100 fully constrained rectangles, which solved before, is now refused with a message instead of risking an abort.

After 0.0.737, most of a drag preview with several sketches is the final `parseCadDocument` of the prepared document: about 13.5 ms for the 8-sketch workload, because the boundary parser clones and validates every feature again even when only one sketch changed.

## Native sketch solver (in progress)

`packages/sketch-solver` is our own Rust constraint solver, compiled to a 92 kB WebAssembly module (33 kB gzip) with no dependencies. From 0.0.739 it is built, tested and compared with PlaneGCS, but the app does not load it yet.

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
    - The ordering, and every rotation after it, count the entries they write against 400,000,000. Rotations check the count before every step, so a group stops within one step of the limit, where it got to. From 0.0.742 a group's diagnoses continue from the count its solve reached, and a diagnosis that runs out is `unavailable`. Labelling across groups has its own allowance of the same size.
    - In a native probe, random groups of 2,000 to 4,200 unknowns whose factors would be dense are refused in under half a second.
    - Either reports `too-large`. This replaces the PlaneGCS limit of 500,000 unfixed parameters times equations, which a chain of 89 rectangles already exceeds.
  - Convergence is judged apart from that weighting:
    - each residual must be within the driver tolerance in millimetres;
    - each direction error must be within 1e-12 radians, or the roundoff of its coordinates at the far end of the longer line.
  - The solver status only reports convergence of its own equations. As with PlaneGCS, the graph checks decide whether a result is accepted, including degenerate lines, angle sectors and the distance between collinear segments.
  - Iteration continues to roundoff, because the graph checks require coincident points to agree within 8 ulp of their coordinates.
  - From 0.0.743 polishing past acceptance stops at the second step in a row that gains less than a quarter of its prediction and less than `1024 epsilon` of the cost. Such a step moves only roundoff: a direction whose roundoff floor sits above the polish level, as in the die after its slot radius grows 0.5 mm, otherwise kept the loop taking them until they vanished, 50 iterations instead of 6. Both conditions are needed. Leaning guides that converge linearly gain what they predict, and a point near a tangency can gain 8% of the cost with a ratio of 0.08. One such step can still be real, as when a point drags its own guide, so a single one does not stop polishing.
- From 0.0.749 a group that converged with freedom left, diagnosed without conflicts or redundancies, moves on toward the solution nearest its start values. Damped Newton steps reach a solution but not the nearest one where relations bend: a direction residual is a normalized sine, so its step moves a point across its line rather than straight onto the line it must lie on. Applying Parallel between a free point's line and a horizontal reference moved the point from (35, 15) to (35.714, 20) instead of (35, 20). Each of at most four rounds, sharing the 100-iteration allowance, solves the linearized relations for the least change from the start, `min |z|` with `J z = J (x - start) - r`, converges again from `start + z` and stands only when every row is still accepted and the group ended nearer its start. That reaches the nearest solution when the relations are linear in the moved unknowns and only brings the group nearer otherwise. The moved group is diagnosed again, and unless its rank and its lack of witnesses are unchanged the first diagnosed solution is kept: a point held 1 mm from two points 2 mm apart lies on a tangency, and a nearer solution there read as rank-unclear. Reported iterations include the correction. Well-constrained groups, such as the die, and drags skip it; a group with freedom left pays about one factorization more, and a second diagnosis when it moved.
- From 0.0.742 the module diagnoses every solve, as PlaneGCS does (`src/diagnose.rs`, wire protocol 2):
  - Each equation carries the tag of its source constraint (coincident, midpoint and symmetric relations have two equations) and a temporary flag for drag targets, which are solved but not diagnosed.
  - **Rows dependent at the start.** Before each group is solved, its lasting rows go into a rank-only factor at the input values. Rows within `TAU = 1e-10` of the span of earlier ones (once each row has unit norm) stay out of a first solve. That result stands if every row is then accepted. Otherwise the group is restored and solved with every row, sharing the 100 iterations and the work limit. Unclear rank or an exhausted budget solves every row.
  - **Diagnosis at the result.** Rows go in authoring order into an undamped sparse factor in the solve's column order. A dependent row gets a witness: the earlier rows that reproduce it. Its coefficients come first through the same factor, by seminormal equations corrected from what the combination still misses until the correction stops shrinking it; this stays as sparse as the solve. The factor's pivot columns can be far worse conditioned than the rows themselves, so a combination found this way that reproduces the row is a witness, but one that does not proves nothing. The rows it chose are then fitted on their own by least squares: their transpose is factored by rotations and corrected the same way. A value shared by many rows makes that factor dense, so it is held to the group's fill limit, and a fit that would pass it leaves the diagnosis `unavailable`; 3,200 midpoints around one free value are diagnosed through the solve's factor in about 2 MiB. Coefficients and misses are kept in twice the working precision (error-free sums and products), so a combination found within the distance is, and terms near 1e6 that cancel neither hide a real miss of 1e-9 nor make one up. A row within `TAU` of the span can lean on a nearly parallel one by up to about `epsilon / 1e-14` relatively; such a row stays only when the others do not reproduce the dependent one within twice `TAU` (2-norm) without it, tried first through a fresh factor of the others in the solve's column order, which fills no more than the solve's, and then by least squares. Only a settled fit, whose last correction moves the combination by under a hundredth of `TAU`, shows that they cannot; otherwise the removal is undecided and the diagnosis `unavailable`. Every witness must also reproduce its row within twice `TAU`. An insertion's remainder shrinks with the earlier pivots, so rows with small pivots can make a row look dependent relative to coefficients near 1e6 while their combination misses it by 5e-5. Its residuals then change as the sketch moves and cannot tell redundant from conflicting, so the diagnosis is `unavailable` rather than blaming a relation. A witness agrees when the same combination of residuals is within the rows' acceptance tolerances. A lead between `TAU` and `1e-7`, or a smallest singular value estimate below `1e-7`, makes rank unclear and the diagnosis `unavailable`.
  - **Labels.** Each witness sets aside one equation: one of the constraint with fewer equations, then of the later constraint, then the earlier equation. Witnesses of one constraint can lie in different groups, as with the two axes of a coincidence, so this runs across all groups. An equation set aside whose witnesses all agree is redundant; every constraint of a witness without a redundant equation conflicts. TypeScript maps the label bits to source ids, including partial redundancy. Degrees of freedom are the unknowns less the rank, reported only without conflicts.
  - **Stalled conflicts.** The nearest point of a conflicting sketch often collapses geometry, as a triangle too long for its sides flattens. Gauss-Newton approaches it only linearly and stops about `sqrt(epsilon)` short relatively, where rank at `TAU` is unclear. A group that did not converge and whose rank is unclear is diagnosed again with dependence at `1e-6` (`STALLED`), with the singular value gate unchanged. Such a diagnosis is `suspected`: it reports conflicts only, with no freedom. A row near a conflict without being in it can be blamed too, and a satisfiable sketch stuck at a stationary point is blamed as conflicting. The application message for it is "could not be met together from this start".
  - **Nothing free.** With no unknowns, relations that are not met conflict and met ones are left unlabelled.
  - Large conflicting groups can still stop at the iteration limit far from their collapsed nearest point. They are then diagnosed there, usually with no ids, as PlaneGCS does at its start; an 11-point chain is diagnosed and a 31-point one is not.
  - Compared with PlaneGCS on every solve in the differential suites (409 diagnosed), 394 results are identical in freedom and conflicting, redundant and partially redundant ids. Four are reviewed differences: three where PlaneGCS's unnormalized perpendicular and parallel gradients also blame a line's length, and one where PlaneGCS sets aside the earlier of two collinear relations because it is in more dependencies. Eleven are relations not met with nothing free, which PlaneGCS reports as success and the graph checks reject; native names them. Hand probes found two more PlaneGCS gaps, a midpoint with two horizontals where PlaneGCS blames only one and a coincidence before a midpoint that PlaneGCS calls conflicting although the sketch is consistent.
- The `native-differential` test project runs the real PlaneGCS sketch suites through both solvers. Every compiled input must give the same equations. Every solved sketch must also solve natively and pass the graph checks, and well-constrained sketches must match PlaneGCS within 1e-8.
- From 0.0.746 the application solves with the native solver first; from 0.0.747 the module follows drag targets (reached, projected or stalled; see the 0.0.747 release record), and from 0.0.748 the application answers drags with it. PlaneGCS still answers what native cannot: suspected and unavailable diagnoses, a drag diagnosed as conflicting or redundant where it ended, and stalled drags.
- Not built yet, in order:
  1. exact elimination of simple equalities;
  2. removing PlaneGCS.
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

Run `npm run cad:benchmark -- --group solver-workloads`. A full run takes about two minutes on the development laptop; the recorded run below took 125.4 seconds. It uses seven latency samples, seven 60-frame trajectories, 1000 repeated solves per solver and an adaptive capacity search. `--quick` uses three latency samples and 100 repeated solves; `--runs N` changes latency samples and trajectory count but leaves the full-run memory count at 1000. Capacity always uses three samples per size and searches at most 4096 connected rectangles. Keep the host idle during the run. Reports include Node version, CPU, sample order, all calibration brackets, outcomes, source diagnostics, stage statistics, resource observations and correctness failures. A Markdown summary is written beside the JSON.

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

Both adapters implement the existing `CadSketchSolver` interface. Every timer encloses its public `solve(input)`, including boundary parsing, compilation, solving, mapping, the fixed-value check, building the solved graph from the accepted request with `cadSketchGraphWithSolvedValues` (0.0.745) and the same `checkCadSketchGraph` acceptance. The benchmark's own `cadSketchSolutionMatchesInput` correctness check runs outside timing. The PlaneGCS adapter uses the current runtime, including connected components, the group-size guard, temporary drag constraints and **always-on diagnosis**. The native adapter uses `compileCadSketchEquations`, `loadCadSketchNativeSolver` and `applyCadSketchEquationSolution`. Neither adapter changes the application's solver selection.

From 0.0.742 native rows are the **full job**: the native adapter maps the module's diagnosis to the same source ids and rejects in the same order as the PlaneGCS runtime, conflicting first, then redundant or partially redundant, then a convergence failure. An unavailable diagnosis is a failure, never a clean result. A suspected diagnosis rejects with its conflicts only and no freedom. `cadSolverWorkloadBenchmark.test.ts` compares every fixture with PlaneGCS; four differences are reviewed, each with the native result the better one: `tangency-near` solves where PlaneGCS fails the graph check, `overlapping-conflicts` also blames the vertical offset, `impossible-triangle` blames all three sides where PlaneGCS gives none, and `fully-fixed-conflict` names the unmet relation. This adapter predates native drags (0.0.748) and does not run them, so drag is explicitly unsupported, without a fabricated latency. Runs recorded before 0.0.742 measured native solving without diagnosis and are not full-job comparisons.

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

### Recorded 0.0.743 run

Node v24.22.1, Windows x64, Intel(R) Core(TM) i9-14900HX, seven samples, 125.4 seconds. Full report: `tmp/cad-benchmark/2026-10-26T00-16-01-944Z-solver-workloads.json`, with its adjacent Markdown summary. It ran the 91,733-byte release module, with the 0.0.742 diagnosis and the 0.0.743 polish stop. This is a release-specific record; the historical baseline was not regenerated. It replaces the 0.0.742 record, in which the die "+0.5 mm" edit polished for 50 iterations: its native call took 10.06 ms and its full job 15.57 ms, against 9.8 ms for PlaneGCS. It now takes 2.28 ms and 10.49 ms, level with PlaneGCS.

CPU calibration ranged from 65.16 to 242.09 ms, so the host changed speed during the run. An asterisk marks a bracket that drifted more than 1.5 times; exclude those timings from performance comparisons. Other rows are comparable only to their paired solver under similar calibration, not to other rows or the old baseline. The flagged group stays in the record so slow or unstable measurements cannot disappear.

All timings below are public-call p50 milliseconds. Each pair is first solve / re-solve. Both solvers run the **full job** with diagnosis. S = geometry accepted; R = redundant rejection; C = conflicting rejection; F = convergence failure; I = independent graph-check rejection.

| Workload | PlaneGCS full job | Native full job | Outcome Plane/native | CPU before/after ms |
| --- | ---: | ---: | --- | --- |
| rectangles-10 | 2.82 / 2.66 | 2.55 / 1.89 | S/S | 67.32/70.71 |
| rectangles-60 | 12.66 / 11.74 | 10.79 / 9.35 | S/S | 65.16/66.16 |
| rectangles-200 | 96.35 / 101.96 | 81.44 / 74.8 | S/S | 158.61/214.5 |
| connected-60 | 123.08 / 73.2 | 32.33 / 29.72 | S/S | 187.46/212.87 |
| connected-88 | 267.73 / 135.51 | 42.3 / 39.14 | S/S | 122.97/166.16 |
| topology-open | 48.52 / 27.55 | 19.34 / 15.82 | S/S | 228.87/226.4 |
| topology-loop | 13.41 / 11.14 | 10.71 / 7.99 | S/S | 218.28/242.09 |
| topology-branch | 13.72 / 9.25 | 8.84 / 6.55 | S/S | 163.56/165.57 |
| topology-hub | 13.16 / 13 | 13.13 / 11.02 | S/S | 163.95/173.04 |
| topology-hub-shuffled | 13.78 / 13.33 | 12.23 / 12.13 | S/S | 194.12/200.93 |
| die-constrained | 12.92 / 12.28 | 10.16 / 8.32 | S/S | 200.3/180.57 |
| die-free | 10.31 / 6.18 | 7.7 / 7.32 | S/S | 181.42/129.46 |
| numeric-tiny | 0.56 / 0.52 | 0.48 / 0.42 | S/S | 133.85/141.53 |
| numeric-far-origin | 1.01 / 0.99 | 0.82 / 0.41 | S/S | 169.35/219.6 |
| numeric-mixed-scales | 1.4 / 1.35 | 1.22 / 1.52 | S/S | 166.83/158.94 |
| tangency-exact | 10.02 / 8.49 | 9.29 / 8.38 | S/S | 188.87/159.19 |
| tangency-near | 11.17 / skipped | 9.36 / 8.58 | I/S | 174.57/179.58 |
| redundant-distances | 0.55 / skipped | 0.38 / skipped | R/R | 217.35/161.66 |
| partial-coincident-horizontal | 0.35 / skipped | 0.22 / skipped | R/R | 143.81/176.26 |
| partial-symmetry-midpoint | 0.92 / skipped | 0.5 / skipped | R/R | 156.82/181.92 |
| conflicting-distances | 0.36 / skipped | 0.29 / skipped | C/C | 167.18/150.38 |
| conflicting-triangle * | 0.53 / skipped | 0.42 / skipped | C/C | 127.58/193.93 |
| fixed-point-vs-dimension | 0.5 / skipped | 0.37 / skipped | C/C | 183.3/201.94 |
| overlapping-conflicts | 0.51 / skipped | 1.01 / skipped | C/C | 113.8/123.6 |
| impossible-triangle | 0.33 / skipped | 0.43 / skipped | F/C | 119.48/135.1 |
| fully-fixed-conflict | 0.19 / skipped | 0.13 / skipped | I/C | 117.49/133.18 |
| fully-fixed-satisfied | 0.23 / 0.21 | 0.25 / 0.25 | S/S | 189.02/148.37 |
| fully-fixed-conflict-with-free | 0.48 / skipped | 0.38 / skipped | C/C | 168.7/172.62 |
| fully-fixed-satisfied-with-free | 0.44 / skipped | 0.31 / skipped | R/R | 206.84/204.31 |

| Edit from previous accepted solution | PlaneGCS full job p50 ms | Native full job p50 ms | CPU before/after ms |
| --- | ---: | ---: | --- |
| dimension-plus-0.5-mm | 10.25 | 10.49 | 178.69/194.33 |
| dimension-plus-20-percent | 9.62 | 9.63 | 178.69/194.33 |
| constraint-addition | 6.68 | 6.36 | 162/141.88 |
| constraint-removal | 7.15 | 5.48 | 162/141.88 |

Selected p50 stage timings, also in milliseconds. Each stage has its own distribution, so its median need not add to the total median.

| Workload / solver | Parse/compile | Native call | Mapping | Validation | Total |
| --- | ---: | ---: | ---: | ---: | ---: |
| rectangles-200 / PlaneGCS | 37.48 | 19.74 | 26.38 | 4.42 | 96.35 |
| rectangles-200 / native | 45.35 | 15.74 | 20.24 | 4.34 | 81.44 |
| connected-88 / PlaneGCS | 17.07 | 229.25 | 12.85 | 2.05 | 267.73 |
| connected-88 / native | 19.64 | 7.63 | 10.23 | 1.44 | 42.3 |
| die-constrained / PlaneGCS | 4.53 | 4.99 | 2.41 | 0.92 | 12.92 |
| die-constrained / native | 4.44 | 2.59 | 2.26 | 0.96 | 10.16 |
| dimension-plus-0.5-mm / PlaneGCS | 3.71 | 4.52 | 1.91 | 0.61 | 10.25 |
| dimension-plus-0.5-mm / native | 2.74 | 2.28 | 2.06 | 0.83 | 10.49 |

| Resource / operation | PlaneGCS full job | Native full job |
| --- | --- | --- |
| WASM raw / gzip bytes | 484003 / 174403 | 91733 / 32857 |
| Cold local read / compile / instantiate+glue ms | 6.75 / 1.11 / 4.71 | 1.34 / 0.23 / 0.13 |
| Cold sum ms, calibration 66.31/66.45 ms | 12.57 | 1.70 |
| Largest retained WASM capacity across fixture probes, MiB | 21.06 | 1.94, connected-88 |
| Seeded die WASM capacity before / after 1000 solves, MiB | 21.063 / 21.063 | 1.125 / 1.125 |
| RSS / JS heap deltas after 1000 solves, MiB, uncontrolled GC | 1.04 / 31.35 | -1.00 / 55.84 |
| Connected capacity, median under 1 s | 88 rectangles, 271.72 ms; 89 rejected too-large | 1920 rectangles, 984.56 ms; 1921 solved in 1122.32 ms (throttled boundary; largest unthrottled 1792, 993.29 ms) |
| 60-frame drag, seven trajectories | 14.51 / 23.65 / 26.7 ms p50/p95/p99; 414/420 over 8 ms | Unsupported |

The PlaneGCS capacity boundary bracket was unthrottled, and 89 rectangles are refused by its group-size guard. The native boundary bracket was throttled; its largest unthrottled solved probe was 1,792 rectangles. All 420 drag frames were accepted and the seven unreachable targets were projected; the drag bracket was 197.86/177.09 ms. The run had no correctness failures. The JSON retains raw frame samples and every capacity probe. Process deltas do not establish a leak or allocator live usage. Browser/network cold fetch, temporary process-memory peaks and native drag could not be measured.
