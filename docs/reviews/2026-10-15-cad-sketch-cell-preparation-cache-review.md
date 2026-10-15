# Shared sketch-cell preparation repair

Separate next slice after reviewed checkpoint `6e2113fa0151ef7d0b378ad3de7635664b2fab82`. It addresses the measured duplicate preparation in `2026-10-15-cad-preview-transport-resource-audit.md`; the prior checkpoint/51-file freeze remains historical evidence. No coordinator, viewport, worker/native geometry, public schema/tool, installed package, release/checklist, build/server/browser, staging or commit change belongs to this slice.

## Behavior and boundary

The domain now shares one latest successful complete cell preparation per parser-owned immutable sketch and its exact referenced profile parameter values. An unrelated extrusion-depth edit reuses the same physical picker cells. A true geometry driver still resolves the complete contour forest, quantities, canonical nesting references and intersections. Placement/offset/datum always resolves against current parameters separately. This is source geometry reuse; complete document/history/native validation keeps its existing boundaries and timing.

`cadSchema.ts` adds a private WeakSet of sketch identities registered **only after a successful complete document parse and deep freeze**. `isAcceptedCadSketchSource` queries that provenance. Mutable, shallow-frozen and manually deeply-frozen lookalikes are not trusted. No serialized trust flag, public DTO/schema field, generic cache framework or size/precision policy was added.

`cadSketchRegionInspection.ts` owns the dependency projection and cached `CadPreparedSketchCells`. The existing scalar visitor supplies all `profiles.*` parameter names conservatively, including construction profiles, generic locked inputs and syntactically referenced dormant builtin values. Own finite numeric data descriptors supply a detached dependency environment used for both the key and actual resolution. Missing/inherited drivers cannot match an earlier own-valued entry; accessor/invalid environments follow the unchanged uncached evaluator and never replace the trusted entry. `Object.is` preserves the distinction between signed zeros. Only successful results replace the latest entry; failed driver/topology changes return their real errors, never stale cells.

Before shared adoption, newly resolved geometry (including nested path/point arrays), contour points and contour objects are frozen. Borrowed profiles are not frozen by this helper: accepted profiles are already deeply frozen by the parser; arbitrary caller inputs stay untouched. The prepared container, cells, bounds and canonical references retain their existing immutable contract. `resolve(selection)` still builds fresh union containers/void lists each call around immutable cached contours; changing a caller's returned union does not replace the preparation or another resolution. Native material semantics, arc math, tolerances and source text are unchanged.

`cadExtrudeDepthInteraction.ts` removes its duplicate source/dependency/cell preparation. It keeps one latest selection/bounds entry per prepared result identity. A changed relevant driver or source yields another preparation and cannot reuse old selected bounds. Unrelated depth/placement updates retain the same local material bounds but use the current quantity/frame. Untrusted source aliases resolve freshly, fixing the demonstrated stale bounds when a raw caller changes rectangle height from10 to25.

## Test-first evidence

Before production edits,15 behavioral cases ran against the pinned unchanged3-file baseline in ignored `tmp/`:13 expected failures/2 existing controls passed. The real120-tooth editor initially performed3 full source preparations where one shared preparation was required. Further failures covered successful reuse/recovery for true aliases, V1/V2/V3 packages and generic locks, datum-only reuse, geometry/point/path mutation protection, and stale bounds after an untrusted alias mutation.

That unchanged15-case set was moved to proper tracked domain/editor tests before implementation. It verifies physical analytic picking and exact material/references, not only a mock invocation:

- Twelve real named-depth input events preserve the exact spaced distance alias, advance current depth7.1, retain the same picker preparation, allow actual picker selection/Cancel, and leave accepted source/version/Undo/workflow exact on feature Cancel.
- Relevant width/module aliases update independently expected area/bounds. Unknown, inherited, nonfinite and invalid dimensions still reject. Accessor input cannot poison a valid cached entry. Failed values do not replace a prior successful result.
- Moving the bore recomputes its nesting signature and rejects the old selected-cell reference. Source replacement/rename/reorder preserves appropriate references/labels while establishing a new preparation identity.
- Exact pinned V1/V2/V3 packages remain byte-for-byte unchanged. A generic disabled editing field still changes independently expected star material, so an editing lock never makes it inactive geometry.
- Mutable/shallow/deep-frozen lookalikes remain uncached; newly resolved shared path coordinates/contour data cannot be mutated through the returned result. Datum-only drivers update the independently expected rotated normal/world origin without regenerating local cells.

