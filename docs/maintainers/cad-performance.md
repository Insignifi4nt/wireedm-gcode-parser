# CAD performance baseline

`npm run cad:benchmark` measures the CAD kernel and sketch solver on fixed workloads and writes a JSON report to `tmp/cad-benchmark/<timestamp>.json`. Add `-- --quick` for a shorter run or `-- --runs N` to change the sample count (a positive whole number, default 7). It runs in Node with the same OpenCascade and PlaneGCS WASM files the app ships. Use it before and after a change that claims a speed or memory improvement, and record both reports in the pull request.

## Workloads and correctness

`src/features/cad/benchmark/cadBenchmarkCases.ts` defines the workloads. Kernel cases are complete documents with edit steps and analytic expected volumes. `cadBenchmarkCases.test.ts` builds every step in the normal Vitest suite, so a case that stops producing its analytic geometry fails CI instead of producing misleading timings. The script also marks such a step `INCORRECT` and exits non-zero.

| Case | What it isolates |
| --- | --- |
| `plate-hole-pattern` | Ordinary sketch, extrude, linear pattern and boolean cut; the width edit invalidates every feature. |
| `gear-and-plate` | A gear plugin profile (hundreds of faces) beside an independent holed plate. The plate edit rebuilds the unchanged gear. `affectedBodies` is the plate alone, with its unchanged hole pattern, and has its own analytic volume. |
| `box-fillet-all-edges` | Rolling-ball fillet of all twelve box edges and a radius edit. |

Solver workloads are independent, fully constrained rectangles (4 lines and 7 relations each). The drag preview uses documents with 1, 4 and 8 independent graph sketches of 10 rectangles. The first rectangle of the first sketch has its fixed corner released, and one corner move is prepared through `prepareCadEdits`, as a sketch drag preview does. The suite checks that the rectangle follows the drag and that every other sketch is unchanged.

## Metrics

- `buildMs`: uncached `buildCadKernelModel` of the full document. `coldMs` is the first build of the first step in a fresh module.
- `shippedEditMs`: the previous step followed by this step through `createCadKernelRuntime`, which caches only a whole document.
- `affectedBodiesMs`: uncached build of only the bodies the edit changes, including unchanged inputs they need. It is sampled alternately with `shippedEditMs` so both see the same clock speed. A rebuild that reuses unaffected bodies should take no longer than this; it can be faster by also reusing unchanged inputs.
- `payload`: triangles, plain-array numbers and JSON size of the build result that crosses the worker boundary.
- `mainThread`: `structuredClone` of the reply, `isCadKernelReply` validation and `prepareCadMeshDisplay` for every mesh. The app pays these on the main thread for each build.
- `memoryBytesAfterRebuilds`: OpenCascade linear-memory capacity after 1, 10 and 50 edits through one shipped runtime, alternating the case steps so each edit replaces the cached model. WASM memory grows but never shrinks, so this is a high-water mark. Each case runs in a fresh OpenCascade module, so its numbers do not depend on the cases before it.
- Solver `scaling`, `drag`, `dragPreview` (`solvesPerPreview` counts native solves for one preview) and `capacity`. PlaneGCS has fixed linear memory and aborts with OOM, so capacity uses a fresh module per size and reports the largest rectangle count that solved and the first that did not.
- `cpuCalibrationMs`: a fixed JavaScript loop timed before and after each measurement group: full builds, edits and main-thread work for each kernel step, and each solver size, the solver drag and each drag-preview size. Laptops reduce clock speed under sustained load; the development host below ran the same loop 3.5 times slower after about three seconds. The script marks a group `THROTTLED` when its calibrations differ by more than 1.5 times and warns when they do across the run. Use only unthrottled groups, compare groups with similar calibration, and never compare across hosts.

## Baseline

App 0.0.736, Node 24.22, Intel Core i9-14900HX laptop on the Balanced power plan, 7 runs. Every measurement group was bracketed at 57 to 84 ms of calibration, so none was throttled.

| Measurement | Result |
| --- | --- |
| OpenCascade WASM | 23.0 MB, 7.2 MB gzip, 86 ms initialization |
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
2. PlaneGCS aborts on a few hundred constrained entities because its memory cannot grow; the worker reports the raw abort text and restarts.
3. Every edit rebuilds every feature. Unchanged expensive bodies dominate edits of cheap ones. OpenCascade memory already grows from 100 to 127 MiB between the 10th and 50th edit of the holed plate, so a feature cache must show no more growth than that over the same 50 edits.
4. Build results cross the worker as plain arrays (1.1 MiB JSON for 5.8k triangles) and are validated and prepared for display again on the main thread. That costs about 5 ms a build here, so it is a payload and memory cleanup, not the main latency.

Proposed order: solve only edited sketches and their reference dependents, then solve independent sketch components separately with a clear limit message; incremental feature rebuilds keyed by a chain hash with bounded memory after 50 rebuilds as a gate; typed-array transfer with display preparation in the worker. Rust or kernel replacements are considered only where this benchmark shows the remaining time is inside the native kernel or solver.
