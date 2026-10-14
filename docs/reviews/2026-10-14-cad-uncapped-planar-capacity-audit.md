# Uncapped CAD planar capacity audit

Baseline: `c36aa3b50a30f82ded3508652d9e7917c69b6b59`. Scope: accepted CAD/source geometry after static import and serialized-array count policies were removed. Inspected source parsing, planar helpers and their shared path-intelligence dependencies. Native benchmarks, viewport changes and the other owners' closure-tolerance/Section/Export seams are outside this slice.

The audit uses actual complete CAD/DXF inputs. It does not equate an arbitrary JavaScript argument-count limit with a geometric or file-size limit.

## Proven and repaired

1. **Pocket polygon precision preflight.** A valid convex 131,072-edge polygon passes `parseCadDocument`, but adding a Through-all Pocket threw `RangeError` at `cadPocketSectionScale.ts:15` because all X/Y coordinates became arguments to `Math.min/max`. The helper now calculates the same coordinate extrema in one pass. No coordinate arrays or call-arity assumption remain. The accepted entire section reports exactly 131,072 edges, one region and 20 mm precision-support scale; the original document remains unchanged.

2. **DXF polyline to analytic segment conversion.** Actual LWPOLYLINE and classic POLYLINE with 131,073 finite vertices failed at `fromDxfEntities.ts:274/291` while appending complete segment arrays through `push(...segments)`. Both segment and diagnostic appends now use ordered loops. Complete Curve tests verify every one of the 131,072 stored line endpoints, original source text and units; LWPOLYLINE uses millimetres and classic POLYLINE uses inches. No source vertices, diagnostic rows or segments are filtered to avoid the failure.

3. **Lazy DXF block resolution.** A complete 104,416-byte DXF containing 2,048 acyclic nested INSERT definitions and one final circle overflowed recursive `resolveBlock`/entity parsing/INSERT expansion. Entity parsing now suspends at a valid INSERT; an explicit frame stack resolves child blocks in the same lazy depth-first order and resumes each parent at its authored entity position. Completed blocks retain the existing normalized-name cache. Cycle and malformed-base-point outcomes, instance accounting before lookup, native-free transforms, source ordering and provenance remain unchanged. Default CAM still enforces its existing insert-depth policy.

Deep public-import coverage checks every INSERT in the 2,049-entry provenance chain, the independently accumulated translated circle centre/radius, one complete contour and exact saved DXF text. Deep cycles and a malformed leaf still return `dxf-inexact`, preserving the refusal to accept partial material.

4. **CAD-to-CAM source ordering.** After the three repairs, the same accepted dense polygon reached another argument overflow in `cadSketchToCam`: `planOperations.ts:300`, `Math.min(...contour.provenance.sourceEntityIndices)`. The actual handoff creates one distinct exact source entity per edge, so its one closed contour carries 131,072 indices. After separate authorization, the source-order minimum now streams over every index. Pairwise `Math.min` preserves the current numeric semantics, including NaN, signed zero and infinities; the initial positive Infinity preserves the empty-provenance rule.

The actual public CAD handoff regression verifies every stored line endpoint and exact source index, complete ordered contour/operation provenance, one operation containing every edge, independently computed polygon area and perimeter, and an unchanged input document. The repair does not shorten or sort the saved source identities to fit an argument limit.

## Call-spread inventory

`tmp/cad-call-spread-inventory.mjs` inventories call/new-expression spreads through the TypeScript AST, including multiline calls. Its output is `tmp/cad-call-spread-inventory.log`.

Safe retained calls were checked by provenance: three-dimensional frame/mesh points, two-dimensional endpoints, the three selected points in an arc solve, two placed extrusion origins, fixed boundary-bounds fields, and the existing bounded Loft section list. Base64 encoding spreads at most 24,576 bytes per aligned chunk. Gear-help points remain subject to the existing authored gear edge policy; this slice does not remove those separate generator/operation policies. Array-literal and object spreads do not consume function-call arity and were not replaced merely for appearance.

The independently assigned closure-tolerance maximum and viewport/reference limits remain with their owner. The large Curve regressions exercise the owner's completed iterative closure-tolerance repair without editing that source.

Unbounded expanded warning argument spreads in the tolerant DXF parser were also inventoried. No valid accepted CAD reproduction of those calls was established in this slice; they are not claimed repaired or used to justify unrelated warning architecture changes.

## Verification

- Isolated original source-only probes completed in 2.57 s, reproducing all three independent failures on complete inputs (`tmp/cad-source-planar-capacity-probe.log`). No WASM or browser was used.
- Red-first formal regressions: five genuine failures before repairs, three existing exact-CAD cases passed (`tmp/cad-source-planar-capacity-red.log`).
- Shared CAM/DXF/Pocket/path-planning gate: **143/143**, seven suites (`tmp/cad-source-planar-capacity-gate.log`). This covers unchanged default CAM limits, transforms, polyline integrity and existing plan semantics.
- Final CAD source/geometry integrity: **91/91**, four suites (`tmp/cad-source-planar-capacity-final.log`).
- App TypeScript and `git diff --check`: passed (`tmp/cad-source-planar-capacity-tsc.log`).
- The separately authorized handoff case reproduced `RangeError` through the actual public CAD operation before its minimum repair, using **Node 24.22.0** (`tmp/cad-handoff-capacity-red-node24.log`).
- Final combined verification of all four repairs and shared CAD/CAM semantics under **Node 24.22.0**: **230/230**, eleven suites, duration 12.43 s (`tmp/cad-uncapped-planar-node24-final.log`). No performance threshold is asserted.
- Final app TypeScript and diff check under **Node 24.22.0**: passed (`tmp/cad-source-planar-node24-tsc.log`). The running preview and browser state were untouched.

The first green run exposed an overly specific new test message expectation; it was corrected to assert the existing `dxf-inexact` code. The actual rejection policy and production diagnostic wording were unchanged.

This record covers the scoped planar repairs. It does not claim unlimited physical resources or completion of the overall CAD goal.
