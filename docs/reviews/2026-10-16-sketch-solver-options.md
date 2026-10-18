# Practical 2D sketch solver options

Research date: 2026-10-16. The comparison used documentation, upstream source and published artifact inspection. A subsequent isolated Node/WASM trial is recorded separately below. The trial packed the exact package under `tmp`; it changed no production code, root dependencies or lockfile and made no remote writes.

## Recommendation

Use `@salusoft89/planegcs@1.3.0` as the first integration candidate through one small application-owned adapter. It already exposes the needed line/circle/arc relations, temporary drag constraints and conflict identifiers to TypeScript. Its browser package is materially closer to this Vite app than extracting a solver from a complete CAD application. The subsequent trial verified the core interface on small fixtures; browser integration and distribution remain separate adoption work. [Package documentation][pg-readme], [Constraint types][pg-constraints], [Wrapper source][pg-wrapper]

Keep the current scalar primitive edits for rectangle/circle grips and existing dimensions. Do not write a second general nonlinear solver, replace Replicad, import FreeCAD's desktop application, or add a runtime backend chooser. The missing work is the adapter, relation ownership, validation and persistence semantics, not another CAD kernel. [Current geometry model][local-document], [Current dimension operations][local-constraints]

## Candidate comparison

| Candidate | Browser delivery and license evidence | Capabilities and limits | Decision |
| --- | --- | --- | --- |
| FreeCAD PlaneGCS through `@salusoft89/planegcs` | Published ESM, TypeScript declarations and separate WASM; explicit Vite URL guidance. Core headers permit GNU Library GPL version 2 or later; wrapper sources and included license use LGPL 2.1 or later. npm's `LGPL-2.0-or-later` field does not fully describe that distinction. [README][pg-readme], [Core header][pg-core], [Wrapper][pg-wrapper], [License][pg-license], [Manifest][pg-package] | Numeric planar geometry, dimensions, tangent relations, temporary drag targets, DOF and conflict/redundancy diagnostics. Some non-driving measurement modes are documented as unreliable. [Constraint declarations][pg-constraints], [Binding API][pg-api], [README limits][pg-readme] | First trial. Preserve the exact shipped source/binary pairing and assess the limited relation set below. |
| Direct PlaneGCS build from FreeCAD | Official C++ implementation exists independently of the desktop Sketcher UI. The browser wrapper records the FreeCAD commit it copied. [FreeCAD source][fc-core], [Recorded upstream commit][pg-upstream] | Direct integration would require maintaining generated bindings, Emscripten build flags and source updates already supplied by the wrapper. [Build files][pg-build], [Wrapper generation][pg-binding] | Fallback if a confirmed wrapper defect or packaging requirement justifies owning a small fork. Avoid starting here. |
| SolveSpace `libslvs` and upstream WASM bindings | Upstream has JavaScript/TypeScript bindings and a WASM CMake target. SolveSpace's library page says GPLv3 and describes the restriction on proprietary linking. [Library licensing][slvs-license], [JS declarations][slvs-types], [Build target][slvs-build] | Numeric points/lines/circles/arcs, dimensions and relations; solve result includes DOF and bad-constraint handles. C API supports drag preference separately from a hard `WHERE_DRAGGED` constraint. [C header][slvs-header], [JS bindings][slvs-bindings] | Technically credible second choice only with a deliberate distribution-license decision and a tailored browser build. It is not an MIT-only drop-in. |
| SolverWasm fork of SolveSpace | Maintainer documents a browser-only build and retains SolveSpace's GPL terms. Its README describes split JS/WASM output; upstream's inspected build uses single-file output. [Fork README][slvs-fork], [Upstream build][slvs-build] | It presents upstream's solver interface rather than a different numerical engine. Fork documentation does not establish the size or configuration of an immutable published browser artifact. | Useful packaging reference. No demonstrated advantage here over pinning an upstream build. |
| JSketcher | Its author describes a JavaScript/TypeScript solver and browser CAD app. The current license adds mandatory upstream submission and irrevocable copyright assignment for modifications, with a commercial-license alternative. It is not the standard MIT grant. [Project README][js-readme], [Actual license][js-license] | Broad named-dimension and geometric-constraint functionality is documented, but solver extraction and legal compatibility are separate work. [Project README][js-readme] | Exclude from the default path. Do not copy the solver assuming that public JavaScript source means permissive reuse. |
| Assemble2D | MIT source, TypeScript and an L-BFGS implementation. Its inspected manifest declares version `0.0.1`; repository head is dated 2023-06-19. [License][a2-license], [Manifest][a2-package], [Commit][a2-commit] | README lists relevant constraints, but the inspected assembly API returns success rather than DOF/conflict diagnostics. The coincidence implementation treats parameter-array index zero as missing. [README][a2-readme], [Assembly][a2-assembly], [Coincidence source][a2-coincident] | Too much repair and diagnostic work for the smallest sound path. The readable energy functions are not evidence of a complete production sketch solver. |

