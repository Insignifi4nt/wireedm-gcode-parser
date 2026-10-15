# Sketch workflow implementation reference

Research date: 2026-10-16. Local source snapshot: `01e6380987091862513d50359c0975f19254c307`, on `feature/sketch-workspace-polish`.

## Recommendation and scope

Make the ordinary editing loop complete before adding a larger tool palette. A person must be able to identify a point, segment, contour or bounded area, select it without moving something else, change its free geometry, add precise intent, understand why an edit is blocked, and undo or cancel the operation.

The current app already has useful foundations: exact analytic geometry, expression-aware dimensions, contour translation previews, guarded commits, and undo. The missing everyday behavior is finer selection and shape manipulation. Full cross-entity constraint solving is a separate domain change. Initial rectangle and circle grips can use the existing scalar model without waiting for that solver.

The recommendations below are our implementation judgment. Vendor behavior is evidence for the choices, not a requirement to reproduce every CAD command or shortcut.

## Evidence limits

- This is documentation research and static source review. External CAD products were not operated, and neither app browser checks nor tests were run for this note. Existing tests cited below were read as specifications, not reported as passing.
- Sources are official help, official documentation repositories, or identified vendor publications. Some SOLIDWORKS pages returned a JavaScript shell when opened; their substantive text was available in the search index of the official versioned help pages. Treat those as documented behavior, with weaker retrieval evidence than the fully readable Onshape and Fusion pages.
- FreeCAD's wiki rejected automated reads. The cited files are in the official FreeCAD organization, but that documentation repository is archived and its pages contain release-specific annotations. They support the described workflow, not a claim about every detail of the latest FreeCAD release. [Official repository status][fc-workbench]
- CATIA V5, 3DEXPERIENCE CATIA and xDesign are distinct product contexts. The accessible official course catalog and xDesign introduction establish broad sketch capabilities. A vendor-hosted R2019x feature note gives a specific, historical SmartPick behavior. This investigation did not verify the complete current CATIA command reference or exact present keyboard/menu behavior. [CATIA course catalog][catia-course], [xDesign introduction][catia-xdesign], [R2019x SmartPick note][catia-smartpick]
- A documented command is not evidence that users find it intuitive. The usability proposals here need browser task checks with the app. No comparative speed, solver accuracy, accessibility conformance or performance benchmark is claimed.
- Source review describes the snapshot above. Concurrent local implementation may supersede individual gaps.

## Comparison matrix

These are selected, documented behaviors useful to this app. An unmentioned capability is unassessed, rather than absent.

| Product | Selection and direct editing | Precision and diagnosis | Practical lesson for Wire EDM |
| --- | --- | --- | --- |
| Onshape | Curve and region highlights are distinct; click selection toggles/adds, empty space clears, and directional boxes distinguish enclosed from crossed entities. [Selection][os-selection] | Constraints can be applied before or after entity selection. Constraint inspection highlights associated geometry. [Working with constraints][os-constraints] | Show which kind of object the next click will select; make relation ownership inspectable. |
| Autodesk Fusion | Filters independently include sketch points, curves, profiles, dimensions and geometric constraints. [Selection filters][fusion-filters] | Dimensions distinguish editable drivers from calculated reference measurements. [Dimensions][fusion-dimensions] | A Filter disclosure should change actual hit eligibility. A readout must say whether it changes geometry. |
| SOLIDWORKS | Dragging can stretch an endpoint, a rectangle side or a vertex. Selection filters have enable/disable and clear controls. [Dragging][sw-drag], [Selection filter][sw-filter] | Sketch status separates under-defined, fully defined, over-defined and failed/invalid solutions. [Sketch states][sw-states] | Whole-contour translation is only one drag operation. Explain both remaining motion and rejected changes. |
| CATIA / 3DEXPERIENCE | The R2019x SmartPick note distinguishes a snapped preview from creation of a persistent relationship, controlled by options and eligible visible background geometry. [Historical feature note][catia-smartpick] | Official CATIA V5 training includes sketch analysis, profile editing and constraint-based dimensions; xDesign introduces profiles, constraints and transforms. [Course catalog][catia-course], [xDesign introduction][catia-xdesign] | Explicitly separate snapping from saved constraints. Do not infer current detailed CATIA behavior from the short publications. |
| SketchUp | Edge/face selection, connected selection, modifiers and directional boxes make selection scope explicit. [Selecting geometry][su-selection] | Move uses a chosen reference point, visible inferences and optional typed distances/coordinates. [Moving entities][su-move] | Show the anchor, target and live measurement of a move. SketchUp is an inference/direct-modeling reference here; no parametric solver parity is claimed. |
| FreeCAD | Edges, endpoints and centers can be chosen individually through the Elements list. [Sketcher dialog][fc-dialog] | Solver messages identify remaining degrees of freedom and select implicated geometry or constraints. Snapping alone does not add constraints. [Sketcher dialog][fc-dialog], [Workbench][fc-workbench] | Provide an alternate precise selection route and actionable diagnostics. Keep snap and constraint policies independent. |

