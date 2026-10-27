# Solver workloads before and after removing PlaneGCS

Medians (p50) in milliseconds unless stated. The 0.0.756 columns come from one run, which measured `planegcs`, `native-first` (the app as shipped) and `native-only` in the same calibration brackets. The 0.0.757 columns come from a separate run of the native runtime on the removal commit. CPU columns are the calibration before and after each group, in ms; a `T` marks a throttled bracket. See `README.md` for how to read them, and the two `summary.md` files for stages and re-solve rows.

| Workload / operation | PlaneGCS | Native first | Native only | Outcome | 0.0.756 CPU | 0.0.757 native | Outcome | 0.0.757 CPU |
| --- | ---: | ---: | ---: | --- | --- | ---: | --- | --- |
| conflicting-distances / first-solve | 0.29 | 0.2 | 0.17 | rejected:conflicting | 129/129 | 0.2 | rejected:conflicting | 213/181 |
| conflicting-triangle / first-solve | 0.46 | 0.26 | 0.32 | rejected:conflicting | 192/136 | 0.44 | rejected:conflicting | 184/156 |
| connected-60 / first-solve | 32.34 | 3.11 | 3.05 | solved | 60/156 T | 3.5 | solved | 60/64 |
| connected-60 / re-solve | 15.55 | 1.36 | 1.45 | solved | 60/156 T | 1.65 | solved | 60/64 |
| connected-88 / first-solve | 235.63 | 14.13 | 10.78 | solved | 157/115 | 4.47 | solved | 62/63 |
| connected-88 / re-solve | 125.48 | 4.81 | 5.53 | solved | 157/115 | 1.84 | solved | 62/63 |
| die-constrained / first-solve | 8.87 | 3.92 | 3.72 | solved | 169/204 | 2.56 | solved | 155/158 |
| die-constrained / re-solve | 4.79 | 2.29 | 4.22 | solved | 169/204 | 1.81 | solved | 155/158 |
| die-free / first-solve | 5.21 | 3.57 | 3.34 | solved | 180/177 | 5.13 | solved | 177/217 |
| die-free / re-solve | 3.98 | 2.32 | 1.92 | solved | 180/177 | 2.25 | solved | 177/217 |
| fixed-point-vs-dimension / first-solve | 0.28 | 0.17 | 0.21 | rejected:conflicting | 140/126 | 0.24 | rejected:conflicting | 198/192 |
| fully-fixed-conflict-with-free / first-solve | 0.82 | 0.19 | 0.21 | rejected:conflicting | 153/176 | 0.2 | rejected:conflicting | 143/140 |
| fully-fixed-conflict / first-solve | 0.11 | 0.1 | 0.12 | rejected:conflicting | 216/152 | 0.17 | rejected:conflicting | 207/217 |
| fully-fixed-satisfied-with-free / first-solve | 0.75 | 0.11 | 0.11 | rejected:redundant | 148/145 | 0.09 | rejected:redundant | 127/138 |
| fully-fixed-satisfied / first-solve | 0.16 | 0.15 | 0.22 | solved | 173/134 | 0.17 | solved | 188/187 |
| fully-fixed-satisfied / re-solve | 0.11 | 0.16 | 0.17 | solved | 173/134 | 0.14 | solved | 188/187 |
| impossible-triangle / first-solve | 0.5 | 12.81 | 0.47 | rejected:failed | 163/132 | 0.52 | rejected:failed | 237/190 |
| numeric-far-origin / first-solve | 0.3 | 0.21 | 0.31 | solved | 136/123 | 0.27 | solved | 142/171 |
| numeric-far-origin / re-solve | 0.24 | 0.17 | 0.27 | solved | 136/123 | 0.21 | solved | 142/171 |
| numeric-mixed-scales / first-solve | 0.49 | 0.55 | 0.6 | solved | 154/146 | 0.77 | solved | 164/160 |
| numeric-mixed-scales / re-solve | 0.41 | 0.25 | 0.26 | solved | 154/146 | 0.47 | solved | 164/160 |
| numeric-tiny / first-solve | 0.45 | 0.32 | 0.34 | solved | 145/169 | 0.43 | solved | 181/184 |
| numeric-tiny / re-solve | 0.41 | 0.25 | 0.25 | solved | 145/169 | 0.33 | solved | 181/184 |
| overlapping-conflicts-repeated / first-solve | 0.81 | 21.82 | 0.87 | rejected:conflicting | 178/169 | 0.45 | rejected:conflicting | 216/173 |
| overlapping-conflicts / first-solve | 0.48 | 13.83 | 0.51 | rejected:conflicting | 132/130 | 0.58 | rejected:conflicting | 130/141 |
| partial-coincident-horizontal / first-solve | 0.69 | 0.25 | 0.3 | rejected:redundant | 294/199 | 0.45 | rejected:redundant | 227/207 |
| partial-symmetry-midpoint / first-solve | 0.8 | 0.21 | 0.22 | rejected:redundant | 226/206 | 0.15 | rejected:redundant | 221/215 |
| rectangles-10 / first-solve | 1.32 | 0.81 | 0.85 | solved | 65/65 | 1.07 | solved | 63/65 |
| rectangles-10 / re-solve | 1.17 | 0.4 | 0.4 | solved | 65/65 | 0.5 | solved | 63/65 |
| rectangles-200 / first-solve | 11.78 | 7.95 | 8.35 | solved | 53/60 | 9.09 | solved | 66/64 |
| rectangles-200 / re-solve | 11.31 | 3.91 | 4.06 | solved | 53/60 | 4.66 | solved | 66/64 |
| rectangles-60 / first-solve | 4.26 | 3.17 | 3.21 | solved | 84/61 | 3.04 | solved | 65/64 |
| rectangles-60 / re-solve | 3.85 | 1.65 | 1.55 | solved | 84/61 | 1.69 | solved | 65/64 |
| redundant-distances / first-solve | 0.76 | 0.32 | 0.23 | rejected:redundant | 135/178 | 0.14 | rejected:redundant | 190/178 |
| tangency-exact / first-solve | 2.64 | 1.46 | 1.63 | solved | 168/186 | 1.53 | solved | 136/147 |
| tangency-exact / re-solve | 2.8 | 1.35 | 1.36 | solved | 168/186 | 1.71 | solved | 136/147 |
| tangency-near / first-solve | 2.92 | 2.8 | 2.06 | solved | 122/191 T | 2.05 | solved | 202/127 T |
| tangency-near / re-solve | n/a | 1.06 | 1.14 | solved | 122/191 T | 1.23 | solved | 202/127 T |
| topology-branch / first-solve | 3.93 | 2.1 | 2.03 | solved | 143/214 | 0.88 | solved | 64/64 |
| topology-branch / re-solve | 4.31 | 1.28 | 1.19 | solved | 143/214 | 0.55 | solved | 64/64 |
| topology-hub-shuffled / first-solve | 5.05 | 2.37 | 2.78 | solved | 188/135 | 3.37 | solved | 162/200 |
| topology-hub-shuffled / re-solve | 3.77 | 1.21 | 1.48 | solved | 188/135 | 1.76 | solved | 162/200 |
| topology-hub / first-solve | 2.63 | 2.12 | 1.64 | solved | 160/149 | 0.99 | solved | 61/60 |
| topology-hub / re-solve | 2.92 | 0.89 | 1.31 | solved | 160/149 | 0.57 | solved | 61/60 |
| topology-loop / first-solve | 4.91 | 1.84 | 2.34 | solved | 122/159 | 0.63 | solved | 62/68 |
| topology-loop / re-solve | 3.7 | 1.11 | 1.26 | solved | 122/159 | 0.42 | solved | 62/68 |
| topology-open / first-solve | 20.31 | 2.68 | 2.88 | solved | 132/122 | 1.67 | solved | 60/68 |
| topology-open / re-solve | 5.64 | 1.05 | 1.1 | solved | 132/122 | 0.67 | solved | 60/68 |
| die-dimension-edits / dimension-plus-0.5-mm | 5.85 | 2.75 | 3.18 | solved | 113/136 | 3.71 | solved | 185/202 |
| die-dimension-edits / dimension-plus-20-percent | 6.67 | 2.61 | 2.97 | solved | 113/136 | 4.19 | solved | 185/202 |
| die-constraint-edits / constraint-addition | 2.43 | 1.19 | 1.2 | solved | 130/183 | 2.06 | solved | 169/180 |
| die-constraint-edits / constraint-removal | 2.18 | 1.12 | 1.61 | solved | 130/183 | 2.39 | solved | 169/180 |