## What the PlaneGCS trial must actually cover

The inspected package is version `1.3.0`, published on 2026-10-05. npm records source commit `9d26baef0b240fe0eef4186d4e5e5e66ec3620b7`; its copied FreeCAD source identifies commit `5f8eac49f31626354ee69bf40616bac801ca5560`. This is a specific wrapper/core pair, not a promise that it tracks every subsequent FreeCAD fix. [Registry record][pg-registry], [Upstream record][pg-upstream]

| App requirement | Existing package mechanism | Adapter responsibility |
| --- | --- | --- |
| Coincident endpoints | `p2p_coincident` between point IDs. [Constraint types][pg-constraints] | Keep explicit relation identity and operand ownership. Coincident points need not become the same stored vertex unless our topology model deliberately says so. |
| Horizontal / vertical | `horizontal_l`, `vertical_l` and point-pair variants. [Constraint types][pg-constraints] | Scope to local sketch axes, including sketches on datum planes. |
| Fixed point / axis position | Point `fixed` locks both coordinates; `coordinate_x`/`coordinate_y` constraints can drive one coordinate. [Geometry types][pg-geometry], [Constraint types][pg-constraints] | Preserve per-axis expression links. A size dimension must not accidentally freeze placement. |
| Length, position, angle, radius | Point distances, coordinate differences, line angles, circle/arc radii and diameters are declared. [Constraint types][pg-constraints] | Convert app degrees to the package's radian convention where applicable. Keep radius and diameter as one driving quantity, and distinguish signed axis distance from unsigned length. |
| Tangent line/circle/arc | `tangent_lc`, `tangent_la`, `tangent_cc`, `tangent_aa` and `tangent_ca` exist. Arcs also require internal `arc_rules`. [Constraint types][pg-constraints], [Arc representation][pg-readme] | Verify endpoint tangency versus tangency to the underlying curve, branch choice, clockwise sweep, wraparound and full circles. A declared relation is not proof every orientation matches our path representation. |
| Drag remaining freedom | Temporary constraints use a lower-priority system and do not reduce permanent DOF. [Package drag guidance][pg-readme], [Core temporary-tag contract][pg-core] | Add drag targets only to a candidate solve, warm-start with accepted geometry, and discard them after the gesture. Do not install temporary pointer targets as saved dimensions. |
| DOF and conflicts | `gcs.dof()` plus conflicting, redundant and partially redundant tags; wrapper maps tags back to application-supplied string IDs. [Binding API][pg-api], [Wrapper][pg-wrapper] | Report unknown diagnosis as unknown. The core returns `-1` when DOF diagnosis is not current. Map diagnostics to our relation/geometry labels, not library insertion numbers. [Core header][pg-core] |

### Expressions and stable identity

The wrapper accepts numbers, named sketch-parameter references and references to earlier-added geometry properties. Its strings are parameter-name lookups, not a parser for arbitrary app expressions. Keep `CadScalar` evaluation, parameter dependency checks and original expression text in the app. Feed evaluated numeric drivers to the solver and write back only free numeric geometry. A formula such as `size * 2` must survive a solve unchanged. [Wrapper parameter handling][pg-wrapper], [Current dimension model][local-constraints]

Package geometry and constraints use caller-supplied string IDs, but the internal numeric diagnostic tags depend on insertion order. Create dependencies before their users and rebuild the mapping for each compiled snapshot. Neither PlaneGCS nor libslvs solves our persistent identity problem after trim, split or deleted geometry. Keep saved domain IDs under application control and treat solver handles as temporary. SolveSpace likewise documents typed integer handles rather than a persistence policy. [Sketch index][pg-index], [Wrapper][pg-wrapper], [libslvs model][slvs-doc]

The wrapper's `apply_solution()` updates the geometry objects in its sketch index. Pass copied solve input, never accepted document objects, and convert the result back through our validated operations. Keep solver-owned numbers out of authoritative parameter-expression fields. [Wrapper][pg-wrapper], [App session][local-session]

### Status and failure behavior

PlaneGCS distinguishes `Success`, `Converged`, `Failed` and `SuccessfulSolutionInvalid`. In the core's comments, convergence means a minimized error function, while success means zeroing it. Do not accept any nonfailure integer as proof that constraints and material geometry are valid. [Core status enum][pg-core]

Begin with `Success` plus finite values, independent residual checks for our supported relations, valid radii/arcs and existing contour validation. Preserve the source document on failure. Separately inspect conflict/redundancy diagnostics; show DOF only after current diagnosis. A locally successful numerical solve can still change an arc branch or make an unusable material contour. Those are app-level acceptance checks.

