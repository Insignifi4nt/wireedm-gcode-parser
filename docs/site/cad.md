# CAD design

Open **Design in CAD** from Start Work. The desktop workspace keeps the feature tree on the left, the sketch or solid view in the centre, and the selected feature's dimensions on the right. The timeline follows the same feature history. Nothing is uploaded to a modelling service.

Drag a divider beside the feature tree or properties panel to resize it. You can also focus a divider and use Left/Right arrows; hold Shift for a one-pixel step, or use Home/End for the width limits. Preferred widths return when the window expands or the properties panel reopens, and resizing preserves pending edits.

## Design a part

1. Create a sketch on XY, XZ or YZ. Draw a closed Rectangle, Circle, Polygon, Slot or line/arc Path. Use the numeric editor for exact position and size. Rectangles support rounded corners; slots have an angle. Construction profiles remain visible for reference but do not enter solids or CAM exports.
2. Draw nested contours normally. Enclosed contours create voids; another contour inside a void creates an island. CAD determines these regions automatically. Touching, crossing and self-intersecting contours are rejected. To combine overlapping solids, use separate sketches and a solid operation.
3. Finish sketching and create a Pad (extrusion) or Revolve. Pad supports a symmetric extent. New body, Join and Cut explicitly control whether material is created, added or removed.
4. Select a feature to edit its dimensions. Later features rebuild from the edited history. Pick edges before Fillet or Chamfer to limit the operation, or choose all edges. Pick one planar face before Shell to open that face and hollow the body inward. Transform, mirror, linear/circular pattern and Boolean union/cut/intersection operate on solid bodies.
5. Save the document. Saved CAD documents appear in the CAD library. Returning to the workbench retains the in-memory draft; save before closing the browser or changing documents.

Use isometric, top, front or right views, fit the part, and navigate with the viewport mouse controls. Rendering updates on demand. The solid engine loads only when needed, so its first operation can take longer. Rebuilding and failed models are labelled; export cannot silently use a failed history.

In sketch Select mode, click inside a contour or near its outline. Nested interiors select the innermost contour; construction geometry is selected by its outline. Picking uses the pointer position independently of grid snapping. Escape discards pending dimensions or parameter edits. Ctrl/Cmd+S saves only after those edits are applied or cancelled; Ctrl/Cmd+Z in a text field keeps its normal text-editing behavior.

For a polygon, use the Vertex picker in Properties to reach a point and edit X/Y. Previous/Next retains pending changes to other vertices. Apply accepts them together; Cancel discards the complete edit.

**Path** joins lines and circular arcs in one closed contour. Pick a start, then use **Line** to pick an endpoint, or **3-point Arc** to pick an endpoint followed by a point on the arc. The third point determines the arc's direction and short or long sweep. Switch modes while drawing. **Close profile** adds a straight closing edge when needed and accepts the whole contour as one undo step. Clicking the start alone does not save it. **Undo last** removes the most recent point or segment; **Cancel drawing** discards the pending path. On the focused canvas, arrows position the cursor, Space places a point, Backspace undoes and Escape cancels. Invalid closure retains the drawing for correction. Saved paths remain analytic and their segment dimensions can use parameter expressions.

Use **File → Rebuild model** if a cancelled operation or restarted worker invalidates an exact selection. The visible shape can remain available while its cached topology needs rebuilding; select faces or edges again after the rebuild.

Existing sketches and curves fit their geometry when opened for editing, including drawings far from the origin. Later dimension changes keep the current view; use **Fit** or **F** to reframe.

**File → Capture view PNG** saves the current sketch or solid viewport. The capture includes the current draft, which may be unsaved. Finish property edits and wait for the current solid rebuild before capture. The Agent panel in the notification bell keeps the captured PNG available to download again.

If 3D graphics are interrupted, the view redraws when the browser recovers. **Retry 3D view** creates a fresh view if needed, retaining the document and resetting the camera to Isometric. Capture is unavailable while graphics are lost.

If the CAD view itself cannot load, its recovery panel keeps the accepted document available. Use **Save current document** or **Download CAD document** before reloading the page. A download request is not confirmation that the browser saved the file.

## Parameters and history

**Curve** creates an independent open chain of exact lines and circular arcs. Choose a reference plane and offset, name it, then draw with Line or 3-point Arc. **Finish curve** accepts the complete chain as one undo step; Cancel discards its name, placement and geometry together. Curves can have sharp corners but cannot close, cross, overlap or touch themselves. Double-click a saved curve to inspect its planar view and edit its segment dimensions in Properties. Length, bounds and endpoints remain analytic, including parameter expressions.

