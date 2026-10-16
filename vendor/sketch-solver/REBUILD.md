# PlaneGCS source, rebuild and replacement

Wire EDM Workbench pins the unmodified npm release `@salusoft89/planegcs@1.3.0`. The distribution retains the published package, the complete wrapper/native source archive, dependency source archives, license notices and `planegcs-sources.json`. Browser recipients can download them from this directory without an npm account. The application is MIT licensed. These library files retain their own licenses.

## What is pinned

The npm registry records `gitHead` as `9d26baef0b240fe0eef4186d4e5e5e66ec3620b7`. That source archive includes the modified FreeCAD C++ files in `planegcs/`, their local replacement headers, the TypeScript wrapper, the binding generator and templates, the npm build lock, CMake, Dockerfile and packaging script. Its `planegcs/commit.txt` identifies the copied FreeCAD revision as `5f8eac49f31626354ee69bf40616bac801ca5560`. The complete copied core is already in the PlaneGCS archive. Rebuilding it does not require checking out the rest of FreeCAD.

The manifest verifies every installed file against the published npm payload. In particular, the 484,003-byte `dist/planegcs_dist/planegcs.wasm` has SHA-256 `af9d1874fc895726bd267703a698a86c82d35b7415a02fe5184ebf65ddbc04af`. The JavaScript loader and WASM are separate files. Keep them as a matching pair when rebuilding or replacing the library.

The copied core retains GNU Library GPL version 2-or-later notices. The wrapper and build generator carry LGPL 2.1-or-later notices. Both license texts are included, together with GPL 2. The npm metadata's `LGPL-2.0-or-later` label does not replace the individual source notices. There is no OCCT license exception for this solver.

## Original build limits

The upstream Dockerfile selects `emscripten/emsdk:6.0.10` and runs unversioned `apt-get install` for Eigen and Boost. It records neither an image digest nor the resolved header package versions. The npm release and GitHub release contain no original build receipt. The binary-to-source association is the publisher's npm `gitHead`; it is not a reproducible-build attestation.

The supplied Eigen `3.4.0-4build0.1` and Boost `1.83.0-2.1ubuntu3.2` source packages are available, pinned Ubuntu noble rebuild inputs. They include the upstream source, Ubuntu/Debian patches and source-package descriptors. They are **not proven to be the exact headers used for the published WASM**. Their archive sizes and SHA-256 values match the Ubuntu `.dsc` records obtained over HTTPS. This packaging check does not validate the descriptors' OpenPGP signatures.

Emscripten 6.0.10 source at `d6c521a7f05449857c76bd99e396895583cf2083` and its SDK scripts at `a2b92777574c2feda07994cd4f1079a3dfc151f8` are included as pinned available build inputs. These include the runtime sources, compiler download manifest and runtime notices. They do not identify the original container image, host filesystem or all historical compiler-package bytes. No local native rebuild or byte-for-byte reproduction of the upstream WASM has been claimed.

## Rebuild the library

Use a separate directory and preserve the downloaded originals. The following are maintainer steps for a Linux environment with Node, npm, Python, a C++ compiler, make, CMake, patch, tar and Docker available. The generator's `tree-sitter` dependencies have native Node addons, so `npm ci --ignore-scripts` alone is insufficient. Windows users can use a suitable Linux environment. No toolchain installation or native rebuild is needed to use the published package.