The existing selected-bounds reuse test now crosses the actual document parser boundary before asserting identity reuse. Its geometry, selector, unrelated driver and exact-source assertions are retained. A separate new alias-mutation case verifies that raw mutable inputs cannot reuse stale bounds. Other existing tests, especially immediate coordinator validation errors/old-native-success suppression, were unchanged.

Final focused Node24 gate: **61/61 cases in7 files**,8.06s total, `tmp/cad-sketch-cell-cache-focused-green.log`:

`cadSketchCellPreparation`, `CadSketchCellPreparationEditor`, `cadExtrudeDepthInteraction`, `cadSketchRegionInspection`, `CadFeatureRegionPickEditor`, `CadExtrudeDepthEditor`, `cadFeaturePreview`.

Full Node24 `npx tsc -b` passed (`tmp/cad-sketch-cell-cache-types.log`), as did the scoped diff whitespace check. No build or broad/native/browser-CUA verification was run by this owner; parent/independent review remains separate.

## Same-fixture remeasurement

The original ignored actual editor observation was preserved with its original fixture/12 input events and output. The after observer additionally counts the expensive source-forest resolver rather than confusing cache lookups with regeneration. No elapsed-time threshold or weakened geometry/alias/cancellation assertion was introduced.

| Actual120-tooth editor observation | Before | After |
| --- | ---: | ---: |
| Full source preparations during mount | 3 | 1 |
| Full source preparations during12 unrelated named-depth edits | 12 | 0 |
| Source-preparation/helper elapsed sum during those edits | 260.044ms | 0.058ms |
| Median whole input event, jsdom on this host | 25.813ms | 2.585ms |
| Final correlated named depth | 7.1 | 7.1 |

Both consumers now perform cheap domain lookups (24 total over12 edits), sharing one preparation instead of maintaining separate caches. These are limited jsdom observations on the same host/fixture, not browser latency guarantees or native speedup claims. Native rebuild/import/meshing and the coordinator's immediate full validation remain unchanged. The separate public native/capture work is not certified by this measurement.

Evidence: `tmp/cad-sketch-cell-cache-next-slice-red-manifest.json`, `cad-sketch-cell-cache-red.log`, `cad-preview-field-resource-cache-before.json/.log`, `cad-preview-field-resource-cache-after.test.tsx/.config.ts/.json/.log`. Original measurement files/audit hashes and prior checkpoint manifests were not rewritten.

## Frozen owned files

Exact new next-slice source manifest: `tmp/cad-sketch-cell-cache-next-slice-source-hashes.json`.

| File | SHA-256 |
| --- | --- |
| `src/domain/cad/cadSchema.ts` | `0001E118622C909FE601D2817C99F497C85AC6E0433FDBF7BBA28A77F9731052` |
| `src/domain/cad/cadSketchRegionInspection.ts` | `982929F298C54DF866273FBDD7CED3CC97F109D5AE26509B4D12363FAF7AD348` |
| `src/features/cad/cadExtrudeDepthInteraction.ts` | `74B527E0563638E97B7CE1A7A7B60681445FB82076E09D549811CB6CED00E715` |
| `src/features/cad/cadExtrudeDepthInteraction.test.ts` | `68D9E4D81F3361FDEDF91F86AA83E621152D19CA3902212D3BF3C35836D98D06` |
| `src/domain/cad/__tests__/cadSketchCellPreparation.test.ts` | `03F1D530119563828F205EE77D75A111969CC8D05478E5182B46386420B048C1` |
| `src/features/cad/CadSketchCellPreparationEditor.test.tsx` | `60E8B64BFAEE1208A77C8756AED072FB396ECCD8F4CF6FA1D5E5AD0915E45EC0` |

Source/test edits stop at this freeze pending independent/root review. Overall CAD goal remains active.

Root independently reviewed the boundary/cache/consumer diff, including the parser-owned fixture correction. The same six hashes remain exact. Its existing native selected-area, generated gear, region inspection and unchanged immediate feature-preview gate passes **45/45 in four files** (31.22 s, `tmp/cad-source-cache-root-native-preview-check.log`). This verifies the existing exact material and error contracts on the frozen cache implementation; independent reviewer, final production and combined CI remain separate gates.
