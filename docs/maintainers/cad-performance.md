# CAD performance baseline

`npm run cad:benchmark` measures the CAD kernel and sketch solver on fixed workloads and writes a JSON report to `tmp/cad-benchmark/<timestamp>.json`. Add `-- --quick` for a shorter run or `-- --runs N` to change the sample count (a positive whole number, default 7). It runs in Node with the same OpenCascade and PlaneGCS WASM files the app ships. Use it before and after a change that claims a speed or memory improvement, and record both reports in the pull request.

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

`packages/sketch-solver` is our own Rust constraint solver, compiled to a 51 kB WebAssembly module with no dependencies. From 0.0.739 it is built, tested and compared with PlaneGCS, but the app does not load it yet.

- `compileCadSketchEquations` turns a sketch into scalar parameters and twelve kinds of scalar equation, and the module solves them.
  - Each connected group of unknowns gets its own damped Gauss-Newton solve, with exact gradients from dual numbers.
  - Each equation is divided by its gradient norm over the unknowns, so every residual reads as the distance they must move.
  - Each step comes from a Givens QR of the weighted Jacobian, not the normal equations, so roundoff does not move the free directions of an under-constrained sketch.
  - From 0.0.740 the QR is sparse:
    - Rows keep their authoring order. Columns take a minimum-degree order fixed by the structure, so a chain of profiles fills like a band.
    - Each damping trial refactors from `sqrt(mu) I`, which costs no more than factoring the Jacobian alone.
    - Time and memory grow about linearly with the size of a group, instead of with the square and cube of its unknowns.
  - Native code cannot be interrupted, so each group has limits:
    - The ordering gives the exact fill of the factor before any numeric work. A group above 2,000,000 entries (about 32 MiB) is left in place.
    - A group that spends 400,000,000 rotation updates stops where it got to.
    - Either reports `too-large`. This replaces the PlaneGCS limit of 500,000 unfixed parameters times equations, which a chain of 89 rectangles already exceeds.
  - Convergence is judged apart from that weighting:
    - each residual must be within the driver tolerance in millimetres;
    - each direction error must be within 1e-12 radians, or the roundoff of its coordinates at the far end of the longer line.
  - The solver status only reports convergence of its own equations. As with PlaneGCS, the graph checks decide whether a result is accepted, including degenerate lines, angle sectors and the distance between collinear segments.
  - Iteration continues to roundoff, because the graph checks require coincident points to agree within 8 ulp of their coordinates.
- The `native-differential` test project runs the real PlaneGCS sketch suites through both solvers. Every compiled input must give the same equations. Every solved sketch must also solve natively and pass the graph checks, and well-constrained sketches must match PlaneGCS within 1e-8.
- Not built yet, in order:
  1. diagnosis of redundant and conflicting relations and degrees of freedom;
  2. exact elimination of simple equalities;
  3. drag targets;
  4. switching the runtime over.
- A direct probe of warm solves with this module, on the same host and not bracketed by calibration, against the PlaneGCS runtime with its diagnosis:

  | Workload | PlaneGCS | Native |
  | --- | --- | --- |
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

  The dense column comes from earlier runs, and differences below a millisecond are within noise. These numbers are not a fair comparison yet. PlaneGCS diagnoses redundant and conflicting relations and degrees of freedom on every solve, and the native solver does not do so until diagnosis is built.
- A start far outside the linear range of an equation can take one long step. For example, a perpendicular line that starts nearly antiparallel can be stretched to a valid but very long solution. A step bound comes with drag targets, where the solution must stay near the start.
