# Independent gear-help display-coordinate review

## Scope and result

Reviewed the frozen `CadGearHelp.tsx` coordinate-only diff and `CadGearHelpCoordinates.test.tsx`, their actual red/green records, pinned V1/V2/V3 resolution routes and the parent's saved pre-repair browser measurements. No actionable source or test issue was found. This reviewer did not edit the owner's production/tests, change package or scalar contracts, or execute browser automation.

The accepted tiny-gear case uses module 0.05 mm, 18 teeth, phase 17°, and placement [1,000,000,−1,000,000] mm. Before repair, the saved Module figure measured a far pitch-circle width of 107.3864 px versus 110.4546 px near the origin for the same exact radius; the far tooth boundary looked blocky. The root highlight measured 58.80949 × 0 px, whereas the near highlight was 28.87826 × 29.90645 px. These actual browser results establish a display precision defect. They do not justify changing the gear mathematics.

## Source and mathematical invariants

The component still resolves the authored gear at its accepted placement and phase, with the same applied profile shift, tolerance and cutter-tip radius. Its SVG serializer subtracts the authored center from resolved line endpoints and arc center coordinates before serialization. Arc radii, segment order, large-arc flag, signed-sweep direction, end angles and phase remain unchanged. Both overview and highlighted-root paths use the same translation; framing translates the same tooth line points before applying the original module-based margin. Overview circles now use local center [0,0] and their unchanged resolved radii.

No resampling, rounded replacement coordinates, tolerance change, regeneration at an invented origin or new gear package is introduced. V1 retains its legacy straight-root construction. V2/V3 retain the actual rack-generated root transition. The V1 test explicitly selects its already permitted fine tolerance for the accepted tiny module; it does not modify the embedded package default or loosen a validation limit.

## Independent verification

On Node v24.22.0, the focused HelpCoordinates, PluginFields and ContextHelp suites pass **28/28 across three files** in 4.36 seconds. Log: `tmp/cad-gear-help-coordinate-independent.log`. The new meaningful red evidence previously failed five of six cases on absolute circle centers or absolute root bounds, rather than accepting an already malformed fixture.

This reviewer also replayed the actual `b0be1bce26f8eb671d27d17d17a33812afd52443` component source in an ignored private DOM probe. For pinned V1, V2 and V3 at the origin, the complete current overview path strings, viewBoxes and circle coordinates/radii are exactly equal to that prior committed implementation. V2/V3 root-diagram path strings and framing also remain exactly equal. All **three replay cases pass**, in 1.02 seconds, with exact profile and parameter JSON unchanged. Source/log: `tmp/cad-gear-help-compatibility-independent.test.tsx` and `tmp/cad-gear-help-compatibility-independent.log`. The temporary prior component and private configuration do not alter production files or repository test discovery.

The new far-placement regressions separately check bounded coordinates, pitch-circle proportions, noncollapsed root spans, full path command/numeric agreement with near placement, linked module/phase updates and unchanged original profile/parameters. This establishes both preservation of the prior near-origin rendering and correctness of the newly local far-placement representation. The owner reports successful application TypeScript and diff checks; its fixed source hashes match before and after this independent gate.

| File | SHA-256 |
| --- | --- |
| `src/features/cad/CadGearHelp.tsx` | `4B465F4E50013C38AD06BD77DB833CB32CD619287C5387DA039FFA905E92E0BB` |
| `src/features/cad/CadGearHelpCoordinates.test.tsx` | `F8614385E6E8E8D660E09A769D10365A27EE35A6163A32C3F1FB960643EF940B` |

The parent owns fresh browser pixel comparisons and the combined CI gate. DOM/source checks do not substitute for that raster proof. The broader CAD goal remains active.
