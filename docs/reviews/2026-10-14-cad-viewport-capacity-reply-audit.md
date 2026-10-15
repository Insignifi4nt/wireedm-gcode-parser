# CAD viewport capacity and tool reply audit

Checkpoint: `c36aa3b50a30f82ded3508652d9e7917c69b6b59`. Scope: complete accepted CAD histories, displayed reference/body metadata, capture receipts and parameter usage inspection. No server, browser, version, commit, saved-source or public-document changes were made by this owner.

## Proven failures and repairs

The first accepted 257-datum case failed in `cadReferenceFeatureIds`: a retired 256-feature policy remained in the rendering path after document feature counts became uncapped. Both `CadWorkbench` and `CadViewport` call this helper. The helper now returns every sorted unique real feature identity; principal planes remain separate. The actual Workbench test opens all 257 rows and selects the last datum without changing its accepted document/version/history.

Reference preparation also rejected 32,769 authored line segments, even when every Curve was accepted. A second case showed that 300 accepted circular outlines were reduced from 120 samples each to 109 merely because other outlines existed. The aggregate display policy and adaptive reduction are removed. Every authored line remains represented; arcs keep their existing three-degree maximum sampling increment. This only changes display preparation. Exact analytic coordinates, bounds, original strings and native geometry are preserved.

An independent accepted single Curve with 32,769 line segments failed earlier in `cadPathClosureTolerance`: flattening all coordinates into `Math.max` arguments exhausted the JavaScript call stack. Its iterative maximum preserves the same initial scale, `1e-12` floor, eight-epsilon scale, NaN and Infinity behavior. Accepted chains at the origin and at `1e8` retain all 32,769 edges, endpoints and exact length. Closed Curves at far coordinates still reject with the existing open-Curve diagnostic. No geometry repair or simplification is introduced.

After reference preparation could preserve the complete layer, actual shared controller/viewport operations demonstrated a second boundary failure:

| Accepted scene | Raw viewport JSON | Published artifact JSON | Before repair |
| --- | ---: | ---: | --- |
| 1,001 UUID datum IDs | 39,632 bytes | 40,121 bytes | Read and capture returned `OUTPUT_TOO_LARGE` |
| 1,001 UUID visible Pad IDs | 39,679 bytes | 40,168 bytes | Read and capture returned `OUTPUT_TOO_LARGE` |

The capture had already published its blob artifact when the public tool rejected the receipt. The narrow set-view operation succeeded and left the exact draft unchanged. These tests use the real `CadSession`, controller, accepted document parser, reference preparation, shared viewport controls, PNG validation/hash/artifact/download path and tool envelope. A deterministic rendered PNG and supplied ready-state build metadata replace WebGL/native rasterization; these are contract tests, not native performance or visual-quality claims. Native heavy validation remains a separate owner’s work.

## Public reply contract

`cad_get_viewport` retains its existing complete small state. The tool-only formatter adds:

- `viewportToken`, identifying the complete observed viewport metadata.
- `visibleBodyCount`, `omittedVisibleBodies`, `omittedVisibleBodyCount` alongside `visibleBodyIds`.
- In an installed solid reference view, `referenceFeatureCount`, `omittedReferenceFeatures`, `omittedReferenceFeatureCount` alongside `view.referenceFeatureIds`.

An oversized reply keeps whole ID entries within its actual serialized response budget. Counts always describe the complete original collections. No document, renderer state or capture artifact is shortened. Unavailable reference metadata stays unavailable; it is not converted into a claim of zero installed references.

The existing tool gains one strict paging arm:

```json
{
  "expectedVersion": "current draft version",
  "collection": "visible-bodies",
  "expectedViewportToken": "token returned by the summary",
  "offset": 0,
  "limit": 50
}
```

