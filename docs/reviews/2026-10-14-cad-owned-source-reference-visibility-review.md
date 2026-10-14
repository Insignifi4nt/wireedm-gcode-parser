# Owned CAD source-reference visibility repair

Date: 2026-10-14. Preparation reads checkpoint `25b3994af33d3a7f011651a42603f8dd898af597`. This is a bounded follow-up to `2026-10-14-cad-pad-pocket-region-source-audit.md`, whose internal-source concern was initially unconfirmed. The parent subsequently confirmed the physical Pocket failure; whole-sketch source semantics remain unchanged.

## Actual failure

The parent imported the exact accepted Pocket fixture into disposable tab 22 using bundle `main-BwYHhAH4.js`. The accepted native result was 31,874.336293856402 mm³ and one solid. Owned `Pick profile sketch from model` reported eligible reference IDs `regions`, `single`, and `stock_profile`, but Top showed the opaque stock with no internal Regions outlines. The visible stock covered approximately screen [353,233] to [818,466]. A physical click at approximately [674,379], independently corresponding to the Regions rectangle boundary at world [50,10], left the source picker active, accepted version `70b084c6` unchanged, and the source Single. Choosing the same eligible Regions history row immediately started a valid preview.

Primary parent artifact: `C:/Users/cristian/code/Wire_EDM/tmp/cad-pocket-internal-source-pick.png`, 48,684 bytes, SHA-256 `2173894D935C63AAC8713F877865299F7CA07C041CF1D1586C4DDE6302652A4D`. Parent owns raster/browser evidence and the remaining ready/Cancel/source integrity proof.

The cause is narrow. Workbench already filters the displayed references through an owned, document/version/build-current picker command. It still displays opaque accepted bodies. Viewport line materials retain depth testing, and its reference ray picker intentionally rejects hidden references behind body surfaces. That ordinary rule is correct; it cannot expose a completely enclosed, eligible source sketch while the user is explicitly choosing a source.

## Prepared structural scope

An optional `sourceReferencePickIds` prop will carry only the current owned command's eligible feature IDs from Workbench to Viewport. The viewport will recognize through-body source presentation only for matching installed sketch/curve references in Body mode, excluding plane selection and face/edge topology modes. This is presentation and picking of already eligible whole sources, with no new schema, geometry, agent argument or source-selection fallback.

During this owned mode, eligible reference outlines will ignore solid depth and avoid depth writes; bodies will remain as translucent visual context. A first reference-picking pass will contain only those eligible sketch/curve outlines and no occluding bodies. Remaining references retain their existing normal depth behavior. Entering or leaving the mode will cancel an active pointer and restore the ordinary materials without recreating the renderer, uploaded geometry, camera or native model. Existing document identity, expected version/build, preceding-feature/type eligibility, draft ownership, cancellation and single accepted history guards stay in Workbench/editor.

Normal hidden-reference/silhouette tests and topology picking are preserved. This mode will not alter the global `pickCadCurveReference` mathematical tolerance or ordinary occlusion rule. The change must also be absent for owned body/plane selection commands that have no matching sketch/curve references.

## Red preparation before the start signal

Tracked product and test files remain unchanged during checkpoint preparation. The ignored draft `tmp/CadSourceReferencePicking.test.tsx` mounts the real viewport with real Three geometry/rays, mocking only WebGL raster scheduling. Its accepted stock top is above an internal Regions sketch and Rail curve; an ineligible, closer line competes at the same projected point. It covers world origins 0 and 100,000,000, actual pointer selection, normal depth restoration, exact input immutability, camera/geometry/renderer identity, mode-transition pointer cancellation, face picking, plane mode exclusion and interaction locks.

Node 24.22.0 command `node_modules/vitest/vitest.mjs run --config tmp/cad-source-pick-red.config.ts` gives three meaningful red cases. The two placement cases fail because the eligible internal sketch still depth-tests against stock. The ownership-transition regression fails because the existing viewport ignores the proposed source-mode prop, allowing the normal stock click to complete across that transition; it is a required invariant of the new mode, not evidence of a separate existing Workbench ownership flaw. Log: `tmp/cad-internal-source-picker-red.log`. An initial draft harness run lacked a queued raster frame and was corrected before this behavioral red was recorded.

Prepared draft SHA-256: `66514990511B905223ACAFD863D572E6391018CDF33202035EEFFD6A6CA166C4`.

