# CAD performance baseline

`npm run cad:benchmark` measures the CAD kernel and sketch solver on fixed workloads and writes a JSON report to `tmp/cad-benchmark/<timestamp>.json`. Add `-- --quick` for a shorter run or `-- --runs N` to change the sample count (default 7). It runs in Node with the same OpenCascade and PlaneGCS WASM files the app ships. Use it before and after a change that claims a speed or memory improvement, and record both reports in the pull request.

## Workloads and correctness

`src/features/cad/benchmark/cadBenchmarkCases.ts` defines the workloads. Kernel cases are complete documents with edit steps and analytic expected volumes. `cadBenchmarkCases.test.ts` builds every step in the normal Vitest suite, so a case that stops producing its analytic geometry fails CI instead of producing misleading timings. The script also marks such a step `INCORRECT` and exits non-zero.

| Case | What it isolates |
| --- | --- |
| `plate-hole-pattern` | Ordinary sketch, extrude, linear pattern and boolean cut; the width edit invalidates every feature. |
| `gear-and-plate` | A gear plugin profile (hundreds of faces) beside an independent holed plate. The plate edit rebuilds the unchanged gear; `dirtySubset` builds only the plate features, the lower bound for an incremental rebuild. |
| `box-fillet-all-edges` | Rolling-ball fillet of all twelve box edges and a radius edit. |

Solver workloads are independent, fully constrained rectangles (4 lines and 7 relations each). The drag preview uses documents with 1, 4 and 8 independent graph sketches of 10 rectangles and prepares one point move through `prepareCadEdits`, as a sketch drag preview does.

## Metrics

- `buildMs`: uncached `buildCadKernelModel` of the full document. `coldMs` is the first build of the first step after WASM initialization.
- `shippedEditMs`: the previous step followed by this step through `createCadKernelRuntime`, which caches only a whole document.
- `dirtySubsetMs`: build of only the invalidated features.
- `payload`: triangles, plain-array numbers and JSON size of the build result that crosses the worker boundary.
- `mainThread`: `structuredClone` of the reply, `isCadKernelReply` validation and `prepareCadMeshDisplay` for every mesh. The app pays these on the main thread for each build.
- `memoryBytesAfterRebuilds`: OpenCascade linear-memory capacity after 1, 10 and 50 build/dispose cycles.
- Solver `scaling`, `drag`, `dragPreview` (`solvesPerPreview` counts native solves for one preview) and `capacity`. PlaneGCS has fixed linear memory and aborts with OOM, so capacity uses a fresh module per size and reports the largest rectangle count that solved and the first that did not.
- `cpuCalibrationMs`: a fixed JavaScript loop timed beside every step. Laptops reduce clock speed under sustained load. The development host below ran the same loop 3.5 times slower after about three seconds. When calibration differs by more than 1.5 times across a run, the script warns. Compare ratios within a step, or steps with similar calibration, and never compare across hosts.

## Baseline

App 0.0.736, Node 24.22, Intel Core i9-14900HX laptop on the Balanced power plan, 7 runs. Calibration ranged from 62 ms (idle) to 196 ms (throttled), so absolute times are pessimistic; the ratios are the useful part.

| Measurement | Result |
| --- | --- |
| OpenCascade WASM | 23.0 MB, 7.2 MB gzip |
| PlaneGCS WASM | 0.5 MB, 0.2 MB gzip, 21 MiB fixed linear memory |
| occt-import-js WASM (machine STEP import, lazily loaded) | 7.6 MB, 3.1 MB gzip |
| Gear and plate, plate width edit (shipped) | 1428 ms p50, of which the plate features alone take 202 ms (7 times headroom) |
| Gear and plate build result | 5792 triangles, 1.1 MiB JSON, 7 ms structured clone, 7 ms display preparation |
| Holed plate build | 69 ms p50 |
| Box fillet, all edges | 90 ms p50 |
| Solver warm solve | 1 rectangle 0.8 ms, 10 rectangles 4 ms, 40 rectangles 17 ms, 60 rectangles 46 ms |
| Drag preview, one point move | 1 sketch: 1 solve, 8 ms; 4 sketches: 4 solves, 48 ms; 8 sketches: 8 solves, 82 ms |
| Solver capacity, fresh module | 80 rectangles solved; 100 rectangles aborted with OOM |

Unthrottled spot checks of the gear and plate edit were about 490 ms with about 75 ms for the plate features alone.

## Findings that set the order of work

1. Drag previews re-solve every graph sketch in the document, so preview cost grows with unrelated sketches.
2. PlaneGCS aborts on a few hundred constrained entities because its memory cannot grow; the worker reports the raw abort text and restarts.
3. Every edit rebuilds every feature. Unchanged expensive bodies dominate edits of cheap ones.
4. Build results cross the worker as plain arrays and are validated and prepared for display again on the main thread for every build.

Proposed order: solve only edited sketches and their reference dependents, then solve independent sketch components separately with a clear limit message; incremental feature rebuilds keyed by a chain hash with bounded memory after 50 rebuilds as a gate; typed-array transfer with display preparation in the worker. Rust or kernel replacements are considered only where this benchmark shows the remaining time is inside the native kernel or solver.
