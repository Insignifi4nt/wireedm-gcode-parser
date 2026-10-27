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