## Current app map

The evidence in this section is local code and test specifications at the recorded snapshot.

| Area | Existing behavior | Gap and implementation implication |
| --- | --- | --- |
| Selection identity | `createCadSketchProfilePicker` returns a profile ID. It checks exact line/circle/arc boundaries before an interior fallback, chooses the smallest containing nonconstruction contour, and uses a six-pixel boundary tolerance. [Picker][local-picker], [Picker specifications][local-picker-tests] | It cannot express an endpoint, center, individual segment, dimension or selection set. Extend the typed result and hit preparation before exposing those pick filters. Preserve the existing exact boundary math and zoom behavior. |
| Contours versus material areas | `CadSketchProfile` owns a contour. `CadSketchCellReference` separately identifies a bounded cell with its immediate voids and full nesting ancestry. [Document model][local-document], [Region selection][local-regions] | An interior click that selects a contour is not automatically a selected pad/pocket area. Keep contour edit selection separate from material-region selection and retain stale nesting rejection. |
| Geometry identity | Profiles have IDs; polygon vertices and path segments currently have coordinates and array positions. Line endpoints are stored per segment, and arcs use center/radius/start angle/sweep. [Document model][local-document] | Version-scoped semantic handles can support an initial primitive grip. Saved point/segment relationships require a stable identity and topology-change policy. Raw array indices cannot silently retarget a saved constraint after trim or split. |
| Dragging | A selected nonplugin contour can preview a snapped translation and commit one accepted edit. Changes in document version, view, tool, selection, lock, pointer ownership or cancellation invalidate the gesture. [Canvas][local-canvas], [Direct manipulation specifications][local-drag-tests] | There is no endpoint stretch, segment edit or radius/width grip. Add those through shared domain operations while preserving the current gesture ownership and rollback rules. |
| Dimensions | Rectangle width/height, circle radius/diameter, and slot length/width/angle have explicit dimension intent. Numeric drawing values remain free. Arithmetic and named expressions remain authoritative. Radius and diameter share one size field. Polygon/path/plugin quantities are unsupported by this dimension model. [Constraints][local-constraints], [Dimension specifications][local-constraint-tests] | This is a quantity-lock model, not a general geometric relation solver. A dimension count does not prove a sketch has zero remaining degrees of freedom. Position dimensions and line/arc relationships need explicit models. |
| Expression safety | A named dimension edit updates its parameter; a compound expression cannot be silently replaced by a numeric dimension edit. Removing dimension intent retains its expression. Explicit unlink evaluates the present size. Translation rejects only expression-driven axes that actually change. [Constraints][local-constraints], [Dimension specifications][local-constraint-tests] | Keep these distinctions in grips and diagnostics. Call an expression link a driver or linked expression; a CAD reference dimension means a calculated measurement and is a different concept. |
| Drawing and snaps | Tools create rectangles, circles, slots, closed polylines and closed line/three-point-arc paths. A separate Curve feature holds an open reference path. Grid snapping and a pixel-scaled path-start closure snap exist. [Interaction helpers][local-interaction], [Canvas][local-canvas], [Document model][local-document] | There is no general endpoint/midpoint/center/intersection snap candidate system or persisted inferred relationship in these helpers. A same-sketch open construction line also needs an explicit representation; a separate Curve is not automatically such a line. Reuse exact geometry and add visible snap reasons. |
| Edit tools | The sketch dock offers dimensions, whole-profile move and all-corner rectangle fillet. Construction is profile-wide. Body mirror and body patterns exist outside sketch editing. [Workbench][local-workbench], [Profile panel][local-panel] | Body operations do not supply sketch mirror/pattern tools. General sketch trim, extend, split, offset, projection and selected-corner treatment need actual domain operations and previews before controls. |
| Recovery and access | Accepted edit batches are undo steps. Canvas drawing supports arrows, Space/Enter, Backspace, Escape and fit. Context menus accept pointer or keyboard invocation; editors own Escape; app shortcuts avoid typing targets. [Session][local-session], [Canvas][local-canvas], [Workbench][local-workbench] | Preserve keyboard ownership and cancellation as finer selection is added. Existing contour translation is already tested against many stale/cancel paths; do not rebuild that behavior as separate unguarded handlers. |

