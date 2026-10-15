# Pinned native ownership and topology repair

Maintainer/relink recipe, not CAD authoring instructions. Production still uses
the accepted pinned artifact until the reviewed package is installed.

The original generator revision `ebd263f15337b440b391492af073662707e86482`
mistakes OCCT's placement-delete declaration for a class that cannot be deleted.
Its empty raw destructors leak objects created by builders, analyzers and
containers. Upstream [PR50](https://github.com/tauCAD/opencascade.js/pull/50),
commit `193f3339893c909abdd5e62a6f1dc6742369fa30`, repairs this and marks raw
pointer returns borrowed. Both changes are necessary: otherwise borrowed OCCT
members can be destroyed while their owning algorithm still needs them.

This backport modifies four generator source files. It retains the pinned
overload dispatcher, Emscripten5.0.1, OCCT8.0.1 revision
`b8f597c677811d1f9f4d8a97f5ae2825c0353a42`, all original OCCT source patches,
the original geometry and sampling implementation. No tolerances or validity flags change.
The ownership detector leaves inaccessible and placement-only destructors alone.
Raw pointers returned by OCCT are borrowed; by-value/reference copies and Handle
returns retain their existing ownership. Upstream's known `FilletPoint::Copy`
raw-pointer ownership exception is outside this application's bindings.

The app requires exact picking even when OCCT's bounded public shape hashes
collide. The separate indexed-topology patch adds `extractWithTopologyIndices`
to both Replicad mesh extractors and binds the existing indexed map's missing
`NCollection_BaseMap` base in the single-thread YAML. Each extractor uses
`TopTools_IndexedMapOfShape::FindIndex`, whose bucket equality uses `IsSame`.
The old extractor methods and their hash group IDs remain available. Their
geometry, normals, triangles and edge sampling are unchanged. The app constructs
the same exact maps and uses `ModifiedShape` plus `FindIndex` to map a translated
preview back to its original body, with fresh opaque pick keys per build.

The compatible single-thread pair is built from this immutable official image:

```
ghcr.io/taucad/opencascade.js@sha256:215198af0e2ca4c5f308e5540869f2419784dc290062d3eb03d34e4f22e0188c
```

On Linux/WSL, acquire `skopeo` and `umoci` from the official distribution
repository. Pull/unpack that image in an isolated build directory:

```sh
skopeo copy --override-os linux --override-arch amd64 \
  docker://ghcr.io/taucad/opencascade.js@sha256:215198af0e2ca4c5f308e5540869f2419784dc290062d3eb03d34e4f22e0188c \
  oci:pinned-oci:toolchain
umoci unpack --rootless --image pinned-oci:toolchain pinned-bundle
```

Extract the exact Replicad source archive distributed alongside the app. Copy
`packages/replicad-opencascadejs/build-config/` into the candidate's `rootfs/src/`.
Copy `run-pinned.sh` and `compile-selected.py` there as well. Preserve the original
loader/WASM before any replacement. Apply this recipe only to the candidate:

```sh
python3 backport-ownership.py pinned-bundle/rootfs
python3 backport-indexed-topology.py pinned-bundle/rootfs
bash enter-toolchain.sh pinned-bundle/rootfs patch-embind generate
bash enter-toolchain.sh pinned-bundle/rootfs selected-bindings
bash enter-toolchain.sh pinned-bundle/rootfs link /src/custom_build_single.yml
python3 emit-source-patch.py pinned-bundle/rootfs
```

The entry script mounts `/dev` and `/proc` for the scoped chroot and unmounts them
on exit. No Docker daemon is installed or started. Generation uses the exact
patched producer. Selected compilation uses the pinned compiler/PCH and original
flags, recompiles every existing requested binding plus a conservative superset
of NCollection bindings, and leaves the original immutable OCCT static libraries
untouched. The pinned linker determines its ordinary final binding set and
generates the custom Replicad wrappers with the same repaired producer. The
indexed map's added base must also be compiled with that producer. A warm rebuild
after applying only the indexed-topology patch can use
`selected-bindings --symbol NCollection_BaseMap` before relinking. A full
`bindings` pass can be used instead of `selected-bindings`; the selected YAML and
original OCCT libraries remain identical. Never relink an old empty-destructor object into
the repaired package.

Results appear in `pinned-bundle/rootfs/src/`. The paired loader, WASM and generated
types must be distributed together under the new `1.1.0-wireedm.2` identity.
Preserve the original registry pair and any `.1` candidate before staging `.2`.
Use the application's checked source for its regression probes:

```sh
npx tsx scripts/native-repair/check-allocation.ts /absolute/replicad_single.js /absolute/replicad_single.wasm
CAD_NATIVE_CANDIDATE_ROOT=/absolute/candidate npx vitest run --config scripts/native-repair/vitest.config.ts
```

For the staged package recipe, copy the matched outputs into
`tmp/cad-native-repair/candidate2/`, then run `package-candidate.mjs stage` and pack
`tmp/cad-native-repair/package2/`. The ownership patch, indexed-topology patch and
this complete recipe archive accompany the package. Refresh the build metadata
only after the native fixtures, exact collision picks, allocation probes and
recipe type checks pass. The published fingerprints must match those final bytes.

These probes explicitly initialize the selected separate pair; they do not patch
installed dependencies. Native reserve capacity is a high-water allocation
measure, not a live-heap measurement or proof about every possible future model.
No forced garbage collection, allocator-block free, worker restart or cap change
is used. The build metadata records exact hashes and evidence. LGPL source,
exception and original copyright notices must accompany the modified distribution.
