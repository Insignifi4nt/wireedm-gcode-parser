# Interactive Usability Evaluation Notes

Date: 2026-07-14

Status: Active evaluation log. These observations are evidence for a later workflow redesign; they are not yet an approved implementation specification.

## Evaluation Context

- Evaluation is being performed interactively in the user's foreground Comet browser against the local Wire EDM Workbench.
- Current test project: `Prisma fixa 1 cog`, imported from `C:\Users\cristian\Documents\Catia\COGEME\Prisma\Prisma fixa 1 cog.dxf`.
- The project uses the verified Charmilles Robofil 100 v2 multi-contour candidate profile, with a 150 mm maximum width and 200 mm maximum length.
- The user wants the finished application to behave like a coherent CAD/CAM workbench: tools should be grouped by workflow and scope, opening a control should reveal a clearly related workspace, and the effect of every action should be visible where it occurs.

## Positive Observations

- The split/dropdown import control is liked.
- The Contour Tree is currently in good shape for describing contour hierarchy, contour composition, and cut-order numbering.
- The local-folder connection found the intended workbench folder without requiring the user to locate it again.

## Captured Confusion and Defects

### Workbench and project persistence

- Connecting an existing folder and seeing `0 projects` was surprising. The UI does not explain that browser-cache projects are separate and are not automatically migrated into a newly connected folder.
- A connected workbench can therefore look as though projects were deleted even when they existed only in another persistence scope.
- The application footer can show `Default Wire EDM` while the active project reports the Robofil v2 candidate machine. The difference between the workbench default and the project-pinned machine snapshot is not explained.

### Machine-profile setup

- The temporary/prominent `Robofil V2` profile-creation control is too visually dominant for a normal application workflow. It may be acceptable for testing, but it should not remain as a primary permanent action.
- Several machine-profile configuration fields are not self-explanatory. Their scope, controller consequence, and safe defaults need contextual explanations.

### Import workflow

- The `Import DXF as Path Project` action appeared to do nothing during the session. In this instance the Playwright extension had intercepted the file chooser, but the application provided no visible feedback that a picker had opened or that import was waiting for a file.
- Import actions need observable pending/cancel/error states so an intercepted, blocked, or dismissed picker does not look like a dead button.

### Transform workflow

- `Mirror document across X axis` produced the desired pins-up orientation, but the operation was difficult to verify from the Transform panel because mirroring around the document center leaves the numerical bounds unchanged.
- Axis terminology is ambiguous to a user: it can mean “reflect across this geometric axis” or “invert this coordinate.” The UI should describe the visible result, show the transform origin, and provide immediate before/after orientation feedback.

### Planning, geometry basis, role, and compensation

- Planning Mode, Geometry Basis, Compensation, and Contour Role are presented as one flat stack even though they have different scopes:
  - Planning Mode affects the document's operation order.
  - Geometry Basis affects the whole document's machining interpretation.
  - Compensation affects the selected operation.
  - Contour Role describes the selected contour and supplies an automatic compensation suggestion.
- The UI does not clearly distinguish document-level controls from selection-level controls.
- The relationship between Contour Role and Compensation is unclear. Role supplies an automatic suggestion, but a manual compensation decision is intentionally preserved instead of being overridden by later role changes.
- When Compensation changes from `Automatic` to a manual choice, the `Automatic` option disappears from the dropdown. This makes the state transition feel irreversible and hides how to return to role-derived behavior.
- A more intuitive design must expose an explicit `Use automatic recommendation` action or persistent option and explain which field is controlling the current result.
- Disabling Contour Role after a manual compensation choice was suggested as one possible signal, but it may incorrectly imply that the contour's semantic role no longer matters. The redesign must preserve the distinction between classification and machining intent while making their dependency visible.
- Similar context and consequence explanations are needed for Planning Mode and Geometry Basis, not only Compensation.

### Path Actions and operation editing

