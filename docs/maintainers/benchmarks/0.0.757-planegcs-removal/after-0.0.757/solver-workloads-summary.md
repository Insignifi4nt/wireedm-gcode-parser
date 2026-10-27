App 0.0.757, commit e29374e2ed8c005dded6781f4ad24e220ceb6ea0; Intel(R) Core(TM) i9-14900HX, 32 cores, Node v24.22.1 on win32; 7 runs; native.

| Workload / operation | native p50 ms | CPU ms before/after |
| --- | ---: | --- |
| conflicting-distances / first-solve | 0.2 rejected:conflicting | 213.27/180.69 |
| conflicting-distances / re-solve | skipped | 213.27/180.69 |
| conflicting-triangle / first-solve | 0.44 rejected:conflicting | 184.19/156.02 |
| conflicting-triangle / re-solve | skipped | 184.19/156.02 |
| connected-60 / first-solve | 3.5 solved | 59.84/63.96 |
| connected-60 / re-solve | 1.65 solved | 59.84/63.96 |
| connected-88 / first-solve | 4.47 solved | 62.37/63.17 |
| connected-88 / re-solve | 1.84 solved | 62.37/63.17 |
| die-constrained / first-solve | 2.56 solved | 155.16/158 |
| die-constrained / re-solve | 1.81 solved | 155.16/158 |
| die-free / first-solve | 5.13 solved | 177.18/217.26 |
| die-free / re-solve | 2.25 solved | 177.18/217.26 |
| fixed-point-vs-dimension / first-solve | 0.24 rejected:conflicting | 197.87/192.27 |
| fixed-point-vs-dimension / re-solve | skipped | 197.87/192.27 |
| fully-fixed-conflict-with-free / first-solve | 0.2 rejected:conflicting | 143.32/139.88 |
| fully-fixed-conflict-with-free / re-solve | skipped | 143.32/139.88 |
| fully-fixed-conflict / first-solve | 0.17 rejected:conflicting | 207.05/217.49 |
| fully-fixed-conflict / re-solve | skipped | 207.05/217.49 |
| fully-fixed-satisfied-with-free / first-solve | 0.09 rejected:redundant | 126.66/137.82 |
| fully-fixed-satisfied-with-free / re-solve | skipped | 126.66/137.82 |
| fully-fixed-satisfied / first-solve | 0.17 solved | 187.62/187.2 |
| fully-fixed-satisfied / re-solve | 0.14 solved | 187.62/187.2 |
| impossible-triangle / first-solve | 0.52 rejected:failed | 237.22/189.78 |
| impossible-triangle / re-solve | skipped | 237.22/189.78 |
| numeric-far-origin / first-solve | 0.27 solved | 141.76/170.94 |
| numeric-far-origin / re-solve | 0.21 solved | 141.76/170.94 |
| numeric-mixed-scales / first-solve | 0.77 solved | 164.35/160.34 |
| numeric-mixed-scales / re-solve | 0.47 solved | 164.35/160.34 |
| numeric-tiny / first-solve | 0.43 solved | 181.2/183.67 |
| numeric-tiny / re-solve | 0.33 solved | 181.2/183.67 |
| overlapping-conflicts-repeated / first-solve | 0.45 rejected:conflicting | 216.3/173.29 |
| overlapping-conflicts-repeated / re-solve | skipped | 216.3/173.29 |
| overlapping-conflicts / first-solve | 0.58 rejected:conflicting | 130.13/140.85 |
| overlapping-conflicts / re-solve | skipped | 130.13/140.85 |
| partial-coincident-horizontal / first-solve | 0.45 rejected:redundant | 226.62/207.47 |
| partial-coincident-horizontal / re-solve | skipped | 226.62/207.47 |
| partial-symmetry-midpoint / first-solve | 0.15 rejected:redundant | 221.24/214.87 |
| partial-symmetry-midpoint / re-solve | skipped | 221.24/214.87 |
| rectangles-10 / first-solve | 1.07 solved | 62.88/64.79 |
| rectangles-10 / re-solve | 0.5 solved | 62.88/64.79 |
| rectangles-200 / first-solve | 9.09 solved | 66.22/63.89 |
| rectangles-200 / re-solve | 4.66 solved | 66.22/63.89 |
| rectangles-60 / first-solve | 3.04 solved | 64.87/63.83 |
| rectangles-60 / re-solve | 1.69 solved | 64.87/63.83 |
| redundant-distances / first-solve | 0.14 rejected:redundant | 190.06/177.95 |
| redundant-distances / re-solve | skipped | 190.06/177.95 |
| tangency-exact / first-solve | 1.53 solved | 136.05/146.82 |
| tangency-exact / re-solve | 1.71 solved | 136.05/146.82 |
| tangency-near / first-solve | 2.05 solved | 202.09/126.76 THROTTLED |
| tangency-near / re-solve | 1.23 solved | 202.09/126.76 THROTTLED |
| topology-branch / first-solve | 0.88 solved | 63.86/63.51 |
| topology-branch / re-solve | 0.55 solved | 63.86/63.51 |
| topology-hub-shuffled / first-solve | 3.37 solved | 162.06/200.24 |
| topology-hub-shuffled / re-solve | 1.76 solved | 162.06/200.24 |
| topology-hub / first-solve | 0.99 solved | 61.23/60.24 |
| topology-hub / re-solve | 0.57 solved | 61.23/60.24 |
| topology-loop / first-solve | 0.63 solved | 61.6/68.4 |
| topology-loop / re-solve | 0.42 solved | 61.6/68.4 |
| topology-open / first-solve | 1.67 solved | 60.3/68.47 |
| topology-open / re-solve | 0.67 solved | 60.3/68.47 |
| die-dimension-edits / dimension-plus-0.5-mm | 3.71 solved | 185.13/201.77 |
| die-dimension-edits / dimension-plus-20-percent | 4.19 solved | 185.13/201.77 |
| die-constraint-edits / constraint-addition | 2.06 solved | 168.96/180.06 |
| die-constraint-edits / constraint-removal | 2.39 solved | 168.96/180.06 |

