# Actual CAD icon and toolbar review (Luna)

Reviewed the rendered app at `http://127.0.0.1:3107/wireedm-gcode-parser/` in a separate browser tab. Closed onboarding, inspected the empty workbench, File menu, View controls, drew and selected a rectangle in a real XY sketch, finished it, created and applied a 10 mm Pad, then inspected the selected feature and enabled file actions. The temporary part stayed unsaved.

## Findings

No blocking icon defect found. In the empty model, Sketch, Plane, Curve and Plugins were enabled while body-dependent features stayed disabled. In sketch mode, the drawing tools had understandable shapes and the property panel named the selected Rectangle 1; the Dimension, Move profile and corner treatment controls enabled after selecting the rectangle. The Pad preview temporarily locked the document commands, displayed a solid preview, and enabled Apply when ready. After apply, the tree showed the Sketch 1 → Pad 1 dependency and selected Pad properties; body operations and solid exports became available. Send sketch to CAM remained disabled with Pad selected. These guards matched the visible state.

The toolbar uses a consistent thin-stroke icon style. At 14–15 px, the simpler forms (Sketch, Rectangle, Circle, Pad, Revolve, Mirror) read cleanly. More abstract forms (Plane diamond, Curve wave, closed Path, and some pattern/boolean symbols) depend on their labels or help text, which are present in the accessibility tree and on hover. The File menu pairs its icons with plain action names, and the view drawer exposes named views, Fit model, grid, Body/Face/Edge picking, and navigation help. I found no closure or spacing issue at the tested 1280×720 viewport.

One low-priority polish candidate: the combined **Fillet / Chamfer** trigger uses only the **Fillet** glyph while its label offers both actions. The dropdown arrow and the menu's distinct Fillet/Chamfer labels make it usable; this is not a release blocker. If the icon family is revisited, a neutral edge-treatment glyph for the combined trigger would better represent the command, while keeping the distinct rounded and beveled icons in the menu. No other icon redesign is recommended.

## Screenshots

- [Empty workbench](actual-app/cad-luna-baseline.png)
- [View controls, empty model](actual-app/cad-luna-view-controls.png)
- [Sketch drawing mode](actual-app/cad-luna-sketch-mode.png)
- [Selected Rectangle 1](actual-app/cad-luna-profile-selected.png)
- [Pad preview dialog](actual-app/cad-luna-pad-dialog.png)
- [Selected Pad 1 and feature tree](actual-app/cad-luna-pad-selected.png)
- [Enabled File menu actions](actual-app/cad-luna-file-menu-solid.png)
- [View controls, solid model](actual-app/cad-luna-view-controls-solid.png)
- [Fillet/Chamfer menu](actual-app/cad-luna-edge-treatment-menu.png)