## Interaction contract to implement

### Select the intended geometry

Fusion's filter list is useful because points, curves and profiles are separate selectable types. Onshape's documentation also shows curve and region hover as different outcomes. [Fusion selection filters][fusion-filters], [Onshape selection][os-selection]

For this app, use a discriminated selection with sketch/profile ownership, the current document version, and a precise kind. Initial kinds can be contour, segment, endpoint and center, followed by dimensions and constraints when their operations exist. A derived bounded region keeps its existing cell reference rather than borrowing a contour ID.

Apply filters before choosing the nearest eligible candidate. Make hover match the object a click will select, retain a screen-space pick radius, and give crowded or coincident geometry an explicit candidate chooser. A list or inspector should let the user select a specific endpoint or segment when a pointer cannot disambiguate it. FreeCAD documents this alternate route with separate element-edge, start, end and center controls. [Sketcher dialog][fc-dialog]

Recommended app policy: plain click replaces the set, Ctrl/Cmd-click toggles, blank click clears, and an empty-space drag makes a box. Left-to-right encloses; right-to-left crosses. The box direction convention appears in both Onshape and SketchUp. Their click/modifier conventions differ, so our help must describe our own choice. [Onshape selection][os-selection], [SketchUp selection][su-selection]

Always show the active selection kind and count. Changing a filter must not modify geometry or silently reinterpret an already-selected segment as its whole contour. Commands validate the existing selection's kind and explain any needed replacement.

### Move and reshape what is free

SOLIDWORKS documents both whole-entity movement and endpoint/side/vertex stretching. Its sketch-state guidance says that constraints restrict the motion. [Dragging][sw-drag], [Sketch states][sw-states]

Keep whole-contour move available. Add distinct visible shape grips so a rectangle corner changes its free size, a side changes the corresponding free extent, and a circle center/radius can be manipulated separately. Preserve primitive identity where the operation still represents that primitive. Decide and test the fixed anchor of each grip, including the opposite corner/side for rectangle resizing. Crossing an anchor must have an explicit normalization or rejection policy, without jumping the selected handle to an unrelated corner.

A width dimension prevents a resize grip from changing width; it does not prevent a separate move operation from changing free X/Y placement. An expression-driven X coordinate can block X motion while leaving Y available. Show the free or locked components before committing. Never infer that every size has been locked because one annotation exists.

Every drag captures one accepted revision, previews without persistence, and commits one validated batch on release. Escape, pointer cancellation, capture loss, unmount or an incompatible revision restores the accepted state without an undo entry. Preserve the current selected-contour click threshold and its suppression of the click generated after a completed drag. These are existing app behavior, not speculative polish. [Direct manipulation specifications][local-drag-tests]

### Add intent and explain solve state

Onshape supports coincident, horizontal/vertical, parallel, perpendicular, tangent, equal, concentric, midpoint, symmetric and fixed relations, with related-geometry highlighting and constraint inspection. Its status indicators distinguish remaining freedom from conflicts. [Working with constraints][os-constraints]