- Path Actions currently mixes unrelated categories in one panel:
  - document history and persistence (`Undo`, `Redo`, `Save`, `Export Preview`);
  - operation sequencing (`Move up`, `Move down`, planning strategy);
  - selected-contour semantics (`Contour Role`, Compensation);
  - machining setup (`Start`, `Pierce`);
  - point-construction/snapping modes (`Perpendicular`, `Tangent`);
  - geometry-basis policy.
- `Undo` and `Redo` are duplicated in the application header and Path Action Bar. The duplication creates uncertainty about whether they operate on different histories even though they refer to the same active-document history.
- `Move operation up` and `Move operation down` are placed beside Undo/Redo without a clear selected-operation context or a sufficiently visible result. The user cannot easily tell what moved, where it moved, or whether automatic planning is now overridden.
- The audit confirmed that operation up/down controls already exist on every row in the dedicated Cut Sequence panel. Their additional presence in Path Actions is a true duplicate, not merely a similar-looking action. Cut Sequence is the clearer behavioral home because it shows both the source row and resulting destination in the ordered list.
- `Set Start`, `Pierce`, `Perpendicular`, and `Tangent` are ambiguous in this location. Their targets, activation modes, required selection, and effect on the canvas are not clear.
- Perpendicular and Tangent are point-construction or snapping modes, not general path actions. Their current grouping obscures that distinction.
- The user no longer remembers exactly how these four controls work, which confirms they need guided activation states rather than relying on compact labels and prior knowledge.
- Pierce has a useful hover description, but Start, Perpendicular, and Tangent do not provide equivalent hover/focus explanations. Every compact or unfamiliar tool needs consistent help that states its target, prerequisites, effect, and next interaction.
- Source tracing confirmed that the four adjacent buttons do not form one coherent tool group:
  - `Start` activates a one-shot canvas mode for the selected closed operation. The next contour click selects or creates the operation's start point, then the mode exits.
  - `Pierce` immediately adds a cut lead-in from the center of an eligible full-circle contour to that contour's current start point. It is a contour machining action and depends on the selected circular operation.
  - `Perpendicular` creates a measurement/construction point on geometry from the latest measurement point; it does not modify the selected operation or create a toolpath lead-in.
  - `Tangent` likewise creates a tangent measurement/construction point from the latest measurement point and falls back to a nearest construction when an exact tangent is unavailable; it does not modify the toolpath.
- Perpendicular and Tangent therefore belong with Measurement/Construction tools, while Start and Pierce belong in a selected-operation setup workflow. Their current adjacency falsely implies that all four configure contour entry motion.
- Start and Pierce are related but distinct stages: Start chooses where cutting the contour begins; Pierce adds the approach/lead-in from the circle center to that existing start. The UI should show this dependency explicitly.
- The Contour Tree successfully describes geometry hierarchy and displays cut-order numbers, but it is not sufficient as the only place to understand or manipulate the operation sequence.
- Sequence editing needs a dedicated surface that presents the actual ordered operations, their relevant setup, and the result of reordering.

## Overall Product Risk

- The application has accumulated enough functionality that features can be duplicated, forgotten, or effectively undiscoverable.
- Controls do not consistently communicate whether they affect the document, selected operation, selected contour/segment, canvas interaction mode, machine profile, or exported program.
- Disabled controls often communicate only that an action is unavailable, not what must be selected or configured to enable it.
- Changes are not always reflected in an obviously linked location, so users cannot build a reliable cause-and-effect model.
- Even a user who built the application collaboratively is having difficulty predicting what each control changes. This is a workflow and information-architecture issue, not merely missing tooltips.

## Required Audit Before Redesign

Inventory every user-visible control and record:

1. Its current location and label.
2. Its actual domain command or state transition.
3. Its scope: workbench, project/document, operation, contour, segment, point, canvas mode, machine, or export.
4. Its prerequisites and why it becomes disabled.
5. Where its result is visible.
6. Whether it duplicates another control.
7. Whether it is still valid for the current product.
8. Its proposed workflow home: retain, rename, regroup, move into a contextual workspace, merge, or remove.

