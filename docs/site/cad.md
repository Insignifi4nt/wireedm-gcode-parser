# CAD design

Open **Design in CAD** from Start Work. The desktop workspace keeps the feature tree on the left, the sketch or solid view in the centre, and the selected feature's dimensions on the right. The timeline follows the same feature history. Nothing is uploaded to a modelling service.

## Design a part

1. Create a sketch on XY, XZ or YZ. Draw a closed Rectangle, Circle, Polygon or Slot. Use the numeric editor for exact position and size. Rectangles support rounded corners; slots have an angle. Construction profiles remain visible for reference but do not enter solids or CAM exports.
2. Add internal profiles with the **Hole** role. Holes must lie completely inside an outer profile without touching or crossing it. Overlapping or self-intersecting profiles are rejected. To combine overlapping solids, create separate sketches and use a solid operation.
3. Finish sketching and create a Pad (extrusion) or Revolve. Pad supports a symmetric extent. New body, Join and Cut explicitly control whether material is created, added or removed.
4. Select a feature to edit its dimensions. Later features rebuild from the edited history. Fillet and chamfer apply to all eligible edges; unsupported values produce a feature diagnostic. Transform, mirror, linear pattern and Boolean union/cut/intersection operate on solid bodies.
5. Save the document. Saved CAD documents appear in the CAD library. Returning to the workbench retains the in-memory draft; save before closing the browser or changing documents.

Use isometric, top, front or right views, fit the part, and navigate with the viewport mouse controls. Rendering updates on demand. The solid engine loads only when needed, so its first operation can take longer. Rebuilding and failed models are labelled; export cannot silently use a failed history.

**File → Capture view PNG** saves the current sketch or solid viewport. The capture includes the current draft, which may be unsaved. Finish property edits and wait for the current solid rebuild before capture. The Agent panel in the notification bell keeps the captured PNG available to download again.

## Parameters and history

Named parameters are numeric values. Dimensions accept numbers or expressions such as `width / 2`, `thickness + 3`, and `(pitch * 4) - diameter`. Expressions support `+`, `-`, `*`, `/` and parentheses, without executing JavaScript. Dimensions are millimetres; angles are degrees.

Each accepted edit is one undo step. Undo/redo changes the draft without rewriting saved storage. History is bounded to 50 steps and a memory budget. Invalid edits leave the previous draft intact. Deleting a feature with dependents requires explicit cascade deletion; reordering must preserve dependency order.

This release provides dimension-driven profiles and parametric feature history. It does not provide a general geometric constraint solver, assemblies, freeform surfaces, arbitrary face sketching, or imported STEP feature reconstruction. Fillets and chamfers currently target all edges; individual edge selection is not supported.

## Send a sketch to CAM

Select the intended sketch and use **Send to CAM**. The app saves the exact CAD draft first, then creates a new CAM project from that sketch's non-construction closed contours. Lines, circles, rounded corners and slot arcs stay analytic. XZ and YZ sketches transfer in their own two-dimensional coordinates, in millimetres.

**This transfers the selected sketch, not the silhouette or section of the final solid.** Later pockets, transforms, patterns and fillets do not change the original sketch's contours. Select the actual manufacturing sketch and review the result. CAD and CAM are separate editable documents after transfer; later CAD changes require a new handoff and never overwrite an existing CAM project or saved revision.

Review contour roles, material side, order, entry/exit and threading in CAM before generating output. Controller output still requires a saved CAM revision and a complete installed machine package. CAD does not infer feeds or change postprocessor formatting rules.

## Send a final-solid section to CAM

Select a solid and choose **Section for CAM**. Pick XY, XZ or YZ, then enter a plane offset (numbers or parameter expressions). The offset follows the plane normal: +Z for XY, −Y for XZ, +X for YZ. For a 10 mm deep XY pad, start with an XY offset of `5`.

Choose **Preview section** to inspect the final material boundaries, including cuts, patterns and Boolean operations. Changing the plane requires a new preview. **Send section to CAM** saves the source and opens a new CAM project with those exact plane-local contours. It uses the finished solid, while sketch handoff continues to use the original sketch.

Sections must cut through material and produce closed, unbranched contours made of lines and circular arcs. Tangent end faces, open contours, ellipses and spline edges produce an explicit diagnostic. Choose another plane or offset; unsupported curves are never silently replaced with line segments. This is one planar section, not taper or four-axis machining.

## Save, exchange and recover

- **Save** writes to browser cache or the connected folder with conflict detection. Another tab's edit is never overwritten silently. If storage changed, export your draft and reopen the saved document before retrying.
- **CAD JSON** preserves parameters and feature history. Import assigns a fresh identity, protecting existing saves.
- **STEP** exports exact solid geometry; **STL** exports a tessellated solid. Neither carries this application's editable history.
- **DXF** exports the selected sketch in local millimetres, excluding construction profiles.
- Full workbench backup includes saved CAD documents. Unsaved drafts are outside backup.

Browser download requests do not prove a file was saved to disk. CAD JSON files are limited to 4 MiB, with bounded features, profile complexity and pattern instances. Keep a portable CAD copy before extensive experiments.

## Work with an agent

The [agent tools guide](agents.md#cad-workspace) describes the same operations as the interface. Agents read the draft version, import or edit typed documents, measure analytic sketch geometry, build and inspect volumes/bounds, save, and send a sketch or final-solid section to CAM. Finish or cancel active drawing, feature editors and section dialogs before agent mutations.