The core relation set for our line/arc geometry should begin with coincident, horizontal/vertical, fixed point, equal length/radius, parallel/perpendicular, tangent and concentric. Midpoint and symmetry follow once their inputs and diagnostic behavior are complete. Each relation needs explicit eligible operands and independent deletion. Do not present a list of relation buttons whose handlers only change tool state.

Use honest states: free components known to the primitive model today; under-constrained, fully constrained, conflicting/redundant and failed solve when a solver can establish those results. FreeCAD distinguishes convergence failure from constraint conflicts and exposes the implicated items through clickable messages. [Sketcher dialog][fc-dialog]

A failed solve leaves the accepted geometry untouched, retains the user's attempted values, and identifies involved constraints and geometry. Redundant, conflicting, invalid geometry and missing reference are different repair paths. Avoid the misleading fix of silently deleting an old relation or freezing everything in place.

### Dimension in the canvas

Onshape and SOLIDWORKS derive a dimension from the selected entities: a line length, point distances, angle between lines, circle diameter or arc radius. Placement can choose a horizontal/vertical/aligned measurement or angle region. [Onshape dimensions][os-dimension], [SOLIDWORKS 2D dimensions][sw-dimension]

For our existing primitives, keep direct dimension annotations and the inspector editing the same authoritative scalar. Extend selection-driven dimensioning to endpoints, segment length, position from origin, angle and arc radius only when supported by domain operations. Display the proposed quantity and units before the value is accepted. Choosing a measurement must never silently switch from arc center to circumference or from horizontal to aligned distance.

Distinguish an editable driving dimension, a parameter-linked driver, and a calculated reference measurement. Fusion's driven dimensions are read-only measurements that update with geometry and are visually distinct. [Fusion dimensions][fusion-dimensions] A second circle radius/diameter request should offer measurement/reference behavior when that capability exists, or explain the existing driver. Preserve the current atomic rejection in the meantime. A released dimension retains the current shape; unlinking a formula remains a separate deliberate operation. [Current dimension specifications][local-constraint-tests]

### Snap with visible reasons

SketchUp documents endpoint, midpoint, intersection and center inferences with labels and visual cues. Onshape previews alignment and relation inferences and supplies temporary suppression. [SketchUp drawing concepts][su-inference], [Onshape inferencing][os-inference]

Add exact endpoint, center, midpoint and on-entity snaps first, then intersections and horizontal/vertical/tangent alignment. Rank geometry snaps and grid snaps explicitly, show a glyph and short label, and keep their acquisition distance stable in screen pixels. Offer temporary suppression without destroying the user's persistent snap setting.

Treat grid rounding, geometry snapping and automatically saved constraints as separate policies. FreeCAD explicitly says snapping does not by itself create constraints. The historical CATIA SmartPick note describes users mistaking a snapped preview for a saved relation. [FreeCAD workbench][fc-workbench], [CATIA SmartPick note][catia-smartpick] Our feedback must say when a click creates a relationship, and the resulting relation must be inspectable and removable.

### Edit and reuse geometry

