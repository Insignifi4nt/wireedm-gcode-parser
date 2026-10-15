# Native CAD ownership audit

This record describes the original-binary ownership stage. Its measurements are
retained as causal evidence. The subsequent pinned destructor repair removes the
neutral analyzer reset and verifies longer repeat plateaus; see
[native destructor repair](2026-10-14-cad-native-destructor-repair.md).

Scope: the pinned Replicad 1.1.0 / replicad-opencascadejs 1.1.0 runtime, cached models, exact profile construction, validation, topology, transforms, and import/export. This is an internal engineering record. The library binaries, geometry tolerances, package pins, document schemas, originals, and worker safety caps remain unchanged.

## Confirmed failures and corrections

- STL export supplied retained body wrappers to Replicad `makeCompound`, which consumes its inputs. A native regression failed when an exact section immediately followed export, even though the cached mesh still looked valid. Export now builds its own native compound without consuming any body wrapper. Repeated STL/STEP exports, exact topology picks, sections, cached mesh/build identity, and independent STEP/STL material roundtrips are covered.
- Replicad plane conversion omitted deterministic deletion of its native edge builders and converted curve handles. A real dodecagon construction established the failure before adding a scoped exact conversion adapter. Native curves and OCCT wire construction are preserved; only ownership changes.
- Replicad topology enumeration retained raw `TopExp_Explorer.Current()` handles, while its primitive extrusion downcast retained the raw `Shape()` return. Tests captured those actual handles before correcting the owned traversal and native Pad/Revolve primitive boundary. Expected material volume, placement and sections are checked separately.
- Deleting the JS wrapper is insufficient for affected native classes. Owned shape references are explicitly `Nullify`-ed before deletion. Consuming transforms retain a public embind handle alias until the call finishes, then clear that alias. Tests prove both release of consumed inputs and preservation of independently built output and borrowed sources. Independent review also reproduced uncleared intermediate pattern operands and STL temporary references; those callers now use the same ownership boundary.
- Actual STL import traversal retained owned face/shell references. A native import regression established that retained aliases remained non-null before replacing vendor face enumeration and clearing owned import temporaries. The imported volume and the source model's section remain correct.

## Pinned upstream defect and strict validity

The [pinned binding generator](https://github.com/tauCAD/opencascade.js/blob/ebd263f15337b440b391492af073662707e86482/src/ocjs_bindgen/codegen/embind/class_.py#L155) specializes `raw_destructor` to do nothing when a class declares a two-argument placement-delete overload. OCCT's [allocation macro](https://github.com/Open-Cascade-SAS/OCCT/blob/b8f597c677811d1f9f4d8a97f5ae2825c0353a42/src/FoundationClasses/TKernel/Standard/Standard_DefineAlloc.hxx) declares that overload. `BRepCheck_Analyzer` and several topology classes use it.

The [analyzer source](https://github.com/Open-Cascade-SAS/OCCT/blob/b8f597c677811d1f9f4d8a97f5ae2825c0353a42/src/ModelingAlgorithms/TKTopAlgo/BRepCheck/BRepCheck_Analyzer.cxx) shows that `Init` clears its result map and refuses a null shape. The adapter performs the original full geometric/topological check with `(true, false, false)` flags, then calls `Init` with a non-null empty native compound and geometric controls still enabled, before deletion. One neutral compound is retained per native realm; it never enters authored history, material, preview, export, or CAM.

This explicitly releases the large validation cache. It does not repair the binary destructor. Proper dependency repair requires correcting the generator's destructor selection, rebuilding/relinking the exact corresponding source, and updating the binary/source evidence together. No private native pointers, manual allocator frees, synthetic tiny solids, reduced validation, forced production GC, or increased worker caps are used.

## Measurements and limits

Measurements are native linear-memory capacity, not live allocated bytes. Emscripten retains a high-water reserve after disposal.

- A fresh realm reserves 100 MiB. A simple box produces 252 preview scalars (about 2 KiB of numeric payload) and warmed builds took 7–9 ms in the initial isolated run.
- Default v3 m3/z18 Pad10 produces 60,468 scalars (about 472 KiB), 866 faces and 2,592 edges. Initial warm builds took 800–824 ms. Two validity checks per rebuild caused capacity to rise to 495.5 MiB across eight disposed rebuilds; forced diagnostic Node GC did not fix it.
- Same-body remeshing alone remained at 163 MiB across eight calls. Fresh construction plus meshing, or volume checks alone, plateaued at 199 MiB. Adding only the analyzer reproduced growth. After explicit result-map cleanup, eight full rebuilds plateau at about 199 MiB without forced GC.
- Final-source 24-build observation without forced GC: 163.0625 MiB after build 1; 199.0625 MiB after builds 2–10; 238.875 MiB after builds 11–19; 286.6875 MiB after builds 20–24. Material volume remained exactly 22,493.43335045167 mm³ on every build. The first warmed builds took 648–655 ms, while later samples ranged up to 2,530 ms during concurrent app work; this is not evidence for a universal speedup. The adapter does not claim universal native deallocation. Larger z50 gear geometry has a much higher reserve, and preview payload size does not bound native peak memory.
- The existing preview budget is 8,000,000 numeric values per model; topology is limited to 10,000 faces/edges per body and 25,000 per model. Those are cache-local budgets, so two workers hold two native realms. Candidate preview must remain lazy, coalesce edits, retain only the latest request, and terminate its separate worker when the owner closes. These policies do not substitute for the ownership fixes.

## Evidence

Behavior-driven native regressions are in `cadKernelRuntime.test.ts`, `cadKernelSketch.test.ts`, `cadKernelMemory.test.ts`, and the independent `cadKernelShapesOwnership.test.ts`. The datum failure-injection fixture now fails the actual native primitive after a valid staged holed region, preserving its original preceding-solid and cleanup assertions. The independent accepted/candidate runtime case verifies candidate volume/bounds, cancellation disposal, accepted topology/build identity, exact section and a STEP material roundtrip.

Final whole-native source gate: 27 files / 275 tests passed in 23.37 s, including the last alias, nonconsuming export and STL-import cleanup. `tsc -b` passed. Independent native ownership review passed 22 focused cases and its actual app TypeScript check; see the separate review record. The root owns the broader app/build gates. This record deliberately retains the remaining binding limitation.
