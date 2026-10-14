# Pad/Pocket region and source-selection audit

## Read-only scope

This audit reads checkpoint `25b3994af33d3a7f011651a42603f8dd898af597` while its full CI runs. It changes no application source, schema, tests, browser, server or public guide. The parent owns actual CUA probes. Candidate descriptions below distinguish supported behavior from a demonstrated failure; no partial-region feature is invented during this audit.

## Current supported contract

Pad (`extrude`) and through-all Pocket store `sketchId`, not a contour/region selection. The strict shared schema rejects undeclared selection fields. `resolveCadSketchRegions` builds a containment forest from accepted analytic contours. Even-depth boundaries add material; their immediate odd-depth children are voids; islands and disconnected boundaries become independent material regions. Construction geometry does not contribute material. Touching, crossing, ambiguous or degenerate contours remain rejected at the shared document boundary.

Both native Pad and Pocket use every inferred active material region. Pocket's resolved input explicitly returns all regions and native target bounds determine its through-all extent. This is accurate whole-sketch behavior. It does not support the earlier user-requested Onshape-style choice of individual planar faces/contours, and that absent capability must not be mislabeled as a broken implemented selector.

The human editor exposes `Profile sketch` with eligible preceding sketch choices and an owned `Pick profile sketch from model` button. Its model picker passes feature IDs, so physically choosing any boundary of a source identifies the whole sketch. In 2D Sketch mode, profile selection opens geometry/dimension configuration, while Finish Sketch clears that profile context. The shared feature factory selects the eligible sketch rather than that geometry-editor profile. There is no current human region-subset control or separate agent subset argument.

Live preview uses the complete feature/parameter edit batch and owner/base-version guards. While a reference picker is active, the viewport temporarily shows accepted geometry and eligible references. The existing editor blocks Apply during source picking, stale/invalid input or a non-current preview. Ready multi-solid previews display their actual solid count. Cancel clears only the owned private preview; accepted changes apply through one shared Session batch and one Undo step.

## Accepted fixtures and independent quantities

The ignored fixtures were accepted by the shared parser, region resolver, sketch measurement and Pocket input resolver. Their DXF source strings describe the same original analytic contours and remain exact data, not instructions.

The `Regions` sketch contains:

- A rectangle from [0,0] to [40,30], area1200.
- A circle centered at [10,15], radius4, which is a void inside that rectangle.
- A concentric radius2 circle, which is a material island inside that void.
- A disconnected10 ×10 rectangle from [50,5] to [60,15], area100.

The exact inferred regions are `outer` with void `hole`, depth-two `island` with no void, and depth-zero `separate` with no void. Their combined material area is `1300−12π = 1262.3008881569224` mm². All contours are safely separated; no ambiguous nesting is used.

| Fixture | Original accepted result | Whole Regions replacement | If only separate rectangle participated |
| --- | --- | --- | --- |
| Pad, named `padDepth=6`, original radius3 circle at[-15,10] | `54π =169.64600329384882` mm³, one solid | Depth6: `7800−72π =7573.805328941535`; depth9: `11700−108π =11360.707993412303` mm³, three solids | Depth9:900 mm³ |
| Pocket in80 ×40 ×10 stock, original radius2 circle at[70,15] | `32000−40π =31874.33629385641` mm³, one solid | `19000+120π =19376.991118430775` mm³; expected stock frame plus preserved annular island, two solids |31000 mm³ |

Pad fixture has three features: `Single`, `Regions` and existing `Pad`, whose exact distance expression is `padDepth`. Pocket fixture has a stock footprint, named-depth Stock, Single, Regions and existing Pocket. Both Pocket sources are on XY at exact expression `stockDepth / 2`, which resolves to station5 within the ten-millimetre stock, and use `both` through-all direction. Shared Pocket resolution reports three cutter regions and station5. Native solid counts/volumes above are independently worked expectations for the actual CUA build, not claims that this audit built those particular fixtures natively.

| Ignored portable fixture | SHA-256 |
| --- | --- |
| `tmp/cad-regions-pad-source-selection.cad.json` | `ef6862063d677a60763816d32c3e095b92287e1695ee6eb8dfc5dd1cac5ab82e` |
| `tmp/cad-regions-pocket-source-selection.cad.json` | `aeadea26109197d3c6b21c4223fd73be1402fedda4816555dc6a4c0c90331f14` |

## Small actual CUA Pad journey

Import the Pad fixture into a disposable task tab, then build the accepted version. Require no diagnostics, original volume54π and one solid. Select its existing Pad and start `Pick profile sketch from model`. Physically choose the visible separate rectangle boundary in the model; the source field must become `Regions` and the candidate must show all three solids, while the accepted feature still references `Single`, its exact named driver remains `padDepth`, and accepted version/history have not changed.