| Tool | Documented reference behavior | Proposed app contract |
| --- | --- | --- |
| Trim, extend and split | Fusion previews the affected portion for trim/extend and break. Its trim deletes the entity when no intersection exists; extend cannot proceed without an intersection. [Modification tools][fusion-modify], [Trim/extend][fusion-trim] | Preview the exact removed/added portion and changed endpoints. Start with explicit nearest-boundary behavior. Preserve surviving IDs and constraints where valid; report invalidated dependencies before commit. Empty/ambiguous targets cannot become unrelated profile deletion. |
| Offset | Onshape accepts individual curves or loops with direction and distance. Fusion associates offset geometry with its parent and exposes unlinking. [Onshape offset][os-offset], [Fusion modification tools][fusion-modify] | Start with exact line/arc contours, signed distance and a visible side. Detect degeneracy or self-intersection. State whether the result is an independent copy or an associative offset. Do not use this sketch tool as a substitute for post-controlled machining compensation. |
| Project/reference | Onshape Use projects edges into the active plane and updates them with their source, subject to documented topology limitations. [Use][os-use] | Select source, preview projection, retain source identity and diagnose broken references. An explicit independent copy is a different operation. Keep existing imported DXF lineage intact. |
| Mirror | Onshape accepts selected sketch entities and a mirror reference, with selection before or after tool activation. [Sketch mirror][os-mirror] | Show source set and axis, preview reflected geometry and declare which relationships remain associative. This is separate from the existing body mirror. |
| Linear/circular pattern | Onshape sketch patterns expose count, distance/angle and later pattern editing. [Linear pattern][os-linear], [Circular pattern][os-circular] | Define whether count includes the original, how angle extent is distributed, and how deleted instances behave. Keep a pattern record if it is advertised as editable/associative; otherwise name it a copy operation. |
| Fillet/chamfer | Fusion chooses a vertex or eligible curve pair and previews a radius or chamfer distances/angle. [Modification tools][fusion-modify], [Chamfers][fusion-chamfer] | Keep the current rectangle all-corners action accurate. A selected-corner tool must modify the chosen corner only, preserve line/arc exactness and reject an impossible size before mutation. |
| Precise transforms/copy | SketchUp Move exposes a reference point and typed displacement. Onshape Transform supports commit/cancel but can alter constraints for some transforms. [Move][su-move], [Transform][os-transform] | Reuse whole-profile translation, then add anchor-to-anchor movement and exact rotate/copy. Preserve existing expression bindings. If a transform cannot retain a relationship, explain the proposed loss before acceptance rather than copying another product's deletion policy. |

Construction is editable helper geometry excluded from material boundaries. Onshape supports both drawing in construction mode and converting selected entities; Fusion separately controls visibility of points, profiles, dimensions, constraints, construction and projected geometry. [Construction][os-construction], [Sketch palette][fusion-palette] Our profile-wide construction toggle already exists. Segment-level construction belongs with granular geometry ownership and must not accidentally open a material loop without a useful diagnostic.

### Recover and stay oriented

Onshape separates accepting a sketch from canceling its edit session; its transform also has explicit commit/cancel. SketchUp's line tool can cancel the current start point, and Undo restores accepted geometry changes. [Sketch basics][os-basics], [Transform][os-transform], [Drawing concepts][su-inference]

Our app currently accepts separate contour edits into the draft. Finish sketch therefore means leave sketch editing, while Cancel operation means discard the active unaccepted operation. Keep that distinction explicit. Do not make Escape silently delete previously accepted contours by copying a whole-sketch cancellation model.

Show the active tool, next expected input, current snap, and pending versus accepted state. Context menus should act on their displayed target, preserve unrelated selection, be keyboard-invocable, and close on Escape with focus restored. A context command and toolbar command must call the same validated operation. Dimension text, number fields, native pickers and input-method composition retain their keyboard ownership.

Shortcuts should be discoverable in tooltips and help. Onshape uses a sketch shortcut toolbar and SketchUp publishes its defaults; this supports discoverability, not copying an entire keyboard map into a browser app. [Sketch basics][os-basics], [SketchUp default shortcuts][su-shortcuts] Preserve the app's existing fit and drawing keys. Test browser shortcuts, editable fields and selection modifiers before assigning new letters.

## Priorities and acceptance scenarios

P0 restores trust in existing interactions. P1 completes practical selection and manipulation. P2 completes the baseline line/arc authoring workflow. P3 is optional expansion. The scenarios below are proposed requirements, rather than claims that the current build passes them.

