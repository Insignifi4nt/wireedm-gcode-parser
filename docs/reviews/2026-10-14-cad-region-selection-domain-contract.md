# Explicit sketch-cell input: first domain/API slice

Date: 2026-10-14. Preparation against `4a16` after the capture checkpoint. Root owns the physical selected-area UI and public/release wording; the source-picker owner has separate viewport changes. This slice adds no feature kind, editor/Workbench/Viewport interaction, native package or tolerance policy.

## Saved contract

Existing `extrude` and `pocket` gain optional `regionSelection`, a nonempty array of strict cell references:

```ts
interface CadSketchCellReference {
  readonly boundaryProfileId: string;
  readonly voidProfileIds: readonly string[];
  readonly ancestorProfileIds: readonly string[];
}
```

IDs are existing canonical profile identifiers. Void IDs list every immediate nonconstruction child, sorted lexically without duplicates. Ancestors list the complete containment path from root through direct parent, in that order. No name, index, coordinate, native key or invented hash establishes identity. Empty selectors, duplicate selected boundaries, malformed/duplicate/noncanonical signatures and own-data violations reject. Parsing retains authored values and order; it never normalizes saved data.

An absent selector takes today's exact contour order and automatic even-depth material parity. Other feature kinds retain current whole-sketch input. Complete validated geometry resolves first, including unselected contours, construction geometry validity and legacy role checks. Current crossing/contact/self-intersection rules stay unchanged. Each selected cell is its boundary interior minus immediate child interiors, including cells previously treated as voids. A contour is retained only when its cell's selection differs from its parent's selection; the exterior is unselected. Retained cycles form outer boundaries and holes by containment. Shared nested boundaries disappear before native extrusion, so selected neighbors do not create duplicate interior walls.

Current acceptance policy stays intact: an active missing/changed cell rejects the complete edit/import atomically with an actionable error; prior parameters, version, sources and history remain untouched. A suppressed feature retains a structurally valid dormant selector and validates geometry identity when resumed. Defensive direct native resolution still produces a failed-feature diagnostic and preceding valid prefix. No fallback to another cell/sketch occurs. Replacing both upstream geometry and its intentional new reference in one valid batch is allowed.

## Shared API and bounded replies

The existing `cad_edit_document` add/update-feature operation carries the new optional field through the same schema, own-data, workflow, expected-version and single-Undo checks. No direct controller mutation endpoint is added. Feature discovery exposes the same strict saved schema and explains absence versus explicit selection.

`cad_inspect_sketch_regions(expectedVersion, sketchId, offset?, limit?)` reads current active sketch cells without WASM, persistence or history. Stable boundary-ID ordering makes paging independent of authoring order. Each row reports authored contour kind, evaluated cell area in mm², perimeter/bounds in local mm, nesting and complete cell reference. Full source/package/scalar definitions are not regenerated. Domain results remain complete. The tool adapter reuses whole-entry byte budgeting: if one complete reference prevents a row fitting the existing reply budget, the row explicitly marks it omitted and includes exact child/ancestor counts, UTF-8 bytes and UTF-16 JSON length.

`cad_read_sketch_region_reference(expectedVersion, sketchId, boundaryProfileId, offset?, length?)` returns exact version-pinned UTF-16 JSON chunks of that complete reference, with totalLength and nextOffset, using the existing document-read pattern. It introduces no geometry, ID, source or depth cap and no cryptographic identity scheme. Changed versions, pending workflows, inactive sketches and cancellation reject before a usable response. Agents reconstruct and submit the full reference instead of guessing geometry.

Public guide, tool descriptions/discovery, saved-schema compatibility and release notes must explain the additive field: old readers reject explicit selectors, while unchanged legacy files keep their exact behavior. No post/package schema or pinned recipe upgrade is involved. Root receives exact schema/receipt examples after source freeze.

## Red-first evidence and planned ownership

Ignored preparation files are `tmp/cad-region-selection-next-fixtures.ts`, `tmp/cad-region-selection-next-domain.test.ts`, `tmp/cad-region-selection-next-native.test.ts` and a local Vitest config. The proposed optional third argument is exercised against the actual current resolver; today it is ignored. Current strict parsing rejects the new field. These are behavioral regressions, not missing-function smoke tests.