Compute reference measurements in the existing exact domain code first. The package README specifically warns that some non-driving circle/arc diameter and other distance/length constraints do not work correctly. There is no reason to make ordinary measurement depend on those modes. [Known package limits][pg-readme]

## Browser delivery and cost

Read-only metadata inspection of the published `1.3.0` artifact found the following. Sizes are raw artifact bytes, not compressed transfer size, resident RAM or measured loading time. [Published file listing][pg-files], [Registry record][pg-registry]

| Item | Evidence |
| --- | --- |
| WASM binary | 484,003 bytes. |
| Generated WASM loader | 26,129 bytes. |
| Compiled `gcs_wrapper.js` | 29,586 bytes, before bundler output. This does not include every helper imported by the wrapper. |
| Whole npm package | 865,993 unpacked bytes. This includes declarations, source and maps, so it is not the app's runtime payload. |
| Declared linear memory | The binary's memory section declares 337 initial and 337 maximum 64 KiB pages, or 22,085,632 bytes. This is a fixed ceiling in this artifact, not a browser-process memory estimate. [Inspected WASM artifact][pg-wasm] |
| Build configuration | Inspected source uses ESM/module output, no filesystem and a 5 MB stack; no pthread flag appears in that target. [Build source][pg-build] |

The memory numbers came from parsing the published binary's WebAssembly memory section without instantiating it. The artifact's fixed limit means larger sketches can exhaust its available heap. Do not infer an entity limit or latency guarantee from the byte count. The local trial below covers small repeated fixtures; exhaustion and browser latency remain unverified.

Lazy-load one solver instance when constraint editing needs it. Use a worker if the trial confirms synchronous solves interfere with pointer input. A worker keeps computation off the UI thread, but a queued abort message cannot interrupt an already-running synchronous WASM call. Cancel by invalidating its result; terminate/recreate the worker for a hard deadline. Keep the accepted app state untouched in either case. This is the proposed adapter policy, not a feature promised by the package.

Call the explicit cleanup path for each solver system and let instance/worker disposal release the module's memory. The source includes vector deletion helpers as well as system cleanup; final integration must cover all owned handles. [Wrapper lifecycle][pg-wrapper], [Vector helpers][pg-vectors] The published loader still contains a dynamic `Function` construction path despite the source build's AOT comment. This inspection did not execute that path or establish CSP incompatibility; test the exact shipped loader under the app's intended browser policy. [Published loader][pg-loader], [Build source][pg-build]

SolveSpace has a concrete cost disadvantage in its current upstream browser target: `SINGLE_FILE=1`, `INITIAL_MEMORY=512MB` and memory growth are explicitly configured. That is a build default, not a minimum mathematical requirement of libslvs or measured browser usage. A slimmer separate-WASM build is possible work, but would be our reproducible packaging responsibility. [Upstream build][slvs-build]

## License and distribution fit

The app declares MIT and already distributes pinned corresponding source, notices and rebuild/relink material for its current CAD libraries. That machinery is useful, but its OCCT-specific exception and artifacts do not automatically cover PlaneGCS. [App manifest][local-package], [Existing distribution script][local-distribution]

For a PlaneGCS adoption, record the core and wrapper notices accurately, retain licenses and copyright notices, pin matching source/build dependencies and compiled artifacts, and supply the modification/relink materials applicable to the chosen distribution. LGPL 2.1 sections 4 and 6 describe source distribution and combined-work conditions. Separate JS/WASM files or a worker are useful packaging choices, not a conclusion that license obligations disappear. [Included LGPL text][pg-license]

SolveSpace's authors explicitly identify GPLv3 and a different commercial licensing route. Shipping a combined browser application with that library needs a deliberate license decision; preserving a claim that the whole delivered combination is MIT-only would be inappropriate. This note does not select a commercial license or declare a final legal compatibility result. [SolveSpace library terms][slvs-license]

JSketcher's current custom modification/assignment condition rules it out as an assumed MIT alternative. Assemble2D's MIT grant is straightforward, but its inspected implementation would leave us repairing basic behavior and supplying missing diagnostics. Licensing alone does not make it the least work. [JSketcher license][js-license], [Assemble2D license][a2-license], [Assembly API][a2-assembly], [Zero-index handling][a2-coincident]

## Smallest useful trial and decision gate

Keep this as one solver adapter with app-owned input/output and one pinned dependency. No public toolbar, saved schema upgrade, runtime solver plugin system or migration is needed for the trial.