| ID | Priority | Scenario and observable acceptance |
| --- | --- | --- |
| S01 | P0 | Select opens the appropriate working mode and Filter opens a real disclosure. Its labels describe currently supported target types; toggles change hit eligibility and show an active-state indication. Closing/reopening preserves the stated setting without document edits. |
| S02 | P0 | Two nested circles plus a construction contour are visible. Boundary hover/click selects the intended contour, interior selection follows the documented contour policy, and construction has no material-area hit. Repeat at different zooms and reversed profile order. |
| S03 | P0 | Select an existing free contour, click without appreciable movement, then drag it. The click creates no undo entry; drag previews one move and commits one step. Undo/redo restore exact geometry, expressions and dimension records. |
| S04 | P0 | Begin a move or dimension preview, then press Escape, cancel the pointer, lose capture, change revision or unmount the editor. No accepted edit leaks through; pending ownership and capture clear. A stale pointer release cannot overwrite a newer parameter change. |
| S05 | P1 | Hover the corner, midpoint of a side and interior of a rectangle. Each shows a distinct eligible target. Point-only and segment-only filters exclude the other kinds before nearest-hit ranking. A crowded-point chooser selects the intended owned point. |
| S06 | P1 | Select two segments with the modifier, deselect one, clear with empty space, and box-select in both directions. The selected-kind/count indicator and highlights match the exact set. Pan and drawing drags do not become box selection. |
| S07 | P1 | Resize a free rectangle by a corner/side grip, move a circle by its center, and change its free radius. Only the intended free scalars change; rectangle anchor behavior is documented, arc/circle geometry stays exact, and the gesture creates one undo step. |
| S08 | P1 | Add a rectangle width dimension, then try its width grip and whole-contour move. Width remains fixed while free placement still moves. With X linked to a parameter, Y-only motion remains possible and X motion explains the link without replacing it. |
| S09 | P1 | Move/resize near an endpoint, midpoint, circle center and grid location. The chosen snap has a label and visible target. Temporarily suppress it and resume. Repeat zoomed out and near large coordinates; snapping does not create unadvertised constraints. |
| S10 | P1 | Edit an existing on-canvas dimension using a number, named parameter and arithmetic expression. Enter/Apply commits the same operation as the inspector. Escape preserves the original. Updating a named driver updates all dependent geometry; an invalid correlated edit rejects atomically. |
| S11 | P1 | Finish a line/arc path with an off-grid start, undo its last draft segment, switch line/arc mode, and cancel a partial arc. No extra closing segment, zero-length remnant or partial contour persists. Keyboard and pointer routes produce equivalent exact geometry. |
| S12 | P2 | Select a polygon/path vertex and move it with connected segments. Shared joins remain connected, unrelated vertices stay put, and the contour either remains valid or the preview explains the invalid result. Stable selection survives non-topological edits. |
| S13 | P2 | Constrain two connected lines horizontal/perpendicular, add length and origin placement, then drag. Remaining freedom changes as expected. Selecting a constraint highlights its operands; deleting it releases only its intended relation. A fully-constrained status appears only when established. |
| S14 | P2 | Add a contradictory relation or driving dimension. The accepted sketch is unchanged, the attempted value remains available, and the message selects the conflict. A redundant constraint, invalid contour and nonconvergent solve get distinct messages. No old constraint is automatically removed. |
| S15 | P2 | Dimension a segment, two points, an angle and arc radius. Quantity, reference and units are visible before acceptance. A reference dimension reads the result without moving geometry; changing it to driving validates the new solve. Circle radius/diameter do not become competing drivers. |
| S16 | P2 | Trim and split a selected segment, then extend it to a chosen/nearest eligible boundary. Preview matches the exact changed portion. Cancel restores source geometry. Existing relationships either remain attached to the intended surviving entities or block with a specific repair message. |
| S17 | P2 | Offset a line/arc loop on both sides with typed distance, including a distance that collapses a small arc. Show the side and result, reject invalid geometry, and preserve the original. Associative mode follows the source; independent copy mode does not claim a link. |
| S18 | P2 | Project an eligible source edge, then modify or remove its source. The projection follows a valid source or exposes a broken reference. A separate independent-copy command preserves present geometry without pretending it remains linked. |
| S19 | P2 | Mirror selected sketch geometry about a construction line and create an editable pattern with explicit count/spacing. Preview, cancel, change count, delete one instance and undo. No body-level feature is silently substituted for sketch geometry. |
| S20 | P2 | Convert a selected helper segment to construction. It remains selectable and useful for dimensions/snaps but stops contributing to material. Material closure diagnostics and existing region references update or reject rather than quietly choosing another area. |
| S21 | P0-P2 | Invoke each available edit by toolbar and keyboard context menu, cancel, reopen and complete it. Focus returns predictably. Text entry, native selects, input-method composition, Save, Undo and browser navigation keep their intended owners. |
| S22 | P0-P2 | Save and reopen a changed sketch through browser cache and folder storage. Exact saved drivers, topology identities and references survive. Old contour-only documents retain their established geometry and behavior. Any schema upgrade follows the repository's validation/backup/retry rules. |

