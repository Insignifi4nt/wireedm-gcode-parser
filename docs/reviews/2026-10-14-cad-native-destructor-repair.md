# Native destructor repair and pinned rebuild

The remaining allocation growth was reproduced on the exact original
`replicad-opencascadejs1.1.0` single-thread pair, then repaired in a separate
candidate library before changing the installed dependency. No worker lifetime,
topology, tolerance, validity or sampling limit was relaxed.

## Cause and repair scope

[Upstream issue40](https://github.com/tauCAD/opencascade.js/issues/40) and
[PR50](https://github.com/tauCAD/opencascade.js/pull/50), commit
`193f3339893c909abdd5e62a6f1dc6742369fa30`, identify two coupled ownership defects:
the generator emitted empty `raw_destructor` specializations for classes with a
placement delete declaration, and Embind treated raw-pointer returns as owning.
The first leaks ordinarily deletable OCCT objects; fixing it without the second
can destroy a borrowed algorithm member prematurely.

The four-file backport changes the existing generator's specialization to call
the upstream SFINAE deletion helper and adds borrowed-pointer handling to the
existing Emscripten dispatcher. Clones preserve borrowing; constructors return
owning handles. By-value/reference copies and OCCT Handle returns retain their
previous ownership. Non-public and placement-only destructors remain protected.
No private pointer or allocator block is read/freed by application code.

The backport retains generator revision
`ebd263f15337b440b391492af073662707e86482`, Emscripten5.0.1, OCCT8.0.1
`b8f597c677811d1f9f4d8a97f5ae2825c0353a42`, original OCCT patches, custom
Replicad wrappers/YAML and all modeling flags. The official newer ownership
release uses Emscripten6.0.5; it was used as the repair reference, not substituted
for the original compiler. Replicad's custom face/edge extractors return owning
MeshData values rather than raw object pointers, as independently reviewed.

## Reproducible build and originals

The official toolchain image is pinned by immutable digest:

```
ghcr.io/taucad/opencascade.js@sha256:215198af0e2ca4c5f308e5540869f2419784dc290062d3eb03d34e4f22e0188c
```

Build workspace: `/home/cristian/cad-native-repair-2026-10-14` in
WSL Ubuntu24.04. Official Ubuntu `skopeo`/`umoci` packages and automatic
dependencies added76.2MB to that Linux environment; no Docker daemon, Windows
installer or global Windows PATH change was used. Hardware32 logical CPUs,
approximately31GiB available RAM and825GiB free disk. The unpacked official
toolchain occupies8.6GiB before regenerated bindings.

The exact old loader/WASM and source/relink records are preserved under
`tmp/cad-native-repair/originals`. Their SHA256 values are
`018e57538fcb773f0124eae60aee4de693d3aae01c55b2b883a874911ab121c3`
and `4c9f22e9f3828dca6f3c95405934cdbe624e593c35266f47f392ab337478dbde`.
The immutable OCI store preserves the original toolchain; each of the four
changed source files was separately backed up before editing.

Generation completed in210 seconds. The pinned compiler rebuilt1078 existing
requested/discovered binding objects against the unchanged precompiled OCCT
static libraries; all compiled successfully. The original linker selected317
bindings plus35 immutable OCCT libraries, generated the same custom wrappers,
and optimized the single-thread pair. The four-file source patch dry-run passed
against a fresh extraction of the exact corresponding generator archive.

Recipe/probes are in `scripts/native-repair/`. The four immutable distribution
artifacts in `vendor/cad-kernel/` contain the local compatible npm package,
four-file patch, source recipe archive and build metadata. The local package
version is `1.1.0-wireedm.1`; default ESM/CJS, single-thread WASM and original
types are preserved. Multi-thread exports are intentionally unavailable, so an
older defective binary is not advertised as repaired. Source/notice/relink
integration is owned by the root task and validates the exact artifact hashes.

Candidate loader SHA256:
`5ba5161518781c04af771ae4e841956613dde4e679766ddaaeb581b778e1a8be`.
Candidate WASM SHA256:
`c2232f84698ad2070673e158ff40e7c4f554ca1f74bacf0e5103eb2eb206f11e`.

## Red/green acceptance evidence

Every isolated allocation case initializes an explicitly selected fresh pair.
No forced GC, manual allocator free, synthetic solid, worker restart or job-cap
change is used. WASM capacity is reserved high-water memory, not live allocation
or a universal bound on all future models.

| Case | Original pair | Repaired pair |
|---|---|---|
|128 owned arrays,100000 `gp_Pnt` each, ordinary delete|100→594.625MiB|100MiB throughout|
|4096 fully geometric analyzers/box builders, ordinary delete, no Init/Clear|100→412.875MiB|100MiB throughout|
|32 identical defaultV3 gear builds/disposals at0.005mm tolerance|163.0625 initially;199.0625 warmed→344.0625MiB|163.0625MiB throughout|
|Borrowed curve `This()` and public clone deletion, then owner reuse|Native out-of-bounds trap|Original curve/algorithm remain usable|

Every gear build retained the exact original volume
`22493.43335045167mm³`. The first independent native suite against the candidate
passed27 files/275 tests, including imports, material, placements, sections,
topology/cache, STL/STEP exports and ownership cases. A separate package probe
verified matching public bound class/enum/member names, byte-identical types,
and independent CJS factory material volume1000mm³. Minified internal runtime
property names are excluded from the public-surface comparison.

A meaningful candidate regression failed on the application's retained neutral
analyzer reset. That workaround was removed while retaining the exact full
geometric/topological `IsValid` call and ordinary owned deletion. The subsequent
candidate suite passed28 files/278 tests in20.24 seconds, and all allocation
cases remained flat. The permanent native memory regression now covers32 gears
and the direct owned-container/analyzer lifecycles, so the previous eight-build
false confidence cannot recur.

Independent review subsequently found retained app-owned section traversal
handles in a realistic grow/shrink/edit/export lifecycle. Its owner is fixing
that separately with captured handle regressions. The native binary plateau
does not excuse undeleted caller-owned handles; source/package integration and
the full realistic lifecycle gate remain part of the root task's final review.
