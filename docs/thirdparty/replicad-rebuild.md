# CAD kernel source and relinking

This file is maintainer and redistribution documentation. CAD users can download
the exact corresponding library source from the hosted app's CAD license link.

The application uses unmodified `replicad` 1.1.0 (MIT) and
`replicad-opencascadejs` 1.1.0 (LGPL-2.1-only). The pinned npm package revision is
`e4b05f67dc4e2393a876ce8c5064a9c93db05bf1`. OpenCascade Technology is 8.0.1,
revision `b8f597c677811d1f9f4d8a97f5ae2825c0353a42`, under LGPL 2.1 with
the additional OpenCascade exception. The generator and its OCCT patches are
from tauCAD/opencascade.js revision
`ebd263f15337b440b391492af073662707e86482`.

The five archives in `replicad-sources.json` contain the complete Replicad
wrappers and build configurations, generator and OCCT patches, exact OCCT source,
RapidJSON and FreeType source. SHA-256 values verify all downloads and the exact
installed single-thread JavaScript/WASM artifacts. Every production build copies
the verified source archives and licenses into `third-party/cad/` alongside the
application. Source archives are not evaluated or extracted during that build.

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
`dist/replicad_single.js` and `dist/replicad_single.wasm` together, then rebuild
the MIT-licensed application from its published source. Update the source and
binary manifest to the corresponding modified source. Vite emits the WASM as a
separate asset; the CAD module worker supplies its URL through `locateFile` and
injects the library with `setOC`. This is the application/library linkage point.
The worker client and domain CAD model remain application code; no models are
embedded into the library and no library modifications have been made.

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
