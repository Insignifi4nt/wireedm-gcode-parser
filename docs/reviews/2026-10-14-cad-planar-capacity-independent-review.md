# Independent uncapped planar capacity review

Baseline: `c36aa3b50a30f82ded3508652d9e7917c69b6b59`. Reviewed the four repairs and new regressions pinned in `tmp/cad-source-planar-capacity-final-hashes.json` and `2026-10-14-cad-uncapped-planar-capacity-audit.md`. No owner source/tests, servers, browsers, public docs or commits were changed by this reviewer.

**No actionable product-semantic defect found.** One verification reliability concern was reported to the original owner and parent: the large LWPOLYLINE regression exceeded its 15-second test deadline during concurrent gates, then passed unchanged in isolation. That observation is recorded separately from geometry correctness below.

## Streaming extrema and ordered appends

`cadPocketSectionScale` computes the same polygon extrema with initial `+Infinity` minima and `-Infinity` maxima. Pairwise `Math.min/max` preserve finite values, NaN propagation, infinities, signed-zero extrema and the existing empty-array result. It does not change the returned width/height minimum or precision policy. The accepted 131,072-edge Pocket regression verifies the complete edge count, one region, 20 mm scale, unchanged prior features and exact original document.

`fromDxfEntities` replaces only polyline result `push(...array)` calls with ordered `for...of` appends. Segment and diagnostic identity/order are preserved. Diagnostic base indices are still calculated before append. There is no new filtering, source-index synthesis, geometry approximation or resource policy. The complete LWPOLYLINE/POLYLINE cases retain every 131,072 line endpoint and original source, including actual inch-to-mm scaling.

`planOperations` preserves the source-order minimum with initial positive Infinity and pairwise `Math.min`. Empty provenance still sorts as Infinity, and special numeric behavior is unchanged. The real CAD handoff verifies every source index, complete contour/operation provenance, all edges in one ordered operation, independent polygon area/perimeter and the unchanged accepted input. Existing shared path-planning tests verify ordinary CAM ordering semantics.

## Lazy INSERT stack

The former recursive `resolveBlock` is replaced by an explicit stack of suspended entity parsers. Each generator retains its authored index and locals; a parent resumes with the completed child at that exact INSERT position. Only a valid INSERT suspends parsing. The `yield* expandInsert` delegation has fixed depth: child block parsing is scheduled by the explicit frame stack rather than recursive generator delegation.

The resolver preserves the important ordering:

- Instance accounting occurs before block lookup, including missing blocks.
- Cached normalized names are checked before raw definitions, malformed bases, active-cycle checks and depth checks, as before.
- Only completed definitions are cached. The active-name set tracks the current DFS ancestry; completing a frame removes its name before its parent resumes.
- Malformed bases, missing blocks and cycles keep the existing diagnostics/unsupported outcomes. Exact CAD import still refuses partial material.
- Parsed local entities remain the cached source. Unchanged transform functions produce each instance with its actual base-point subtraction, scale/reflection, rotation, array spacing, layer and authored provenance.
- Parent entity order, row/column expansion order, warning/unsupported propagation and source indices remain unchanged.

Default CAM keeps its existing budget checks, including insert depth and instances. Exact CAD keeps the earlier no-policy-ceiling behavior while rejecting unsafe/nonnegative counter arithmetic. Resource failures terminate the same pure parse; suspended frames own no native resource or external write requiring cleanup. No accepted partial result is returned after an exception.

The deep 2,048-definition regression checks every member of the 2,049-entry provenance chain, complete translated circle geometry and exact saved source. Deep cycle/malformed leaf cases still reject with `dxf-inexact`; default CAM still rejects the depth. Small shared parser regressions cover transformations, paper-space handling, malformed geometry, tiny arc/reflection behavior and nonuniform-scale rejection.

An independent ignored harness, `tmp/cad-insert-independent-review.ts`, loads the actual checkpoint parser through local TypeScript transpilation and compares it with current source. **All 18 complete outcomes matched** across both CAM and exact-CAD modes: nested DAG/repeated cached definitions, normalized aliases, reflected/rotated block arrays, base points, authored siblings, unknown/malformed/cyclic blocks, lazy unused deep definitions, used-depth limits, missing-block instance accounting and unsafe instance counts. Geometry, ordering, provenance, warning multiplicity and exact budget/error messages matched. This is a small parity check, not a native or large-parser benchmark.

