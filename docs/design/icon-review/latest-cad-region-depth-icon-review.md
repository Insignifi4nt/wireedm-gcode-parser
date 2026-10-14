# CAD region and depth icon review

Compared merged `6ef095d` with `origin/feature/parametric-cad-workbench` at `6e2113f`.

The CAD icon integration had accidentally changed 11 string literals containing the X axis label to `CloseIcon`. This affected visible or accessible labels for revolve, transform, linear and circular patterns, and rectangle, circle, and slot profile fields. Restored those literals to `X`; action glyph substitutions remain intact.

A TypeScript AST scan of changed production TSX found no other unintended user-facing string substitutions. The remaining changed strings correspond to icon imports or the existing conditional lead-in/out icon selection. `CadSketchRegionsField` remains glyph-only: its picker handler, whole-sketch reset behavior, and closed-area help SVG match the target. `CadViewport` remains glyph-only, preserving depth dragging locks, rust palette, and depth handle geometry. `CadFeatureEditor` diff now contains only icon imports and JSX glyph substitutions.

`git diff --check` passes. No tests or browser checks were run; the parent task will run the Node 24 UI/build validation after source changes settle.