## Direction Expressed by the User

- Do not rewrite the application from scratch.
- Rework how existing features are displayed, grouped, and linked.
- Prefer clear task workflows over a flat collection of controls.
- Opening a control should reveal a workspace clearly associated with that control and its target.
- Changes should be visibly reflected in the related canvas, sequence, contour, or export surface.
- Review the complete user-visible interface before deleting or relocating controls, so existing functionality is not accidentally lost.
- Preserve these notes throughout the current evaluation and testing session, then use them as input to the redesign.

## Docking and Workflow Architecture Clarification

- The left and right sides must not acquire different semantic responsibilities. Both are simply equivalent panel docks.
- “Inspector on the right” is only a current placement, not the intended information architecture. A contextual workflow must not depend on being on the right side.
- Product workflows should be organized primarily through clear menus, submenus, and the tool windows or workspaces those commands open.
- A tool window may be attached to either dock or left floating according to user preference. Dock position is layout state, not workflow meaning.
- Menu commands must make the relationship between the initiating command, the active target, the opened tool, and the visible canvas/result explicit.
- The redesign should therefore separate two systems:
  - command and workflow organization: where users discover and initiate work;
  - panel layout: where users choose to place the resulting tools and information.
- Docks should remember their contained panels and ordering. Floating panels should ideally remember their last position and size as a UX enhancement.
- The current implementation keeps placement, dock order, floating geometry, and dock widths only in React component state. They reset when the editor is reconstructed; no persisted workspace-layout model currently exists.
- A menu command should open or focus its associated tool in its remembered placement. On first use, a guided tool may open floating and remain freely dockable afterward.

## Active Tools, Conflicts, and Hover Assist

- Opening every panel at once undermines guided workflows. Incompatible editing actions must not be simultaneously active without an explicit transition or cancellation.
- Panel visibility and tool activation should be modeled separately. A panel can remain visible as reference while its mutating controls are unavailable during another active tool.
- Disabled actions need an explanation such as `Finish or cancel Set Start before transforming geometry`, not unexplained dimming.
- Source tracing shows that the current `Hover Assist` panel combines two different behaviors:
  - `Canvas hover highlights navigator` is a view/cross-highlighting preference.
  - `Magnetic non-existing points` changes editing and construction behavior. For Set Start it permits creating a new split point; for Perpendicular/Tangent it enables the construction preview and magnetized target behavior.
- Magnetic snap is currently disabled unless Hover Assist is enabled, and turning Hover Assist off also turns magnetic snap off. This dependency is not explained and makes Hover Assist appear to overlap with Perpendicular/Tangent.
- Cross-highlighting belongs with view/selection preferences. Snap behavior belongs with the currently active construction or start-point tool, where its effect can be previewed and explained.
- Hover Assist should not remain an isolated general-purpose panel if its responsibilities can be placed in the relevant View and active-tool workflows.
- The user emphasized that conflict tracking must be reliable from the start. It must not depend on scattered component booleans or individual buttons remembering to disable themselves.
- The current editor holds selection, canvas point mode, line mode, path click mode, guide state, export preview, hover behavior, magnetic snap, panel layout, and mutation locks as separate state values in `EditorPage`. This permits relationships to be encoded ad hoc across event handlers and render conditions.
- The redesign needs one explicit active-tool/session model with legal transitions, cancellation behavior, prerequisites, conflict reasons, and a single source for command availability. Panel layout and passive view preferences remain separate from the active editing session.

## Approved Architectural Direction