## Independent verification and timing concern

Runtime: **Node v24.22.0** using the parent’s pinned toolchain PATH.

The focused eight-suite run completed **119/120 tests**, with only the new 131,073-vertex LWPOLYLINE test timing out at 16.02 seconds against its 15-second deadline. It produced no geometry/assertion mismatch. The unchanged polyline file then passed **2/2** under `--maxWorkers=1 --fileParallelism=false`; test execution totaled 10.91 seconds, run total 12.49 seconds. The independent parity harness passed all 18 cases.

Logs: `tmp/cad-planar-capacity-independent-node24.log`, `tmp/cad-polyline-capacity-independent-isolated-node24.log`, `tmp/cad-insert-independent-review.log`.

The original owner and parent were notified of the timeout sensitivity. A proportionate 30-second budget for this capacity regression, matching its dense handoff sibling, or less concurrent scheduling can improve gate reliability without weakening any geometry assertion. This reviewer made no timeout/source edit while the parent’s full gate was running. The initial eight-suite run is not represented as a clean pass, nor does the isolated result prove a universal runtime guarantee.

Remaining limitations are stated in the owner’s audit: warning argument spreads were inventoried but not claimed repaired; cached nested provenance and full exact geometry still consume physical resources. This review does not add source/geometry policy ceilings, promise bounded physical memory, or claim the entire CAD goal complete. Root’s current full gate remains the integration check.

## Frozen hashes

All entries in the supplied hash record matched at review time, including these production files:

| File | SHA-256 |
| --- | --- |
| `src/domain/cad/cadPocketSectionScale.ts` | `bd9792289c5cb4870986763a29225541d4578b367e7526bb7067e6c627b1376f` |
| `src/domain/path-intel/fromDxfEntities.ts` | `b959ae32f5bbbd80fb48e953c683f9945aeadf06c09a419f8f006c125bab23d6` |
| `src/domain/dxf/parseDxf.ts` | `b0a6c2a6aaf462e851618019188d37441dcfb3852629362c7f8ea63cd07b45f8` |
| `src/domain/path-intel/planOperations.ts` | `87a484e1e31a88a187aa275eb9fbfcd339be0ba8b2b1fd9a78adb6fdcd477bca` |
| `src/domain/cad/__tests__/cadPocketCapacity.test.ts` | `d7aa96ecf1309d7610f9c1d4ba6aeeecb8a0b2bd6bca6bf63d148cff4c2666a0` |
| `src/domain/cad/__tests__/cadDxfPolylineCapacity.test.ts` | `982ee2ba1bee112d900cbbe8f229467c160cbd66b99ff0b24c227aee98f17631` |
| `src/domain/dxf/__tests__/parseDxfExactCad.test.ts` | `155455868665a64c4b1db229e722b0899e8e71b21e6e5786fde51bfd7e80a4d9` |
| `src/domain/cad/__tests__/cadHandoffCapacity.test.ts` | `4e2b294819c73ca56f4bc537df74f2a4b809a49717aa3ca5017b966e7a54999e` |

## Authorized fixture-timeout follow-up

The original owner applied the parent's authorized change: only the final execution timeout of `cadDxfPolylineCapacity.test.ts` changed from 15,000 to 30,000 ms. Its current SHA-256 is `796ce570d4a6b35d5656322983c9b63a9fe704b969bc376c1e1f9fb342120ed5`. Replacing that one timeout literal with its original value produces the exact frozen prior SHA-256 `982ee2ba1bee112d900cbbe8f229467c160cbd66b99ff0b24c227aee98f17631`, independently confirming every source/geometry/units/provenance assertion and all other test bytes are unchanged. No global timeout, product limit or performance criterion changed. Because the same fixture already passed unchanged in isolation and the parent reports its full Node 24 run passed both large fixtures before this adjustment, no further duplicate execution was needed for this literal-only repair. The parent’s separate gzip gate failure is outside this planar slice.
