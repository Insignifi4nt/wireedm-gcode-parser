# PlaneGCS removal benchmarks (0.0.757)

These files are the evidence for removing PlaneGCS in 0.0.757. The measurements were taken on the same host: Intel Core i9-14900HX, 32 cores, Node v24.22.1, Windows.

## Before: 0.0.756 (`before-0.0.756/`)

The commit adding this folder is 0.0.756 (main at 8dedfaee) plus two scripts. The solver-workloads manifest records those scripts as uncommitted changes. They were later renamed to the `benchmark-cad-*` pattern so the benchmark type check covers them.

| File | Contents |
| --- | --- |
| `native-first-vs-native-only.json` | `scripts/benchmark-cad-native-first-corpus.ts`. Each of the 1,774 frozen corpus inputs is answered by the shipped native-first runtime and by native alone, with every fallback and every answer that differs. |
| `corpus-replay-tally.json` | `PLANEGCS_CORPUS_TALLY=1` replay of the frozen corpus, natively against PlaneGCS's answers. |
| `native-differential-tally.json` | `NATIVE_DIFFERENTIAL_TALLY=1 npm test -- --run --project native-differential`, summed over its 25 files; for the `largest` keys, the largest value. |
| `native-too-large.json` | `scripts/benchmark-cad-native-too-large.ts`. Connected rectangle chains double from 4,096, then the size is bisected to the first that native refuses as too large. |
| `solver-workloads-summary.md`, `solver-workloads-report.json.gz` | `npm run cad:benchmark -- --group solver-workloads --out <dir>`, then `--aggregate <dir>`. All seven sections and seven runs, for `planegcs`, `native-only` and `native-first`. |
| `legacy-report.json` | `npm run cad:benchmark -- --group legacy`. Kernel, solver scaling, drag preview and capacity: PlaneGCS rows plus a `nativeFirst` section. |

Also passing on this commit:
- `npm run solver:corpus -- --check` against a fresh capture;
- `npm run solver:check`: the module matches its source, 210,230 bytes, sha256 `728141186fcc1a1c300b63734f054cfd6001a41dcbe6783aac442ca7164b31cc`.

CPU calibration varied from 53 to 294 ms during these runs, so the host changed speed. Groups marked `THROTTLED` drifted more than 1.5 times within their bracket. Compare only solvers within one group, never groups with each other.

## After: 0.0.757 (`after-0.0.757/`)

Measured on the removal commit, e29374e2, with no uncommitted changes and the same native module (sha256 `728141186fcc…`).

| File | Contents |
| --- | --- |
| `solver-workloads-summary.md`, `solver-workloads-report.json.gz` | The same solver-workloads run, now with the one solver, `native`. |
| `legacy-report.json` | The same legacy run on the native runtime. |
| `corpus-replay-tally.json` | The corpus replay. It is identical to the one before removal. |

CPU calibration varied from 60 to 237 ms.

## Comparison (`comparison.md`)

`comparison.md` puts every solver-workloads row of both runs side by side, with its calibration bracket. A `T` marks a throttled bracket. The controlled comparison is inside the 0.0.756 run: `native-first` was the app as shipped, and `native-only` was the same runtime without PlaneGCS, measured in the same brackets. The 0.0.757 column is a separate run at another time, so it confirms the outcomes, while its timings compare only roughly.

- **Outcomes.**
  - Every workload, edit, drag frame and sweep drag of the 0.0.757 run has the outcome `native-only` had on 0.0.756.
  - The drag outcomes and the largest target errors are the same.
  - Every sweep answer is `native:answer`.
  - There are no correctness failures in either run.
- **Where the app asked PlaneGCS, it now answers at native speed.**

  | Case (0.0.756 p50, ms) | `native-first` | `native-only` | 0.0.757 `native` |
  | --- | ---: | ---: | ---: |
  | `impossible-triangle` | 12.81 | 0.47 | 0.52 |
  | `overlapping-conflicts` | 13.83 | 0.51 | 0.58 |
  | `overlapping-conflicts-repeated` | 21.82 | 0.87 | 0.45 |
  | `tangency` drag, from start | 18.79 (p95 32.02) | 0.48 (p95 3.26) | 0.53 (p95 1.22) |
  | `tangency` drag, chained | 14.5 (p95 36.87) | 0.45 (p95 1.76) | 0.61 (p95 0.92) |

  On these cases the answers differ: the conflicts name the relations native names, and the tangency frames that native ends stalled or limited end up to 7.5e-6 mm from their targets, against at most 7.36e-6 mm for PlaneGCS.
- **Everything else is unchanged.** Where native answered on 0.0.756, `native-first` and `native-only` agree within noise, and the 0.0.757 run agrees with both within its calibration.
- **Legacy group.** The drag-preview solver calls take 1.1 to 1.3 ms for native first on 0.0.756 and 1.2 to 1.3 ms for native on 0.0.757, apart from the referenced edge with its two solves (1.37 and 2.13 ms). PlaneGCS took 2.3 to 4.1 ms. Whole previews are dominated by document parsing and vary with calibration in both runs. The legacy connected capacity probes up to 125 rectangles, and all of them solve; PlaneGCS refused 89.
- **Memory.**
  - The largest WASM capacity over the fixtures was 22.19 MiB for `native-first`, which loaded PlaneGCS on 3 of 30 fixtures. `native-only` and 0.0.757 `native` reach 1.94 MiB. PlaneGCS alone held 21.06 MiB.
  - The 1,000-call repeat probes stay at 1.13 MiB, and at 1.25 MiB for the die-slot frames, in both runs.
- **Cold start.**
  - The module is 210,230 bytes, 70,323 gzip, and loads in about 2.1 ms in both runs.
  - The first answer on the die is 9.0 to 9.1 ms on 0.0.756 and 11.25 ms on 0.0.757, a separate run at a different calibration.
  - A first answer that needed PlaneGCS took 22.87 ms on 0.0.756. That load (484,003 bytes, 174,403 gzip, 10.46 ms, 21 MiB) is gone.
- **Capacity.**
  - The one-second search reaches its cap of 4,096 connected rectangles in both runs, so it is a lower bound.
  - `native-too-large.json` places the refusal at 83,334 rectangles: 83,333 solve in 27.5 s. The module is unchanged, so the boundary is unchanged.
  - PlaneGCS refused 89.