1. Start with numeric points, line segments, circles and arcs. Preserve mm and sketch-local coordinates. Compile shared endpoints and stable relation IDs explicitly; do not flatten every legacy profile into a newly saved graph.
2. A single line should have four free parameters, then three after horizontal, one after fixing its start, and zero after adding a valid length. Verify the reported DOF and geometry independently. Add a conflicting length and require actionable constraint IDs with the accepted state unchanged.
3. Constrain a two-line join, a circle radius and a line/arc tangent join. Exercise clockwise arcs, angles crossing zero, a major arc and a full circle. Check residuals, continuity and original sweep intent.
4. Drag a free endpoint with temporary targets, then a partially constrained endpoint. The accepted geometry must satisfy hard relations. Cancel and stale-version results publish no edit; a completed gesture becomes one existing session batch and undo step.
5. Reevaluate a named and compound expression, and solve again. Preserve exact expression strings and shared parameter effects. Convert a failure into a structured app diagnostic without adopting the package's mutable objects.
6. Use the packaged binary in the actual Vite base path and browser worker/CSP setting. Measure initialization, typical drag solves and conflict diagnosis; observe memory over repeated open/close cycles and handle the fixed heap limit. Only change build flags if evidence requires it.

If that trial passes, add the smallest persisted relation subset: coincident, horizontal, vertical, fixed point/axis, length/position/radius and tangent. Preserve existing primitive shapes and dimension records; introduce stable subgeometry IDs only where saved relations require them. Apply the repository's browser-cache and folder-adapter migration rules before changing saved data. [Storage contract](../maintainers/storage-and-migrations.md)

If it fails, identify whether the blocker belongs to the wrapper, core numerical behavior, domain conversion or distribution. A targeted wrapper patch is smaller than adopting another application's whole sketcher. No inspected alternative currently provides a stronger evidenced path that avoids that adapter and persistence work.

## Local Node/WASM trial

The follow-up trial used the official registry package, packed with scripts disabled into `tmp/planegcs-trial-2026-10-16`. The throwaway [harness][local-trial] imports the unmodified extracted package. Its [JSON report][local-trial-report] records solved coordinates, diagnostic IDs, independent residuals, timings, memory snapshots and artifact hashes. The root `package.json` and `package-lock.json` had no diff after the trial.

The recorded run used Node `v22.23.2`, Windows x64 and an Intel Core i9-14900HX. It was a local file load, not a network load or browser run. The app's supported Node runtime starts at 24, so this execution does not certify the app runtime or browser build. The official packed archive is 238,554 bytes with SHA-1 `490cca2a741f5e1302072965eda8d8aed161bc8e`; its SHA-512 integrity matches the registry. The 484,003-byte WASM has SHA-256 `af9d1874fc895726bd267703a698a86c82d35b7415a02fe5184ebf65ddbc04af`.

| Executed case | Observed result |
| --- | --- |
| Rectangle made from four distinct line segments and four coincident endpoint pairs | Horizontal/vertical relations, fixed first point, width 20 and height 10 returned `Success`, DOF 0 and the intended exact rectangle. Independent hard-relation residual was zero. |
| Line as intent is added | DOF progressed 4, 3, 1, 0 for free, horizontal, fixed start and fixed length. All four states returned `Success`. |
| Free endpoint drag | Temporary X/Y targets moved the endpoint to 35,12, left the fixed start unchanged and retained permanent DOF 2. The returned candidate omitted temporary constraints. |
| Dimensioned endpoint drag | The same incompatible pointer target preserved horizontal length 20 and DOF 0. Hard-relation residual remained zero. |
| Circle and numeric named driver | Fixed circle center and radius 7 returned `Success`, DOF 0. A line dimension using a named numeric solver parameter reached length 30 without altering the accepted input. |
| Arc and tangent line | Arc rules, radius 10, endpoint-axis dimensions and line tangency returned `Success`, DOF 0. Maximum independent residual was about `4.18e-11` mm, below the harness's `1e-7` mm threshold. This was a quarter arc only. |
| Redundant duplicate length | Returned `Converged`, DOF 0 and redundant ID `duplicate-length`, with no conflicting IDs. The proof adapter rejected this candidate before applying a solution. |
| Contradictory lengths 20 and 30 | Returned `Failed`, DOF -1 and both IDs `length` and `contradictory-length`. The proof adapter preserved its accepted input byte-for-byte. |
| Recovery after failure | Clearing the failed reusable system and solving the rectangle through that same system returned `Success`, DOF 0. |
| Cleanup and repetition | 500 clear/reuse cycles and 500 create/destroy cycles passed. Destroyed Embind systems reported `isDeleted()`. All cycles used one WASM module, not 1,000 module initializations. |

The verified minimum adapter is `init_planegcs_module`, construct `GcsWrapper` and `GcsSystem`, copy and push ordered primitives/parameters, solve, inspect status/DOF/diagnostic IDs, apply only an accepted candidate, independently validate, and clear or destroy the system. No production backend framework is needed. `apply_solution` was never called for failed or redundant candidates. This demonstrates rollback at the proof adapter boundary, not an app session/persistence integration.