1. Verify the downloaded files against `planegcs-sources.json`, then extract the PlaneGCS source archive. Do not run `npm run update-freecad`. That command fetches a newer FreeCAD HEAD and changes the source being rebuilt.
2. In the extracted source, run `npm ci` using its included lock. Then run `npm run build:bindings`. This produces `planegcs/bindings.cpp` and the generated `planegcs_dist/*.ts` files from the supplied native headers and templates.
3. The upstream build path is `npm run build:docker`, followed by `npm run build:wasm`. Its Dockerfile is retained unchanged for reference. That path resolves today's apt packages and is not a pinned reconstruction of the publisher's environment.
4. For a rebuild using the supplied header sources, extract each upstream header archive, extract its matching `debian.tar.xz` into that source root, and apply the non-comment entries of `debian/patches/series` in order with `patch -p1`. The Eigen root is `eigen-3.4.0`; the Boost root is `boost`. These are header inputs, so building all Boost libraries or Eigen documentation is unnecessary.
5. Make a separate copy of the upstream Dockerfile. Keep the Emscripten 6.0.10 toolchain, replace the unversioned Eigen/Boost apt installation with `COPY` instructions for those patched roots at `/usr/include/eigen3` and `/inc/boost`, and retain the source's CMake options. Record the resolved toolchain image digest and all added build inputs for the replacement release. An alternative is to install SDK 6.0.10 with the supplied SDK scripts and use `emcmake cmake`/`emmake make` with those include paths. The SDK installation still downloads compiler binaries identified by its release manifest.
6. Run the upstream `npm run build:wasm` with that separately named builder image, or its documented equivalent `emcmake cmake . -DCMAKE_BUILD_TYPE=Release` and `emmake make -j` in `planegcs/`. Copy the resulting `planegcs.js` and `planegcs.wasm` from `planegcs/bin` into `planegcs_dist/`.
7. Run `npm pack`. Upstream `prepack.sh` runs TypeScript compilation and copies the matching native loader/WASM into `dist/planegcs_dist/`. Use a distinct package version for a modified release. Retain the modified source, generator inputs, exact header inputs, build record and notices alongside that package.

The native recipe uses C++20, a single-threaded ESM module, `-O3`, `emmalloc`, a 5 MB stack and `EMBIND_AOT`. Its CMake include paths use Boost headers and Eigen. It does not link the Ubuntu host's Boost shared libraries into WASM. Do not silently substitute a different release's generated declarations or loader.

These commands describe the upstream build procedure and the supplied input paths. The packaging trial verified archive contents, npm/source agreement, installed artifact hashes, distribution and runtime loading. It did not run a native toolchain build. On this Windows host, a generator-only attempt stopped because node-gyp could not find Python. That is an environment prerequisite, not evidence that the generator or a native rebuild passed.

## Replace or modify the library

Recipients may modify the library and debug those modifications. Wire EDM Workbench adds no restriction on reverse engineering for that purpose. Library source changes retain the applicable licenses and change notices.

For a local application rebuild, unpack the provided npm package or build a replacement package, keep the complete wrapper/declarations/native loader/WASM set together, and point the dependency at the replacement package. The browser adapter must import `dist/planegcs_dist/planegcs.wasm` through Vite's `?url` asset path and pass that URL through Emscripten's `locateFile` callback. The WASM must remain a separate emitted asset, allowing a compatible replacement to be served locally. A wrapper/API change requires rebuilding the application against its matching declarations as well.

Replacing a compatible WASM file in an already built local deployment is possible by serving the replacement bytes at the emitted WASM asset URL. A matching loader change requires a fresh application build because Vite bundles JavaScript. Preserve a copy of the application source and build instructions to rebuild that glue. Do not change the published 1.3.0 manifest hashes to make a modified package pass. Create a separately identified source/artifact record and run focused solver checks for the replacement.

This packaging directory supplies the library source and instructions. Application integration owns the actual separate-asset import, cancellation and cleanup behavior, solver checks and visible link to these downloads. Packaging alone does not verify that future integration.

## Sources

- [Exact npm release record](https://registry.npmjs.org/@salusoft89/planegcs/1.3.0)
- [Pinned source and build files](https://github.com/Salusoft89/planegcs/tree/9d26baef0b240fe0eef4186d4e5e5e66ec3620b7)
- [Upstream 1.3 release](https://github.com/Salusoft89/planegcs/releases/tag/1.3)
- [Ubuntu Eigen source record](https://api.launchpad.net/1.0/ubuntu/+archive/primary/+sourcepub/16942167)
- [Ubuntu Boost source record](https://api.launchpad.net/1.0/ubuntu/+archive/primary/+sourcepub/18085260)
- [Emscripten source](https://github.com/emscripten-core/emscripten/tree/d6c521a7f05449857c76bd99e396895583cf2083)
- [SDK source](https://github.com/emscripten-core/emsdk/tree/a2b92777574c2feda07994cd4f1079a3dfc151f8)