- The user selected the explicit tool-session state-machine approach over both scattered command conditions and mandatory fixed CAD/CAM workspace modes.
- Fixed sequential workspaces sounded attractive for guidance but were rejected as the primary architecture because they would make quick import/edit/export work unnecessarily rigid.
- Every user-facing feature should be reconsidered as a workflow with an explicit goal, prerequisites, ordered steps, active target, preview/result, completion, and cancellation path.
- The system should prompt in concrete terms: `You want to do X; next provide Y`, rather than exposing all controls simultaneously.
- Escape behavior should be layered. During a multi-step tool, Escape should first discard or step back from the latest provisional input when possible; it should not always cancel the entire tool session. Escape from the tool's initial step cancels the session.
- Choosing a wrong point should permit returning to point selection without losing the whole operation.
- Completing a tool should commit one atomic document-history transaction. Global Undo/Redo should undo or redo completed tool transactions; provisional steps inside an active tool should use explicit Back, Reset, or Escape semantics rather than independent hidden history stacks.
- This workflow model is also the extension contract for future features: new commands declare their scope, prerequisites, steps, conflicts, preview, commit, and cancellation behavior through the same interaction system.

## Additional Requirements Captured During Part Testing

- The normal Path Project workflow should support setting the program's wire-relative coordinate position, specifically the project-level `G92`, before export. The user currently exports ISO and manually adds `G92` in the Machine Program editor.
- Requiring the dedicated Machine Program/G-code editor for routine project setup should be minimized. Path Project setup and export should express all normal machining intent directly.
- The Machine Program editor should remain because it is a useful preview of exactly what the controller will receive, but it needs a later feature and workflow review because it has fallen behind the Path Project functionality.
- Future work should support importing suitable machine programs and converting their geometry and recoverable intent into UPID, analogous to DXF and portable UPID import. This is recorded only and explicitly deferred until the user requests implementation.
- The current interactive test must teach and verify:
  - starting hole operations from their centers where supported;
  - how implemented lead-in and lead-out movements behave and are selected;
  - whether a per-project wire-relative/G92 position can currently be configured before export.
- Test result: Robofil v2 currently hardcodes `G92 X0 Y0` and initializes posted travel at `(0,0)`. Editing the planned first-rapid source does not change that posted initial position.
- For the current placed part, the first operation is Hole 2. Its center is `X-17.500 Y24.900`; its circumference start is `X-9.500 Y24.900`.
- Adding Center Pierce to Hole 2 creates and persists an 8 mm `G1` lead-in from `(-17.500, 24.900)` to `(-9.500, 24.900)`. It makes the first rapid destination the hole center, but the program still begins from hardcoded G92 origin `(0,0)`.
- To represent a wire physically positioned at the first hole center without an initial move, a project-level wire-start setting would need to emit `G92 X-17.500 Y24.900` and initialize post travel at the same coordinate. That project-level capability does not currently exist.
- Operator clarification of the required G92 workflow:
  1. The part is clamped at an arbitrary physical location on the machine table.
  2. The operator measures/locates the part and establishes the part's working axis system and datum.
  3. The operator manually threads the wire through a previously prepared small starter hole.
  4. The starter hole is generally not at the part-coordinate origin.
  5. `G92 X... Y...` declares the current wire position in the established part coordinate system; it does not move the wire and must not translate the project geometry.
- G92 is therefore project/setup intent, not a reusable machine-profile coordinate or an absolute machine-table coordinate.
- Robofil safety meaning: `G92` assigns the coordinates of the wire's current physical position inside the already established part/program coordinate system. The controller then interprets the complete programmed geometry from that assignment. An incorrect G92 does not merely spoil the first move; it shifts the entire program consistently into the wrong physical location.
- The initial wire position may be a prepared starter hole, an exterior approach point, or another physically accessible setup point. The data model must not assume every operation begins by manually threading through an interior hole.
- The intended UI workflow should allow the operator to set the initial wire position by selecting a known geometric point such as a hole center or by entering exact part-relative X/Y coordinates. The export preview must show the resulting G92 explicitly.
- The post must initialize its tracked position from the same G92 coordinate. If the first operation entry equals the declared wire position, it should not imply or emit a contradictory initial move; if they differ, the planned and posted approach from the declared position must be visible.
- Relationship between Placement/Transform, physical setup, and G92:
  - Placement/Transform positions the part geometry inside the program's coordinate system. For example, the user can center the part on X0 and place its bottom at Y0.
  - On the physical machine, the operator measures the clamped part and sets machine zero so the controller's working coordinate system matches that program coordinate system.
  - The wire is then manually threaded through a starter hole. Initial Wire Position/G92 declares where that wire currently is inside the same program coordinate system.
  - Placement changes part geometry relative to the program datum. G92 does not move the part, move the wire, establish the physical datum, or transform geometry; it only declares the current wire coordinate after the physical datum has been matched.