For this recorded run, module import took about 5.95 ms and WASM initialization 6.92 ms. The first rectangle's solve took 5.81 ms. Across 500 warmed rectangle calls, full proof adapter time including input copies, insertion, solve, diagnosis, independent validation and cleanup had median/p95 of 0.142/0.258 ms with clear/reuse, and 0.106/0.198 ms with a new C++ system per call. Those tiny-fixture measurements do not establish a useful large-sketch limit or predict browser pointer latency. They also do not establish that recreation is generally faster.

With forced V8 GC between phases, reported external memory was 24,262,129 bytes before repetition and 24,262,133 bytes after each 500-cycle phase. RSS varied from 60.5 MB to 90.8 MB and then 64.4 MB. This shows no growing external-memory trend over these fixtures, but does not prove that the native heap is leak-free or that arbitrary large sketches fit its fixed memory.

The native redundant/conflict solver printed diagnostic lines directly despite supplied module `print` and `printErr` callbacks. The wrapper's console shim explicitly calls JavaScript `console.log`, which explains that observation. Capture/suppress those messages through a targeted native build change if production requires it; do not globally replace app console functions. [Native console shim][pg-console]

### Source distribution follow-up

The npm archive contains the compiled module, TypeScript wrapper sources and LGPL text, but omits the native PlaneGCS C++ files, binding-generator/build files and dependency inputs. That archive alone is not the complete corresponding-source bundle described by the license. [License sections 4 and 6][pg-license], [Published file list][pg-files]

The later packaging task installed the exact `1.3.0` dependency using Node `24.22.0`. Its [source manifest][local-solver-manifest] pairs every one of the 54 installed package files with the published npm payload. `vendor/sketch-solver` retains that exact npm tarball, the full source archive at publisher `gitHead` `9d26baef0b240fe0eef4186d4e5e5e66ec3620b7`, the copied-core revision, wrapper, native generator/templates, npm build lock, native source and build/patch scripts. The installed wrapper source matches the pinned repository files byte-for-byte. The bundled core is modified FreeCAD source, since the update script applies adaptations. Both native Library GPL version-2-or-later notices and wrapper LGPL 2.1-or-later notices are retained. [Update/patch recipe][pg-update], [Core notice][pg-core], [Wrapper notice][pg-wrapper]

The upstream Dockerfile names Emscripten `6.0.10`, but neither its image digest nor apt-resolved header versions are recorded. The npm metadata and GitHub release supply no original native build receipt. Packaging therefore identifies available Eigen `3.4.0-4build0.1` and Boost `1.83.0-2.1ubuntu3.2` Ubuntu source packages, including distro patches and descriptors, as pinned rebuild inputs rather than proven original-binary inputs. Their sizes and SHA-256 values match the published Ubuntu source descriptors. Emscripten 6.0.10 and SDK source archives are pinned to commits too. Eigen/Boost, Emscripten, musl and LLVM notices accompany the source downloads. This is not a claim of byte-reproducible native rebuilding or complete knowledge of the original compiler environment. [Dockerfile][pg-docker], [Upstream release][pg-release], [Ubuntu Eigen source][ubuntu-eigen], [Ubuntu Boost source][ubuntu-boost], [Eigen licensing][eigen-license], [Boost license][boost-license]

The [distribution script][local-solver-distribution] adds `dist/third-party/sketch-solver/index.html` to the existing `third-party:bundle/check` pipeline. Its 27 local files total 5,633,894 bytes; six downloaded header/toolchain archives total 113,009,002 bytes. These are source downloads, not runtime assets. The full bundle/check commands and strict script type-check passed on Node 24. A task-local [contract report][local-packaging-report] records seven checks covering complete offline validation/cache reuse, changed source URLs, short-download cleanup, installed WASM corruption, corrupt caches, lock integrity and truncated distributed notices. Native compilation was not attempted. A generator-only attempt stopped at missing Python for node-gyp.

[Rebuild and replacement instructions][local-solver-rebuild] preserve the separate loader/WASM pair and explain replacing a compatible native asset or rebuilding the wrapper/application glue. Application integration still owns the Vite `?url` import and `locateFile`, a prominent link to the source/notices, matching application source or relink support for a bundled wrapper change, and actual browser verification. This packaging task makes no claim that those integration steps have passed.

## Production adapter foundation and remaining arc limit

The later foundation at `src/features/cad/sketch-solver` uses the real pinned module in a dedicated lazy worker. It compiles the declared graph relation subset, treats every string point component and circle radius as a fixed driver, preserves its exact text, and writes numeric components only. Endpoint arcs compile to two native center-to-endpoint lines and one native `equal_length` structural relation. Their source direction stays in the graph. This matches the current point-only graph relation vocabulary without adding independent native radius or angle parameters. These internal spoke IDs never become saved entities.