Domain preparation has 18 cases: 16 reds and two legacy/contact passes. Native preparation has six cases: five reds and one exact legacy pass. The native legacy fixture is a radius10 outer/radius6 void plus disconnected radius3 disk, extruded5: 365π mm³ and two solids. Future annulus, bore disk, their union and disconnected disk must instead produce320π,180π,500π and45π, each one solid. The native Pocket on18000 mm³ stock currently rejects the undeclared selector and retains the stock; selecting only the disconnected disk must remove90π and leave one solid with two section boundaries. Source JSON stays exact in every fixture. These tiny OCCT cases preserve independent quantities and actual section topology without a benchmark or browser.

The tracked implementation owns `cadDocument.ts`, `cadSchema.ts`, `cadSketchGeometry.ts`, `cadPocket.ts`, focused selection/inspection modules, the existing analytic profile measurement seam, `cadDatumPlanes.ts`, `cadKernelModel.ts`, and narrow controller/tool/discovery paths. Meaningful domain, native and shared-agent tests cover canonical signatures; nested cells/islands/disconnected regions; native Cut/New/signed/symmetric quantities and exports; rename/reorder survival; deleted/construction/moved ancestry refusal; atomic Session no-op/Undo; exact imported originals/pinned recipes; paged complete/oversized references; stale/cancel/workflow/lazy-WASM boundaries. No tracked implementation started before the coordinator's build hold was released.

## Selected datum material precision

The new selector exposed an existing bounds-scope assumption in datum extrusion preflight. A radius1 cell at local origin, datum origin `[10,20,30]` with world-X rotation30°, depth5, already passes the unchanged placement policy when authored alone. Its independent native volume is5π mm³ and bounds are min`[9,17.5−√3/2,29.5]`, max`[11,20+√3/2,30.5+2.5√3]`. Adding a valid unselected radius1 contour at localX=1e8 initially made the explicit near-cell extrusion fail the whole-sketch datum precision check, despite sending only the near material to native. The real native red is recorded in `tmp/cad-region-selected-datum-precision-red.log`.

The approved repair gives the existing placement resolver the feature's exact optional selection when resolving its material bounds. The complete forest still validates first. No numerical constants, authored frames/coordinates or source bytes change. Revolve, absent-selector whole sketch and separate whole-sketch plane inspection keep their previous scope. The selected full-source fixture now gives the same independently expected5π volume and rotated bounds; the unselected contour remains exact. Whole-sketch parsing still rejects this lever arm, and defensive native whole-sketch rebuild still reports `unsupported-datum-precision` plus `rebuild-stopped`, retaining the preceding18000 mm³ Stock. New native selection and existing datum-domain suites pass33/33 under Node24; `tmp/cad-region-selected-datum-precision-green.log`.

## Proposed-source agent completeness audit and repair

The accepted-only inspector could not supply a new signature needed for one atomic source/parameter/selector edit. An ignored real Session fixture moves a formula-linked bore outside its outer contour and replaces the inner island with a new profile. Editing source and numeric parameter with the old selector correctly rejects atomically. Accepted-only inspection then returned the old bore child rather than the new child. `tmp/cad-region-proposal-red.test.ts` and `tmp/cad-region-proposal-red.log` preserve that behavioral failure; tracked domain/tool reds are `tmp/cad-region-proposal-domain-red.log` and `tmp/cad-region-proposal-tools-red.log`.

Both reads now accept an optional strict proposal:

```ts
interface CadSketchRegionProposal {
  readonly sketch?: CadSketchFeature; // Complete same-ID definition; no fragments.
  readonly parameterValues?: Readonly<Record<string, number>>; // Add/override names.
}
```

The proposal object needs at least one of these fields, no extra fields; parameter names/ranges and complete sketch definitions use their existing strict schemas. An omitted proposal keeps accepted-only behavior and its exact receipt shape. A supplied proposal adds `proposed:true` to the receipt. It validates the complete accepted document first, then a detached candidate comprising the complete requested source and only its actual preceding datum dependency, evaluated under the merged numeric environment. It does not change source identity/order, relocate geometry, substitute a sketch, suppress dependencies or certify complete downstream history/native material. Missing/later/suppressed datum references, malformed/pinned-package/constraint/source errors and invalid unselected contours still reject. The final `cad_edit_document` batch and `cad_build` retain all-history/native validation.

