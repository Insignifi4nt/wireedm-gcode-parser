# CAD section endpoint and export buffer efficiency audit

Date: 2026-10-14. Initial investigation baseline: `09795ec5e0e404f5ce69ff2173dea119a69f66ce`, with the parent's frozen CAD capacity changes, subsequently committed as `c36aa3b50a30f82ded3508652d9e7917c69b6b59`. The first pass below was a read-only investigation. The final addendum records the subsequently authorized, narrow production optimizations and their focused verification; it is not an overall completion gate. Offline native measurements started only after the parent reported the whole browser gate passed: 311 files/3,447 tests; the separate pure-domain gate passed 43 files/348 tests.

## Accepted native fixture and method

Each fixture is an exact regular polygon of radius 100 mm, with 256, 1,024 or 4,096 straight edges, an analytic circular bore of radius 20 mm, and a 10 mm Pad. Its one accepted body is sectioned on XY at Z=5 mm. The document crosses the real strict CAD parser and kernel-model builder; diagnostics are empty. Expected volume is `(N / 2 × 100² × sin(2π / N) − π × 20²) × 10` mm³.

The section has exactly N lines and the complete circular bore. This pinned native build returns the bore as two analytic arcs, not a tessellated circle: their radii remain 20 mm and absolute sweeps sum to 2π. Both contours are closed. The section result crosses its real response validator; CAM retains every analytic entity without omitting or repairing it. A tangent section at Z=0 rejects. The 4,096-edge body is accepted beyond the former 10,000-element body-topology policy; the fixture does not rely on lowering accuracy or rewriting geometry.

The full section uses the unchanged application implementation. The isolated endpoint replay consumes its actual projected endpoints and uses the same first-representative distance predicate. The read-only prototype adds an existing `SpatialHash` broadphase, retains the exact `Math.hypot(dx, dy) <= 1e-7` test and preserves original representative insertion order. Full representative coordinates, order and degrees match between replays.

Timing uses Node v22.23.2 and the installed pinned native package on this host. WASM initialization is excluded. Full sections and CAM construction have three samples; endpoint replay has five. Replay timings include an explicit comparison counter and thus are not a native phase profiler or an exact measurement of the uninstrumented block. They are useful alongside deterministic comparison counts. Numbers below are medians in milliseconds; one fixture/host does not establish a general performance guarantee.

| Polygon lines | Full section | Current endpoint replay | Spatial candidate replay | Current distance checks | Spatial distance checks | CAM replay | Native heap capacity after measurement |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 256 | 73.99 | 1.44 | 1.78 | 66,564 | 258 | 5.97 | 100 MiB |
| 1,024 | 403.21 | 38.42 | 13.00 | 1,052,676 | 1,026 | 33.82 | 199.06 MiB |
| 4,096 | 10,324.06 | 650.63 | 50.63 | 16,793,604 | 4,098 | 115.66 | 1,279.06 MiB |

The heap column is WASM buffer capacity, not resident-memory peak or evidence of a leak. The temporary model is explicitly disposed. Construction also grows substantially: 283.24, 860.18 and 11,875.27 ms for these three fixtures. Section growth was stopped at 4,096 edges because larger runs would spend minutes without resolving the identified matching/copy seam; this is a benchmark choice, not an application size cap.

## Section finding and smallest correct optimization

`cadKernelSection.ts` constructs a list of representative vertices and calls `vertices.find` for every line/arc endpoint. A representative point never moves. It chooses the first existing representative within 1e-7 mm and increments its degree; otherwise it creates a new representative. Circles have no endpoint contribution. Degrees other than two reject open, touching or branching outlines.

For the measured closed fixtures, the unique vertex count V is N+2 and the replay performs exactly V² distance checks. This is a clear quadratic search. Replacing the search candidates with the existing ordered `SpatialHash` reduced the 4,096-edge case from 16,793,604 to 4,098 checks and the counted replay by about 600 ms. That is roughly 6% of its full 10.3-second section, before accounting for replay instrumentation. It would improve this large case, but the remaining native work and extraction are much larger. It must not be sold as making large sections instant. At 256 edges the index costs slightly more than the small linear scan.

The narrow implementation recommendation is a private endpoint-degree validation helper, or a small index inside the current block:

- Insert only newly created representatives into the spatial index. Do not insert every matched endpoint or change representative coordinates.
- Use ordered candidates. `SpatialHash.queryBounds` already sorts its insertion IDs, preserving the current first match even when an endpoint is within tolerance of several representatives. Choosing the nearest candidate or using unordered buckets changes behavior.
- Keep the current inclusive Euclidean distance predicate and degree calculation exactly. A square broadphase may admit extra candidates; only the unchanged radial test can accept them.
- Make the broadphase conservative for floating-point coordinates. The measured prototype used `2 × tolerance + 64 × EPSILON × max(1, |x|, |y|)` for its search bounds and retained 1e-7 for the actual match. This reserve does not heal or admit geometry. Existing `SpatialHash` handles unsafe-sized cell indices with BigInt and has conservative scan fallbacks, so a plain numeric grid loop should not be substituted.
- Keep current tangent/interior checks, line degeneracy, exact arc sweep/orientation checks, unsupported-curve rejection, CAM validation and all native cleanup unchanged. No new public option, accuracy setting or capacity limit is needed.

The existing `clusterSegmentEndpoints` API is not an equivalent replacement. Its exact-group clique rule, centroid updates, 1e-9 coincidence epsilon and reciprocal near-pair healing semantics differ from this first-representative degree check. Native `IsSame` vertex lookup is also not equivalent to geometric tolerance matching.

The prototype's six targeted boundary cases and 150 seeded cases (12,000 endpoints, seed `0x4cad2026`) preserve every representative coordinate, order, degree and resulting open/branch classification, without mutating input. Cases include inclusive tolerance, diagonal near points, several eligible representatives, negative cell boundaries, signed zero and ±1e9 coordinates. This differential evidence is useful but does not replace production regressions before a future optimization.

Dense tolerance neighborhoods and far-coordinate fallback scans can still be quadratic. The index is a candidate accelerator, not a guarantee of globally linear work. A follow-up should measure the native `BRepAlgoAPI_Section.Build` phase separately before attempting larger changes; subtracting replay times from whole section time cannot attribute the residual precisely. CAM has separate costs, including repeated closed-chain start sorting and contour containment; those should not be rewritten as part of this narrow repair.

## Export buffer ownership and measured copy cost

The installed Emscripten loader's `FS.readFile` opens the file, obtains its size, allocates `new Uint8Array(size)`, reads into that array and closes the handle. Its returned bytes are independent of the native heap/file buffer. The app's STEP exporter then calls `Uint8Array.from` on this already independent result, before constructing a Blob. That adds another full N-byte allocation/copy. The pinned Replicad STL exporter directly constructs its Blob from the returned byte view.

An offline actual STEP export from the 4,096-edge ring produced **16,928,876 bytes**. It completed in **3,331.98 ms**, retained two closed analytic sections afterward, left the caller document unchanged and removed `/export.step`. The captured FS view had offset zero, exactly matched its backing buffer length, and did not share `oc.wasmMemory.buffer`.

Seven isolated buffer-construction samples on those exact bytes gave:

| Construction | Median | Observed range |
| --- | ---: | ---: |
| Current `Uint8Array.from(file)` then Blob | 9.30 ms | 6.68–12.27 ms |
| Blob from the independent returned byte view | 3.58 ms | 3.12–4.18 ms |

The direct Blob and existing export both retained their exact bytes after the captured FS array was mutated. Export bytes also remained correct after native model disposal. Their snapshot SHA-256 was `9fd46231ed9ffec4d424e2fe6d1f5d84d2bb3ebe34aea93960a682966c15c383`. This hash belongs to that concrete generated STEP snapshot, not a stable fixture format promise: native headers can vary between exports.

Removing the redundant array copy would save one **16.14 MiB** allocation for this file and about 5.7 ms in the isolated construction median. That is less than 0.2% of the measured native export, so memory amplification is the stronger justification. Blob construction and FS extraction still materialize full bytes; no zero-copy or unlimited-memory promise follows.

The smallest recommended ownership design is to make the native binary read/Blob boundary explicit and typed. It should return a Blob snapshot from a validated ordinary ArrayBuffer-backed byte view with its actual offset/length, without exposing a native heap view or copying solely to satisfy an overly broad TypeScript `ArrayBufferLike` type. Keep the existing borrowed-shape contract, named assembly/MM/schema behavior, scratch-file ownership, `finally` cleanup and primary-error preservation. A real browser download/mutation check and existing native STEP round-trip cases should verify the change before shipping; these offline Node Blob observations alone do not certify the browser boundary.

The first measurement harness attempted a non-exported `FS.analyzePath` helper after its section samples and aborted at that observation step. This was a harness error, not a section/export failure. The completed export run used an actual missing-file read to verify scratch cleanup. No application behavior was adjusted to make the measurement pass.

## Reproduction and future validation