- Implementation must keep these as two distinct project concepts:
  - `geometry placement`: persisted transformations applied to the UPID geometry and its machining features;
  - `initial wire position`: persisted setup data consumed by planning preview and machine posting.
- Recommended initial-wire data should preserve its source:
  - a semantic geometry reference such as a selected hole center, which follows that feature when geometry is transformed; or
  - explicit part-relative X/Y coordinates, which require review if later geometry placement changes make their relationship uncertain.
- A geometry transform performed after initial-wire setup must either update a geometry-linked wire point or mark a manually entered wire position as needing review. It must never silently leave a potentially stale G92 while claiming export readiness.
- Guided ordering should normally be `place geometry → establish initial wire position → review route/export`, while still allowing quick workflows to jump directly to any step when prerequisites are already satisfied.

## Per-Operation Entry and Exit Workflow

- Correction: manually threading through a starter hole is one setup case, not a universal assumption.
- Interior closed contours commonly use a prepared starter hole or another controller/machine-supported threading setup. An accessible exterior contour may instead enter from outside the rough stock and cut toward the finished boundary.
- Initial Wire Position and contour Entry/Exit are independent concepts:
  - Initial Wire Position/G92 declares where the wire is physically located when the program begins.
  - Entry/Exit configuration describes how each operation approaches its contour, activates the required machining state, joins the finished contour, and leaves or terminates after the contour.
- Entry/Exit must become a first-class guided workflow configurable per operation/contour, not a few compact buttons in Path Actions.
- Each operation should visibly declare whether custom entry/exit is enabled, which strategy is selected, whether its geometry is automatic or manually constrained, and whether it is valid for the active machine/post policy.
- Required authoring capabilities include:
  - select exact entry/exit points on the canvas;
  - enter exact coordinates;
  - define a straight cut lead by length and direction/angle;
  - derive normal/perpendicular or tangent approaches where geometrically valid;
  - support a center-to-contour entry for eligible circular operations;
  - preview and manually adjust generated geometry while retaining its semantic relationship to the target contour;
  - allow future validated curved, arc, spiral, overlap, return, or machine-specific strategies without forcing them into the initial implementation.
- Exterior-stock workflows need either a modeled rough-stock boundary or an explicit operator-reviewed approach point. A requested 10 mm or 20 mm cut lead cannot be declared clear of material/geometry using finished-contour geometry alone.
- Lead motion must distinguish non-cut travel in known-clear space from an intentional cut through stock. The UI must not call both merely `lead-in` without exposing the motion and controller state.
- Entry and exit geometry must be included in preview, operation metrics, sequence trace, bounds/fit checks, compensation validation, export diagnostics, persistence, transformations, and Undo/Redo transactions.
- Strategy availability must be evidence-backed by geometry and the active machine/controller policy. The implementation should research real Wire EDM entry/exit practices and controller semantics rather than treating speculative examples such as spiral entry as universally supported.
- Manual authoring remains available as an escape hatch, but it must still pass finite geometry, connectivity, intersection, compensation-transition, work-area, and post-policy validation.
- Geometry-linked entry/exit points must follow transforms. Explicit numeric or free points whose relationship becomes uncertain after a transform must be marked for operator review.

## Partial-Contour Machining Scope

