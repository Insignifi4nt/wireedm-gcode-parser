# Wire EDM icon standard

Status: the 134-icon set is integrated against CAD checkpoint `8375c29` and reviewed in the actual app by Luna subagents. The PR targets `feature/parametric-cad-workbench`. The [final handoff](icon-final-handoff.md) records the concrete assets, source-purpose mapping and validation. App release 0.0.698 follows CAD 0.0.697.

## Target

Original icons for the complete local-first workbench, including its current CAD work. Toolbar controls use 15–16 px, tree entries 12–14 px, and larger actions usually 16–20 px. Existing text labels, button names, focus behavior, disabled guards and selection state remain authoritative.

## Construction

- A `0 0 24 24` viewBox, 24 px intrinsic width and height.
- A nominal 20-unit optical field within 2-unit padding. Small circular overshoot and diagonal caps may reach about one unit of outside padding. Rendered bounds are checked against the complete viewBox.
- Default stroke 1.75 units, round caps and round joins. No caller-specific thinning for CAD.
- Flat geometry for sketching and edge treatment. Shallow oblique solids only where depth conveys the operation. Depth edges follow the same direction throughout the family.
- One foreground using `currentColor`. No embedded theme, status color or hover behavior. Parent controls supply colors and opacity.
- No gradients, filters, scripts, external references, fonts, raster images, masks or globally shared IDs.
- React glyphs are decorative by default and remain unfocusable. `aria-label` or `aria-labelledby` makes a standalone glyph an accessible image. Exported SVG files have their own role and label. Icon-only buttons keep their existing accessible names.
- Shape distinguishes operations before color does. Pad raises material, Pocket cuts inward, Fillet rounds an edge, Chamfer truncates it. Sketch is a plane/profile; body is a solid. Selection is a pointer, navigation uses arrows or a view frame.

## Research

Reviewed 2026-10-14. These sources explain operation semantics and provide official visual references. Their graphics are reference material, not asset sources for this set.

| Source | Observation and design consequence |
| --- | --- |
| [Onshape Extrude](https://cad.onshape.com/help/Content/PartStudio/extrude.htm) | Extrusion adds depth to a selected region, with new/add/remove/intersect results. A profile plus material direction reads better than one generic cube for all results. |
| [Onshape Fillet](https://cad.onshape.com/help/Content/PartStudio/fillet.htm) | Edge rounding should have a visible arc. Keep it separate from a straight bevel. |
| [Onshape Chamfer](https://cad.onshape.com/help/Content/PartStudio/chamfer.htm) | A straight truncated corner supplies a useful silhouette contrast with fillet. |
| [SketchUp iPad main toolbar](https://help.sketchup.com/en/sketchup-ipad/ipad-main-toolbar) | Common model tools sit together and retain tool names and shortcuts. Treat icons as quick recognition alongside labels, not a replacement for labels. |
| [SketchUp Offset](https://help.sketchup.com/en/sketchup/offsetting-line-existing-geometry) | Parallel contours communicate offset. Use nested contours for CAM offset, separate from layer stacks and copying. |
| [CATIA Pad and Pocket with open profiles](https://3dswym.3dexperience.3ds.com/idea/catia-user-community/how-to-use-part-design-pad-or-pocket-using-opened-profile-catia-tip-and-tricks_Y9XbgLQJQhOtnHB_tujA4Q) | Pad and Pocket are material operations derived from profiles. Separate their silhouettes and directional cues in the workbench. |

## Exploration

Three independent Image Gen studies are preserved in [Profile line](concepts/profile-line.png), [Cut plane](concepts/cut-plane.png) and [Material silhouette](concepts/material-silhouette.png). They are inspiration, not SVG source.

Cut plane supplies the final direction. Its orthographic sections make Fillet, Chamfer and Shell recognizable through their outlines. Profile line contributes the body's shallow oblique view. Material silhouette was rejected because filled faces looked heavier than the app's existing thin control bars. Generated size specimens are not validation of the final vectors.

The final paths are authored in `scripts/icon-source.mjs`, independently of the generated concept pixels and commercial icon paths. Generic arrows, checks and file metaphors retain familiar meanings; CAD operations have distinct, deliberately constructed geometry. Single-color outlines follow the app's existing foreground and selection colors.

## Iteration and inspection

The first face/edge selection designs shared too much of the body silhouette. The final face glyph is a plane, the edge glyph a bounded line, and the body glyph a solid. Named view, Top view and Fit also have separate orientation/plan/frame pictures. The UPID geometry tab uses planar geometry instead of the CAD solid.

All final SVGs were rasterized at 12, 14, 15, 16, 20 and 24 pixels. Review sheets include dark/light, hover, selected and disabled specimens. Actual browser rendering was inspected in the built catalog at 14/16/20 pixels, including Pocket versus Pad/Pocket and the remaining family silhouettes. [Rendered metrics](icon-review/metrics.json) verify non-empty, unclipped glyphs. [Browser specimen](icon-review/catalog-light.jpg) preserves a view of the real HTML catalog.

Toolbar and tree labels remain essential at 12–14 px. In particular, the small internal lines in Loft, Sweep and selection details cannot replace their labels. Disabled controls retain the existing app opacity rather than introducing an icon-specific palette.

The favicon is the one color-policy exception. It wraps the same `wire-edm-mark` paths in a fixed charcoal tile with cyan strokes because browser chrome does not provide an app control's currentColor.

## Usage

Use a semantic named export such as `PadIcon`, `PocketIcon` or `GeometryIcon` from `@/components/icons`. Dynamic renderers accept `WorkbenchIconComponent`; persisted feature-kind maps remain exhaustive. Alternatively use `WorkbenchIcon` with the typed `name` union. An existing component-name alias is useful for generic actions, but overloaded names such as `Box`, `Spline`, `Copy` and `Scan` need a semantic decision at their call site.

The owning button supplies size, color, hover, selection, disabled state, labels and tooltip. Normal glyphs use the standard 1.75 stroke; do not thin individual toolbars. SVG assets are available in `src/assets/icons/`, and the generated manifest supplies ID, label, category, aliases and file name. Paths are shared exactly with the TypeScript catalog.

React or inline SVG carries the owning control's currentColor. An external SVG image loads in its own document and needs its own foreground color; use the inline components for controls that inherit app themes.

`icons:generate` regenerates SVGs, manifest, React exports and the review page from the editable geometry source. `icons:check` checks parity, live source references and asset/accessibility/catalog behavior without overwriting audit evidence. `icons:audit` refreshes integration and frozen-snapshot crosswalk records. `icons:review` regenerates six-size raster inspection sheets. These are maintainer operations, not requirements imposed on hosted-app users.

## Coverage and integration boundary

[Final inventory crosswalk](final-inventory-crosswalk.md) accounts for the concurrent CAD handoff snapshot, including all 282 icon occurrences, 214 import bindings and 206 expanded renderer variants. Its newer CAD rows are explicit merge-forward mappings. Their implementation belongs to the CAD branch and was not copied into this checkout. [Current integration audit](current-integration-audit.json) reconciles the starting checkout's imported icon occurrences to its actual replacements.

Native browser controls, exact model geometry, scene helpers, coordinate notation, status text and the onboarding illustration have documented exclusions. The actual current text-icon controls are replaced as well. Original assets and the complete mapping can be reviewed independently of the later CAD merge.