The adapter reports native `Success`, `Converged`, failure and invalid statuses separately. Conflicting, redundant or partly redundant candidates do not publish a graph. Both successful statuses must pass independent `checkCadSketchGraph` residual and source-geometry checks. Input and parameter snapshots precede asynchronous module initialization. Each call deletes its C++ system; the worker client bounds active work to 15 seconds and four queued requests, terminates on cancellation/failure, and rejects stale or mismatched responses. The focused real-package/client suite passed 15 cases on Node 24.22.0. This is foundation evidence, not a claim that all sketch workflows or arcs are complete.

A [36-case numerical review][local-arc-matrix] deliberately started arcs with unequal radii. For each radius `r` in `[0.25, 1, 10, 33.3, 99.5, 1000]`, center `C` in `[(0,0), (100,300), (1000000,2000000)]`, and direction `cw` or `ccw`, the graph contained:

- A center with both coordinates stored as exact numeric strings.
- A start point `C + r * (cos(30°), sin(30°))`, with both components converted to exact JavaScript numeric strings and therefore fixed.
- An end point with fixed string X `Cx + r*cos(145°)` and free numeric Y initialized to `Cy + 1.2*r*sin(145°)`.
- One arc referencing those three points and no explicit user relations. Its structural equal-radius relation supplied the solve intent.

With unmodified default DogLeg and native equation scale 1, 28 cases passed the independent graph check. Eight returned native `Success`, DOF 0 and no conflict/redundancy, but were correctly rejected as `invalid-solution`. Those were radii `0.25` and `10`, centers `(0,0)` and `(100,300)`, in both directions. Radius equality error was about `3.63e-11` mm for radius 0.25 and `6.65e-11` mm for radius 10. The existing source-closure policy at those coordinates allows `1e-12` mm. The adapter returns the arc ID and `arc-radius-mismatch` issue without a candidate graph. Exact failing graphs are retained in the task-local report; regressions retain one ordinary oblique success and one honest strict-closure rejection.

The public convergence setter did not improve the DogLeg cases. The copied native source has separate `convergence` and `DL_tolf` fields, and the wrapper setter changes the former. A bounded experiment with the package's LM algorithm and smaller convergence values also did not resolve the whole matrix. No fallback algorithm, equation scaling, source-coordinate repair or relaxed graph tolerance was adopted. [Native stopping criteria][pg-core], [Wrapper setter implementation][pg-binding]

### Bounded coordinate-conditioning trials

Two later Node 24.22.0 trials compared the unchanged runtime with a uniform 1024 native length units per mm. Every coordinate, fixed driver, distance, radius and temporary drag target used that conversion; numeric writeback used its inverse, exact source strings remained unchanged, and the independent world-mm check stayed unchanged. The first trial translated coordinates around the initial evaluated position of the lowest ASCII point ID. The second used origin zero, without translation. Each ran the same 78 inputs through the actual package. [Translated-frame report][local-conditioning-translated], [Unit-only report][local-conditioning-units]

| Cases | Count | Current runtime accepted | Translation + 1024 | Unit-only 1024 |
| --- | ---: | ---: | ---: | ---: |
| Original oblique arcs | 36 | 28 | 36 | 24 |
| Tiny/large radius arcs | 10 | 6 | 10 | 8 |
| Far-origin arcs | 8 | 0 | 8 | 0 |
| Mixed expression axes, fixed points, distance and circles | 10 | 8 | 10 | 8 |
| Free, expression-axis, dimensioned and locked drag | 8 | 8 | 8 | 8 |
| Conflicts and redundant constraints, correctly rejected | 4 | 0 | 0 | 0 |
| Whole-sketch extent | 2 | 1 | 0 | 2 |

The translated trial introduced one accepted-to-rejected regression: a radius 99.5 arc near `(0,0)` connected by a construction line to the lowest-ID point at `(-5e8,5e8)`. Its fixed start X `86.16952767655165` round-trips through that translation as `86.16952764987946`, an error of about `2.67e-8` mm. A deterministic source-point origin therefore does not preserve small-feature precision across every allowed sketch extent. Changing the lowest point ID or its evaluated position also changes the numeric frame. The unit-only trial avoids subtraction loss, and binary scaling/inverse scaling is exact for the tested input range, but it introduced 14 accepted-to-rejected regressions: all 12 original-matrix arcs centered at `(1e6,2e6)` and both radius 999999 cases at zero returned native `Failed`. Exact reversible unit conversion still changes native convergence behavior.

