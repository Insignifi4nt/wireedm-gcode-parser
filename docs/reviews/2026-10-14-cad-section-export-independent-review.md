# Independent Section and Export optimization review

Reviewed against `c36aa3b50a30f82ded3508652d9e7917c69b6b59` and the implementation pinned in `2026-10-14-cad-section-export-efficiency-audit.md`. This owner made no product, server, browser, public documentation or commit changes. The separate frozen viewport work was untouched.

**No actionable correctness, ownership or cleanup defect found in this slice.** Focused verification used **Node v24.22.0** and passed **37 tests in five files**. An additional inexpensive differential replay matched the actual endpoint helper against the checkpoint’s original first-representative scan in 280 seeded cases.

## Section endpoint behavior

`cadKernelSection.ts` only replaces the former representative scan with `assertCadSectionClosedEndpoints`. Native section construction, approximation disabled, projection/basis, exact circular sweep and direction checks, line degeneracy, tangency/interior checks, unsupported-curve diagnostics, CAM validation and native resource scopes are unchanged.

The helper inserts only newly created representatives. Their points do not move. `SpatialHash.queryBounds` sorts its insertion IDs, so `.find` examines representatives in the same order as the former array scan. The first eligible representative wins, even when another representative is nearer; it does not introduce transitive clustering or centroid updates. The explicit nontransitive regression would reject under nearest-match or merged-cluster behavior and passes here.

The broadphase uses a tolerance/roundoff-expanded, finite-clamped square. Acceptance still requires the unchanged inclusive `Math.hypot(dx, dy) <= tolerance` predicate; the production caller still passes `1e-7`. Indexed point bounds are filtered inclusively. Unsafe cell ranges use the existing conservative scan fallback, and finite far-coordinate cell indices use BigInt. Negative/inclusive cell boundaries and representable gaps below/above tolerance have focused regressions. Expanded bounds cannot heal a gap or increase the acceptance tolerance.

Circles still contribute no endpoints. Exact complementary arcs contribute their authored endpoints, and every representative must have degree two. Touching loops with degree four reject with the original `open-section` code/message. The native compound test confirms this rejection leaves the borrowed body valid for a different successful section. The real polygon/bore fixture retains every line and complete analytic bore sweep, valid CAM contours, original source and expected volume; tangent rejection and successful exact retry remain intact. Existing reflected-circle and narrow-notch regressions also pass.

The operation-count regression is meaningful: it counts actual `Math.hypot` distance checks in the production helper, retains unchanged entities and caps nearby-candidate work for a separated 2,048-edge contour. It rejects the former full scan without asserting elapsed time or mirroring a fixed implementation output. This does not prove globally linear performance: broadphase work, far-coordinate fallback scans and native section construction remain outside that counter.

Independent replay: `tmp/cad-section-endpoints-independent-review.ts`, seed `0x19ca2026`, origins `0`, `±1e5`, `±5e8`, `±1e9`. The actual helper and checkpoint scan agreed in all **280 cases: 140 closed and 140 open**, with exact input JSON preserved. These are finite endpoint-algorithm cases, not an additional native-model acceptance or performance benchmark. Existing targeted tests separately establish ambiguous first-match ordering and circle/arc behavior.

## STEP byte ownership and failures

The pinned loader’s `FS.readFile` allocates its own `Uint8Array(size)` and reads into it. For ordinary ArrayBuffer storage, the exporter now constructs a view with the original `byteOffset` and `byteLength` and passes that view to Blob. It neither includes prefix/suffix backing bytes nor adds the former full-size `Uint8Array.from` copy. SharedArrayBuffer and the currently exposed native memory buffer retain the defensive copy. Blob construction snapshots the supplied bytes; it does not expose a mutable heap/file view.

The real native exporter tests cover all three backing kinds with nonzero offsets. Complete bytes survive mutation of the returned FS view and prefix, scratch unlink and source-shape disposal. The ordinary path performs zero redundant copies; shared/native paths perform one. Borrowed shapes remain valid with unchanged volume. The Blob-standard MIME spelling remains lowercase `application/step`, as before.

The native borrowed-shape contract, names, assembly/schema/MM writer configuration, serialized scratch path and `attemptedWrite` handling are unchanged. Every owned native resource remains inside the original cleanup loop. Read or Blob construction errors remain primary when unlink also fails. The Blob failure test verifies scratch removal, native source usability and successful retry; the read failure test verifies source usability and its primary error when scratch cleanup fails. Existing native shape ownership and numerical section/export guards pass independently.

## Verification and limits

Independent Node 24 commands ran these files:

- `cadKernelSectionEndpoints.test.ts`, `cadKernelSection.test.ts`, `cadKernelExportBuffer.test.ts`: 17 tests passed.
- `cadKernelShapesOwnership.test.ts`, `cadKernelNumerics.test.ts`: 20 tests passed.

Logs: `tmp/cad-section-export-independent-node24.log`, `tmp/cad-section-export-ownership-node24.log`, `tmp/cad-section-endpoints-independent-review.log`.

The reviewed bytes/algorithms preserve their existing guards and failure semantics. This review did not repeat the owner’s 4,096-edge/16.9 MB measurements, profile every native phase, inject every unchanged native constructor/delete failure, or certify real browser download behavior. The owner’s record distinguishes independent measurements from a paired whole-section speedup and correctly limits its latency/memory claims. Root’s full current build/browser gate remains the integration check.

SHA-256 checked during this review; all six implementation/test hashes match the frozen owner record:

| File | SHA-256 |
| --- | --- |
| `src/features/cad/kernel/cadKernelSection.ts` | `4fcd6a12b40b885bd82a45b1351c8dbbfc436961787fc5dedc68869bdeee3dc2` |
| `src/features/cad/kernel/cadKernelSectionEndpoints.ts` | `aef406abddce06c4935e8de2d7058dd45708842c939ac6e876bd731c09bd129e` |
| `src/features/cad/kernel/cadKernelExport.ts` | `a774371166babaf1b2437afc7707b4c62265aa2b35532121fcb23e3aa820719d` |
| `src/features/cad/kernel/cadKernelSectionEndpoints.test.ts` | `8668a46c4d384f961912ce36b3a6dee6fe769c7b00475bf0010680dbda7172da` |
| `src/features/cad/kernel/cadKernelSection.test.ts` | `b82609e5bf74306f33e2b4836dd5a8d8eb185f0ba62f6978f9b55e2d9e331261` |
| `src/features/cad/kernel/cadKernelExportBuffer.test.ts` | `8a2c315f74b74c62824c10e3344b5eb31d85a54f424c4502a13b13e4accc8b0b` |
| `src/domain/path-intel/spatialIndex.ts` | `2f0e0b2225640336bc487b48affa07e083296f3c90a0236b7ff53b11e7f5c493` |
