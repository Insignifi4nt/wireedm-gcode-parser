App 0.0.756, commit 8dedfaeeb5b9331106179e877a20fba34b987672 with uncommitted changes 013516e6ead638fb16145f105614e4fc32a10c931650fd49883740b1a35e5e66; Intel(R) Core(TM) i9-14900HX, 32 cores, Node v24.22.1 on win32; 7 runs; planegcs, native-only, native-first.

| Workload / operation | planegcs p50 ms | native-only p50 ms | native-first p50 ms | CPU ms before/after |
| --- | ---: | ---: | ---: | --- |
| conflicting-distances / first-solve | 0.29 rejected:conflicting | 0.17 rejected:conflicting | 0.2 rejected:conflicting | 128.97/128.82 |
| conflicting-distances / re-solve | skipped | skipped | skipped | 128.97/128.82 |
| conflicting-triangle / first-solve | 0.46 rejected:conflicting | 0.32 rejected:conflicting | 0.26 rejected:conflicting | 192.35/135.78 |
| conflicting-triangle / re-solve | skipped | skipped | skipped | 192.35/135.78 |
| connected-60 / first-solve | 32.34 solved | 3.05 solved | 3.11 solved | 59.89/156.29 THROTTLED |
| connected-60 / re-solve | 15.55 solved | 1.45 solved | 1.36 solved | 59.89/156.29 THROTTLED |
| connected-88 / first-solve | 235.63 solved | 10.78 solved | 14.13 solved | 157.34/114.87 |
| connected-88 / re-solve | 125.48 solved | 5.53 solved | 4.81 solved | 157.34/114.87 |
| die-constrained / first-solve | 8.87 solved | 3.72 solved | 3.92 solved | 169.29/204.3 |
| die-constrained / re-solve | 4.79 solved | 4.22 solved | 2.29 solved | 169.29/204.3 |
| die-free / first-solve | 5.21 solved | 3.34 solved | 3.57 solved | 180.03/176.74 |
| die-free / re-solve | 3.98 solved | 1.92 solved | 2.32 solved | 180.03/176.74 |
| fixed-point-vs-dimension / first-solve | 0.28 rejected:conflicting | 0.21 rejected:conflicting | 0.17 rejected:conflicting | 140.37/125.62 |
| fixed-point-vs-dimension / re-solve | skipped | skipped | skipped | 140.37/125.62 |
| fully-fixed-conflict-with-free / first-solve | 0.82 rejected:conflicting | 0.21 rejected:conflicting | 0.19 rejected:conflicting | 152.72/176.2 |
| fully-fixed-conflict-with-free / re-solve | skipped | skipped | skipped | 152.72/176.2 |
| fully-fixed-conflict / first-solve | 0.11 rejected:invalid-solution | 0.12 rejected:conflicting | 0.1 rejected:conflicting | 215.75/152.31 |
| fully-fixed-conflict / re-solve | skipped | skipped | skipped | 215.75/152.31 |
| fully-fixed-satisfied-with-free / first-solve | 0.75 rejected:redundant | 0.11 rejected:redundant | 0.11 rejected:redundant | 148.49/145.36 |
| fully-fixed-satisfied-with-free / re-solve | skipped | skipped | skipped | 148.49/145.36 |
| fully-fixed-satisfied / first-solve | 0.16 solved | 0.22 solved | 0.15 solved | 173.29/134.16 |
| fully-fixed-satisfied / re-solve | 0.11 solved | 0.17 solved | 0.16 solved | 173.29/134.16 |
| impossible-triangle / first-solve | 0.5 rejected:failed | 0.47 rejected:failed | 12.81 rejected:failed | 163.44/131.82 |
| impossible-triangle / re-solve | skipped | skipped | skipped | 163.44/131.82 |
| numeric-far-origin / first-solve | 0.3 solved | 0.31 solved | 0.21 solved | 135.53/123.2 |
| numeric-far-origin / re-solve | 0.24 solved | 0.27 solved | 0.17 solved | 135.53/123.2 |
| numeric-mixed-scales / first-solve | 0.49 solved | 0.6 solved | 0.55 solved | 154.25/146.18 |
| numeric-mixed-scales / re-solve | 0.41 solved | 0.26 solved | 0.25 solved | 154.25/146.18 |
| numeric-tiny / first-solve | 0.45 solved | 0.34 solved | 0.32 solved | 145.33/169.31 |
| numeric-tiny / re-solve | 0.41 solved | 0.25 solved | 0.25 solved | 145.33/169.31 |
| overlapping-conflicts-repeated / first-solve | 0.81 rejected:conflicting | 0.87 rejected:conflicting | 21.82 rejected:conflicting | 178.15/169.38 |
| overlapping-conflicts-repeated / re-solve | skipped | skipped | skipped | 178.15/169.38 |
| overlapping-conflicts / first-solve | 0.48 rejected:conflicting | 0.51 rejected:conflicting | 13.83 rejected:conflicting | 132.37/129.82 |
| overlapping-conflicts / re-solve | skipped | skipped | skipped | 132.37/129.82 |
| partial-coincident-horizontal / first-solve | 0.69 rejected:redundant | 0.3 rejected:redundant | 0.25 rejected:redundant | 294.44/199.11 |
| partial-coincident-horizontal / re-solve | skipped | skipped | skipped | 294.44/199.11 |
| partial-symmetry-midpoint / first-solve | 0.8 rejected:redundant | 0.22 rejected:redundant | 0.21 rejected:redundant | 225.54/205.92 |
| partial-symmetry-midpoint / re-solve | skipped | skipped | skipped | 225.54/205.92 |
| rectangles-10 / first-solve | 1.32 solved | 0.85 solved | 0.81 solved | 64.65/64.64 |
| rectangles-10 / re-solve | 1.17 solved | 0.4 solved | 0.4 solved | 64.65/64.64 |
| rectangles-200 / first-solve | 11.78 solved | 8.35 solved | 7.95 solved | 52.93/59.91 |
| rectangles-200 / re-solve | 11.31 solved | 4.06 solved | 3.91 solved | 52.93/59.91 |
| rectangles-60 / first-solve | 4.26 solved | 3.21 solved | 3.17 solved | 84.25/60.53 |
| rectangles-60 / re-solve | 3.85 solved | 1.55 solved | 1.65 solved | 84.25/60.53 |
| redundant-distances / first-solve | 0.76 rejected:redundant | 0.23 rejected:redundant | 0.32 rejected:redundant | 135.13/177.97 |
| redundant-distances / re-solve | skipped | skipped | skipped | 135.13/177.97 |
| tangency-exact / first-solve | 2.64 solved | 1.63 solved | 1.46 solved | 168.24/185.55 |
| tangency-exact / re-solve | 2.8 solved | 1.36 solved | 1.35 solved | 168.24/185.55 |
| tangency-near / first-solve | 2.92 rejected:invalid-solution | 2.06 solved | 2.8 solved | 122.42/190.8 THROTTLED |
| tangency-near / re-solve | skipped | 1.14 solved | 1.06 solved | 122.42/190.8 THROTTLED |
| topology-branch / first-solve | 3.93 solved | 2.03 solved | 2.1 solved | 143.45/213.72 |
| topology-branch / re-solve | 4.31 solved | 1.19 solved | 1.28 solved | 143.45/213.72 |
| topology-hub-shuffled / first-solve | 5.05 solved | 2.78 solved | 2.37 solved | 188.47/135.09 |
| topology-hub-shuffled / re-solve | 3.77 solved | 1.48 solved | 1.21 solved | 188.47/135.09 |
| topology-hub / first-solve | 2.63 solved | 1.64 solved | 2.12 solved | 159.75/148.93 |
| topology-hub / re-solve | 2.92 solved | 1.31 solved | 0.89 solved | 159.75/148.93 |
| topology-loop / first-solve | 4.91 solved | 2.34 solved | 1.84 solved | 122.25/158.7 |
| topology-loop / re-solve | 3.7 solved | 1.26 solved | 1.11 solved | 122.25/158.7 |
| topology-open / first-solve | 20.31 solved | 2.88 solved | 2.68 solved | 132.13/122.1 |
| topology-open / re-solve | 5.64 solved | 1.1 solved | 1.05 solved | 132.13/122.1 |
| die-dimension-edits / dimension-plus-0.5-mm | 5.85 solved | 3.18 solved | 2.75 solved | 113.07/135.79 |
| die-dimension-edits / dimension-plus-20-percent | 6.67 solved | 2.97 solved | 2.61 solved | 113.07/135.79 |
| die-constraint-edits / constraint-addition | 2.43 solved | 1.2 solved | 1.19 solved | 129.83/183.31 |
| die-constraint-edits / constraint-removal | 2.18 solved | 1.61 solved | 1.12 solved | 129.83/183.31 |