DOF and conflict/redundancy ID arrays matched the current runtime in both trials. Every accepted result passed the unchanged world checker and production reply ownership checks; inputs and expression strings stayed unchanged. This does not establish identical free-geometry placement or exact pointer attainment for constrained dragging. Both proposals were frozen without production runtime/test changes, additional tuning or a toolchain rebuild. The current eight strict arc rejections remain safely rejected without publishing a candidate graph. [Exact prototypes and limits][local-conditioning-notes]

Remaining solver work includes improving these ordinary arc cases through a justified representation or supported numerical setting while keeping exact driver ownership, immutable inputs and the independent acceptance gate. Native tolerance success alone is insufficient for the application's source-closure contract. Tangency and explicit circle/arc radius relations also remain outside the current persisted graph relation subset.

An independent [actual production Chromium check][local-solver-browser] used the public registered WebMCP operations through the repository's existing test transport shim on the existing local preview server. The empty CAD workspace requested no WASM and started no solver worker. Its first graph edit started exactly one `cadSketchSolver` worker and fetched one separate 484,003-byte WASM with the exact published SHA-256 and `application/wasm` MIME type. The endpoint solved to `(20,0)` while the exact relation text `" width "` survived. No OCCT request or page error occurred. This verifies browser bundling, lazy delivery and the real application operation path; it is not native WebMCP browser interoperability or a strict-CSP certification.

## Evidence limits

This is a bounded comparison and real-solver foundation, not a numerical-quality certification or complete license audit. Actual worker delivery and an expression-driven solve were verified in production Chromium. Strict CSP, browser-native WebMCP interoperability, every browser's native cancellation behavior, all major/full-circle arc cases, large-sketch performance, memory exhaustion and long-term native allocation behavior remain outside this evidence. The adapter/client cases do not certify persistence or every controller workflow. Upstream tests were read only. Local trial scripts under `tmp` are throwaway evidence; the adapter/client's 15 focused cases live at their public seams in the production test suite.

PlaneGCS source links below are pinned to its published `1.3.0` commit. SolveSpace source links are pinned to the inspected upstream head `8ef723e145fbe3f1d19e74667c59df795d9d3479`. Assemble2D links use inspected commit `5f4380ce8311a1679b19c5f75d6b3e887bfb3ca6`. No exhaustive search of older permissively licensed JSketcher history or every research solver was attempted.

