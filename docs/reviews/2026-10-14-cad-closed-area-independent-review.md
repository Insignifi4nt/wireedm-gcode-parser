# Closed-area interaction: independent scoped review

Date: 2026-10-14. Reviewer: region domain/API owner, reviewing the separate area renderer/helper and parent field/Workbench integration. The review does not independently certify its own domain/API implementation. The depth renderer/helper remains under separate development and is excluded. No browser, production build, server, native package, commit or product-source edit was performed by this reviewer.

## One confirmed integration finding, repaired by its owner

The new source-owned `pick-regions` command inherited Workbench's native-build identity pin from ordinary source/body requests. A same-document/same-version accepted native build publication therefore cancelled an active area choice, even though its immutable cells and resolved source frame were unchanged. The standalone renderer already preserved such publications correctly.

An ignored replay of the parent's actual mounted Workbench harness, `tmp/cad-region-build-publication-review.test.tsx`, failed against the initial integration: `viewportRegions` became null after changing only the accepted `buildId`. The unchanged draft/version and actual source-owned cell command made this a meaningful ownership regression, not a synthetic stale native pick. Red: `tmp/cad-region-build-publication-review-red.log`.

The parent wrote its own tracked behavioral red and repaired only the command-kind predicate: region picking retains document, version, workflow and source ownership; ordinary `pick` requests still require captured native `buildId`. The private replay is now green (`tmp/cad-region-build-publication-review-green.log`). A separate direct run of the parent's new tracked case verifies that the area choice remains pending/selectable through native publication while a subsequent whole-source picker still clears on another build identity change. No generic topology/capture guard was relaxed.

## Remaining reviewed seams

- Display and analytic selection share the same prepared source forest and resolved frame. A ray intersects the exact plane in doubles, then uses actual local analytic containment. GPU triangles, body face keys, screen bounding boxes and profile names never establish a saved selected cell. Offset, principal axes and tilted/far datum placement remain authored.
- Per-cell filled geometry includes immediate-child holes. Each actual contour has one authoritative outline. Signed/clockwise major arcs retain their sampled traversal; display triangulation does not affect analytic selection or saved/native math. Local coordinates are uploaded around each cell's bounds center, retaining double world placement for small far features. Existing conservative analytic bounds remain the Fit authority.
- The helper paints selection/hover on reused resources. Source/base/owner/preparation/placement changes rebuild and cancel old gestures; selection-only wrapper and native mesh publications retain ownership/camera. Exit, rebuild failure and unmount dispose all allocated fill/outline resources. Ordinary reference styles and opaque body materials restore on exit.
- Last-valid native reference geometry is hidden during area mode, so a provisional shared parameter cannot leave a misleading older outline alongside the actual candidate cells. Current authoritative outlines remain above stock. Graphics loss cancels a started gesture and blocks invisible choices; recovery requires a fresh pointer gesture.
- Human area preparation uses the effective parameter environment and actual preceding datum. Choosing a cell changes the provisional feature only; source profile definitions, constraints, expressions, embedded recipes and imported originals are retained. Empty selection remains invalid rather than becoming whole sketch. Deliberate Whole sketch restores the absent-selector default; changing source clears selectors to avoid reinterpreting coincident profile IDs. Same-source extent/operation changes preserve the exact selector and dormant distance expression.
- The form pins callback tokens to its owner, immutable document and version. Older callbacks cannot select/finish/cancel a newer picker or replacement document. Area Cancel restores the pre-picker feature while retaining the already-typed shared numeric quantity. Done retains a provisional selection; the current validated preview and one atomic Apply establish accepted history. Whole-source selection pauses preview separately. Tree/parameter/feature edits remain locked by pending editor ownership.

No further actionable area finding was found in this bounded review. This does not claim analytic/native parity for every display sample, a physical browser proof, depth-handle completion or overall CAD completion.

## Independent focused evidence

All commands used the pinned Node24.22.0 runtime; no timeout/assertion relaxation or full-suite repeat:

- `tmp/cad-closed-area-independent-focused.log`: **36/36 cases in4 files** (`cadRegionSelectionOverlay`, `CadRegionPicking`, `CadExtrudeFields`, `CadFeatureRegionPickEditor`). Actual Three rays/scene resources and analytic picking are exercised; unavailable WebGL raster transport is mocked. Form cases use real domain/Session operations with injected preview transport metadata.
- `tmp/cad-closed-area-workbench-independent.log`: **3/3 selected real-mounted Workbench cases**, covering correlated quantity/area Cancel/Apply/Undo, accepted native publication versus ordinary source-pick invalidation, and stale callbacks after document replacement.
- The isolated original regression replay independently passes1/1 after the parent's repair.

The tree owner's four frozen renderer/test hashes match exactly. Whole Workbench hashes below are an observed reviewed snapshot; depth integration may subsequently alter that parent-owned file and needs its own review. The feature editor's depth WIP was not frozen or certified here.

| File | SHA-256 |
| --- | --- |
| `src/features/cad/cadRegionSelectionOverlay.ts` | `4D8565415823D7F0742E9612AC24BA9E36AE5C71CDF1C16B7B91C541A337FF4C` |
| `src/features/cad/cadRegionSelectionOverlay.test.ts` | `F20DD8A29979BFE3222B490BA75D00DB2B23D1433083979CDA6279737ABD3F19` |
| `src/features/cad/CadViewport.tsx` | `C80C27F283107FA8F1702997326DBD02284BF4C7241BB68D6811957E45AC9B58` |
| `src/features/cad/CadRegionPicking.test.tsx` | `5BBFFF80E815D3D830068A0DE8A2AB287D1A02D2C345337ABF9F6B3CC9E2FA01` |
| `src/features/cad/CadSketchRegionsField.tsx` | `EE8CBF92F43780154112E42D1E6D27A3D7FDFEAABFE07D5AED6BA1CA4390D767` |
| `src/features/cad/CadExtrudeFields.tsx` | `00CDBA1F91AA91A4DD2FD54D59D70B2F5F389C6475AE968A69A37F74E0FBDD2A` |
| `src/features/cad/CadExtrudeFields.test.tsx` | `11938C9BEBDA37E278D641125B6FBE08E39B24F6F6BF9EB0740D6CC78A33F62E` |
| `src/features/cad/cadFeatureReferencePicking.ts` | `0D12053A183AD074D87DAF8595728F18A44F69C2B52887D97E97DC5FF298FE4B` |
| `src/features/cad/CadWorkbench.tsx` | `D57D792A41DB70D85B1C79AB0EE36E749F817BCAD202400A62BA81A4C1C59EDC` |
| `src/features/cad/CadWorkbench.test.tsx` | `4C0DE97140A1DFBBA1C3C97A2EDE9CBB63112AD0BA2C8DE04A5D31C80002CBAC` |
| `src/features/cad/CadFeatureRegionPickEditor.test.tsx` | `6E4EFDC7D60289522F5D3FDBFCBFCC61DD413510C980B765C0B9F916D007C789` |
