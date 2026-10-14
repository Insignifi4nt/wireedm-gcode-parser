# CAD icon iteration 3

This review compares the current `scripts/icon-source.mjs` paths, the rejected iteration-2 candidates, and focused iteration-3 alternatives. It covers the full CAD, geometry, and view catalog families. The work is limited to isolated path proposals and review artifacts; the shared icon source, generated assets, and CAD implementation are untouched.

## Decisions from the review

The v2 full-cube treatment for face and edge selection should be dropped. It makes select-face, select-edge, and select-body nearly the same at toolbar size. The v3 options keep the face and edge as isolated targets, align their edges to the body’s ±8/±4 isometric slopes, and use the exact pointer path from select-body. That gives the family one pointer modifier without removing the target distinction.

The v2 pad and pocket paths should also be dropped. Their duplicate shoulder strokes add weight without improving the icon. Current pad and pocket already form a strong orthographic pair: the closed profile is stable, and the arrow direction differentiates material addition from removal. The v2 shell proposal should be dropped because its full top bar closes the opening and reads as a double square. The v2 Boolean ticks have no operation meaning. Mirror and linear-pattern were already closed in the source, so their v2 “closure” changes were false fixes and are not carried forward.

The operation metaphors still need a deliberate choice between depicting inputs and depicting results. The v3 board compares those choices where useful:

| Icon | V3 candidates | Reading from the 14px and 24px renders |
| --- | --- | --- |
| Revolve | Closed profile beside axis and turn cue; turned cylinder result with axis and rotation cue | The profile option remains the safer feature-input symbol, but still resembles a bracket. The turned-result option reads as a cylinder, which could be confused with a generic solid. Neither is ready to replace the current icon without context testing. If staying with the profile metaphor, at minimum close the source contour. |
| Loft | Two closed sections with four connecting generators | The square-to-rectangle wireframe is more explicit than the v2 cup silhouette and reads as a transition at 24px. At 14px it still compresses to a tapered outline. This is the strongest loft candidate so far, but should be shown beside real feature-tree rows before adoption. |
| Sweep | Closed constant-width curved tube with visible end section and trajectory; closed profile with attached curve and direction | The tube-result option reads as a swept result at 24px; at 14px it approaches a curved path. The input option makes the profile and trajectory explicit but its small profile competes with the direction arrow. Choose based on whether the product uses result or input metaphors for feature rows. |
| Pad-pocket | One stepped orthographic profile with a plus/minus cue | This separates the combined command from pad without stacking two arrowheads on one axis. At 14px the plus and minus survive as small but distinct marks. It is the preferred next candidate if pad-pocket is exposed as a distinct command. |
| Imported-body | Closed body with center import arrow; same body with external arrow badge | Both reuse the body’s closed isometric silhouette. The badge avoids drawing through the facets but is small at 14px; the center arrow is more directly “import” but adds detail to the top face. Prefer the external badge only if it remains legible in the actual tree row. |
| Datum-plane | Isometric rhombus using the body’s exact top-face vertices | This removes the v2 floating support ticks and resolves the projection mismatch. The standalone plane remains recognizably planar and aligns with the solid-body family. |

## Path and perspective notes

- The body top-face vertices are `(4,8)`, `(12,4)`, `(20,8)`, `(12,12)`. The v3 datum plane uses that exact contour. The v3 select-face target uses the same ±0.5 slope and the select-body cursor path.
- The v3 select-edge runs from `(10,16)` to `(18,12)`, matching the body’s projected edge slope, with endpoint marks and the shared select-body pointer path.
- Current imported-body still lacks the solid body’s top apex and back edges. Both v3 candidates reuse the exact body outline and internal edges, then add an import cue.
- Current revolve profile is open. The v3 profile option closes the rectangle. The turned-result option uses a closed cylinder, center axis, and external rotation cue; it is included as a comparison, not asserted as the final symbol.
- The v3 loft loops and generators are all explicit paths. Unlike a filled container, the separate section loops show two profiles joined through their corresponding corners.
- The v3 sweep-result path is closed, preserves a roughly constant tube width through the curve, and shows the center trajectory. The separate input variant connects the trajectory to a closed starting profile.
- Current shell remains unchanged: its open inner contour is the cavity opening. Do not close the whole top edge. The current Boolean and mirror geometry is retained. Linear-pattern’s source already uses closed instance boxes, so no contour-closure edit is justified.

## Coverage and artifacts

`scripts/icon-revisions/cad-v3.mjs` exports 11 candidate records across eight catalog IDs and a `cadV3Coverage` list with an explicit disposition for every one of the 63 CAD/geometry/view catalog IDs. It also records camera-capture as a related view affordance outside those categories. CAM commands and file icons are outside this review.

`scripts/icon-revisions/render-cad-v3.mjs` validates candidate bounds and non-empty raster output at 14, 15, 16, and 24px, then compares current source, available v2 path, and v3 path using `@resvg/resvg-js`, a 24-unit viewBox, and the shared 1.75-unit rounded stroke. The comparisons are in `docs/design/icon-review/iteration-3-cad/compare-14.png`, `compare-15.png`, `compare-16.png`, and `compare-24.png`. The complete ID disposition table is generated at `docs/design/icon-review/iteration-3-cad/coverage.md`.