### Advanced optional capabilities

Keep spline/control-polygon editing, conics, curvature continuity, 3D sketches, motion/constraint animation, advanced block libraries, rich sketch text and automatic whole-sketch constraint suggestions out of the baseline commitment. They need their own geometry, persistence and usability work. Onshape's constraint list includes curvature; Fusion's palette includes 3D sketching; both are beyond the present exact planar line/arc model. [Onshape constraints][os-constraints], [Fusion palette][fusion-palette]

Automatic constraint proposals can be useful later. Fusion's documented AutoConstrain workflow lets the user inspect alternatives and optionally permit bounded geometry modification. Dassault lists CATIA Sketch Auto Constraint as a separate AI capability. Those sources support treating suggestions as an optional reviewable operation, not a prerequisite for normal sketch editing. [Fusion AutoConstrain][fusion-autoconstrain], [Dassault intended-purpose register][catia-ai]

## Implementation sequence and compatibility

1. Finish P0 with the existing contour model. Preserve picking, snap tolerance, guarded translation and the current meaning of Finish sketch. Use the focused picker, canvas, direct manipulation and dimension suites for affected behavior.
2. Add typed, revision-scoped subgeometry selection and primitive grip operations. Implement their domain checks before controls. Selection state need not become saved schema merely because the canvas can identify a rectangle corner or circle center.
3. Before saving general constraints, define persistent geometry identities and ownership, shared endpoints, relation operands, topology-change mapping, solver results and failure behavior. Preserve legacy analytic profiles and expression bindings. Do not silently flatten them into unrelated line collections or claim an inferred rectangle is fully solved.
4. Add each edit tool as a domain operation with preview and atomic commit. Cover exactness, canceled/stale gestures, constraint retention, invalid geometry and dependency repair. Copy/paste and transforms need explicit relationship transfer policies.
5. Update shared application operations and the public agent-tool guide with narrow typed arguments and input-version checks when these capabilities become agent-accessible. UI and agents must obey the same active-workflow, cancellation, expression and persistence checks.

No release/version bump, saved-data migration, post-processor change or public tool exposure is proposed by this research file alone. When implementation changes saved sketch data, apply the browser-cache and folder-adapter migration contract in [storage and migrations](../maintainers/storage-and-migrations.md). Installed post processors and existing saved revisions must retain the repository's compatibility protections.

## Sources

All external URLs below were consulted on 2026-10-16. Source titles in the body link to the supporting page. Version-qualified or historical sources retain their version in the discussion.

