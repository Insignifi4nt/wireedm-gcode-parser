# Final cross-family design review

Reviewed the standardized 134-entry source, selected production geometry and prior critical iteration records before parent integration. This pass found three small, justified source corrections. It did not reopen the visual direction or modify CAD application behavior.

## Corrections made

1. The solid-file badge used a 5-unit run and 2-unit rise, producing a 0.4 oblique slope. Body, selection, imported-body and the section family use 0.5 slopes. Its revised badge uses 5-unit runs and 2.5-unit rises, retaining the lower-right modifier field and a maximum y of 22. This aligns the projection without enlarging the badge beyond its optical field.
2. Section view had a shifted top at y=7 and 10-unit walls, while the basic body and its direct selection/import variants have a top at y=8 and 9-unit walls. There was no viewport wrapper or operation meaning requiring that difference. Section view now reuses the exact closed body base. Two 2:1 hatch strokes sit inside its left face and retain the section meaning without retracing a body edge.
3. Generic Boolean drew the intersection rectangle a second time on top of the same four operand edges. Removing that extra subpath preserves both closed overlapping operands and the same visible operation meaning. It removes redundant geometry rather than adding a new symbol.

`scripts/icon-revisions/final-body-family-review.mjs` records actual 14/16/24 px before/after specimens in dark and light themes, with enlarged construction specimens. Inspected the dark comparison. The corrected section view now belongs to the same body family, and the small file badge retains its recognizable shape. Generic Boolean looks unchanged as intended.

## Projection and closure

The body, select-body and imported-body bases are identical. Section view now uses that same base. Their oblique edges have an 8-unit run and 4-unit rise. Section-for-CAM uses 6-unit runs and 3-unit rises to reserve horizontal space for the transfer arrow. The file badge now uses 5-unit runs and 2.5-unit rises. All follow the same 2:1 axis direction. Composite badges and transfer symbols retain different vertical depths to fit their modifier fields; they do not introduce a conflicting oblique perspective.

Loft uses two closed rhombus sections with the same axis direction, different sizes and matching visible vertex connectors. The hidden rear connector remains omitted to avoid central overdraw. Sweep has one closed bent-material boundary and no duplicate internal trajectory. Boolean operands, pattern instances, section solids, material contours, face and body silhouettes are closed. Circles now explicitly close their two-arc paths. Arrow shafts, hatch marks, gesture traces and deliberate page-edge occlusions are intentionally open; closing them would add unrelated connecting strokes.

No additional accidental duplicated line was identified in the inspected body/CAM/general families after the Boolean correction. A pointer intentionally contacting a selectable edge is not duplicate geometry. The face pointer's outside gap prevents that contact from becoming a fused contour; the body pointer stays attached to the body context.

## Bounds evidence

Independently rendered all 134 source glyphs and checked their actual stroked bounds against the 24-unit viewBox. All remain inside it. Recorded explicit x/y/width/height values in `docs/design/icon-review/final-body-family/source-bounds.json`.

The standard rendering script previously serialized the Resvg bounding-box object as `{}` because its properties are not enumerable. The script now copies x/y/width/height into a plain object. Its runtime clipping check was already operating on those properties, so this repairs the evidence record rather than changing the check's result. The owning task regenerates standard metrics and assets after these source changes.

## Readiness and limits

The selected family is ready for the parent's integration review. The owning task regenerated the assets, and this reviewer reran `npm run icons:check`: all 134 SVG/catalog assets match, the current integration audit resolves all 228 baseline references, the actual-path geometry checks pass, and all 6 focused icon tests pass. The owning task updated the selected CAM proposal to match the section correction. The checker retains full 11-ID proposal parity and mathematical checks, with an additional invariant that section view begins with the exact closed body primitive. This final invariant also passed its focused geometry rerun.

The direction is consistent enough to ship a concrete set, without claiming every pictogram is independently self-explanatory. At 12 px the CAM closed-contour icons and file-body badge still rely on their labels; the lead arrows depict the supported center-pierce example; the brand mark is an abstract wire and displaced stock/offcut. These limits are documented rather than solved by adding detail that would crowd the icons.

The existing laptop-context trackpad remains the selected production metaphor. New direct trackpad experiments did not establish a clear small-size improvement without introducing panel, socket or domino readings. A two-finger candidate is recorded for an actual settings-row trial, but no speculative substitution is included in the final source.

Integration into the newer parent CAD revision remains a separate step, with the inventory crosswalk as guidance. This record does not claim that newer CAD UI consumers are present in this icon checkout, or that the icon work changes any API guard.
