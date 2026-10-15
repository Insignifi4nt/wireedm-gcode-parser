# Sketch interaction research

Research date: 2026-10-14. Scope: the six browser comments about sketch editing, dimensions, selection, panel placement and contextual tools. This note records documentation and source inspection. It does not claim browser verification or vendor feature parity.

## What the references establish

Onshape permits geometry to remain undimensioned after it is drawn. Typing a value or expression while drawing establishes a dimension; continuing without typing does not. Its active Sketch dialog opens a Sketch toolbar, and the dialog checkmark accepts the sketch. Selected sketch entities also have a context-menu transform command. These are useful references for separating drawing, explicit intent and editing context. [Onshape Sketch basics](https://cad.onshape.com/help/Content/Sketch/sketch_basics.htm).

Onshape distinguishes driving dimensions, which change geometry and can be edited, from driven reference dimensions, which report geometry and cannot be edited. Over-defining a sketch creates a driven dimension by default; forcing a conflicting driving dimension reports an error. Its Dimension tool places horizontal, vertical, length, diameter, radius and angle annotations on the relevant geometry. Circle dimensions use a diameter through the circle; arcs use a radius leader; angular dimensions occupy a chosen quadrant. [Onshape Dimension](https://cad.onshape.com/help/Content/Sketch/dimension.htm).

Onshape displays constraints for the hovered entity instead of showing every relation continuously. Selecting a constraint highlights its related geometry. Its documented colors distinguish hover, related geometry, underconstrained geometry, fully constrained geometry and errors. The distinction between these states matters more here than copying its light-theme colors. Its Fix constraint prevents an entity moving; a length or diameter dimension alone does not necessarily fix its position. [Onshape Working with constraints](https://cad.onshape.com/help/Content/Sketch/working_with_constraints.htm).

SketchUp's Dimension tool reports a line length, circle diameter or arc radius. Linear annotations are pulled perpendicular to the measured entity; circular annotations remain in the entity's plane. Dimension associations update with geometry. Overwriting displayed text breaks that association. Its annotation behavior is a useful reference; this documentation does not establish a parametric sketch constraint solver. [SketchUp Dimensions](https://help.sketchup.com/en/sketchup/adding-text-labels-and-dimensions-model).

Dassault's vendor-hosted CATIA course catalog explicitly teaches sketch drawing, constraint-based dimensioning, editing and analysis. The vendor-hosted CATIA PDG wiki describes variational sketching, automatic recognition, local constraints, direct dimensions, parameters and equations. It also documents an underlying DCM-2D solver. This establishes a substantive distinction between defining coordinates and solving a set of geometric relationships. It does not verify the current CATIA dialog layout. [CATIA course catalog](https://www.3ds.com/assets/edu/document/learning-experiences-for-catiav5.pdf), [CATIA PDG](https://3dswym.3dexperience.3ds.com/wiki/catia-user-community/catia-part-design-2-pdg_wUklCUysT4GXL-WVU4ZrWQ).

The official public 2020x xDesign guide categorizes its action bar by task and puts sketches and features in a design tree. These support contextual commands and tree context, but establish neither current CATIA sketch-corner behavior nor an exact visual specification. Current Dassault User Assistance could not be retrieved at the attempted 2026x sketch-constraint URL. Third-party CATIA help mirrors were found but are not used as primary evidence. [3DEXPERIENCE xDesign guide](https://dshelp-embed.3ds.com/2020x/english/xd_dashboard/SOLIDWORKS_XD_Tips.html).

Onshape's Sketch Fillet takes a vertex or two sketch curves, creates tangent rounds, and permits successive corners to share one radius. It preserves the original sharp intersection as reference geometry so existing coincident constraints retain a target. An excessive radius gets an invalid preview. Its solid Fillet instead takes edges or faces of a body, with an explicit tangent-propagation option. Sharing a command position and shortcut is reasonable; the selected object and editing context determine different operations. [Sketch Fillet](https://cad.onshape.com/help/Content/Sketch/sketch_fillet.htm), [Solid Fillet](https://cad.onshape.com/help/Content/PartStudio/fillet.htm).

## Current application model

Source inspection found the following before implementation of this request:

- `cadDocument.ts` defines rectangle, circle, slot, polygon, line/arc path and plugin profiles. Every coordinate or size is a `CadScalar`, either a number or a parameter expression. There is no general sketch constraint graph or solver.
- Rectangle geometry already guarantees axis-aligned opposite sides and has one uniform `cornerRadius`. Circle geometry has a center and radius. Slot geometry has a center, overall length, width and angle. Their geometric relationships are intrinsic to those analytic shape types.
- `CadSketchDimensionControls.tsx` creates Width/Height, Diameter or Length/Width chips merely because such scalar fields exist. It changes the underlying field or its named parameter. It does not record that the user constrained the shape.
- `CadSketchCanvas.tsx` positions those chips at one bounding-box anchor. They have no side-specific extension lines, diameter line, radial leader or angular arc.
- `CadFeatureEditor.tsx` exposes origin, size, corner radius and name in an ordinary profile form. Generic polygon/path coordinate editing remains the only precise editing route for those shapes.
- Line/arc paths store ordered segments without persistent segment IDs. Their endpoint continuity is validated as geometry. Changing a line endpoint or arc radius can break a closed chain; validation is not a coincidence or tangent solver.

The current chips are parameter shortcuts, not proof of constraint intent. Hiding them on free shapes is appropriate, but removing all exact editing before a replacement exists would reduce functionality.

## Minimal honest constraint foundation

These are local design recommendations, not statements about vendor implementations.

1. Preserve existing geometry scalars and expressions as the source of numeric truth. Add explicit per-profile dimension intent only when a user creates a dimension. A target should identify the profile and supported analytic field, with a discriminated driving/reference mode. A driving record can bind to that existing field rather than duplicating its value in a second independent store. A reference record derives its measurement and never writes geometry.
2. Mouse-drawn analytic shapes start with no authored driving dimensions. Their numeric coordinates are the current free geometry. Width can be explicitly constrained while height and location remain free. A circle diameter constraint locks its size while leaving its center free. Slot length, width and angle each constrain a different freedom. An axis-aligned rectangle has four placement/size freedoms, plus its optional uniform corner treatment; a circle has three and a slot five. These counts apply to the current analytic model, not to arbitrary connected sketch graphs.
3. Legacy omission must retain exact old semantics and bytes. Do not manufacture constraints, rewrite expressions, or normalize saved originals on open. A field linked to an existing expression remains linked even without new dimension metadata. Treat parameter linkage separately from user-created dimension annotations. Plugins retain their authored input relations; a gear is a generator-defined profile and its module/tooth controls should be identified as configuration controls.
4. Use the same validated operation for human dimensioning and agent edits. Creation, value changes, reference conversion and removal must validate target kind, document version, expression ownership and resulting geometry before one atomic edit. Never silently replace a shared expression with a literal. No-change acceptance must retain full precision and binding type.
5. For analytic-field dimensions, changes can be solved exactly through the existing shape representation. Avoid claiming generic coincidence, tangent, equal-length or fully constrained status for polygon/path profiles. Generic constraints need stable entity/endpoint references and actual equations with degrees-of-freedom and conflict analysis. Otherwise a radius change can detach an adjacent line while the UI claims it preserved a relation. A segment index plus current revision can support a transient editing target, but is insufficient as an indefinitely persisted relationship after insertion or deletion.
6. Removing a driving dimension releases that field for subsequent manipulation; it does not remove the shape or reset its size. Reference dimensions remain read-only measurements. Only show fully fixed status when every permitted freedom is accounted for by implemented constraints or a genuine Fix operation.

## Annotation and selection rules

| Geometry or state | Recommended local presentation |
| --- | --- |
| Free rectangle | No persistent size annotations. Show measurements on inspection, separate from constraints. |
| Constrained rectangle width | Extension lines from the two relevant side endpoints and a horizontal dimension outside the contour. Height uses the corresponding vertical side. |
| Circle diameter | A diameter line through the center, arrowheads at the circle and an `Ø` value. Preserve the existing radius-to-diameter factor of two. |
| Arc radius | Center-to-arc leader with `R`; generic path arcs require a validated target and continuity policy before driving edits. |
| Slot length/width/angle | Overall length along its local axis, width across it, angle arc about its center. Do not use horizontal bounding-box width for a rotated slot. |
| Linked dimension | Expression/parameter indicator and explicit binding inspection. Lock direct editing if the existing expression cannot safely be changed. |
| Selected profile | One selected row and one corresponding geometry treatment. Its parent sketch remains an editing context with a slim rail or icon, without the same filled selection background. |
| Hovered profile | A transient row/geometry treatment weaker than selection; hovering the child must not trigger the parent row's hover style through a container selector. |
| Constraint inspection | Highlight only its actual geometry targets. Keep unrelated profiles visually neutral. |

Annotation leaders should be computed from exact local geometry, then projected through the current view transform. Keep text and arrowheads in screen units. Clamp labels without detaching their leaders from the geometry. This avoids the current one-anchor chip layout while preserving pan and zoom correlation. Display, editing and annotation placement are separate concerns.

## Contextual tools and panels

- Put the configuration inspector on the left of the viewport by default, next to the tree. Keep it floating so opening, shrinking or selecting another item does not resize the viewport. Fit must use the resulting unobscured area. Parameter and tool editors should follow the same placement rule.
- Put Finish sketch in the active sketch inspector header as a checkmark with an accessible name and tooltip. Preserve the existing pending-edit guards. If the inspector is minimized, the compact header must still expose the checkmark. This action closes sketch editing; it must not silently discard a pending profile definition or unrelated inline dimension edit.
- In sketch mode, replace body-modeling commands with currently supported sketch commands. Select, Rectangle, Circle, Slot, Polyline, Path, Construction and supported plugin insertion are available. Curve creation remains a distinct supported context. Do not advertise unimplemented generic sketch Chamfer, tangent solving or freeform Transform as working commands.
- Rectangle's existing uniform corner radius can move into a contextual Sketch Fillet editor. Selecting that rectangle means all four corners; retain one scalar and preserve its expression. Arbitrary corner selection, path fillets and sketch chamfers need shared geometry operations before exposing those targets. Solid face selection can select that face's existing eligible boundary edges, with preview and normal stale-topology guards. Never infer all body edges from a selected face.
- Keep the gear cutter-tip radius in gear configuration. A rack-generated tooth root is not the same geometric operation as applying a constant-radius corner fillet to a finished outline.
- Remove profile name editing from the front-facing geometry configuration only after a real tree Rename action exists. Keep exact generic coordinate access available through an appropriate editor until direct manipulation and constraints replace it.
- Move view, grid and snap controls to the bottom-right viewport corner and remove the persistent prose navigation footer. Keep tool-specific prompts near the cursor or active tool panel, and keyboard instructions available through accessible descriptions or help.

## Behavior to verify before acceptance

Cover a free mouse-drawn rectangle without dimension annotations; explicit width with free height/location; circle diameter factor of two; rotated slot annotations; linked-expression preservation; reference measurement without mutation; constraint removal without geometry loss; stale/deleted/wrong-kind targets rejecting atomically; generic path edits preserving validated closure or failing without partial writes; selected child versus active parent styling; checkmark access with a minimized inspector and pending edits; left-side Fit; and contextual corner-radius edits with the same preview, Apply, Cancel and Undo rules as other geometry changes.

This research alone implements none of those behaviors. It provides the boundary between immediate UI repairs, exact analytic dimension intent, and the larger general sketch-constraint foundation.

## Updated requirement: specification tree over the viewport

The user's later clarification removes the dedicated left panel. The design area occupies the full workspace; the part specification tree sits directly over it. This supersedes any earlier interpretation that the tree requires a reserved sidebar column. Configuration and parameter editors can remain separate compact overlays on the left. The following evidence supports the interaction pattern without claiming current CATIA layout parity.

| Primary source | Verified behavior or available illustration | Limit |
| --- | --- | --- |
| [3DEXPERIENCE Simulation SolidPractices, User Interface Tips](https://3dswym.3dexperience.3ds.com/wiki/solidworks-news-info/getting-started-with-3dexperience-simulation-solidpractices_rFZtKhrBSdO2cIlYITOksg) | An unpinned tree appears when hovering its arrow. Graphics-area right-click and F3 control tree display. Tree product folders have hide/show context actions. Feature Manager commands are popups in the graphics area and can dock beside the tree. Figure 20 identifies native UI sections; Figure 26 shows the docked manager/tree arrangement. | The documented roles are native simulation apps. These details do not establish every current CATIA modeling role's default layout or opacity. |
| [Dassault xDesign 2020x dashboard guide](https://dshelp-embed.3ds.com/2020x/english/xd_dashboard/SOLIDWORKS_XD_Tips.html), [vendor Design Manager illustration](https://dshelp-embed.3ds.com/2020x/english/xd_dashboard/img/DesignMgr-static.png) | Sketches and features occupy a design tree; rollback returns to an earlier model state. The guide supplies its own Design Manager illustration. | This is an explicitly dated xDesign guide. Its illustration alone does not prove canvas resizing, pointer capture or transparency behavior. |
| [CATIA 2018x release illustrations](https://www.3ds.com/fileadmin/PRODUCTS-SERVICES/CATIA/PDF/3DEXPERIENCE-CATIA-R2018X-Whats-New.pdf) | The vendor release material includes a tablet product-tree/model interface illustration. | Marketing imagery from 2018x cannot establish current hover, keyboard or overlay implementation details. |
| [Dassault 3DXML Player annotation review](https://www.3ds.com/fileadmin/PRODUCTS-SERVICES/3DVIA/3DXML/dircopy_official/PlrUserMap/plr-t-Player-FtaBasicReview.htm) | The specification-tree view and annotation thumbnails are distinct. Tree context commands hide/show annotations. Selecting an annotation highlights it and opens a translucent balloon that becomes visible on hover. | This is the 3DXML Player, not CATIA Part Design. It supplies a documented contextual-information example, not a tree-opacity specification. |

The SolidPractices article links the actual [Tree and 3D Area User Assistance location](https://help.3ds.com/2024x/English/DSDoc/ComUserMap/exp3dbasics-m-Tree-sb.htm?contextscope=cloud). Retrieval redirected to Dassault authentication. No logged-in native session or current CATIA tree preferences were inspected. Vendor-hosted community questions about transparent trees are user reports, not verified vendor instructions, so they are excluded as evidence of defaults. The screenshot in the user's request establishes the desired local composition independently of that access limit.

### Local implementation consequences

These are implementation judgments for this application:

- The tree must overlay a full-size viewport. Opening branches, changing selection or opening configuration must not alter its canvas bounds, aspect ratio or camera. Rendering a transparent sidebar inside a reserved grid column would still violate the requested composition.
- Use the real part as the root and meaningful Reference, Parameters and Model branches. Parameter groups use saved names and plugin provenance. Keep dependency details under their actual feature; branch headers are organization, while ordered model entries carry rebuild history.
- A lightweight tree can use contrast directly behind labels and active rows without painting a full-height panel. Hover and keyboard focus may improve row contrast. The selected child has the selection treatment; its ancestor carries only editing context. Do not make a whole ancestor region look selected merely because the pointer is over a descendant.
- The overlay consumes pointer events only where a row, disclosure, scrollbar or active editor is interactive. Unoccupied space must remain available for canvas selection and navigation. Wheel input over the tree scrolls the tree; over the design area it uses the configured CAD mouse/trackpad behavior.
- Keep supported target actions in right-click menus and provide keyboard equivalents. The menu must release its workflow before running a guarded command. Tree preselection and selected geometry should identify the same target. Collapsing a branch must retain valid selection, constraints and model history.
- Parameters should be discoverable within the part tree, with a floating editor when selected. Opening that editor must retain the selected parameter's real geometry correlation. Agent inspection still uses complete IDs, provenance and guarded domain operations; display density does not limit the agent API.
- Explicit Fit can account for occupied overlays. Expanding, shrinking or hovering the tree must not trigger a new Fit. The local preference for transparency and row background strength comes from the requested design, not an asserted CATIA default.

Verify actual canvas bounds and camera identity before and after tree/parameter/configuration transitions, selection through empty overlay regions, tree-only scrolling, keyboard focus and context actions, and independent visual states for hovered rows, selected children and active parent context. The source illustrations cannot substitute for those local browser checks.