- Production requirement: the imported DXF/UPID may describe the complete finished-part boundary even when Wire EDM must machine only selected portions of that boundary.
- Current Prisma example: both holes and only the toothed top span should be cut. The left, right, and bottom exterior edges were already brought to final size by milling and must not be emitted as Wire EDM cut moves.
- Source/reference geometry must remain intact and visible. Excluding an edge from machining must not require deleting it from the finished-part model.
- The path model needs an explicit machining participation layer over source geometry. Candidate semantics include active cut spans and inactive/reference-only spans; `inactive` must mean excluded from posting, not an unexplained hidden or deleted entity.
- Selecting inactive spans can turn a formerly closed source contour into one or more intentional open machining operations. These must not be diagnosed as accidentally broken topology merely because the source boundary remains closed.
- Each resulting active span needs its own stable identity, direction, start, end, entry, exit, compensation/side intent, sequence position, metrics, preview, and export trace.
- The planner must route from the preceding operation's configured exit/end to the next active operation's configured entry/start regardless of whether either operation is open or closed.
- Segment participation must be editable from both canvas and contour hierarchy, with clear visual differentiation among source geometry, active cut geometry, inactive/reference geometry, leads, and non-cut travel.
- The design must support selecting whole segments and, when required, splitting a segment at picked points so only a sub-span is active.
- Re-enabling geometry must be lossless. Original source provenance, transformed geometry, contour membership, and manual decisions must survive participation changes.
- Open finished-contour compensation cannot be inferred from `inside`/`outside` alone. The workflow must explicitly capture the kept side or wire side and validate entry/exit transitions for the chosen direction.
- Export readiness must consider only active machining operations while still using inactive source geometry and modeled stock for collision and context checks where applicable.
- The current application cannot express this production scope. The temporary test export still contains the full exterior perimeter and must not be treated as the desired production program.

## Final Browser-Test Findings

- A 5 mm manual exterior lead-in was created from `(32.500, -5.000)` to the current exterior start `(32.500, 0.000)`.
- The Contour Tree incorrectly labels that manually defined exterior lead as `Pierce` / `Center pierce cut`. Lead display must derive its name and description from the actual source/strategy (`manual-point` versus `circle-center`) rather than treating every lead as a pierce.
- The final saved test project contains three explicit lead-ins:
  - Hole 2: center `(-17.500, 24.900)` to circumference start `(-9.500, 24.900)`, 8 mm G1;
  - Hole 1: center `(17.500, 24.900)` to circumference start `(25.500, 24.900)`, 8 mm G1;
  - Exterior 1: manual approach `(32.500, -5.000)` to contour start `(32.500, 0.000)`, 5 mm G1.
- Export Preview became ready with Download enabled, 3 operations, 3 rapid moves, 29 cut moves, and 0 export diagnostics.
- The ready test output uses operation-scoped `G39`, `G40`, `G0`, resolved `G41/G42 D0`, and explicit lead-in motion, then ends with `G39`, `G40`, `M02`.
- The preview still emits hardcoded `G92 X0 Y0` and still posts all 22 exterior segments. It is structurally exportable under the current v2 test policy but is not the required production program because it cuts the already-finished left, bottom, and right edges.
- Browser console review found no additional application exception type beyond repeated `Unable to preventDefault inside passive event listener invocation` messages from React event handling. Most accumulated console errors were `Extension context invalidated` messages from a Comet extension and are not evidence of an application-domain failure.
- The passive-listener messages remain a UI implementation issue to audit, most likely around preview wheel/touch handlers that call `preventDefault` through React synthetic events.
- Robofil v2 requires an explicit non-zero linear lead-in for every operation. Center Pierce supplies it for full circular operations; a non-circular exterior needs a reviewed manual approach point.
- Robofil v2 currently has no editable geometric lead-out movement. At an operation boundary it cancels controller compensation with `G39`, enters `G40`, and then rapids to the next operation's lead-in source. If physical lead-out travel is required, that is a missing modeled feature rather than an available hidden control.