The read-only temporary harnesses were `tmp/cad-section-resource-benchmark.ts`, `tmp/cad-section-degree-differential.ts` and `tmp/cad-export-buffer-resource-benchmark.ts`, executed with `npx tsx --tsconfig tsconfig.app.json <path>`. The `tmp/` directory is ignored; these prototypes are not production/test changes. The geometry formula, sample counts, exact measured values and source pins in this record make their conditions explicit.

Before the authorized patch, regressions were required at the real section/export boundaries for full circles and split arcs, separate loops, touching/branching/open outlines, ambiguous first representatives, tolerance/cell boundaries and far coordinates. They must confirm exact entities and error codes, unchanged caller input, retained body/picks after rejected queries and deterministic native disposal. STEP copy removal must verify complete bytes/names/units after scratch unlink, mutation and model disposal, plus write/read/cleanup failures without suppressing the primary error. No algorithm, tolerance or source change was made during the initial read-only investigation.

Source SHA-256 identifiers, rechecked after measurement:

| Source | SHA-256 |
| --- | --- |
| `src/features/cad/kernel/cadKernelSection.ts` | `A38C2FA990F9EC960BCB5979E7B697A699C56831782A1304E487ABE9D124EBDB` |
| `src/features/cad/kernel/cadKernelExport.ts` | `40E78C0984700D48D0E0765B23C694D9343A3B8956AC3E593AE8935E196923BF` |
| `src/domain/cad/cadSection.ts` | `D3CE8161C42F8EC2E3C65A8216A87334C348BAC81A1B401E79AFCEB4BD9FF5F5` |
| `src/domain/cad/cadCam.ts` | `9797551E2A0180F312E3C9CEDDA7B9E25601F88D20C255375A438C408098BA1F` |
| `src/domain/path-intel/spatialIndex.ts` | `2F0E0B2225640336BC487B48AFFA07E083296F3C90A0236B7FF53B11E7F5C493` |
| `src/domain/path-intel/endpointClusters.ts` | `0A22A11BC0047AE75C83BA002766BA635D076DA92A2113D264428B28F4E5E668` |
| `src/domain/path-intel/chains.ts` | `1376585622C6B9AC7377486A531D6C7289CD021AA8228B50D545C7D9FAEFBB4E` |
| `node_modules/replicad-opencascadejs/dist/replicad_single.js` | `5BA5161518781C04AF771AE4E841956613DDE4E679766DDAAEB581B778E1A8BE` |
| `node_modules/replicad/dist/casting-rs4QjB74.js` | `5EDBDF7436C52A984947DCE9BED5B5C671ADBC6AC79EE79B7C9869022C1BCB70` |

## Authorized implementation and measured verification

After the `c36aa3b50a30f82ded3508652d9e7917c69b6b59` checkpoint, the parent authorized the two measured optimizations. Production source was frozen for independent review after the focused checks below. Other agents were changing separate curve-rendering/reference files concurrently; these hashes pin this slice without implying the entire working tree was frozen or clean.

`cadKernelSectionEndpoints.ts` contains the existing degree check, with ordered `SpatialHash` candidates replacing the full representative scan. Representatives still retain their original points and insertion order. Only new representatives enter the index. The `Math.hypot(dx, dy) <= tolerance` predicate, degree-two requirement and `open-section` error are unchanged; the caller still passes `1e-7`. Expanded broadphase bounds are finite-clamped and cannot accept an endpoint without the exact radial check. Native section construction, approximation mode, projection, line/arc generation, tangency/degeneracy checks and native ownership remain unchanged. Dense and far-coordinate fallback scans remain possible.

STEP now constructs its Blob from the exact offset/length of ordinary ArrayBuffer-backed `FS.readFile` bytes, whose independent allocation was established from the pinned FS implementation. It does not allocate a redundant full byte copy for those bytes. SharedArrayBuffer or currently exposed native-memory backing retains the defensive copy. Blob snapshots still allocate their output representation. Borrowed shapes, writer parameters, scratch-file unlink, constructor/resource cleanup and primary-error preservation retain their prior behavior.

Meaningful red evidence preceded both fixes: the actual endpoint block performed **4,194,304** distance calls for a closed 2,048-edge polygon versus the nearby-candidate regression's 8,192 upper bound; native STEP read bytes invoked `Uint8Array.from` once even for an independently owned offset view, where zero redundant copies was expected. The latter fixture initially expected the uppercase MIME spelling; that expectation was corrected to the Blob-standard lowercase value before establishing the actual allocation failure. No production MIME behavior changed.

