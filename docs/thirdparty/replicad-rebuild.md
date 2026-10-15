# CAD kernel source and relinking

This file is maintainer and redistribution documentation. CAD users can download
the exact corresponding library source from the hosted app's CAD license link.

The application uses unmodified `replicad` 1.1.0 (MIT) and the locally built
`replicad-opencascadejs` 1.1.0-wireedm.2 (LGPL-2.1-only). Its upstream package revision is
`e4b05f67dc4e2393a876ce8c5064a9c93db05bf1`. OpenCascade Technology is 8.0.1,
revision `b8f597c677811d1f9f4d8a97f5ae2825c0353a42`, under LGPL 2.1 with
the additional OpenCascade exception. The generator and its OCCT patches are
from tauCAD/opencascade.js revision
`ebd263f15337b440b391492af073662707e86482`.

The modified package backports the coupled native destructor and borrowed-handle
repair from upstream commit `193f3339893c909abdd5e62a6f1dc6742369fa30`
([PR50](https://github.com/tauCAD/opencascade.js/pull/50)). It changes four binding
generator/runtime patch files, preserving the original compiler, overload
dispatcher, OCCT algorithms, precision and full validity checks. A second patch
adds `extractWithTopologyIndices` to both Replicad mesh extractors and binds
`NCollection_BaseMap`, required by the existing indexed shape map. The original
extractor methods and their geometry buffers remain compatible; the app uses
exact indexed identities to distinguish faces and edges even when native hashes
collide. The matched library and declarations are installed from the file-pinned package in
`vendor/cad-kernel/`; a clean npm installation does not revert to the old binary.

The five archives in `replicad-sources.json` contain the complete Replicad
wrappers and build configurations, generator and OCCT patches, exact OCCT source,
RapidJSON and FreeType source. SHA-256 values verify all downloads and the exact
installed single-thread JavaScript/WASM artifacts and generated declarations. Five additional local artifacts
provide the modified package, both exact source patches, complete rebuild recipe and
build record. The record's paired artifact, patch, recipe, source and toolchain
pins must agree with the manifest; byte checksums alone are insufficient. Every production build copies
the verified source archives and licenses into `third-party/cad/` alongside the
application. Source archives are not evaluated or extracted during that build.

For this modified build, extract `replicad-ownership-rebuild.tar.gz` and follow its
`README.md`. The immutable official toolchain is
`ghcr.io/taucad/opencascade.js@sha256:215198af0e2ca4c5f308e5540869f2419784dc290062d3eb03d34e4f22e0188c`.
The included scripts regenerate bindings with the repaired producer, recompile
the selected objects using the original Emscripten5.0.1/PCH/flags, and relink the
unchanged precompiled OCCT libraries and patched custom Replicad wrappers. A full binding
compilation is also supported. The emitted patch dry-runs against the exact
supplied generator source archive; the indexed topology patch dry-runs against
the supplied Replicad source archive. Preserve old originals and verify the complete
new JavaScript/WASM pair and matched declarations before replacement. `replicad-ownership-build.json`
records hashes and native acceptance evidence, rather than claiming byte-identical
output from all hosts. The paragraphs below describe the base upstream build.

To reproduce or modify the library, extract the supplied archives. The generator
archive's `DEPS.json` pins Emscripten 5.0.1 and its container image digest,
OCCT/RapidJSON/FreeType revisions, Python/LLVM dependencies; its Dockerfile and
lockfiles describe the toolchain. Build the generator's `final-single` container
from the provided revision, retaining the source patches applied by
`build-wasm.sh`. Substitute that locally built image for the image named in
`packages/replicad-opencascadejs/package.json` in the Replicad archive.

In that Replicad package, install its locked development dependencies, then run
`npm run generateConfig` and `npm run buildSingle`. `ytt` renders
`build-source/defaults.yml` and `custom_build_single.yml`; the generated
`custom_build_single.yml` plus `wrappers/*.cpp` supply the application bindings.
The default flags include WASM exceptions, SIMD, memory growth and
`-sEVAL_CTORS=2`. Preserve the included library license and exception files.
The npm `dist/*.js` files are loader outputs from this build. The default app
uses only the single-thread build, so no cross-origin isolation headers are
required.

To relink a modified compatible library, replace the installed package's
`dist/replicad_single.js`, `dist/replicad_single.wasm` and matching
`dist/replicad_single.d.ts` together, then rebuild
the MIT-licensed application from its published source. Update the source and
binary manifest to the corresponding modified source. Vite emits the WASM as a
separate asset; the CAD module worker supplies its URL through `locateFile` and
injects the library with `setOC`. This is the application/library linkage point.
The worker client and domain CAD model remain application code; no models are
embedded into the library. The modified package exposes compatible single-thread
ESM/CJS and WASM, with generated declarations for the additive indexed methods
and base-map binding. It intentionally omits the
unrepaired multi-thread variant; this application uses only the single-thread
worker and requires no cross-origin isolation headers.

Replicad's bundled JavaScript dependencies use their upstream licenses: Flatbush
and Flatqueue are ISC-licensed; OpenType.js, tiny-inflate and the codePointAt
polyfill are MIT-licensed. RapidJSON's supplied license covers its MIT
and third-party notices. FreeType is distributed under the FreeType License
(FTL); portions of this software are copyright © 2023 The FreeType Project
(www.freetype.org). All rights reserved. The source archives contain the
respective upstream copyright notices.

The library notices permit reverse engineering for debugging modifications of
the library. There is no app restriction on replacing, modifying or relinking
the library. These libraries are distributed without warranty.