Read product SHA-256 values:

| File | SHA-256 |
| --- | --- |
| `src/features/cad/CadViewport.tsx` | `D3ABDE1B86BC928B88036C6A9FBC03E00C07379F6CDA791EF209684CEFBBF8AE` |
| `src/features/cad/CadWorkbench.tsx` | `46E057178F88287DB326CFB790E55EB18782CB9F078980F5D177EF5EAD17422A` |
| `src/features/cad/cadCurveRendering.ts` | `BB1D03551EC16491322F395ABB9E63F1FEE8FD89E7398A06C6BE5E42047DA061` |

Implementation awaits the parent's start signal after the imminent E2E-only checkpoint. No completion or green implementation claim is made here.

## Implemented after the reviewed checkpoint

The parent started the tracked repair after reviewed checkpoint `4a16f44774a2a49d9ebfd16a8938f733005b07e2` was committed and pushed. The three draft regressions were promoted to `src/features/cad/CadSourceReferencePicking.test.tsx` before product changes and reproduced the same three failures against that checkpoint. Log: `tmp/cad-internal-source-picker-tracked-red.log`.

The final presentation uses eligible overlays alone. Body and solid-edge materials, opacity and depth-write state remain exactly unchanged; no translucency was needed. Workbench adds one prop from its already guarded `currentReferencePick.eligibleIds`. Viewport memoizes their membership set, identifies only matching sketch/curve references in Body mode outside plane selection, disables depth tests/writes on those outlines, and gives them an eligible-only reference ray pass before ordinary feature picking. Noneligible references, planes and face/edge topology keep their ordinary depth rules. On exit, material depth state is restored, including the original construction-outline depth-write exception. The mathematical six-pixel reference tolerance, source eligibility checks and shared schema are unchanged.

The membership change joins the existing layout-time pointer-cancellation dependencies. Rendering uses the existing passive recolor lifetime and frame-style update; it adds no remount, timer, camera compensation or native build. The eligible-only ray scan is skipped in ordinary viewing. Input geometry/references stay immutable and retain their uploaded object identity.

The regression covers actual projected pointer picks at world 0 and 100,000,000, gives the eligible hidden sketch priority over a closer ineligible line, and separately chooses a hidden eligible Curve. It requires the original stock material object and its opaque/depth state throughout. Exit restores normal stock selection and line depth. Other checks cover renderer/geometry/camera identity, owner-transition cancellation, face selection, plane-mode exclusion, explicit body-source selection without reference bypass, and a locked workflow. Existing Workbench source-picker journeys now assert eligible ID propagation/removal after a successful pick, Escape and document replacement while preserving the numeric draft and accepted/candidate geometry distinction. No unrelated tests were weakened.

Node 24.22.0 final focused gate passes **115 tests across four files**: `CadSourceReferencePicking`, `CadWorkbench`, `CadViewport` and `cadCurveRendering`. It includes the existing hidden-reference silhouette/depth tests and real-Three face/pointer regressions. Log: `tmp/cad-internal-source-picker-focused-final.log`. Application TypeScript and scoped diff checking pass; the final type log is `tmp/cad-internal-source-picker-type-final.log`. No server, build, private browser execution, schema, agent-tool or native-math change was made by this owner. Parent-owned fresh native-backed Pocket raster/pick/Cancel proof and independent review remain required before the next checkpoint.

Frozen implementation SHA-256:

| File | SHA-256 |
| --- | --- |
| `src/features/cad/CadViewport.tsx` | `467CA9C517441BFC3685A2F981AE90C3ACE5664B89276D0C4AFF279FDFDAAA0F` |
| `src/features/cad/CadWorkbench.tsx` | `642FD235BE71D84CDF81B381A21F577C6BA5670F6585886AA5481D7234DE12D4` |
| `src/features/cad/CadSourceReferencePicking.test.tsx` | `7E5C023D17395967769CEED9F5E1FEA8DA070554E027CC5B490E6C3F35ABA984` |
| `src/features/cad/CadWorkbench.test.tsx` | `424EBDB684EA4EDA2D53B1BD0A67A7BC0701EC6FFC42A016E740B5A5B43779F1` |

The shared `cadCurveRendering.ts` hash remains `BB1D03551EC16491322F395ABB9E63F1FEE8FD89E7398A06C6BE5E42047DA061`. This bounded repair does not add individual material-region selection or declare the broader CAD goal complete.