`collection` is `visible-bodies` or `reference-features`. Replies contain `documentId`, `documentVersion`, `viewportToken`, `collection`, `items`, `total` and `nextOffset`. Pin both the draft version and token until `nextOffset` is null. Changed complete metadata rejects with `STALE_VIEW`; changed draft rejects with `STALE_STATE`. Collection/token arguments must appear together. Sketch/Curve editors do not advertise installed world reference IDs.

One module WeakMap entry per `CadSession` retains the current exact JSON identity and opaque token. Repeated unchanged reads, including newly constructed tool descriptors, keep the token. Observed selection, installed reference IDs, build identity, navigation or camera changes produce a different token. A token is not a guarantee about an unseen renderer epoch whose complete observed metadata is identical. Existing control-instance, source-version, reference-installation, selection/camera, workflow and cancellation checks remain authoritative.

`cad_capture_preview` formats only the returned `viewState` using the same contract. The controller’s complete `previewArtifact.viewState` is unchanged. A successful published/download-requested capture now returns its truthful artifact receipt even for 1,001 references, 1,001 bodies or a mixed 1,001-body/1,001-reference scene. `cad_set_viewport` keeps its existing narrow command receipt.

## Parameter inspection findings

The committed bounded parameter context/mutation receipt repair is untouched. A complete accepted sketch with 1,001 linked profiles, maximum 512-character expressions, maximum IDs, historical plugin provenance and escaped 160-character feature/group labels reconstructed every exact usage through existing `cad_inspect_parameters` pages. Every reply remained below 32 KiB, and stored geometry, scalar expressions and session identity were unchanged.

No parameter-inspection response-size defect was reproduced. Its existing summary deliberately retains up to eight downstream IDs and four plugin-binding summaries, with full counts; public guidance describes these as bounded references. Actual usages already have complete versioned paging, while complete package/dependency definitions remain readable through document chunks and per-profile inspection. This pass does not silently relabel those nested summaries as complete or broaden their contract.

## Consumers and verification

Public consumers are the viewport/reference/capture guidance in `docs/site/agents.md`, agent tool descriptors and the CAD E2E visual/reference checks. Existing small-array and captured-view assertions remain complete. Internal `visualIdentity`, `referencesInstalled`, rendering, topology selection and controller capture ownership operate on full state and are unchanged. Root owns the public guide and release integration.

Red logs: `tmp/cad-viewport-capacity-red.log`, `tmp/cad-viewport-segments-red.log`, `tmp/cad-chain-closure-red.log`, `tmp/cad-viewport-reply-red.log`. Current focused verification: **236 tests in seven suites**, including actual Workbench render, source/display capacity, scalar closure, shared viewport guards, tool/controller receipts and exact pagination. `npx tsc -b --pretty false` and `git diff --check` pass. No full browser or native benchmark was repeated by this owner.

Frozen source SHA-256:

| File | SHA-256 |
| --- | --- |
| `src/domain/cad/cadAnalyticSegments.ts` | `8cf3e8cad9852fe7ab9e72214614248bd0ce981b5a3d5b9a93d6542c97dab2df` |
| `src/features/cad/cadViewportReferences.ts` | `fa20030f2cc02c00ce094e892089ab8264cfae2615c21ab1478dcc42a3657a69` |
| `src/features/cad/cadCurveRendering.ts` | `bb1d03551ec16491322f395abb9e63f1fee8fd89e7398a06c6be5e42047da061` |
| `src/features/cad/cadViewportToolReplies.ts` | `ddda5bc93f54eb84d85afd36ae7e08ab707ee4a7070c42770fc70e180ec36e74` |
| `src/features/cad/cadSiteTools.ts` | `6ccee0a9e743c2755c0bb0648f038ab000d3be93450d19bb8923d114469f8ef4` |
| `src/features/cad/useCadController.test.tsx` | `103be1c1330a53af2ba761a34681a793a673cd64c2e9738d8fa9ecb00aee4cf3` |
| `src/features/cad/CadWorkbench.test.tsx` | `5e3d4144a461096853f32fe8c577d3ecefeb96936ca3973f550ca47fd45cbb63` |