Cancel must restore the exact accepted document and original cylinder. Repeat the physical source pick and edit the displayed Length to9. Await the current valid three-solid preview, then Apply. The accepted Pad must reference Regions, retain the exact expression `padDepth`, and the shared parameter must become9 in that same history step. Build and require volume `11700−108π` with three solids. One Undo must restore the entire original document, original source, parameter6 and original volume54π; Redo must restore the accepted Regions/depth9 result. The source DXF text, contour order and nested void/island definitions must remain exact throughout.

This journey makes the capability boundary visible: picking the separate rectangle chooses the Regions sketch, so the correct currently supported result includes its other material regions too. The UI has not promised a stored region-subset feature. Any future design for choosing void cells or independent regions requires an explicit shared-domain selection contract, not silently extracting/reclassifying selected contours in the UI.

## Additional candidate: physical picking of an internal Pocket sketch

The Pocket fixture exposes a separate existing-feature usability candidate. All valid source contours at station5 lie inside the opaque stock volume. The owned source-picker state lists them as eligible references, but the viewport retains opaque accepted body meshes. Reference line materials retain normal depth testing. `hitFeature` still calls `pickCadCurveReference` with all body surfaces; that helper rejects references behind the nearest surface, including points near the silhouette.

This is correct ordinary hidden-reference behavior, explicitly covered by existing renderer tests. The candidate concern is the owned source-picking workflow: the application offers a physical model source pick but never makes these entirely internal eligible sketches visible/selectable. No camera angle can expose a fully enclosed contour without changing the body's presentation. History/dropdown selection may be the only usable route.

Parent CUA probe: build the original accepted Pocket, select it, activate `Pick profile sketch from model`, and inspect visible source-reference pixels and a physical pointer at the Regions rectangle boundary. Record whether the picker stays active and its stored source remains Single. Compare with choosing Regions through the eligible history row or dropdown, then require valid preview/two-solid quantity, exact Cancel and a single reversible accepted source change. This distinguishes blocked physical access from invalid source geometry or broken preview ownership.

There is no actual Pocket failure proof yet. If confirmed, a small candidate repair is a transient presentation/picking mode owned by source selection that exposes its eligible reference geometry while rendering noneligible stock as context. It must retain source-ID, preceding-feature, current-version, cancellation and single-Undo guards, and restore ordinary opaque/hidden-edge rules on exit. A global bypass of depth checks would be wrong. No source change is authorized or made in this read-only audit.

## Existing coverage and focused evidence

The region-domain tests cover nested voids/islands, disconnected contours, mixed primitives, concavity, winding/order independence, construction exclusion, far coordinates, micrometre scale, parameter changes and explicit contact/self-intersection rejection. Native Pocket tests already cover nested void/island cuts, legitimate split compounds, disconnected targets, physical precision uncertainty and retained preceding targets. The editor tests cover source eligibility, same-ID extent conversions, dormant expressions, Cancel, native text Undo, exact source preservation, live owner/base/parameter-key gating and one accepted Session step.

Node v24.22.0 focused read-only gate passes **55 tests across five files**: `cadSketchRegions`, `CadExtrudeFields`, `CadPocketEditing`, `CadFeaturePreviewEditor` and `cadCurveRendering`. Log is `tmp/cad-region-source-selection-audit-focused.log`. No new tests were added and no broad native benchmark ran. Existing Workbench owned-source tests exercise guarded row/controller selection with a mocked viewport; they do not establish physical access to these enclosed sketch lines.

## Read source hashes

| File | SHA-256 |
| --- | --- |
| `src/features/cad/CadWorkbench.tsx` | `46e057178f88287db326cfb790e55eb18782cb9f078980f5d177ef5ead17422a` |
| `src/features/cad/CadExtrudeFields.tsx` | `88cc4c43eb6eeab469d5c9f274fee70cc2b294f5dec15e5ee868677e30cf8c9e` |
| `src/features/cad/CadSketchSourceField.tsx` | `5c6ba867932b243502c2015f8e6a01b2a781e41033844d1ac0b611d783995bf5` |
| `src/features/cad/CadFeatureEditor.tsx` | `0a73df8802349d323eb416d758d056d7e644c51f2beb72d3298e1c09cb818914` |
| `src/domain/cad/cadPocket.ts` | `9d6b49a956120f070f3703a1177d0b145ebc1b7c9efaea50710d0b12979aa617` |
| `src/domain/cad/cadSketchGeometry.ts` | `a3efdc01b0eee934ca01138026e05757a8546cfc45c3ec0c51f857eddb608687` |
| `src/domain/cad/cadSchema.ts` | `be7fbe5dc03a7b77e8655b68795091b49c8b46311df657e6fd7d97c5c4515e26` |
| `src/features/cad/CadViewport.tsx` | `d3abde1b86bc928b88036c6a9fbc03e00c07379f6cda791ef209684cefbbf8ae` |
| `src/features/cad/cadCurveRendering.ts` | `bb1d03551ec16491322f395abb9e63f1fee8fd89e7398a06c6be5e42047da061` |

The audit does not assert that full contour-subset interaction exists, that the internal-source candidate is confirmed, or that the overall CAD goal is complete.
