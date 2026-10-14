# CAD design

Open **Design in CAD** from Start Work. The part tree floats directly over the design area, with Reference, Parameters and Model branches. Expand a feature to see its profiles, inputs and later features that use it. The selected contour has its own highlight; the parent sketch shows editing context. Selection in the tree and viewport stays correlated. Nothing is uploaded to a modelling service.

**Sketch** is the first modeling command. Select an XY, XZ or YZ row in Reference, or an active datum plane in the tree or design area, then choose Sketch to start drawing there. With no plane selected, Sketch shows the reference planes in the design area: click a plane patch or its label. Choosing the plane creates one undoable empty sketch and opens it for drawing. Escape or Cancel while choosing a plane leaves the document unchanged. Selection alone never creates geometry. Double-click a sketch in the tree to edit it again.

The contextual tool dock sits at the bottom. Configuration floats at the bottom right, so changing selection does not resize or recenter the canvas. Minimize it to keep the part visible. Finish sketch uses the checkmark in its panel header. Click **View** below the dock to reveal view, grid and selection controls, or sketch grid and snapping controls. The commands move up as that drawer opens; the canvas and camera stay in place. Escape from a drawer control closes it and returns focus to View. The transparent tree scrolls independently; empty space around its rows remains part of the canvas. Explicit Fit uses the space around the current tree, configuration and dock.

Mouse-drawn contours start as free geometry. Select a rectangle, circle or slot and choose **Dimension** to constrain width, height, diameter, radius, length or angle as supported by that shape. Size constraints leave placement movable. Annotations follow the corresponding sides, circular leaders or rotated slot axes. Existing parameter expressions remain driven without being rewritten. Select an annotation or its panel row to edit it. Value editing retains a shared parameter link. Edit expression explicitly changes this contour’s relation; Unlink expression freezes its exact current size while keeping its dimension. Removing a dimension keeps the current geometry and any existing expression link.

Drag a selected ordinary contour to move it with a live preview and one undoable release. **Move** also accepts exact translation distances without changing sizes or dimensions. **Sketch fillet** rounds all four corners of a selected rectangle using one tangent radius, limited by its smaller side. Generator profiles, including Spur gear, keep their correlated configuration. Their on-part controls are profile parameter shortcuts. Polygon and line/arc paths have exact geometry editing; general coincidence, tangent and arbitrary path dimension solving are not currently supported. Invalid or unfinished edits block conflicting actions. Apply creates one undo step; Escape or Cancel keeps the original part.

## Navigation and context actions

Open **Settings → CAD** for horizontal **Navigation** and **Display** sections. Navigation remembers your input device for this browser. Mouse mode uses left drag to orbit in 3D, right drag to pan and the wheel to zoom. Trackpad mode uses two-finger scroll to pan, pinch to zoom and Alt + two-finger scroll to orbit in 3D. Sketches keep their plane orientation. Gestures over a settings or configuration panel scroll that panel normally.

Display controls **On-part dimensions**, the editable dimension labels beside selected constrained sketch geometry. Hiding them keeps dimension actions, configuration and parameter links available.

Right-click a feature or profile in the tree for Rename, configuration, construction, suppression and deletion actions. F2 renames the focused feature or contour. Keyboard users can press Shift+F10 or the Context Menu key on the focused target. Escape closes a menu and returns focus. A stationary right click opens context actions; dragging with the right button pans the view.

Editing a feature previews the candidate part before Apply. Read-only camera navigation remains available during the edit. Native geometry must finish checking before Apply becomes available. Apply accepts one history step; Cancel restores the accepted part and its exact selections. The current document and saved files remain unchanged while a candidate is being previewed.

## Document parameters

Expand **Parameters** in the tree to see grouped document values and their active uses. Plugin-created values have an origin icon and automatically belong to a named group. Create or rename groups to organize the design. Ungrouping keeps every value. Renaming a parameter updates dimension expressions without changing embedded plugin definitions.

Select a value or local profile input to inspect affected geometry. Unused values and dormant automatic inputs are marked separately. A profile can have a local override even when the document has a similarly named parameter; the panel shows both sources explicitly. **Add parameter** and row editing open a small floating editor beside the tree.

Info buttons explain fields when needed. Gear help illustrates the current part's pitch/base/root circles and generated tooth roots. The parameter editor and configuration retain typed expressions through validation errors.

## Plugin profiles