| Drag trajectory / mode | PlaneGCS p50/p95 | Native first p50/p95 | Native only p50/p95 | 0.0.756 CPU | 0.0.757 native p50/p95 | Drag outcomes 0.0.757 | Largest target error mm, first / 0.0.757 | 0.0.757 CPU |
| --- | ---: | ---: | ---: | --- | ---: | --- | ---: | --- |
| die-slot / from-start | 9.56/13.96 | 3.3/7.04 | 3.43/7.7 | 209/191 | 3.76/8.09 | {"reached":413,"projected":7} | 112 / 112 | 203/169 |
| die-slot / chained | 9.68/14.56 | 2.3/4.71 | 2.54/5.34 | 176/223 | 2.62/4.89 | {"reached":413,"projected":7} | 112 / 112 | 177/132 |
| arm / from-start | 0.3/0.75 | 0.44/1.05 | 0.29/0.72 | 128/197 T | 0.31/0.72 | {"reached":287,"projected":42} | 1.273516399504808 / 1.273516399504808 | 158/149 |
| arm / chained | 0.23/0.47 | 0.32/0.83 | 0.28/0.75 | 130/170 | 0.24/0.51 | {"reached":287,"projected":42} | 1.2735163995048047 / 1.2735163995048047 | 181/155 |
| four-bar / from-start | 0.39/0.93 | 0.63/1.34 | 0.65/1.17 | 183/162 | 0.94/1.72 | {"projected":70} | 32.520762598684556 / 32.520762598684556 | 141/135 |
| four-bar / chained | 0.25/0.63 | 0.31/0.73 | 0.37/0.91 | 179/148 | 0.33/0.98 | {"projected":70} | 32.520762598684556 / 32.520762598684556 | 177/158 |
| tangency / from-start | 0.29/1.77 | 18.79/32.02 | 0.48/3.26 | 206/159 | 0.53/1.22 | {"stalled":21,"limited":7} | 0.0000073554477301270575 / 0.000007500000000000001 | 235/201 |
| tangency / chained | 0.29/1.99 | 14.5/36.87 | 0.45/1.76 | 151/138 | 0.61/0.92 | {"stalled":21,"limited":7} | 0.0000073554477301270575 / 0.000007500000000000001 | 225/193 |