## Parent native-backed proof and contrast follow-up

Fresh bundle `main-CpCIpZwm.js` fixed the original physical access defect. The parent clicked the internal rectangle boundary at [671,379]; the draft changed Single to Regions and showed a ready preview of 19,376.991 mm³ and two solids. Accepted source Single/version `c145` remained unchanged and an agent mutation returned `WORKFLOW_OPEN`. Cancel restored the same accepted source/version and zoom `1.455587`. Repeating the physical pick and Apply built exactly 19,376.991118430768 mm³/two solids. One Undo rebuilt the original 31,874.336293856402 mm³/one solid; full canonical JSON equality verified all five features and the exact `stockDepth` data. No Save ran and the saved-library fingerprint stayed unchanged. The disposable tab was closed, with the user's primary tab retained.

Primary parent record: `C:/Users/cristian/code/Wire_EDM/tmp/cad-pocket-internal-source-fixed-browser-report.json`, SHA-256 `3F8140AAFDEFE1892D96758A617387ADFAF74C364AB844F27CBC488616A33D9B`. Ready preview raster: `C:/Users/cristian/code/Wire_EDM/tmp/cad-pocket-internal-source-preview-fixed.png`, SHA-256 `3E8AEAC07C92229D5A5290E07E500D0CDE6E1B8F24191CBF2AC0B3F7AF344400`.

That independent browser pass exposed a smaller contrast defect. The now-visible eligible outlines used ordinary cyan against selected cyan stock and were hard to see. The owner inspected `C:/Users/cristian/code/Wire_EDM/tmp/cad-pocket-internal-source-pick-fixed.png`, 48,268 bytes, SHA-256 `FF990B6A823E1F2E8A3315B19BDCDA8171A7D318EAB1FCE867D13306D1844F82`. A meaningful palette regression failed at both world positions: the original line color had a 1.1424 relative-luminance contrast ratio against the selected body-material color. Log: `tmp/cad-source-picker-contrast-red.log` (two red, one unaffected pass).

The small style refinement changes only eligible source-outline color while the owned picker is active: warm rust `0xb84f18`, with deeper warm hover `0xa6440e`. Both exceed a bounded 2.5 ratio against the dark canvas and selected cyan material palette. This is a regression guard for the chosen material palette, not a WCAG or final lit-raster contrast claim. The real-Three tests exercise pointer hover, require a distinct readable hovered state, keep noneligible references unchanged, and verify exact ordinary colors return on exit. Body/edge materials, geometry allocations, pointer ownership and camera are unchanged by this refinement.

After the refinement, Node 24.22.0 again passes all 115 focused cases, application TypeScript and diff checking. Logs: `tmp/cad-source-picker-contrast-focused.log`, `tmp/cad-source-picker-contrast-type.log`. Parent fresh-build contrast acceptance remains pending; the preceding browser record proves selection/preview/Cancel/Apply/Undo behavior before this final style change.

Updated final hashes (Workbench and its test retain their preceding freeze hashes):

| File | SHA-256 |
| --- | --- |
| `src/features/cad/CadViewport.tsx` | `D3B4C2732C83D52BAEC49CBD6DD58A7163DFF2E4C4841F5C6B656DD5D3C0D5B4` |
| `src/features/cad/CadSourceReferencePicking.test.tsx` | `C92676CF7E9E08FECEF070321FC1A00E848DA18360D1A597D0E58E36B90909FD` |

## Final integrated source-pick browser evidence

The later integrated `main-D0eehPRX.js` candidate is now physically verified on the isolated IPv6 preview origin. Its eligible rust boundaries are visibly distinct from selected cyan stock, including the internal Z5 sketch. A physical boundary click selects Regions and preserves the accepted Single source until Apply. The same browser then chooses an annular cell and Shift-adds its centre, with independently expected native material, exact Cancel and one-step Undo. No Save occurs and the isolated library remains empty. Root evidence: `tmp/cad-pocket-source-rust-current.png` and `tmp/cad-pocket-selected-areas-current-browser-report.json`; complete checkpoint record: `2026-10-15-cad-region-depth-browser-checkpoint.md`. The final integrated source hashes supersede the earlier whole-source-only snapshot; domain/area/depth interactions have their own independent records.