| Drag trajectory / mode | Solver | p50/p95 ms | Outcomes | Drag outcomes | Largest target error mm | CPU ms |
| --- | --- | ---: | --- | --- | ---: | --- |
| die-slot / from-start | planegcs | 9.56/13.96 | {"solved":420} | {"reached":413,"projected":7} | 112.0 | 209.38/191.14 |
| die-slot / from-start | native-only | 3.43/7.7 | {"solved":420} | {"reached":413,"projected":7} | 112.0 | 209.38/191.14 |
| die-slot / from-start | native-first | 3.3/7.04 | {"solved":420} | {"reached":413,"projected":7} | 112.0 | 209.38/191.14 |
| die-slot / chained | planegcs | 9.68/14.56 | {"solved":420} | {"reached":413,"projected":7} | 112.0 | 175.89/223.07 |
| die-slot / chained | native-only | 2.54/5.34 | {"solved":420} | {"reached":413,"projected":7} | 112.0 | 175.89/223.07 |
| die-slot / chained | native-first | 2.3/4.71 | {"solved":420} | {"reached":413,"projected":7} | 112.0 | 175.89/223.07 |
| arm / from-start | planegcs | 0.3/0.75 | {"solved":329} | {"reached":287,"projected":42} | 1.274 | 128.41/197.05 THROTTLED |
| arm / from-start | native-only | 0.29/0.72 | {"solved":329} | {"reached":287,"projected":42} | 1.274 | 128.41/197.05 THROTTLED |
| arm / from-start | native-first | 0.44/1.05 | {"solved":329} | {"reached":287,"projected":42} | 1.274 | 128.41/197.05 THROTTLED |
| arm / chained | planegcs | 0.23/0.47 | {"solved":329} | {"reached":280,"projected":49} | 4.967 | 129.98/169.88 |
| arm / chained | native-only | 0.28/0.75 | {"solved":329} | {"reached":287,"projected":42} | 1.274 | 129.98/169.88 |
| arm / chained | native-first | 0.32/0.83 | {"solved":329} | {"reached":287,"projected":42} | 1.274 | 129.98/169.88 |
| four-bar / from-start | planegcs | 0.39/0.93 | {"solved":70} | {"projected":70} | 33.24 | 183.37/162.25 |
| four-bar / from-start | native-only | 0.65/1.17 | {"solved":70} | {"projected":70} | 32.52 | 183.37/162.25 |
| four-bar / from-start | native-first | 0.63/1.34 | {"solved":70} | {"projected":70} | 32.52 | 183.37/162.25 |
| four-bar / chained | planegcs | 0.25/0.63 | {"solved":70} | {"projected":70} | 32.52 | 179.46/147.83 |
| four-bar / chained | native-only | 0.37/0.91 | {"solved":70} | {"projected":70} | 32.52 | 179.46/147.83 |
| four-bar / chained | native-first | 0.31/0.73 | {"solved":70} | {"projected":70} | 32.52 | 179.46/147.83 |
| tangency / from-start | planegcs | 0.29/1.77 | {"solved":28} | {"projected":21,"reached":7} | 0.000007355 | 206.08/158.86 |
| tangency / from-start | native-only | 0.48/3.26 | {"solved":28} | {"stalled":21,"limited":7} | 0.000007500 | 206.08/158.86 |
| tangency / from-start | native-first | 18.79/32.02 | {"solved":28} | {"stalled":21,"limited":7} | 0.000007355 | 206.08/158.86 |
| tangency / chained | planegcs | 0.29/1.99 | {"solved":28} | {"projected":21,"reached":7} | 0.000007355 | 151.43/138.48 |
| tangency / chained | native-only | 0.45/1.76 | {"solved":28} | {"stalled":21,"limited":7} | 0.000007500 | 151.43/138.48 |
| tangency / chained | native-first | 14.5/36.87 | {"solved":28} | {"stalled":21,"limited":7} | 0.000007355 | 151.43/138.48 |

