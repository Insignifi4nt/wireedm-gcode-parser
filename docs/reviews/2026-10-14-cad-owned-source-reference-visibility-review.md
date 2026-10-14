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