[pg-readme]: https://github.com/Salusoft89/planegcs/blob/9d26baef0b240fe0eef4186d4e5e5e66ec3620b7/README.md
[pg-package]: https://github.com/Salusoft89/planegcs/blob/9d26baef0b240fe0eef4186d4e5e5e66ec3620b7/package.json
[pg-registry]: https://registry.npmjs.org/@salusoft89/planegcs/1.3.0
[pg-files]: https://unpkg.com/@salusoft89/planegcs@1.3.0/?meta
[pg-loader]: https://unpkg.com/@salusoft89/planegcs@1.3.0/dist/planegcs_dist/planegcs.js
[pg-wasm]: https://unpkg.com/@salusoft89/planegcs@1.3.0/dist/planegcs_dist/planegcs.wasm
[pg-constraints]: https://unpkg.com/@salusoft89/planegcs@1.3.0/planegcs_dist/constraints.ts
[pg-api]: https://unpkg.com/@salusoft89/planegcs@1.3.0/dist/planegcs_dist/gcs_system.d.ts
[pg-wrapper]: https://github.com/Salusoft89/planegcs/blob/9d26baef0b240fe0eef4186d4e5e5e66ec3620b7/sketch/gcs_wrapper.ts
[pg-geometry]: https://github.com/Salusoft89/planegcs/blob/9d26baef0b240fe0eef4186d4e5e5e66ec3620b7/sketch/sketch_primitive.ts
[pg-index]: https://github.com/Salusoft89/planegcs/blob/9d26baef0b240fe0eef4186d4e5e5e66ec3620b7/sketch/sketch_index.ts
[pg-core]: https://github.com/Salusoft89/planegcs/blob/9d26baef0b240fe0eef4186d4e5e5e66ec3620b7/planegcs/GCS.h
[pg-license]: https://github.com/Salusoft89/planegcs/blob/9d26baef0b240fe0eef4186d4e5e5e66ec3620b7/LICENSE
[pg-upstream]: https://github.com/Salusoft89/planegcs/blob/9d26baef0b240fe0eef4186d4e5e5e66ec3620b7/planegcs/commit.txt
[pg-build]: https://github.com/Salusoft89/planegcs/blob/9d26baef0b240fe0eef4186d4e5e5e66ec3620b7/planegcs/CMakeLists.txt
[pg-binding]: https://github.com/Salusoft89/planegcs/blob/9d26baef0b240fe0eef4186d4e5e5e66ec3620b7/build-bindings/templates/gcs_system.cpp.njk
[pg-vectors]: https://github.com/Salusoft89/planegcs/blob/9d26baef0b240fe0eef4186d4e5e5e66ec3620b7/sketch/emsc_vectors.ts
[pg-console]: https://github.com/Salusoft89/planegcs/blob/9d26baef0b240fe0eef4186d4e5e5e66ec3620b7/planegcs/headers/Console.h
[pg-update]: https://github.com/Salusoft89/planegcs/blob/9d26baef0b240fe0eef4186d4e5e5e66ec3620b7/planegcs/update_freecad.sh
[pg-docker]: https://github.com/Salusoft89/planegcs/blob/9d26baef0b240fe0eef4186d4e5e5e66ec3620b7/Dockerfile
[pg-release]: https://github.com/Salusoft89/planegcs/releases/tag/1.3
[ubuntu-eigen]: https://api.launchpad.net/1.0/ubuntu/+archive/primary/+sourcepub/16942167
[ubuntu-boost]: https://api.launchpad.net/1.0/ubuntu/+archive/primary/+sourcepub/18085260
[eigen-license]: https://gitlab.com/libeigen/eigen/-/blob/before-3.4/COPYING.README
[boost-license]: https://www.boost.org/LICENSE_1_0.txt
[fc-core]: https://github.com/FreeCAD/FreeCAD/blob/5f8eac49f31626354ee69bf40616bac801ca5560/src/Mod/Sketcher/App/planegcs/GCS.h
[slvs-license]: https://solvespace.com/library.pl
[slvs-doc]: https://github.com/solvespace/solvespace/blob/8ef723e145fbe3f1d19e74667c59df795d9d3479/exposed/DOC.txt
[slvs-header]: https://github.com/solvespace/solvespace/blob/8ef723e145fbe3f1d19e74667c59df795d9d3479/include/slvs.h
[slvs-types]: https://github.com/solvespace/solvespace/blob/8ef723e145fbe3f1d19e74667c59df795d9d3479/js/slvs.d.ts
[slvs-bindings]: https://github.com/solvespace/solvespace/blob/8ef723e145fbe3f1d19e74667c59df795d9d3479/src/slvs/jslib.cpp
[slvs-build]: https://github.com/solvespace/solvespace/blob/8ef723e145fbe3f1d19e74667c59df795d9d3479/src/slvs/CMakeLists.txt
[slvs-fork]: https://github.com/Box-of-Dragons/SolverWasm/blob/master/README.md
[js-readme]: https://github.com/xibyte/jsketcher
[js-license]: https://github.com/xibyte/jsketcher/blob/main/LICENSE
[a2-readme]: https://github.com/tab58/assemble2d/blob/5f4380ce8311a1679b19c5f75d6b3e887bfb3ca6/README.md
[a2-license]: https://github.com/tab58/assemble2d/blob/5f4380ce8311a1679b19c5f75d6b3e887bfb3ca6/LICENSE
[a2-package]: https://github.com/tab58/assemble2d/blob/5f4380ce8311a1679b19c5f75d6b3e887bfb3ca6/package.json
[a2-commit]: https://github.com/tab58/assemble2d/commit/5f4380ce8311a1679b19c5f75d6b3e887bfb3ca6
[a2-assembly]: https://github.com/tab58/assemble2d/blob/5f4380ce8311a1679b19c5f75d6b3e887bfb3ca6/src/solver/assembly.ts
[a2-coincident]: https://github.com/tab58/assemble2d/blob/5f4380ce8311a1679b19c5f75d6b3e887bfb3ca6/src/solver/constraints/coincident.ts
[local-document]: ../../src/domain/cad/cadDocument.ts
[local-constraints]: ../../src/domain/cad/cadSketchConstraints.ts
[local-session]: ../../src/features/cad/cadSession.ts
[local-package]: ../../package.json
[local-distribution]: ../../scripts/distribute-cad-sources.ts
[local-trial]: ../../tmp/planegcs-trial-2026-10-16/trial.mjs
[local-trial-report]: ../../tmp/planegcs-trial-2026-10-16/trial-report.json
[local-solver-manifest]: ../../vendor/sketch-solver/planegcs-sources.json
[local-solver-rebuild]: ../../vendor/sketch-solver/REBUILD.md
[local-solver-distribution]: ../../scripts/distribute-sketch-solver.ts
[local-packaging-report]: ../../tmp/planegcs-trial-2026-10-16/packaging-report.json
[local-arc-matrix]: ../../tmp/sketch-solver-smoke/arc-matrix-report.json
[local-solver-browser]: ../../tmp/sketch-solver-smoke/browser-report.json
[local-conditioning-translated]: ../../tmp/sketch-conditioning/report-translated.json
[local-conditioning-units]: ../../tmp/sketch-conditioning/report.json
[local-conditioning-notes]: ../../tmp/sketch-conditioning/README.md