The new endpoint tests cover ambiguous/nontransitive first matches, inclusive radial tolerance and diagonal rejection across positive/negative cells, far-coordinate representable gaps below/above tolerance, touching degree-four loops, complementary exact arcs, ignored circle endpoints and a large closed contour without mutation. Actual native tests cover touching compound branches with another valid section afterward, and a 512-edge polygon/bore section with complete analytic entities, exact volume, CAM contours, tangent rejection and unchanged input. Actual STEP tests cover independent/shared/native-backed offset views, complete bytes after view mutation/unlink/shape disposal, borrowed-source validity, read/Blob failures combined with unlink failure, and successful retry.

The focused gates passed **83 tests in 11 files**: section endpoints, native section, export buffer, existing native numerics, topology numerics, runtime, DXF export, section capacity, model, native shape ownership and client local-resource cases. `tsc -p tsconfig.app.json --noEmit` and the scoped whitespace check passed. These Node/native and DOM project gates do not substitute for the parent's final build or real browser/download check.

The post-patch offline fixture used the same accepted 4,096-edge polygon, analytic bore and section geometry. Three full section samples were 4,612.63, 4,219.28 and 4,178.50 ms, with median **4,219.28 ms**. Directly timing the exact `BRepAlgoAPI_Section.Build` invocation gave 4,352.79, 4,018.85 and 3,998.25 ms, median **4,018.85 ms**, about 95% of the whole-section median. The temporary instrumentation retained Embind overload metadata and was restored afterward; an initial instrument wrapper without that metadata failed before collecting useful samples and was corrected only in the ignored harness.

In the same process, five uninstrumented replays of the original representative scan had median **265.15 ms**; five calls to the actual patched helper on those exact returned entities had median **25.89 ms**. The approximately **239 ms** endpoint improvement remains a small part of native section work. CAM replay median was 60.85 ms. Native Build is now directly measured as the dominant cost for this fixture; no algorithm or requested-accuracy changes were attempted.

The earlier 10.3-second whole-section measurement and this 4.2-second result are separate, unpaired runs with markedly different model-build/export timings as well. Their difference cannot be credited to this patch. The isolated same-process old/helper measurements support the endpoint benefit; they are not a matched before/after whole-section benchmark or a universal latency promise.

The patched actual STEP export took **1,508.47 ms** and produced **16,928,876 bytes**, with **zero** redundant `Uint8Array.from` calls on its FS output. Complete output bytes matched before/after captured view mutation, scratch unlink and native model disposal. The concrete snapshot SHA-256 was `26789ec1892f41ce93cca04866d77d9bf5f64d2455f36a6f1a8641fa3cac8a3c`; varying native headers make this a snapshot checksum, not a promised stable export checksum. The saved allocation is 16.14 MiB for this file; changed whole-export timing between runs does not prove an export speedup of seconds. Native heap capacity again reached 1,279.06 MiB, without any resident-peak or unlimited-memory claim.

The ignored reproduction harness is `tmp/cad-section-export-post-optimization.ts`, run with `npx tsx --tsconfig tsconfig.app.json`. It checks full entity equality across sections, complete bore sweep/radius, real result/CAM acceptance, unchanged caller data, tangent rejection, byte ownership and cleanup before recording timings. Its JSON record is `tmp/cad-section-export-post-optimization.json`, measured at `2026-10-14T16:24:07.335Z` under Node v22.23.2.

Frozen implementation and test SHA-256 identifiers:

| Source | SHA-256 |
| --- | --- |
| `src/features/cad/kernel/cadKernelSection.ts` | `4FCD6A12B40B885BD82A45B1351C8DBBFC436961787FC5DEDC68869BDEEE3DC2` |
| `src/features/cad/kernel/cadKernelSectionEndpoints.ts` | `AEF406ABDDCE06C4935E8DE2D7058DD45708842C939AC6E876BD731C09BD129E` |
| `src/features/cad/kernel/cadKernelExport.ts` | `A774371166BABAF1B2437AFC7707B4C62265AA2B35532121FCB23E3AA820719D` |
| `src/features/cad/kernel/cadKernelSectionEndpoints.test.ts` | `8668A46C4D384F961912CE36B3A6DEE6FE769C7B00475BF0010680DBDA7172DA` |
| `src/features/cad/kernel/cadKernelSection.test.ts` | `B82609E5BF74306F33E2B4836DD5A8D8EB185F0BA62F6978F9B55E2D9E331261` |
| `src/features/cad/kernel/cadKernelExportBuffer.test.ts` | `8A2C315F74B74C62824C10E3344B5EB31D85A54F424C4502A13B13E4ACCC8B0B` |