| Drag trajectory / mode | Solver | p50/p95 ms | Outcomes | Drag outcomes | Largest target error mm | CPU ms |
| --- | --- | ---: | --- | --- | ---: | --- |
| die-slot / from-start | native | 3.76/8.09 | {"solved":420} | {"reached":413,"projected":7} | 112.0 | 203.05/169.4 |
| die-slot / chained | native | 2.62/4.89 | {"solved":420} | {"reached":413,"projected":7} | 112.0 | 177.27/131.58 |
| arm / from-start | native | 0.31/0.72 | {"solved":329} | {"reached":287,"projected":42} | 1.274 | 158.2/148.96 |
| arm / chained | native | 0.24/0.51 | {"solved":329} | {"reached":287,"projected":42} | 1.274 | 181.3/155.33 |
| four-bar / from-start | native | 0.94/1.72 | {"solved":70} | {"projected":70} | 32.52 | 141/134.93 |
| four-bar / chained | native | 0.33/0.98 | {"solved":70} | {"projected":70} | 32.52 | 177.39/158.22 |
| tangency / from-start | native | 0.53/1.22 | {"solved":28} | {"stalled":21,"limited":7} | 0.000007500 | 235.19/201.23 |
| tangency / chained | native | 0.61/0.92 | {"solved":28} | {"stalled":21,"limited":7} | 0.000007500 | 225.39/193.48 |

| Sweep | Solver | Drags | Sum ms | p50 ms | Answers | CPU ms |
| --- | --- | ---: | ---: | ---: | --- | --- |
| die | native | 120 | 564.4 | 4.6 | {"native:answer":120} | 206.21/214.78 |
| free-die | native | 126 | 519.3 | 3.56 | {"native:answer":126} | 227.68/144.31 THROTTLED |

| Module | Bytes | Gzip bytes | Read + compile + instantiate ms |
| --- | ---: | ---: | ---: |
| native | 210230 | 70323 | 2.12 |

Cold processes, CPU ms before/after: 147.33/177.91

| Cold scenario | First answer p50 ms | Outcome | Checks |
| --- | ---: | --- | --- |
| native | 11.25 | solved native:answer | passed |

| Capacity | Largest connected rectangles under 1 s | Next |
| --- | ---: | ---: |
| native | 4096 | not reached |