| Sweep | PlaneGCS sum ms | Native first sum ms | Native only sum ms | 0.0.756 CPU | 0.0.757 native sum ms | 0.0.757 answers | 0.0.757 CPU |
| --- | ---: | ---: | ---: | --- | ---: | --- | --- |
| die (120 drags) | 613.2 | 485.7 | 499.1 | 138/122 | 564.4 | {"native:answer":120} | 206/215 |
| free-die (126 drags) | 605.8 | 490.7 | 496.7 | 135/162 | 519.3 | {"native:answer":126} | 228/144 T |

| Cold | Bytes / gzip | Read + compile + instantiate ms | First answer p50 ms | CPU |
| --- | --- | ---: | --- | --- |
| 0.0.756 module planegcs | 484003 / 174403 | 10.46 | | 167/137 |
| 0.0.756 module native | 210230 / 70323 | 2.11 | | 167/137 |
| 0.0.756 first answer planegcs | | | 20.85 (solved) | 167/137 |
| 0.0.756 first answer native-only | | | 9.1 (solved native:answer) | 167/137 |
| 0.0.756 first answer native-first | | | 9.02 (solved native:answer) | 167/137 |
| 0.0.756 first answer native-first-fallback | | | 22.87 (rejected:conflicting planegcs:start-diagnosis:planegcs-conflicting) | 167/137 |
| 0.0.757 module native | 210230 / 70323 | 2.12 | | 147/178 |
| 0.0.757 first answer native | | | 11.25 (solved native:answer) | 147/178 |

| Memory | Largest WASM capacity over the fixtures, MiB | Fixtures that loaded PlaneGCS | Die re-solved 1000 times, WASM MiB after 1 / 1000 calls | Die-slot frames 1000 times, WASM MiB after 1 / 1000 calls |
| --- | ---: | ---: | --- | --- |
| 0.0.756 planegcs | 21.06 | 30 of 30 | 21.06 / 21.06 | 21.06 / 21.06 |
| 0.0.756 native-only | 1.94 | 0 of 30 | 1.13 / 1.13 | 1.13 / 1.25 |
| 0.0.756 native-first | 22.19 | 3 of 30 | 1.13 / 1.13 | 1.13 / 1.25 |
| 0.0.757 native | 1.94 | 0 of 30 | 1.13 / 1.13 | 1.13 / 1.25 |

| Capacity | Largest connected rectangles under 1 s | Next |
| --- | ---: | --- |
| 0.0.756 planegcs | 88 | 89 (throttled boundary) |
| 0.0.756 native-only | 4096 | at least largest probed; search capped at 4096 rectangles |
| 0.0.757 native | 4096 | at least largest probed; search capped at 4096 rectangles |
