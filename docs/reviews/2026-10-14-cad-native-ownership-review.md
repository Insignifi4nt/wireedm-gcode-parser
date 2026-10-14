# Native ownership review — 14 October 2026

## Scope and conclusion

Independent review of the pending CAD resource changes against installed Replicad 1.1.0 and replicad-opencascadejs 1.1.0: exact sketch-to-plane conversion, Pad/Revolve primitives, STL export, validation reset, owned traversal, transform consumption, and cleanup callers. No modeling kinds, accuracy tolerances, package pins, worker caps, saved documents or installed posts changed by this review.

The distinction between copied shape wrappers and aliases is sound. Focused native checks found no use-after-free or changed placement/material/sections. Three remaining application-owned BRep retention paths were reproduced before repair; the kernel implementation agent fixed them. These changes release selected native references; they do not establish complete native deallocation.

## Ownership evidence

- Installed `replicad/dist/replicad.cjs` implements `Shape.clone()` by native downcast into another wrapper. Its translate/rotate/mirror operations delete their input JS owner after constructing the output. Installed `casting-CW9g_cFM.cjs` makes wrapper deletion idempotent and throws when accessing an already-deleted wrapper.
- Replicad's `makeCompound` consumes every supplied JS wrapper. The earlier temporary-copy export preserved the accepted snapshot but retained native references under the pinned binding. Current STL export instead constructs one owned native compound and adds borrowed accepted shapes, then releases only that compound.
- Public Embind handle `clone()` aliases the same C++ object and requires its own deletion. Default by-value/by-reference returns use owned copies unless a reference policy is explicit. This supports keeping an alias across a consuming transform, then nullifying that owned wrapper after the transform. It does not authorize nullifying borrowed model inputs. [Emscripten ownership documentation](https://emscripten.org/docs/porting/connecting_cpp_and_javascript/embind.html#cloning-and-reference-counting)
- The pinned binding generator installs an empty raw destructor when it detects placement delete or a nonpublic destructor. Therefore ordinary JS `delete()` cannot be treated as proof that every native shape reference was released. [Pinned binding generator](https://github.com/tauCAD/opencascade.js/blob/ebd263f15337b440b391492af073662707e86482/src/ocjs_bindgen/codegen/embind/class_.py#L155)
- `cadKernelDisposeShape` nullifies the owned TopoDS wrapper, then deletes it. Tests dispose copied wrappers and explored solids while independently checking the borrowed original remains non-null, valid, correctly placed and 1,000 mm³.
- `cadKernelIsValid` still invokes geometric/topological `IsValid` before resetting the analyzer to one non-null empty compound per native realm. Repeated validation/disposal retains original material. The neutral compound is cleanup infrastructure and never enters authored geometry or export.
- The exact plane adapter retains analytic curves and placement while explicitly releasing its edge/wire builders, converted curve handles and owned edge wrappers. Native dodecagon, rounded/profile, principal-plane Revolve, Shell/Pocket and datum tests exercise these paths.

## Reproduced findings and repairs

`cadKernelShapesOwnership.test.ts` captured public native aliases independently of the application's ownership set. Three tests initially failed only the final reference-release assertion; their volume and exact interior sections already passed.

| Path | Observed defect | Repair by kernel agent |
| --- | --- | --- |
| Linear pattern | Instance operand deleted directly; alias retained its BRep after model disposal | Release owned instance and prior transient union through the shape helper |
| Circular pattern | Same retained temporary operand references | Same scoped owned release |
| STL export | Consumed clone wrappers and temporary compound retained native references | Scoped nonconsuming compound; borrowed accepted bodies remain usable |

The new tests also verify independent copied-wrapper disposal, repeated compound traversal/validation, and preservation of the primary transform exception while releasing a failed owned input. The implementation agent additionally reproduced and repaired STL-import traversal retention with its own real native fixture.

## Verification and limits

Independent final run: four focused native files, **22 tests passed** — ShapesOwnership, Sketch, Hardening and Runtime. Checks include independently calculated 80/240/1,000/2,000 mm³ material, translated bounds, exact sections, principal-plane partial Revolves, correlated Shell/Pocket/pattern material, repeated STEP/STL export/reimport, retained topology/cache identity and borrowed-source survival. The actual app TypeScript project also passed with `npx tsc -p tsconfig.app.json --noEmit`.

Broader native validation remains owned by the implementation agent and root. Short warmed allocation checks do not prove all native allocations are freed, and WASM memory capacity is a reserve rather than a direct live-allocation count. Remaining binding allocation retention is acknowledged; no synthetic geometry, weakened validity, enlarged tolerances or worker-cap workaround was introduced.

## Viewport presentation review

Inspected root's actual browser images `tmp/cad-hardening-bearing-before.png` and `tmp/cad-hardening-agent-plates.png`, together with current `CadViewport.tsx` materials, lights, exact edge lines and highlight layers. The unselected plate shows clear bore depth and rounded side-wall curvature, stable thin outlines and readable top/side tonal separation. The three-plate image distinguishes selected body, selected face and unselected surfaces without a missing-geometry or focus-outline artifact.

No lighting or global edge-style change is warranted by these images. Visible cylindrical seam edges are native topology and should not be hidden to make the image smoother. Compact inspector/menu work addresses the observed UI density separately. Further presentation changes should follow an actual failing view or before/after browser evidence, preserving exact edge selection and body/face feedback.

## Coupled repair and caller lifecycle addendum

The earlier sections record the original-pin investigation. This addendum independently checks the isolated second candidate, with the coupled destructor/borrowed-pointer repair and additive exact indexed topology extractors. Loader SHA256 is `5ba5161518781c04af771ae4e841956613dde4e679766ddaaeb581b778e1a8be`; WASM SHA256 is `f3315403717f650c207eccd2f372afc380005b4f219bad31991d6f115fdc1744`. The installed package and final source distribution remain the root task's integration gate.

The realistic repeat identified two application-owned success-path leaks before this review resumed: raw section builder/explorer copies, then the named STEP document/session/writers left to vendor finalizers. The explicit traversal helpers and scoped named exporter release their owners at return. The exporter preserves Replicad's names, default red color, millimetres, AP242 schema, precision and writer modes; accepted body inputs remain borrowed.

This review additionally reproduced two constructor-failure leaks before changing production code. A failing native section builder retained its already-created plane, and a failing second curve adaptor retained the first exact curve owner. Separate nested cleanup scopes now release those resources and preserve the original native exception and the 1,000 mm³ source. Circular section temporaries use the same nested ownership ordering.

Independent second-candidate checks passed:

- Four caller/runtime ownership files, 17 tests in 23.98 seconds. The 24 grow/shrink/edit/pattern/place/section/export/reimport cycles preserve independently calculated material and placed bounds, cached result and mesh object identity, serialized snapshots, topology descriptors and exact section entities. Every phase and cycle stayed at 100 MiB reserve, with zero growth events and the expected 21 distinct builds. Exact STEP and the bounded STL rejection/fallback behavior use unchanged tolerances.
- The strengthened section/STEP fixture, 5 tests in 2.71 seconds. Six copied raw section handles were observed and all six deleted at return. All eight directly constructed STEP owners were deleted at return: two writers, one session, one document, two strings, one color and one progress range. Named AP242/red/MM output reopens as one exact 500 mm³ solid with 10 × 10 × 5 mm bounds and preserves the subsequent source section. Static-return labels/tool/name handles are explicitly scoped in the source; the eight-owner count concerns constructors rather than every returned handle.
- Topology and numerics, 22 tests in 32.22 seconds, including deliberately collided hash groups and exact pick identity. The indexed native map resolves collisions using exact `IsSame` identity and location. Temporary copied shape headers and maps stay owned; the model inputs are not nullified. Mesh arrays are copied while the by-value data owner is alive, before its destructor releases packed buffers.
- A fresh-pair borrowed-pointer probe deletes `This()` results and public clones, then reuses both the original curve and its algorithm successfully. No forced GC, manual allocator free or worker restart is used.

Per-phase capacity evidence is in `tmp/cad-native-repair/lifecycle-phases.json`; observed handle counts are in `tmp/cad-native-repair/lifecycle-ownership.json`. WASM capacity is allocator reserve, not live allocation. These checks establish the exercised caller lifetimes and repeated reserve reuse, not a universal memory bound. Final installed-pair, source-hash, browser and whole-app gates remain required.
