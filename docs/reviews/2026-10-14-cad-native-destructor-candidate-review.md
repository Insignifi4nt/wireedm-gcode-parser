# Coupled native destructor candidate review — 14 October 2026

**Status:** source review only. No candidate factory/WASM, production dependency or native helper changed by this review. This supplements [the current-pin ownership review](2026-10-14-cad-native-ownership-review.md); it does not certify an unbuilt candidate.

## Upstream repair and build scope

Official tauCAD PR50 merged on 12 October at `193f3339893c909abdd5e62a6f1dc6742369fa30`. Its coupled repair conditionally destroys deletable C++ objects and marks raw-pointer results borrowed; clone preserves that ownership, while constructors produce owners. Value/reference copies and smart handles retain their existing ownership. These parts must travel together: enabling destruction alone can free an algorithm's internal pointer result. [Official repair](https://github.com/tauCAD/opencascade.js/pull/50), [reported defect](https://github.com/tauCAD/opencascade.js/issues/40)

Reviewed the source checkout's `class_.py`, `embind_builtins.py`, ownership hunks in `libembind-overloading.patch`, and the original Replicad custom wrapper sources at `e4b05f67dc4e2393a876ce8c5064a9c93db05bf1`.

The pinned image and latest dependency manifests both identify OCCT `V8_0_1`, commit `b8f597c677811d1f9f4d8a97f5ae2825c0353a42`. Their Emscripten versions differ: **5.0.1 versus 6.0.5**. Backport ownership into the original compiler/runtime and preserve its overload dispatcher. Copying the complete latest dispatcher would introduce unrelated overload/default-argument behavior. Regenerate and test JS/WASM as a matched pair; equal public names do not establish binary/glue compatibility.

## Consumer ownership map

| Existing path | Required behavior with proper destructors |
| --- | --- |
| `new` native constructors | Owned. Constructor reset must override the generic pointer-return borrowed flag. |
| `TopExp_Explorer.Current`, builder `Shape`/`LastShape`, `TopoDS` casts | Owned copied wrappers in these bindings. Release those copies; retain the source owner. Verify generated candidate bindings preserve this behavior. |
| Replicad `Shape.clone()` | Independent native header copy sharing the reference-counted BRep. Releasing its header must not invalidate the source header. |
| Public Embind `raw.clone()` | Another handle to the **same C++ object**. Ownership flag and reference count must survive cloning. |
| `Cut.Builder`, map `Seek`, `ExtremaPC.Perform`, exception-data pointers | Borrowed members. Delete only the JS handle; keep their native owner alive until all use is finished. |
| Replicad custom face/edge mesh extractors | Both return `MeshData` **by value**, not heap-object pointers. Their data destructors release packed malloc buffers. Current app extraction copies arrays before deleting data. An initial owned-pointer concern was checked and refuted. |
| Custom BRep reader and shape caster | `TopoDS_Shape`/`TopoDS_CompSolid` values; custom buffer-pointer getters return integer addresses, not class handles. No owning raw-object pointer return found in the inspected custom wrappers. |

## Current helpers after repair

- Owned `Nullify(); delete()` remains safe for the current copied-wrapper callers. It becomes redundant when deletion destroys the object. **Borrowed deletion safety does not make `Nullify` safe:** nullifying a borrowed member would mutate its C++ owner before deletion skips its destructor. Keep `cadKernelDisposeOwned` restricted to known owned results; do not generalize it to every pointer-returned object.
- `cadKernelConsumeShape` remains safe: its owned alias keeps the input alive while Replicad consumes the JS wrapper, then is released. This extra alias/nullification can be simplified only in a separately verified proper-destructor path. Failed transforms must still preserve their primary error and borrowed source material.
- Analyzer `Init(emptyCompound)` is safe but unnecessary after a working destructor releases its maps and shape. Remove the reset/neutral-compound workaround only after candidate proof; preserve the original geometric `IsValid` call. The upstream upgrade guidance specifically identifies retaining adaptor inputs while algorithms use their references and removing leak-only clearing. [Upgrade guidance](https://github.com/tauCAD/opencascade.js/blob/193f3339893c909abdd5e62a6f1dc6742369fa30/.nx/version-plans/real-destructors.md)
- Current STL construction is nonconsuming and scopes its owned compound. Keep that straightforward ownership even when destructors work. Explicit sketch builders/traversal are also useful without relying on nondeterministic vendor finalizers.
- Existing alias-null tests establish the old-pin workaround. After removing nullification, a retained alias legitimately keeps its C++ object alive; do not misinterpret a non-null alias as a destructor failure. Test destruction after the final owning handle is released, alongside source survival and allocator reuse.

## Candidate evidence still required

Before app integration: inspect generated borrowed/value policies and constructor paths; run fresh-realm owned-array/builder allocation probes plus borrowed-result/clone/exception lifetime tests against the **5.0.1 candidate**; then run existing exact material, placed datum, topology, section, STEP/STL roundtrip and gear fixtures with unchanged tolerances. Compare public declarations, custom wrappers, compiler/OCCT pins and matched artifact hashes. Maintain original source bytes and the user's accepted/pending gear draft. Proper ownership is the target; a larger heap limit or shorter worker lifetime is not evidence that destruction is fixed.