| Sweep | Solver | Drags | Sum ms | p50 ms | Answers | Worse than first | CPU ms |
| --- | --- | ---: | ---: | ---: | --- | ---: | --- |
| die | planegcs | 120 | 613.2 | 5.1 | {} | 0 | 137.89/122.3 |
| die | native-only | 120 | 499.1 | 4.02 | {"native:answer":120} | 0 | 137.89/122.3 |
| die | native-first | 120 | 485.7 | 3.99 | {"native:answer":120} | 0 | 137.89/122.3 |
| free-die | planegcs | 126 | 605.8 | 4.55 | {} | 0 | 134.77/162.08 |
| free-die | native-only | 126 | 496.7 | 3.51 | {"native:answer":126} | 0 | 134.77/162.08 |
| free-die | native-first | 126 | 490.7 | 3.49 | {"native:answer":126} | 0 | 134.77/162.08 |

| Module | Bytes | Gzip bytes | Read + compile + instantiate ms |
| --- | ---: | ---: | ---: |
| planegcs | 484003 | 174403 | 10.46 |
| native | 210230 | 70323 | 2.11 |

Cold processes, CPU ms before/after: 167.1/137.31

| Cold scenario | First answer p50 ms | Outcome | Checks |
| --- | ---: | --- | --- |
| planegcs | 20.85 | solved | passed |
| native-only | 9.1 | solved native:answer | passed |
| native-first | 9.02 | solved native:answer | passed |
| native-first-fallback | 22.87 | rejected:conflicting planegcs:start-diagnosis:planegcs-conflicting | passed |

| Capacity | Largest connected rectangles under 1 s | Next |
| --- | ---: | ---: |
| planegcs | 88 | 89 THROTTLED |
| native-only | 4096 | not reached |