An initial provisional implementation parsed the entire history prefix. The coordinator identified a valid shared-driver case: two sketches and earlier/later selected extrusions both need new signatures. Changing their driver invalidates the earlier selector, so prefix validation blocked inspecting the later source. The tracked meaningful red `tmp/cad-region-proposal-multiple-source-red.log` demonstrated this before the approved dependency-scoped repair. It now obtains both fresh references and commits the source/parameter/dependent-reference repairs in one exact Undo step. Real OCCT gives independent volumes480π and495π mm³ with bounds `[-10,-10,0]..[10,10,5]` and `[-10,-10,10]..[10,10,15]`, one solid per body. The original imported source text and retained definitions remain exact.

Proposed chunk reads pin identical `proposal`, `sketchId`, `boundaryProfileId` and `expectedVersion`. A hook-local cache retains only one most recent candidate's reference map, keyed by the accepted immutable document, exact proposal JSON and sketch ID; different candidates replace it. Every read checks application/version/workflow/cancellation and own-data/schema validity even on a cache hit. A failed candidate does not adopt a new cache. Accepted-only reference caching is unchanged. The real public-tool test exercises complete proposal reads/chunks, a changed proposal, invalid source/identity, pending workflow, cancellation during the async seam, stale old version, no draft/history/native work from reads, and the final correlated single-Undo edit.

## Exact tool receipt contract

- Inspector arguments: `expectedVersion`, `sketchId`, optional `offset` (0..MAX_SAFE_INTEGER), `limit` (1..50), `proposal` as above. Top-level result: `version`, `sketchId`, optional `proposed:true`, `coordinateSystem:'sketch-local'`, `units:'mm'`, `items`, complete `total`, global `nextOffset` or null.
- Each inspector row: `boundaryProfileId`, `name`, authored `kind`, `depth`, `defaultMaterial`, `areaMm2`, `boundaryLengthMm`, `boundsMm:{minX,minY,maxX,maxY}`, `referenceOmitted`, exact `voidProfileCount`, `ancestorProfileCount`, `referenceLength` (UTF-16 JSON code units), `referenceByteLength` (UTF-8). Ordinary rows include complete `reference`; omitted rows instead contain `readReferenceWith:'cad_read_sketch_region_reference'`.
- Reference-reader arguments: `expectedVersion`, `sketchId`, `boundaryProfileId`, optional `offset` (0..MAX_SAFE_INTEGER), `length` (1..4096), identical optional `proposal`. Result: `version`, `sketchId`, `boundaryProfileId`, optional `proposed:true`, `offset`, complete `totalLength`, `nextOffset` or null, exact `text`. Offset above complete text length rejects.
- Both are read-only, reuse the existing24KiB whole-entry/32KiB response policy and add no authored geometry or file cap. Discovery uses a compact same-ID sketch envelope pointing to `cad_describe_features(kind='sketch')`; execution still validates the complete exact schema. All selector fields are likewise discoverable under existing `extrude`/`pocket` feature definitions.

## Verification and frozen owner scope

Node24.22.0 final focused gate `tmp/cad-region-selection-domain-api-final.log`: **272/272 tests in10 files**,22.33s. It includes existing sketch-region/measurement/Pocket/datum cases; the new selection/inspection cases; real native selected extrusion/Pocket/material/STEP cases; complete controller and tool-boundary suites. Scoped `git diff --check` passed. The earlier type gate had no owner-scope error; `tmp/cad-region-selection-domain-api-tsc.log` recorded only the parallel depth owner's then-pending `materialBoundsMm` test seam. After that owner's model/helper freeze, independent full Node24 `tsc -b --pretty false` passes (`tmp/cad-depth-foundation-independent-types.log`, exit0). The frozen19-file hashes remain unchanged. This is a domain/API checkpoint, not an overall CAD goal or physical human-interaction completion claim.

Exact source/test hashes are also saved in ignored `tmp/cad-region-selection-domain-api-source-hashes.json`:

