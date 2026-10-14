# Gear contextual illustrations: local coordinate repair

Date: 2026-10-14. Base: `b0be1bce26f8eb671d27d17d17a33812afd52443`. This private owner record covers `CadGearHelp.tsx` and its new coordinate regression suite only. The parent owns fresh browser verification, release documentation and the combined gate.

## Confirmed failure

The disposable portable fixture `tmp/cad-gear-help-far-position.cad.json` contains otherwise identical pinned V3 profiles at `(0, 0)` and `(1000000, -1000000)` mm: module 0.05 mm, 18 teeth, phase 17 degrees, automatic profile shift, root radius and accuracy. Both profiles passed shared schema and generator inspection with no issues. Fixture SHA-256: `050ca1ac688ae24e2a2e2cc6c8282002b96410b2dfeff38224546ec6268962ce`; exact embedded V3 package SHA-256: `3bdd2484ccc7cf1264280a520e8956335669e2f76b388ee8c10509b33f45c6e7`.

The parent's actual CUA comparison of the accepted fixture confirmed a display defect before this patch, with accepted document version `4de5e18a` unchanged:

- The Module figure had identical 135 px SVG height and `-0.55 -0.55 1.1 1.1` viewBox. The near pitch circle measured 110.4546 px across; the far circle measured 107.3864 px despite the same exact 0.45 mm radius. The far gear path appeared square and blocky. I inspected both saved screenshots and the measurement JSON.
- The root figure's near highlighted transition measured 28.87826 by 29.90645 px. The far highlight measured 58.80949 by 0 px and rendered as a horizontal line. The far viewBox contained absolute million-millimetre coordinates. I inspected the far screenshot and the near/far measurement JSON.

Primary-checkout evidence: `tmp/cad-gear-help-module-before.json` SHA-256 `007DD5E0DF5CDA1B7DA13AACF11F1D44D530FC0B2A89C0050FAC7A6A4AFA7B11`; `tmp/cad-gear-help-root-before.json` SHA-256 `E7C69C0BBA20F5BE85CD710733ABE2FF9AD8EFB5E03394704E6E5AF42C3F7867`. Corresponding near/far Module and root screenshots are retained in that directory.

## Small repair and preserved semantics

The component still resolves the exact authored gear, including its placement, phase, effective shift, accuracy and cutter-tip radius. Its diagram serializer subtracts the authored centre from already-resolved line endpoints and arc centres before emitting SVG coordinates. Arc radii, end angles, sweep flags and segment ordering remain unchanged. Root-framing bounds use those same translated line points and the existing margin; overview circles have local centre `(0, 0)` and their original resolved radii.

This removes large absolute SVG coordinates and the compensating overview transform. It does not round authored coordinates, regenerate the gear at an invented origin, change tolerances or simplify any segments. The phase remains in the resolved geometry. No saved source, package, schema, default, domain math, document identity, history, controller or API changes are included.

The callers admit only exact pinned builtin gear packages. V1, V2 and V3 share accepted placement ranges of plus/minus one million millimetres and accepted modules from 0.05 to 50 mm. The new V1 tiny-gear fixture explicitly sets the existing permitted 0.00025 mm tolerance; its legacy default is too coarse for module 0.05. V1 retains its legacy roots. V2/V3 root figures retain their actual rack-generated transition, rather than a substituted circular fillet.

## Verification and source freeze

Tests were added before the product patch. The actual DOM red run failed five of six cases: all three pinned overview figures retained million-millimetre circle centres, and both generated-root figures retained absolute far viewBoxes. The phase/parameter update case already passed.

The six regression cases now pass. They compare near/far local path command order and numerical coordinates, exact circle radii and relative proportions, finite noncollapsed root spans and translated bounds. They cover all pinned overview versions, V2/V3 roots, alias-driven placement/module/phase changes and exact unchanged profile/parameter JSON. The focused Node24.22.0 browser gate passed 28/28 in three files (`CadGearHelpCoordinates`, `CadPluginFields`, `CadContextHelp`). `npx tsc -b --pretty false` exited 0. `git diff --check` exited 0; it reported only the separate Tree owner's CRLF normalization warning.

Frozen SHA-256:

| File | Hash |
| --- | --- |
| `src/features/cad/CadGearHelp.tsx` | `4B465F4E50013C38AD06BD77DB833CB32CD619287C5387DA039FFA905E92E0BB` |
| `src/features/cad/CadGearHelpCoordinates.test.tsx` | `F8614385E6E8E8D660E09A769D10365A27EE35A6163A32C3F1FB960643EF940B` |

Logs: `tmp/cad-gear-help-coordinate-red.log`, `tmp/cad-gear-help-coordinate-green.log`, `tmp/cad-gear-help-coordinate-types.log`. Production and tests remain frozen.

## Fresh browser and independent follow-up

The parent built `main-BwYHhAH4.js` and used CUA on a disposable tab. The fresh near/far Module figures have exactly matching SVG, path and circle screen bounds, including the 110.4546 px pitch-circle diameter. Root base-path and highlighted-transition bounds also match exactly; the highlight measures 28.87826 by 29.90645 px. The far root viewBox is local, with only the existing approximately 1e-10 native JavaScript double differences from the near bounds. I independently read `tmp/cad-gear-help-coordinate-fixed.json`, asserted exact equality of all captured screen rectangles, and viewed the smooth far Module and rounded amber far-root screenshots. That JSON SHA-256 is `7E28DB90EB3CBD3161BEB8C576EE93187DFE706D42F26FC48CF778EB5EBACA03` in the primary checkout.

The parent's final public API readback in primary `tmp/cad-followup-browser-source-proof.json` (SHA-256 `58DCEAC4D78FA198B7003F948E4AAB2B5AB7AC5001EC544E9A0C10337BC0E6A1`) confirms the three imported feature definitions, embedded packages and inputs exactly equal their canonical fixtures. Accepted version `d7577253-2eb4-489a-a2c4-4ebcbc39fea5` remained unchanged, Undo/Redo were unavailable, no workflow remained open and no Save occurred. I read the saved proof. The disposable tab was closed. This is actual browser display and source-preservation evidence, separate from the DOM test assertions.

The independent research reviewer found no actionable issue and passed the same 28 focused Node24 cases. A separate source replay of the original `b0be1bc` component versus the current component confirmed exact unchanged near-origin path strings, viewBoxes, circle coordinates and radii for V1/V2/V3 overviews and V2/V3 root figures; all three replay cases passed with source profiles and parameters unchanged. The parent's combined gate and CI remain parent-owned.
