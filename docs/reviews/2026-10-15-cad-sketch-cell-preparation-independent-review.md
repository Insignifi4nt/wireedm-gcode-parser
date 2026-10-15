# Independent review: shared sketch-cell preparation

2026-10-15; read-only review against `6e2113fa0151ef7d0b378ad3de7635664b2fab82`, using the frozen six-file manifest `tmp/cad-sketch-cell-cache-next-slice-source-hashes.json` and owner record `2026-10-15-cad-sketch-cell-preparation-cache-review.md`.

**No actionable defect found in this slice.** The parser registers sketch provenance only after complete successful validation, detachment and deep freeze. A mutable, shallow-frozen, manually deeply-frozen or structured-cloned lookalike cannot acquire that provenance. Accepted-document fast returns retain already registered sources. There is no persisted trust flag or document/schema compatibility change.

The shared preparation cache retains one successful result per trusted sketch identity and exact referenced profile values. The existing scalar traversal includes every currently supported profile kind, all plugin inputs, construction profiles and dormant/locked input expressions conservatively. Own finite data descriptors supply a detached environment for both key and resolution, so an accessor cannot change values between caching and evaluation; inherited/missing/invalid drivers do not match a prior own-valued preparation. `Object.is` preserves signed zero. Failed geometry or nesting resolution never replaces a successful entry. Current source placement and datum/offset drivers are still resolved separately from local geometry.

Resolved geometry, nested path/point arrays, contour points and contour objects are frozen before adoption; raw borrowed caller profiles are untouched. All retained contour boundaries are covered, including contours appearing as voids. Returned region containers/void lists are fresh, and modifying a caller's union cannot change the cached contour forest or another resolution. The depth helper's selected-bounds cache is keyed by prepared result identity and exact selection serialization, so a real relevant driver/source change cannot retain old material bounds. Raw mutable source calls prepare freshly; the rectangle-height mutation regression demonstrates that boundary.

The one existing identity-reuse test now crosses the actual parser boundary before demanding reuse. Its selected bounds, unrelated depth driver and source-integrity assertions are unchanged; the new raw-mutation test covers the prior unsafe case. The real 120-tooth editor test checks physical cell picking, twelve named-depth edits, exact alias/candidate quantities, picker Cancel and complete accepted-source/history/workflow retention. This is substantive operation reuse rather than a timing threshold or absence assertion.

## Independent verification

Node **24.22.0**: **61/61** cases in seven files pass, 2.44 s (`tmp/cad-sketch-cell-cache-independent-focused.log`): `cadSketchCellPreparation`, `CadSketchCellPreparationEditor`, `cadExtrudeDepthInteraction`, `cadSketchRegionInspection`, `CadFeatureRegionPickEditor`, `CadExtrudeDepthEditor`, `cadFeaturePreview`. All six manifest hashes match before and after the read/check. The owner's full app TypeScript gate is separate evidence; root owns combined native/build/browser gates. This review makes no browser-latency/native-speedup claim and does not approve the separately pending capture/busy repair. No product/test edits or server/browser operation by this reviewer.

| Frozen file | SHA-256 |
| --- | --- |
| `src/domain/cad/cadSchema.ts` | `0001E118622C909FE601D2817C99F497C85AC6E0433FDBF7BBA28A77F9731052` |
| `src/domain/cad/cadSketchRegionInspection.ts` | `982929F298C54DF866273FBDD7CED3CC97F109D5AE26509B4D12363FAF7AD348` |
| `src/features/cad/cadExtrudeDepthInteraction.ts` | `74B527E0563638E97B7CE1A7A7B60681445FB82076E09D549811CB6CED00E715` |
| `src/features/cad/cadExtrudeDepthInteraction.test.ts` | `68D9E4D81F3361FDEDF91F86AA83E621152D19CA3902212D3BF3C35836D98D06` |
| `src/domain/cad/__tests__/cadSketchCellPreparation.test.ts` | `03F1D530119563828F205EE77D75A111969CC8D05478E5182B46386420B048C1` |
| `src/features/cad/CadSketchCellPreparationEditor.test.tsx` | `60E8B64BFAEE1208A77C8756AED072FB396ECCD8F4CF6FA1D5E5AD0915E45EC0` |