[os-selection]: https://cad.onshape.com/help/Content/Home/selection.htm
[os-constraints]: https://cad.onshape.com/help/Content/Sketch/working_with_constraints.htm
[os-dimension]: https://cad.onshape.com/help/Content/Sketch/dimension.htm
[os-inference]: https://cad.onshape.com/help/Content/Sketch/automatic_inferencing.htm
[os-basics]: https://cad.onshape.com/help/Content/Sketch/sketch_basics.htm
[os-offset]: https://cad.onshape.com/help/Content/Sketch/offset.htm
[os-use]: https://cad.onshape.com/help/Content/Sketch/use.htm
[os-mirror]: https://cad.onshape.com/help/Content/Sketch/sketch_mirror.htm
[os-linear]: https://cad.onshape.com/help/Content/Sketch/sketch_linear_pattern.htm?Highlight=pattern
[os-circular]: https://cad.onshape.com/help/Content/Sketch/sketch_circular_pattern.htm
[os-construction]: https://cad.onshape.com/help/Content/Sketch/construction.htm
[os-transform]: https://cad.onshape.com/help/Content/Sketch/sketch_transform.htm?Highlight=copy+sketch
[fusion-filters]: https://help.autodesk.com/cloudhelp/ENU/Fusion-Model/files/SLD-SELECTION-FILTERS.htm
[fusion-dimensions]: https://help.autodesk.com/view/fusion360/ENU/?guid=SKT-SKETCH-CREATE-DIMENSIONS
[fusion-palette]: https://help.autodesk.com/cloudhelp/ENU/Fusion-Sketch/files/GUID-4183A4B7-E002-4396-AD5A-7FF3C8B2F33A.htm
[fusion-modify]: https://help.autodesk.com/cloudhelp/ENU/Fusion-Sketch/files/SKT-SKETCH-MODIFY-TOOLS.htm
[fusion-trim]: https://help.autodesk.com/cloudhelp/ENU/Fusion-Sketch/files/SKT-TRIM-EXTEND.htm
[fusion-chamfer]: https://help.autodesk.com/cloudhelp/ENU/Fusion-Sketch/files/SKT-ADD-CHAMFERS.htm
[fusion-autoconstrain]: https://help.autodesk.com/cloudhelp/ENU/Fusion-Sketch/files/SKT-AUTO-CONSTRAIN.htm
[sw-drag]: https://help.solidworks.com/2025/english/SolidWorks/acadhelp/c_Dragging.htm
[sw-filter]: https://help.solidworks.com/2026/english/SolidWorks/sldworks/r_selection_filter.htm?id=2.12.4.1.26
[sw-states]: https://help.solidworks.com/2024/English/SolidWorks/acadhelp/c_Sketch_States_AcadHelp.htm
[sw-dimension]: https://help.solidworks.com/2025/english/SolidWorks/sldworks/t_Dimensioning_a_2D_Sketch.htm?id=28.19.1.0
[catia-course]: https://www.3ds.com/assets/edu/document/learning-experiences-for-catiav5.pdf
[catia-xdesign]: https://blog.3ds.com/brands/catia/catia-talk-3d-innovator-2-how-to-use-catia-xdesign-sketcher/
[catia-smartpick]: https://3dswym.3dexperience.3ds.com/post/catia-user-community/3dexperience-r2019x-newfunction-sketcher-automatically-create-constraints-when-snapping-during-drag-or-snapping-on-external-edges_j8ffHhZjQW6qSmjXyOh67Q
[catia-ai]: https://www.3ds.com/trust-center/trusted-ai/ai-intended-purpose
[su-selection]: https://help.sketchup.com/en/sketchup/selecting-geometry
[su-move]: https://help.sketchup.com/en/sketchup/moving-entities-around
[su-inference]: https://help.sketchup.com/en/sketchup/introducing-drawing-basics-and-concepts
[su-shortcuts]: https://help.sketchup.com/en/default-keyboard-shortcuts
[fc-workbench]: https://github.com/FreeCAD/FreeCAD-documentation/blob/main/wiki/Sketcher_Workbench.md
[fc-dialog]: https://github.com/FreeCAD/FreeCAD-documentation/blob/main/wiki/Sketcher_Dialog.md
[local-picker]: ../../src/features/cad/cadSketchPicking.ts
[local-picker-tests]: ../../src/features/cad/cadSketchPicking.test.ts
[local-document]: ../../src/domain/cad/cadDocument.ts
[local-regions]: ../../src/domain/cad/cadSketchRegionSelection.ts
[local-canvas]: ../../src/features/cad/CadSketchCanvas.tsx
[local-interaction]: ../../src/features/cad/cadSketchInteraction.ts
[local-drag-tests]: ../../src/features/cad/CadSketchDirectManipulation.test.tsx
[local-constraints]: ../../src/domain/cad/cadSketchConstraints.ts
[local-constraint-tests]: ../../src/domain/cad/__tests__/cadSketchConstraints.test.ts
[local-workbench]: ../../src/features/cad/CadWorkbench.tsx
[local-panel]: ../../src/features/cad/CadSketchProfilePanel.tsx
[local-session]: ../../src/features/cad/cadSession.ts
