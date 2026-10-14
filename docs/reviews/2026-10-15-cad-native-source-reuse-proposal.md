# Retained native source reuse: copy capability audit

Read-only audit at `a021bbcce199f3a737610977bb74a1bdf6c5e3f1`, using Node 24.22.0 and the installed single-threaded `replicad-opencascadejs` 1.1.0-wireedm.2 artifact. No production, tracked test, package, browser, server or release changes. This record is a proposal, not an implementation or a completed CAD performance claim.

## Decision

Repeated STEP transfer is substantial and worth optimizing, but **do not implement a retained-original cache with the currently exposed copy substitutes**. The identity-transform substitute shares mutable cylindrical pcurves. The BRep text substitute has independent ownership in the worked probes, but changes native numeric values. Neither proves the exact independent copy boundary required for reuse.

The smallest next investigation, if authorized separately, is a narrow binding for the existing pinned OCCT `BRepBuilderAPI_Copy` with geometry and mesh copying enabled. The installed binding does not expose that class. Its implementation uses a separate copy modification, including an explicit `Copy()` for each stored pcurve; this differs from transformation copying. This is a promising source-based proposal, not measured proof that every native geometry type copies without numeric changes. [Pinned Copy implementation](https://raw.githubusercontent.com/Open-Cascade-SAS/OCCT/b8f597c677811d1f9f4d8a97f5ae2825c0353a42/src/ModelingAlgorithms/TKTopAlgo/BRepBuilderAPI/BRepBuilderAPI_Copy.cxx), [pinned copy modification](https://raw.githubusercontent.com/Open-Cascade-SAS/OCCT/b8f597c677811d1f9f4d8a97f5ae2825c0353a42/src/ModelingData/TKBRep/BRepTools/BRepTools_CopyModification.cxx).

## Measured work and ownership

The existing phase audit measured an unchanged 3,469,018-byte gear STEP import taking 1,582.181 ms inside a 3,305.031 ms transform rebuild. Each model reconstructs the exact retained source, analyzes it, then meshes both the imported stage and transformed stage. This proposal targets transfer/analysis reuse only; result validation, topology, meshing, document parsing, transport and complete snapshot guards remain necessary.

The new isolated probe uses that same original file, SHA-256 `A501C92CAE766D9B4C518B5FD6CC571C89FD5970CF397C115E594AE82B52F182`. It uses real native geometry, validation, volume, transforms and the application's confirmed-material Cut. Measurements are one local run with modest repeats; they are not browser latency or universal performance thresholds.

| Operation on the retained gear | Warm samples | Median |
| --- | ---: | ---: |
| Full STEP reread, transfer and analysis | 3 | 1,738.186 ms |
| BRep text Write + Read | 7, after 2 warm copies | 26.848 ms |
| Read of a prewritten native BRep string | 7 | 22.626 ms |

One initial BRep Write took 20.344 ms and produced 729,402 bytes. Repeated full reread timings include source parsing, byte creation, own scratch-file handling, transfer and analysis; copy timings exclude the subsequent probe validation. These are different stages, deliberately reported as such. A future source cache would retain validated analysis while the ordinary model still validates every constructed result.

The text-copy probe establishes distinct TShapes, independently mutable sampled surfaces and pcurves for a box and a cylinder. Copies of the actual gear survive translation by 40 mm and a real radius-2, height-5 cylinder Cut inside gear material at X = 15. The removal agrees with independently expected `20π mm³` under unchanged checks. The original's volume and bounds stay exactly unchanged after these operations and candidate disposal. A fresh candidate remains valid after disposal of the original owner. All 135 application-scoped temporary owners created by the script are released; native reserved heap stays at 100 MiB over nine copy cycles. This accounts for probe-owned handles and reserved heap only, not every internal native allocation.

Two negative controls distinguish the dangerous copies:

- Replicad `Shape.clone()` produces a separate downcast wrapper but the same TShape. Disposing that wrapper leaves the other wrapper alive; geometry remains shared. [Pinned Replicad source](https://raw.githubusercontent.com/sgenoud/replicad/v1.1.0/packages/replicad/src/shapes.ts).
- Embind raw `clone()` is a reference-counted alias of one C++ wrapper. Calling `Nullify()` through that alias also nulls the original wrapper. The application deliberately uses this temporary alias inside its consuming-operation cleanup; that mechanism must never receive a retained cache original. [Embind ownership documentation](https://emscripten.org/docs/porting/connecting_cpp_and_javascript/embind.html#cloning-and-reference-counting).

## Why the available substitutes are rejected

**Identity transformation.** `BRepBuilderAPI_Transform(identity, true, true)` produces distinct TShapes, copied 3D surfaces and mesh copies where present. It nevertheless shares a stored cylindrical pcurve. In the real cylinder probe, translating the copied pcurve by `(7, 0)` changes the original sample from `[π, 5]` to `[π + 7, 5]`. The planar pcurve control stays unchanged. This is a native ownership counterexample, not an accusation that current ordinary transforms corrupt saved documents.

The pinned implementation explains the result: its nonplanar pcurve route calls `GeomLib::SameRange`, which returns the original curve handle when the ranges already agree. A topology copy therefore cannot be treated as a deep geometry copy solely because `IsSame` is false. [Pinned transform modification, lines 294–383](https://raw.githubusercontent.com/Open-Cascade-SAS/OCCT/b8f597c677811d1f9f4d8a97f5ae2825c0353a42/src/ModelingData/TKBRep/BRepTools/BRepTools_TrsfModification.cxx), [pinned SameRange, lines 792–809](https://raw.githubusercontent.com/Open-Cascade-SAS/OCCT/b8f597c677811d1f9f4d8a97f5ae2825c0353a42/src/ModelingData/TKGeomBase/GeomLib/GeomLib.cxx).

**BRep Write/Read.** The pinned wrapper uses 17-digit output and creates new topology during Read. This successfully separates the sampled surfaces/pcurves, but one actual gear round trip changes 50 of 114,888 numeric tokens, with maximum absolute difference `2.220446049250313e-16`. Several direction components change by one or two representable steps. A basic cylinder's measured volume changes from `251.3274122871834` to `251.32741228718362 mm³`. The independent Cut checks still pass, but this is not a numerically unchanged native copy. No tolerance was changed to hide this observation. [Pinned wrapper](https://raw.githubusercontent.com/sgenoud/replicad/e4b05f67dc4e2393a876ce8c5064a9c93db05bf1/packages/replicad-opencascadejs/build-config/wrappers/brep-io.cpp).

The wrapper also selects the native default that includes triangulation but excludes normals for geometric faces. It is unsuitable as a blanket promise to retain all native mesh metadata. Nothing was persisted or substituted for the portable original source. [Pinned Write defaults](https://raw.githubusercontent.com/Open-Cascade-SAS/OCCT/b8f597c677811d1f9f4d8a97f5ae2825c0353a42/src/ModelingData/TKBRep/BRepTools/BRepTools.hxx).

## Conditional minimal runtime design

After a true copy primitive passes native ownership and exactness tests, use one runtime-owned source store and one narrow model import-loader argument. Direct native model calls keep their existing loader default. The loader returns a caller-owned independent shape plus detached current analysis metadata; the model never receives the retained original, its wrappers or borrowed mutable analysis arrays.

Entries are keyed by complete validated original format/encoding/data and STL units, within the current runtime's pinned kernel identity. STEP declared units remain inside exact source text; no rewritten units or global scaling. Filename is validated on every request and supplied from the current source for analysis/diagnostics, even when native geometry can be reused. Full document and geometry keys remain unchanged initially, so feature names, STEP solid labels, accepted inspections and stale picks keep their existing behavior. No new persisted field, wire DTO, cryptographic key, request cap or arbitrary job-count reset is needed.

Retain only sources in the current accepted document, deduplicating an identical file used by two imported features while handing out independent shapes. Include suppressed source definitions in that active-document retention set if later unsuppress should reuse them. A document switch is a cold scope. Removed/replaced sources are released; runtime disposal and worker termination release all owners. Never accumulate every typed candidate or failed import.

Read-only section/export candidates need a source transaction matching the existing native model transaction: use existing originals without consuming them, own any newly loaded candidate originals separately, and commit/prune only after the query succeeds. On failure dispose candidate-only additions and candidate models, preserving the accepted source store, accepted model, exact full key and topology picks. Build publication can still adopt its diagnosed valid prefix under the current policy. Failures must not enter the source cache as successful imports.

Keep native result validation, manifoldness, unit capability diagnostics, topology and per-operation precision checks. An optimization may remove repeated source transfer/analysis; it cannot infer validity from filename, persisted BRep, a shallow object freeze or earlier downstream success.

## Meaningful future red cases

Before any cache implementation, prove a true copy leaves exact sampled surface/3D curve/pcurve data, topology tolerance, vertex coordinates, location transforms and triangulation nodes/UV/normals unchanged. Include cylindrical seams, spline geometry, located/rotated/far geometry, a compound with repeated located children, STL faceted material and source mesh metadata. Mutate candidate-owned geometry, mesh and topology through supported native APIs; original and sibling remain exact. Then perform real transform, Cut and model disposal, and dispose the cache original before an independent candidate.

Runtime regressions must cover exact source and STL-unit changes, valid filename-only changes, two uses of one source, suppressed/removed sources, document switch and clear/dispose. Failed read-only candidates preserve accepted cache/picks; failed new source additions are released; a subsequent valid source recovers. Copy construction or model failure releases each owner once. Retain current canceled/stale worker boundaries and prove ordinary source/schema errors occur before native reuse. Use actual native material, exports/sections and exact source retention, not mock speed or elapsed-time assertions.

## Evidence and freeze

Ignored measurement artifacts:

- `tmp/cad-native-identity-copy-pcurve-rejection.ts` and `.log`: real identity-copy pcurve counterexample.
- `tmp/cad-native-brep-roundtrip-exact-rejection.log`: the initial strict native BRep text equality rejection.
- `tmp/cad-native-source-copy-probe.ts`, `.log`, `.json`: completed serialization ownership, material and timing probe.
- `tmp/cad-native-source-reuse-audit-hashes.json`: exact source, fixture and probe hashes.

Production sources read: `cadKernelRuntime.ts`, `cadKernelModel.ts`, `cadKernelImport.ts`, `cadKernelShapes.ts`, `cadKernelCutEvidence.ts`, source schema and installed binding declarations. The installed native artifact and exact upstream commits are recorded in `vendor/cad-kernel/replicad-ownership-build.json`. The measurements stop at this copy-capability decision. No cache, binding or geometry policy repair is authorized or implemented by this audit.