| File | SHA-256 |
| --- | --- |
| `src/domain/cad/cadDocument.ts` | `7C25484DEB66B0CF7334BE089B832EB92208A573A54926ACE33E258A1CAE9EB3` |
| `src/domain/cad/cadSchema.ts` | `6A8D0B428DADF557904F73D4E04BF977E18A370B767374DBEA46563A98E61082` |
| `src/domain/cad/cadSketchGeometry.ts` | `25F1217F3BFFA4E477202630BC8E84D0FE4C5565AC2C591D8751DDD75771A131` |
| `src/domain/cad/cadSketchRegionSelection.ts` | `1C6436166E061C48C03FC0A8C84E0CD9F188912DB5AA9E0F663A76206FB899CA` |
| `src/domain/cad/cadSketchRegionInspection.ts` | `778A6C1C0556885145C8440480C1A70D387872EDA905F62ECB54F689EADB213C` |
| `src/domain/cad/cadPocket.ts` | `CC64BA3D42DBDC72411A6FCDB0F2410EDC596FA9E101D9E718257B9E70FB7B9B` |
| `src/domain/cad/cadMeasurements.ts` | `A6F638B59BD7B8C2DA477AC739AD1D9B5EBFC8B3696C22DF7CDE3FDB79F388D9` |
| `src/domain/cad/cadDatumPlanes.ts` | `D87DBE8B40EC568B7AE0D70481977079173F7174F79F400152B67072DA407BDD` |
| `src/features/cad/kernel/cadKernelModel.ts` | `C5C0E645D3994A51489252019C3AE07C942FEBE95796C60E92C1185780BEF594` |
| `src/features/cad/useCadController.ts` | `78E6C21665BDC859E6641D6D6AC0FD0AC468DAD0B360ADAD6B913D54E000D83E` |
| `src/features/cad/cadSiteTools.ts` | `CFE1BD042A09444DE00DB66DF9C33830EE313C680F68FBFF33E13F7022C11CEB` |
| `src/features/cad/cadToolSchemas.ts` | `A666D6E5F959EA2CB19B481F3EC08D72F565A1F8B56BC2294F18557892E823A3` |
| `src/features/webmcp/siteTools.ts` | `623966BE99077158986345615401FC5FB0DC58282C5B72F5DE97287256535F56` |
| `src/domain/cad/__tests__/cadSketchRegionFixtures.ts` | `6E5FB18BDC0494070E955298C78F8D370C85DE2CFADA47CFDEB8C78E6B4D992F` |
| `src/domain/cad/__tests__/cadSketchRegionSelection.test.ts` | `76579FF6480DA17AA8169F58E8C9E3D1FCEC5A2703E28CAEE84F206D05FFCF13` |
| `src/domain/cad/__tests__/cadSketchRegionInspection.test.ts` | `36BD888D6CF276C7F961F9A7ADD888CC987E289629306D00699056456B55647B` |
| `src/features/cad/kernel/cadKernelRegionSelection.test.ts` | `AE842BBC70D852A9FC0C8514588BA37F00DF451A8B087E3A11E51EF08E8DCB86` |
| `src/features/cad/useCadController.test.tsx` | `CAD70CEEF7F67A2822FB490ED8E27C3418B03B862DD920D3620CB7FC05A9DBFF` |
| `src/features/cad/cadSiteTools.test.ts` | `B62C83E3F8EAF3932B14D89174CE7C805FD2E1C8F4E0D3078525D0A05EBF246B` |

On2026-10-15, the complete integrated gate exposed initial tool metadata54587 bytes above the existing51200-byte discovery budget. The same owner reopened only the two tool/discovery files to shorten11 repeated initial descriptions and the repeated sketch-envelope description. Their current hashes above supersede `3ED21E9C…913E8A` and `6E043329…31F8EE`. All domain/kernel/controller/test hashes and exact execution contracts remain unchanged. Actual metadata is now50770 bytes; the unchanged agent-journey budget, full tool/controller suites pass142/142, and full TypeScript passes. Exact source reconstruction proves that restoring only those strings recovers both preceding full source hashes; registration schemas/annotations/order match with descriptions removed. See `2026-10-15-cad-agent-discovery-budget-review.md` for the measured delta and independent-review boundary.