Sketch outlines and Curves appear at their actual plane and offset in 3D. Before solids exist, all active sketches are visible; afterward, select a sketch or feature to reveal its source sketches. Construction outlines are dashed. Curves remain visible alongside solids. In Body mode, click a visible outline to select its feature; double-click its tree entry to edit. Sketch/Curve-only viewing and PNG capture do not load the solid engine. Curves are reference geometry, without material regions or machining roles.

Named parameters are numeric values. Dimensions accept numbers or expressions such as `width / 2`, `thickness + 3`, and `(pitch * 4) - diameter`. Expressions support `+`, `-`, `*`, `/` and parentheses, without executing JavaScript. Dimensions are millimetres; angles are degrees.

Each accepted edit is one undo step. Undo/redo changes the draft without rewriting saved storage. History is bounded to 50 steps and a memory budget. Invalid edits leave the previous draft intact. Deleting a feature with dependents requires explicit cascade deletion; reordering must preserve dependency order.

**Pattern → Linear pattern** repeats a body by XYZ spacing. **Pattern → Circular pattern** repeats it around a world X, Y or Z axis through the entered centre. Count includes the original body. Angular extent is the total sweep: 4 instances over 360° appear at 0°, 90°, 180° and 270°; 3 over 180° appear at 0°, 90° and 180°. Negative extents reverse direction. Centres and extents accept parameter expressions. Copies are fused where they overlap, and the pattern replaces its source body. To create repeated holes, pattern a separate cutting body, then subtract that pattern with Boolean Cut. Patterns have 2–100 instances and share a 1,000 expanded-instance limit.

For a through hole or cutout, use **Pad / Pocket → Cut from body → Through all**. Choose the target and a direction from the sketch plane, or **Both directions** to cross the entire target. The displayed axis follows the sketch normal: +Z for XY, −Y for XZ and +X for YZ. The cut follows changes to the target thickness; it does not store an oversized depth. Nested contours keep their material/void meaning, and construction geometry stays excluded. **Distance** retains the existing specified-depth behavior. Switching extent is a pending edit until Apply; Cancel preserves the accepted feature.

Through-all rejects a cut that misses all material, erases the whole target, or cannot be confirmed at native precision. Its required target span is limited to one million millimetres. Failed cuts retain the preceding solid for inspection and block export until repaired.

**Loft** builds a solid between 2–16 ordered sketch sections. Create the sketches on the same reference plane with different plane offsets, then add and reorder them in Properties. Offsets must progress in one direction; the app does not sort them for you. Each section needs one closed material boundary without holes. Construction geometry is excluded. Smooth uses fitted native surfaces; Ruled connects each pair of sections directly. Choose New body, Join or Cut as with Pad. If smooth fitting extends beyond the first or last section plane, adjust the section spacing or use Ruled. The resulting solid supports STEP/STL export and later features. Final-solid CAM sections still require analytic lines and circular arcs; unsupported fitted curves are rejected explicitly.

**Sweep** moves one closed sketch section along an open Curve. Place the sketch at the curve's actual start, perpendicular to its first direction. For example, a Curve on XY starting at `[0, 0]` toward +X uses a YZ sketch at offset `0`; a circle centred at `[0, 0]` in that sketch stays centred on the curve. Choose the Profile sketch and Curve, then New body, Join or Cut. Both source features remain editable. Sweep preserves their placement and traversal; it does not move, rotate or reverse the sketch to fit.

The section needs one material boundary without holes; construction geometry is ignored. Line and circular-arc segments must meet tangentially. Sharp corners, uncertain placement and insufficient bend/return clearance give an actionable diagnostic. Clearance conservatively encloses the section in a disk around the curve start, so a wide or offset section can be rejected even when a more specialised sweep might work. Supported sweeps contain up to 64 curve segments, with section-edge count × curve-segment count at most 2,048. These limits keep native work bounded; the source Curve's larger limit is unchanged. Straight portions are extruded and circular portions revolved, preserving analytic native surfaces. Build diagnostics still govern export and exact section handoff.

Choose Body, Face or Edge in the viewport to change the selection filter. Ctrl/Cmd-click adds or removes edges on the same body. The inspector can also list exact topology for keyboard selection. A selection belongs to the current build and clears when that build changes. Saved edge and opening selections use geometric conditions with exact match counts: an ambiguous match fails rather than choosing an arbitrary edge. A tangent edge chain must be selected completely when the solid engine would propagate the operation along it.

