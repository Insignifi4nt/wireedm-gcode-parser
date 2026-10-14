# Explicit face scope and nonzero quantity display repair

2026-10-15; separate repair against green checkpoint `70f45e978c77c67cc3f6f73e2822c5684daba11d`. Parent reports complete GitHub run38649638460 green: 384 unit files/4,071 cases, 124 browser journeys passing first attempt and the unchanged optional folder skip. That verified checkpoint and its historical source freezes remain intact. The native-copy candidate is disjoint, uninstalled and held during this repair.

## Red evidence

The bounded product review found two real existing-feature gaps. Its three original ignored regressions and original red log remain byte-identical: `tmp/cad-final-spec-candidates.test.tsx` SHA`FA57C2BF2C04C22118D87AC6C413C9B1E098A1B9831A4CA98B7C23F4923AE097`; `tmp/cad-final-spec-candidates-red.log` SHA`C1E7FE08D1620D8655785721928B532DA5636D6F66D29E73CC155EC3B31732F0`. The base review is `2026-10-15-cad-final-existing-feature-spec-review.md`.

Before production edits, six promoted behavior cases failed in the existing Workbench, sketch annotation and constraint-panel suites (`tmp/cad-final-spec-tracked-red.log`): both selected-face Fillet/Chamfer commands opened a new all-body workflow instead of preserving the accepted snapshot; constrained tiny width, diameter and signed angle displayed zero; and the constraint list displayed a valid linked width as zero. The geometry and exact alias were accepted, not sub-tolerance fixtures. Width4e-7/radius2e-7 exceed the existing analytic minimum1e-7.

Inspection found the same six-decimal conversion in the other requested human readouts. Six further actual-component scenarios failed before production edits (`tmp/cad-final-spec-readouts-red.log`): scalar relation hint; locked plugin placement/help; datum and placed normal; Loft offset; compatible Sweep world start; and persisted geometric selector quantities. An accepted datum tilt4e-7° resolves a genuinely nonzero normal component approximately−6.981317e-9; the old display claimed `0, 0, 1`. The test separately confirms the resolved component and retains its exact ` tilt ` expression. These are human readouts, not changes to mathematical frame precision.

## Narrow behavior changes

`CadWorkbench` rejects an explicit non-edge topology selection for Fillet/Chamfer before opening a candidate or invoking native conversion. The existing notification path reports: “Pick edges for Fillet / Chamfer, or select the body in the tree to treat all its edges.” The selected face, accepted document/version/history and workflow remain unchanged. Selecting the body deliberately clears topology and still opens the existing All edges scope. Existing valid-edge conversion, asynchronous owner/build/version/cancellation checks, Shell-from-face and explicit source paths are unchanged. No face-to-edge expansion, kernel functionality, API argument or schema was added.

One pure five-line `formatCadQuantity` extracts the already verified depth-label rule. Ordinary quantities keep the existing compact six-decimal display. A nonzero quantity erased by decimal rounding uses compact six-significant-digit scientific notation, preserving its sign. True zero and negative zero retain the established `0` display. Existing unavailable/invalid plugin/help sentinels remain caller-owned. There is no configurable formatting framework or new tolerance.

All existing CAD `toFixed(6)` readout sites now use that helper: on-part sketch annotations, explicit constraint list, legacy scalar expression hints/help, readonly/automatic plugin values and dependent bounds, gear help values/captions, datum/placement normals, Loft metadata, Sweep point/tangent descriptions, geometric selector summaries and the existing depth label. The source rescan finds only the canonical helper's six-decimal call. The depth's formatting behavior is extracted unchanged. Other differently scoped display precision policies are outside this narrow six-decimal consolidation.

Editable numbers, numeric text, raw scientific notation, expressions, named links and compound locks remain full precision. The plugin's editable named parameter uses `String(resolved)` as before; the helper applies only to readouts or readonly/disabled effective inputs. The value-context scalar editor is untouched. No formatter is used for SVG/path coordinates, native input, API receipts, JSON/DXF/STEP/STL serialization or preview identity. Display-only datum/placement metadata does not change actual world frames or acceptance. No renderer/camera/capture ownership code was changed.

## Meaningful verification

Node24.22.0:

- The new targeted gate passes **22/22**: six promoted original behaviors, six implicated readout scenarios and ten canonical ordinary/tiny/signed formatting cases (`tmp/cad-final-spec-behavior-green.log`). The source/alias/session assertions remain exact. Unchanged Apply creates no history and Cancel retains original data; deliberate all-body treatment remains available after unsupported-face refusal.
- Sixteen complete affected suites pass **212/212**, 10.26s (`tmp/cad-final-spec-repair-full-focused.log`): Workbench, DimensionControls, ProfilePanel, QuantityReadouts, display helper, depth helper/real editor, delayed public capture locks, scalar/vector editor, datum editing, PluginFields, GearHelpCoordinates, Loft, SweepSources and TopologyInspector. This includes existing verified-edge/Shell conversion, stale completion/cancellation, precise literals/aliases/formula locks/Undo and gear SVG coordinate preservation. Overlapping targeted and full counts are not summed.
- Full app TypeScript passes (`tmp/cad-final-spec-repair-type.log`, empty, exit0). Scoped whitespace check passes.

Only DOM rendering/native-build stubs appropriate to the existing suites are used. The new readout fixtures resolve through real schema/domain/session operations, and their original source/history are compared exactly. No browser, server, build, commit, push or copy-candidate installation occurred. Parent owns fresh actual UI/native proof and any complete final gate; the green70f45 CI does not automatically certify these new edits.

## Separate source freeze

`tmp/cad-final-spec-repair-source-freeze.json` records these18 production/test files, base/head, both preserved original red hashes, test logs and protected paths. Protected Viewport/controller/tools, schema/operations, native topology/client, E2E spec/client/config and package manifests are verified unchanged from70f45. Existing release/checklist/browser-checkpoint edits belong to the parent and are excluded from this owner manifest.

| File | SHA-256 |
| --- | --- |
| `CadWorkbench.tsx` | `AC6BFC8C1731757C20F5E350A9257F6F78EF5119D0CEAAC8CF518BD067568B28` |
| `CadWorkbench.test.tsx` | `1C9111EB06C269978AD69617FA32AC35D61AAECE1AEAC343835CBE0FA0D3BD37` |
| `CadSketchDimensionControls.tsx` | `3A9EACC11FF03C1D5D0302EE382CD4C1610A532D4E55A22380930BBE0E236C11` |
| `CadSketchDimensionControls.test.tsx` | `146EEA6A1FB70DA66B09E607443239D6BA50A6A5B88AC93569333B3FA9E487C7` |
| `CadSketchProfilePanel.tsx` | `C43208F45E1D24E02F53B4CE42640379EA4D80EFEEC93C40974A51FF00E44E88` |
| `CadSketchProfilePanel.test.tsx` | `167A7DFC71DE0808EB8F20FD0E18F3F2A4E41BE0D16DF482709512829287F58F` |
| `CadFields.tsx` | `118E3F82F260AC73032F2EA2158F3CC892C5CEBA9CCBAB7554A60234640BEAA9` |
| `CadPluginFields.tsx` | `C5EE378CAB253F2801BF0D073BAD33DEDD187A513DFE77AE2D2AE961AA3C1500` |
| `CadGearHelp.tsx` | `329FC98B941A842AD4AE2464F1090C76A3763D7635202DB434C5D01E57101404` |
| `CadDatumPlaneFields.tsx` | `19AD69CE73788F96DC397C605E3E2B139961A431E19A3CEE34AAECAE2A3668F4` |
| `CadPlacementNormal.tsx` | `D2FC1D6097F94306B7AF61A838AD581C04B314F32CA5C4E0BDF280EE00BF0961` |
| `CadLoftSections.tsx` | `D213F8194F8DBD579FED3975604C709F45A7C161BE27FD89C32B4B85E948E9C5` |
| `CadSweepSources.tsx` | `280946D568EBFAD4C7CE66123D08724C9FBB3D439C95259CBC48BC48133DC119` |
| `CadTopologyQuerySummary.tsx` | `F9187BCD060B59937CD854CCFAF6954A2CEB9F0A7EB2D2ABC7CBD57A7102BE30` |
| `cadExtrudeDepthHandle.ts` | `939AA6460346DC3C8AA0E4C587160A1C63D435D6F7B544C69EF9743B2E379774` |
| `cadDisplayQuantity.ts` | `F807C55780A779BA16CDE4D89508831F184E7C07871D50BA6FC0B85243FEC182` |
| `cadDisplayQuantity.test.ts` | `1C585FB74F2C5C8EE05B9AF6C94D61DCAC734E3035D7E6FAF04DFB8792356555` |
| `CadQuantityReadouts.test.tsx` | `2B5000B232F525C3C332F290A3DD1E6FEA2108F9E47FB1979BBE4A4AAE25A50A` |

The frozen patch is ready for independent review; no further owner production edits are planned unless that review establishes another actionable issue. The original CAD hardening goal remains active.