Open **Plugins**, search the real profile library and choose **Add**. A profile goes into the selected sketch, or a new sketch when none is selected. Its compact configuration floats beside the canvas. Driving dimensions appear first; X, Y and rotation share one row. Calculated pitch and outside diameters are read-only. Advanced inputs, cutter guidance and package details are separate disclosures.

Driving fields show evaluated numbers. Editing an exact named binding updates the parameter without unlinking it. **fx** opens its expression; **Keep relation** accepts the pending binding, while **Use current value** explicitly detaches it. Compound expressions remain read-only in the numeric field. Unfinished relation text blocks conflicting actions until kept or discarded. **Apply** validates the whole change before updating the part; invalid edits keep the prior geometry and offer Cancel. Bore holes remain ordinary nested circles, and thickness remains the Pad distance.

### Spur gear

Spur gear uses a full-depth generating rack to calculate involute flanks and rounded root transitions. Module is reference pitch diameter divided by exact tooth count. The rack's addendum coefficient is 1 and dedendum is 1.25. The gear root is the envelope of the moving rounded cutter tip. Its curvature varies along the transition. The equations follow [Wright's gear-generation derivation](https://danotes.mech.uwa.edu.au/gears/appendices.pdf).

Open **Tooth root** to configure the generating cutter. In v3, **Automatic** calculates the tool tip radius from clearance and available rack tip width. **Custom** enables a radius in millimetres within the dependent limits. Smaller radii may require more profile shift to avoid undercut; Automatic shift updates accordingly. This controls the rack-generated root transition, whose local curvature varies. Existing v2 profiles show their calculated tool tip radius. **Configure tooth root** prepares an explicit v3 upgrade; Apply accepts it, Cancel keeps v2.

Automatic profile shift recomputes the minimum correction needed to avoid undercut when teeth, pressure angle, tooth thinning or the generating cutter radius change. Manual mode enables the shift coefficient and enforces its dependent limits. **Curve accuracy** controls the maximum curve approximation error in millimetres. Automatic follows the module; Custom enables your requested tolerance. Disabled fields show their applied automatic values and retain dormant manual expressions. **Calculated dimensions** reports the root/base circles, pitch, tip thickness and applied shift/accuracy. These results cannot be edited independently.

The supported range is 12–300 teeth, module 0.05–50 mm and pressure angle 14.5–30 degrees, subject to valid geometry and the shared 8,192-edge modeling budget. Pointed or thin tips below 0.2 × module, undercut, overlapping roots, invalid expressions and excessive work are rejected. A large or very fine gear can require a larger Custom tolerance. Tooth thinning removes the specified pitch-circle thickness from this gear only; it is not a complete gear-pair backlash setting.

Involute and root curves use straight chords with a proven maximum deviation no greater than the applied tolerance. Root and tip circle arcs are exact. The sketch renders the connected profile as one continuous outline, retaining every modeling endpoint and exact arc. Reducing tolerance adds modeling edges, rather than creating more separately editable teeth. CAD systems can also approximate mathematical curves with splines, as described in [Open CASCADE's curve approximation documentation](https://dev.opencascade.org/doc/occt-7.5.0/refman/html/_geom_convert___approx_curve_8hxx.html). This app's generated gear currently uses chords, including in STEP and DXF. STEP preserves this modeled geometry. Nominal tooth geometry does not establish strength, fatigue, load rating, mating clearance or compatibility with a particular physical cutter. Review these with the actual application and tooling before manufacture.

**Module cutter guide** requires the numbering convention stamped on your set. The common eight-cutter sets number tooth ranges in opposite directions, so No. 6 can denote 17–20 or 35–54 teeth. A preset chooses a starting tooth count, not a unique gear or a measured cutter-tip geometry. A preset can update an exact named tooth-count binding. Compound tooth-count expressions remain controlled by their referenced parameters.

Legacy v1 parts keep their radial root extensions and original package. **Upgrade rounded roots** creates a pending v2 configuration with the existing expressions and manual settings retained. Inspect it, choose Automatic modes if desired, then Apply. Cancel leaves the original part intact; Undo restores the previous profile. Installing a package never upgrades parts implicitly.

### Authoring correlated recipes

Choose **Author or install a plugin** for a separate JSON editor. **Load recipe example** supplies a working API 2 polygon recipe with a calculated diameter and dependent radius limit. Change its identity/version and definition, then **Validate package** and **Install validated package**. Defaults, rules and generated geometry must be valid before installation. Exact source text is retained in browser cache or the optional folder. A conflicting ID/version cannot overwrite an installed original.

An edited recipe must use a new ID or version if its identity already belongs to a bundled package. Installation rejects conflicting definitions before writing. A conflicting package stored by an earlier preview is preserved and reported in the library diagnostics.

API 1 packages remain supported. API 2 adds `rules.derived`, `rules.fields` and `rules.constraints`. Derived values can reference other derived values; cycles and unknown names fail. Each editable input has one field rule specifying its group, dependent minimum/maximum, optional numeric choices and `enabledWhen` condition. Conditions use `left`, `operator` and `right`, with `eq`, `ne`, `lt`, `le`, `gt` or `ge`. Constraints add an actionable `message`. A disabled input retains its stored value; a recipe author must explicitly use derived relations to determine the effective geometry value. Derived values belong in rules, not editable profile inputs.

Recipe arithmetic allows `sin`, `cos`, `tan`, `sqrt`, `atan`, `abs`, and two-argument `min`/`max`; trigonometric angles are radians. `pi` is available in relations, with `index` and `count` additionally available while generating vertices. There is no JavaScript execution, network, file or application-state access. Geometry uses the ordinary closure, intersection, nesting, budget and native-build checks. Recipes can use Pad, DXF and sketch-to-CAM workflows.

Saved instances embed the exact package and version. Earlier plugin API 1-only previews cannot read API 2 profiles; current readers preserve both. Installed machine packages, posts and saved CAM revisions are unchanged.

## Design a part

1. Create a sketch on XY, XZ, YZ or a datum plane. Draw a closed Rectangle, Circle, Polygon, Slot or line/arc Path. Dimension sets supported driving sizes; Move sets exact translation. Sketch Fillet rounds rectangle corners. Polygon and Path geometry have exact editors. Construction profiles remain visible for reference but do not enter solids or CAM exports.
2. Draw nested contours normally. Enclosed contours create voids; another contour inside a void creates an island. CAD determines these regions automatically. Touching, crossing and self-intersecting contours are rejected. To combine overlapping solids, use separate sketches and a solid operation.
3. Finish sketching and create a Pad (extrusion) or Revolve. Choose a sketch with material contours. Empty, suppressed or construction-only sketches cannot supply a solid. Pad supports signed Distance and symmetric extents; Through-all Pocket requires an XY, XZ or YZ sketch. New body, Join and Cut explicitly control whether material is created, added or removed.
4. Select a feature to edit its dimensions. Later features rebuild from the edited history. Open **Fillet / Chamfer** in the toolbar. Pick edges before Fillet or Chamfer to limit the operation, or choose all edges. Pick one planar face before Shell to open that face and hollow the body inward. Transform, mirror, linear/circular pattern and Boolean union/cut/intersection operate on solid bodies.
5. Save the document. Saved CAD documents appear in the CAD library. Returning to the workbench retains the in-memory draft; save before closing the browser or changing documents. A browser may warn before refresh or exit when CAD has unsaved content or a pending edit. This does not save the draft, and browsers cannot guarantee the warning on every exit.

Use isometric, top, front or right views, fit the part, and navigate with the viewport mouse controls. Rendering updates on demand. The solid engine loads only when needed, so its first operation can take longer. Rebuilding and failed models are labelled; export cannot silently use a failed history.

**Cut** in Pad, Revolve, Loft, Sweep and Boolean must intersect positive target material. A missed body, outward cut or contact-only tool reports a diagnostic; a cut that removes the whole target also rejects. Check the sketch or tool placement, extent, direction and target. Numerically unresolved material is rejected explicitly. The preceding valid bodies remain visible, with later features unevaluated and solid export blocked. Saved no-effect cuts accepted by an older preview may now show this diagnostic; their definitions are not rewritten. Through-all Pocket already uses the same material-evidence policy.

Use **Plane** for a translated or tilted sketch support. Choose its base plane, world origin and rotations around X, Y and Z, then Apply. Rotation turns the plane around its own origin in that world-axis order. These fields accept named parameters. Select the plane before creating a Sketch or Curve, or choose a preceding plane in the feature's placement field. Offset follows its normal; changing placement preserves local geometry. The small plane patch illustrates a reference, not a material face or a finite size.

Datum planes support Sketches, Curves, Pads, Revolves, Lofts with aligned local axes, and Sweeps with a section perpendicular to the rail start. Through-all Pocket currently requires a principal plane. Unsupported or numerically uncertain native placement is rejected explicitly; reducing distance from the world origin or simplifying the placement can resolve precision errors. Plane-only designs and references remain usable without loading the solid engine. Attaching a sketch directly to a changing solid face is not supported.

In sketch Select mode, click inside a contour or near its outline. Nested interiors select the innermost contour; construction geometry is selected by its outline. Picking uses the pointer position independently of grid snapping. Escape discards pending dimensions or parameter edits. Ctrl/Cmd+S saves only after those edits are applied or cancelled; Ctrl/Cmd+Z in a text field keeps its normal text-editing behavior.

For a polygon, use the Vertex picker in Properties to reach a point and edit X/Y. Previous/Next retains pending changes to other vertices. Apply accepts them together; Cancel discards the complete edit.

**Path** joins lines and circular arcs in one closed contour. Pick a start, then use **Line** to pick an endpoint, or **3-point Arc** to pick an endpoint followed by a point on the arc. The third point determines the arc's direction and short or long sweep. Switch modes while drawing. **Close profile** adds a straight closing edge when needed and accepts the whole contour as one undo step. Clicking the start alone does not save it. **Undo last** removes the most recent point or segment; **Cancel drawing** discards the pending path. On the focused canvas, arrows position the cursor, Space places a point, Backspace undoes and Escape cancels. Invalid closure retains the drawing for correction. Saved paths remain analytic and their segment dimensions can use parameter expressions.

Use **File → Rebuild model** if a cancelled operation or restarted worker invalidates an exact selection. The visible shape can remain available while its cached topology needs rebuilding; select faces or edges again after the rebuild.

CAD operation and rebuild failures appear as dismissible toasts. Open the notification bell to read them again during the current app session. Dismissing a toast keeps its notification. A failed feature remains marked in the feature tree; its tooltip gives the cause. Identical failed rebuilds do not repeat the same notification until the issue clears. When a rebuild stops, the preview contains only preceding valid features and exports of the incomplete solid remain unavailable.

Existing sketches and curves fit their geometry when opened for editing, including drawings far from the origin. Later dimension changes keep the current view; use **Fit** or **F** to reframe.

**File → Capture view PNG** saves the current sketch or solid viewport. The capture includes the current draft, which may be unsaved. Finish property edits and wait for the current solid rebuild before capture. The Agent panel in the notification bell keeps the captured PNG available to download again.

If 3D graphics are interrupted, the view redraws when the browser recovers. **Retry 3D view** creates a fresh view if needed, retaining the document and resetting the camera to Isometric. Capture is unavailable while graphics are lost.

If the CAD view itself cannot load, its recovery panel keeps the accepted document available. Use **Save current document** or **Download CAD document** before reloading the page. A download request is not confirmation that the browser saved the file.

## Parameters and history

**Curve** creates an independent open chain of exact lines and circular arcs. Choose a reference plane and offset, name it, then draw with Line or 3-point Arc. **Finish curve** accepts the complete chain as one undo step; Cancel discards its name, placement and geometry together. Curves can have sharp corners but cannot close, cross, overlap or touch themselves. Double-click a saved curve to inspect its planar view and edit its segment dimensions in Properties. Length, bounds and endpoints remain analytic, including parameter expressions.

Sketch outlines and Curves appear at their actual plane and offset in 3D. Before solids exist, all active sketches are visible; afterward, select a sketch or feature to reveal its source sketches. Construction outlines are dashed. Curves remain visible alongside solids. In Body mode, click a visible outline to select its feature; double-click its tree entry to edit. Sketch/Curve-only viewing and PNG capture do not load the solid engine. Curves are reference geometry, without material regions or machining roles.

Named parameters are numeric values. Dimensions accept numbers or expressions such as `width / 2`, `thickness + 3`, and `(pitch * 4) - diameter`. Expressions support `+`, `-`, `*`, `/` and parentheses, without executing JavaScript. Dimensions are millimetres; angles are degrees.

Modeling quantity fields show the evaluated value. Editing a simple named link changes its shared parameter, so dependent features follow it in the preview. Use **fx** to author or replace the relation; compound formulas stay read-only in the quantity field until you explicitly detach or change them. Unfinished input keeps the last valid preview visible and disables Apply. Apply keeps the correlated change in one Undo step; Cancel restores the accepted part. Dormant mode settings retain their stored values until that mode is chosen again.

Each accepted edit is one undo step. Undo/redo changes the draft without rewriting saved storage. History is bounded to 50 steps and a memory budget. Invalid edits leave the previous draft intact. Deleting a feature with dependents requires explicit cascade deletion; reordering must preserve dependency order.

**Pattern → Linear pattern** repeats a body by XYZ spacing. **Pattern → Circular pattern** repeats it around a world X, Y or Z axis through the entered centre. Count includes the original body. Angular extent is the total sweep: 4 instances over 360° appear at 0°, 90°, 180° and 270°; 3 over 180° appear at 0°, 90° and 180°. Negative extents reverse direction. Centres and extents accept parameter expressions. Copies are fused where they overlap, and the pattern replaces its source body. To create repeated holes, pattern a separate cutting body, then subtract that pattern with Boolean Cut. Patterns have 2–100 instances and share a 1,000 expanded-instance limit.

For a through hole or cutout, use **Pad / Pocket → Cut from body → Through all**. Choose the target and a direction from the sketch plane, or **Both directions** to cross the entire target. The displayed axis follows the sketch normal: +Z for XY, −Y for XZ and +X for YZ. The cut follows changes to the target thickness; it does not store an oversized depth. Nested contours keep their material/void meaning, and construction geometry stays excluded. **Distance** retains the existing specified-depth behavior. Switching extent is a pending edit until Apply; Cancel preserves the accepted feature.

Through-all rejects a cut that misses all material, erases the whole target, or cannot be confirmed at native precision. Its required target span is limited to one million millimetres. Failed cuts retain the preceding solid for inspection and block export until repaired.

**Loft** builds a solid between 2–16 ordered sketch sections. Create the sketches on the same reference plane with different offsets, or on datum planes with the same oriented local axes and normal. Add and reorder them in Properties. Their normal positions must progress in one direction; the app preserves the supplied order and any in-plane displacement. Datum section rows show the station measured from the first placed section, with authored offset and in-plane shift available on hover. Differently tilted, rolled or reversed section planes need explicit repair before applying. Each section needs one closed material boundary without holes. Construction geometry is excluded. Smooth uses fitted native surfaces; Ruled connects each pair of sections directly. Choose New body, Join or Cut as with Pad. If smooth fitting extends beyond the first or last section plane, adjust the section spacing or use Ruled. The resulting solid supports STEP/STL export and later features. Final-solid CAM sections still require analytic lines and circular arcs; unsupported fitted curves are rejected explicitly.

**Sweep** moves one closed sketch section along an open Curve. Place the sketch at the curve's actual start, perpendicular to its first direction. For example, a Curve on XY starting at `[0, 0]` toward +X uses a YZ sketch at offset `0`; a circle centred at `[0, 0]` in that sketch stays centred on the curve. Choose the Profile sketch and Curve, then New body, Join or Cut. Either source may use a datum plane. Their world placement governs alignment; the section and rail do not need the same plane or local axes. The source selectors expose placement details on hover. Both source features remain editable. Sweep preserves their placement and traversal; it does not move, rotate or reverse the sketch to fit.

The section needs one material boundary without holes; construction geometry is ignored. Line and circular-arc segments must meet tangentially. Sharp corners, uncertain placement and insufficient bend/return clearance give an actionable diagnostic. Clearance conservatively encloses the section in a disk around the curve start, so a wide or offset section can be rejected even when a more specialised sweep might work. Supported sweeps contain up to 64 curve segments, with section-edge count × curve-segment count at most 2,048. These limits keep native work bounded; the source Curve's larger limit is unchanged. Straight portions are extruded and circular portions revolved, preserving analytic native surfaces. Build diagnostics still govern export and exact section handoff.

Open **View** beneath the dock and choose Body, Face or Edge to change the selection filter. Ctrl/Cmd-click adds or removes edges on the same body. The inspector can also list exact topology for keyboard selection. A selection belongs to the current build and clears when that build changes. Saved edge and opening selections use geometric conditions with exact match counts: an ambiguous match fails rather than choosing an arbitrary edge. A tangent edge chain must be selected completely when the solid engine would propagate the operation along it.

In Body mode, expand **Inspect topology** to browse the exact edge list. Face and Edge selections show the geometry type and length or area. **Measurements** reveals detailed coordinates, normals and bounds when needed; close the inspector to leave more space for feature dimensions.

This release provides dimension-driven profiles and parametric feature history. It does not provide a general geometric constraint solver, assemblies, freeform surface authoring, arbitrary face sketching, or reconstruction of an imported solid's original feature history.

## Send a sketch to CAM

Select the intended sketch and use **File → Send to CAM**. The app saves the exact CAD draft first, then creates a new CAM project from that sketch's non-construction closed contours. Lines, circles, rounded corners and slot arcs stay analytic. Principal and datum-plane sketches transfer in their own two-dimensional coordinates, in millimetres.

**This transfers the selected sketch, not the silhouette or section of the final solid.** Later pockets, transforms, patterns and fillets do not change the original sketch's contours. Select the actual manufacturing sketch and review the result. CAD and CAM are separate editable documents after transfer; later CAD changes require a new handoff and never overwrite an existing CAM project or saved revision.

Review contour roles, material side, order, entry/exit and threading in CAM before generating output. Controller output still requires a saved CAM revision and a complete installed machine package. CAD does not infer feeds or change postprocessor formatting rules.

## Send a final-solid section to CAM

Select a solid and choose **File → Section for CAM**. Pick XY, XZ or YZ, then enter a plane offset (numbers or parameter expressions). The offset follows the plane normal: +Z for XY, −Y for XZ, +X for YZ. For a 10 mm deep XY pad, start with an XY offset of `5`.

Choose **Preview section** to inspect the final material boundaries, including cuts, patterns and Boolean operations. Changing the plane requires a new preview. **Send section to CAM** saves the source and opens a new CAM project with those exact plane-local contours. It uses the finished solid, while sketch handoff continues to use the original sketch.

Sections must cut through material and produce closed, unbranched contours made of lines and circular arcs. Tangent end faces, open contours, ellipses and spline edges produce an explicit diagnostic. Choose another plane or offset; unsupported curves are never silently replaced with line segments. This is one planar section, not taper or four-axis machining.

## Save, exchange and recover

- **Save** writes to browser cache or the connected folder with conflict detection. Another tab's edit is never overwritten silently. If storage changed, export your draft and reopen the saved document before retrying.
## Export DXF

Use **File → Export DXF** independently of the selected feature. Choose a sketch, an open reference curve, or a section through one current solid. The section option asks for a body, XY/XZ/YZ plane and an offset along its normal. Preview the closed contours before exporting. Plane normals are +Z for XY, −Y for XZ, and +X for YZ. This is an intersection at a height, not a silhouette projection.

Downloads use exact supported lines, circles and circular arcs in local millimetres. Section export recomputes the validated intersection for the pinned draft version. Unsupported elliptical/spline, tangent, open or branching sections are rejected. Export neither saves the document nor creates CAM. Construction profiles are excluded; source originals and the editable model stay intact. A download request does not confirm that the browser saved the file.

- **CAD JSON** preserves parameters and feature history. Import assigns a fresh identity, protecting existing saves.
- **STEP** imports and exports exact solid geometry. Imported bodies support subsequent solid operations; their original feature history is not reconstructed.
- **STL** imports closed faceted solids and exports tessellated solids. Choose millimeters or inches when importing because STL has no unit declaration. A mesh does not recover analytic curved surfaces. Imports accept one connected closed shell with 4–4,000 triangles; open, nonmanifold and multi-shell meshes are rejected.
- **DXF** imports exact closed contours as an XY sketch and exports a sketch chosen in **File → Export DXF**, in local millimetres, excluding construction profiles. Lines, circles and circular arcs remain analytic. Import uses declared units; choose source units when the declaration is missing. Unsupported curves, approximations, open contours, nonzero elevation and thickness are rejected. Select a segment in Properties to edit its line endpoints or arc dimensions, including parameter expressions. Apply validates the entire closed path; match adjacent endpoints when editing joints. Typed agent operations use the same validation.
- For an open DXF chain, choose **Import as → Curve**. The complete file must describe one connected open planar chain. Unsupported entities, nonzero polyline widths, branching and mixed open/closed geometry are rejected. Use **File → Export DXF**, choose **Reference curve**, and select a Curve to retain its ordered lines and circular arcs in an open polyline, in local millimetres. Its reference plane and offset remain in CAD JSON; DXF exchanges its local 2D geometry.
- Full workbench backup includes saved CAD documents. Unsaved drafts are outside backup.

Imported STEP, STL and DXF originals remain embedded in the CAD document. Each source is limited to 2 MiB; the entire CAD JSON document, including originals, is limited to 4 MiB. Native topology is limited to 10,000 faces/edges per body and 25,000 per build. Sketch complexity and pattern instances also have limits. Browser download requests do not prove a file was saved to disk. Keep a portable CAD copy before extensive experiments.

## Work with an agent

The [agent tools guide](agents.md#cad-workspace) describes the same operations as the interface. Agents read the draft version, import or edit typed documents, measure analytic sketch geometry, build and inspect volumes/bounds, save, and send a sketch or final-solid section to CAM. Finish or cancel active drawing, feature editors and section dialogs before agent mutations.