In Body mode, expand **Inspect topology** to browse the exact edge list. Face and Edge selections open this inspector automatically; close it when you want more space for feature dimensions.

This release provides dimension-driven profiles and parametric feature history. It does not provide a general geometric constraint solver, assemblies, freeform surface authoring, arbitrary face sketching, or reconstruction of an imported solid's original feature history.

## Send a sketch to CAM

Select the intended sketch and use **File → Send to CAM**. The app saves the exact CAD draft first, then creates a new CAM project from that sketch's non-construction closed contours. Lines, circles, rounded corners and slot arcs stay analytic. XZ and YZ sketches transfer in their own two-dimensional coordinates, in millimetres.

**This transfers the selected sketch, not the silhouette or section of the final solid.** Later pockets, transforms, patterns and fillets do not change the original sketch's contours. Select the actual manufacturing sketch and review the result. CAD and CAM are separate editable documents after transfer; later CAD changes require a new handoff and never overwrite an existing CAM project or saved revision.

Review contour roles, material side, order, entry/exit and threading in CAM before generating output. Controller output still requires a saved CAM revision and a complete installed machine package. CAD does not infer feeds or change postprocessor formatting rules.

## Send a final-solid section to CAM

Select a solid and choose **File → Section for CAM**. Pick XY, XZ or YZ, then enter a plane offset (numbers or parameter expressions). The offset follows the plane normal: +Z for XY, −Y for XZ, +X for YZ. For a 10 mm deep XY pad, start with an XY offset of `5`.

Choose **Preview section** to inspect the final material boundaries, including cuts, patterns and Boolean operations. Changing the plane requires a new preview. **Send section to CAM** saves the source and opens a new CAM project with those exact plane-local contours. It uses the finished solid, while sketch handoff continues to use the original sketch.

Sections must cut through material and produce closed, unbranched contours made of lines and circular arcs. Tangent end faces, open contours, ellipses and spline edges produce an explicit diagnostic. Choose another plane or offset; unsupported curves are never silently replaced with line segments. This is one planar section, not taper or four-axis machining.

## Save, exchange and recover

- **Save** writes to browser cache or the connected folder with conflict detection. Another tab's edit is never overwritten silently. If storage changed, export your draft and reopen the saved document before retrying.
- **CAD JSON** preserves parameters and feature history. Import assigns a fresh identity, protecting existing saves.
- **STEP** imports and exports exact solid geometry. Imported bodies support subsequent solid operations; their original feature history is not reconstructed.
- **STL** imports closed faceted solids and exports tessellated solids. Choose millimeters or inches when importing because STL has no unit declaration. A mesh does not recover analytic curved surfaces. Imports accept one connected closed shell with 4–4,000 triangles; open, nonmanifold and multi-shell meshes are rejected.
- **DXF** imports exact closed contours as an XY sketch and exports the selected sketch in local millimetres, excluding construction profiles. Lines, circles and circular arcs remain analytic. Import uses declared units; choose source units when the declaration is missing. Unsupported curves, approximations, open contours, nonzero elevation and thickness are rejected. Select a segment in Properties to edit its line endpoints or arc dimensions, including parameter expressions. Apply validates the entire closed path; match adjacent endpoints when editing joints. Typed agent operations use the same validation.
- For an open DXF chain, choose **Import as → Curve**. The complete file must describe one connected open planar chain. Unsupported entities, nonzero polyline widths, branching and mixed open/closed geometry are rejected. Select a Curve and use **Export curve DXF** to retain its ordered lines and circular arcs in an open polyline, in local millimetres. Its reference plane and offset remain in CAD JSON; DXF exchanges its local 2D geometry.
- Full workbench backup includes saved CAD documents. Unsaved drafts are outside backup.

Imported STEP, STL and DXF originals remain embedded in the CAD document. Each source is limited to 2 MiB; the entire CAD JSON document, including originals, is limited to 4 MiB. Native topology is limited to 10,000 faces/edges per body and 25,000 per build. Sketch complexity and pattern instances also have limits. Browser download requests do not prove a file was saved to disk. Keep a portable CAD copy before extensive experiments.

## Work with an agent

The [agent tools guide](agents.md#cad-workspace) describes the same operations as the interface. Agents read the draft version, import or edit typed documents, measure analytic sketch geometry, build and inspect volumes/bounds, save, and send a sketch or final-solid section to CAM. Finish or cancel active drawing, feature editors and section dialogs before agent mutations.
