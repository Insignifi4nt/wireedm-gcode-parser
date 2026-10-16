# Precise placement of an editable sketch detail

Design only, 2026-10-16. Tangent acceptance is separate. No production changes, tests, native probes or builds were performed for this assessment. The original [precise-transform requirement](2026-10-16-sketch-workflow-reference.md) and [current workflow audit](2026-10-16-sketch-final-workflow-audit.md) identify the remaining outcome: reorient an independently copied noncircular detail, locate its anchor precisely, then build the part.

## Primary-source behavior

- [Onshape Transform Sketch](https://cad.onshape.com/help/Content/Sketch/sketch_transform.htm) provides a typed rotation angle, relocatable manipulator anchor and placement onto another sketch point, with Enter/commit and Escape/cancel. It also documents swapping H/V constraints and deleting directed dimensions in some transforms. Those are vendor policies, not permission to change our source drivers.
- [Fusion Move/Copy](https://help.autodesk.com/cloudhelp/ENU/Fusion-Model/files/GUID-FFD25CD3-0707-429E-B0E6-B7F9984CDC4C.htm) includes sketch objects, Rotate with an axis/angle, Set Pivot, and Point to Point with explicit source/target points. This supports combining angle and anchor placement in one owned preview. It does not establish our constraint-retention policy.
- [SketchUp Rotate](https://help.sketchup.com/en/sketchup/flipping-mirroring-rotating-and-arrays) selects geometry, sets a rotation vertex and starting direction, then accepts a typed degree angle. [Move](https://help.sketchup.com/en/sketchup/moving-entities-around) uses a chosen reference point for placement. These support direct canvas picks; we need no geometry dropdown or general transform gizmo for the first slice.

## Smallest shared operation

Add one in-place edit alongside existing exact Move. Independent Profile Copy already supplies the editable detail; Mirror already supplies a detached reflected copy. Neither needs another copy flag.

```ts
type CadSketchPlacementRequest = {
  readonly selections: readonly CadSketchGraphSelection[]; // existing 1–64 atoms
  readonly anchor: CadPoint2;
  readonly target: CadPoint2;
  readonly angleDegrees: CadScalar;
};
// CadEdit arm: { kind: 'place-sketch-geometry', sketchId, ...request }
placeCadSketchGraph({ graph, parameters, ...request }): CadSketchGraph;
```

For each selected support point, `P′ = target + R(angleDegrees) × (P − anchor)`. Positive angles are CCW in local sketch XY, independently of the SVG Y flip or principal/datum plane. The angle is relative to the accepted detail, not an absolute edge bearing. Angle zero gives anchor-to-anchor translation; `target === anchor` gives pivot rotation. Expressions in the request evaluate once after preceding edits solve. They do not create saved placement drivers.

Anchor/target are explicit local positions, not new persistent references. Canvas picks capture their accepted numeric positions and visible snap reasons. The source document/version and exact frame own those snapshots until Apply. Picking an existing point, midpoint or profile position never implies Join, Coincident, cross-sketch projection or a source-ID substitution. Agents submit the same narrow edit with the usual expectedVersion. Existing coordinate inspection supplies exact positions; no new query tool is needed.

## Source and ownership policy

Reuse [exact Move's](../../src/domain/cad/cadSketchTranslation.ts) typed support collection and exact acceptance, with a stricter boundary for this whole-detail operation. Existing Move remains unchanged:

- Validate the existing typed selection set. Move each selected point or selected entity support once. Retain every entity, point and relation ID, circle radius scalar, arc direction, record order, construction flag, plane and offset. Complete corner selections include their existing virtual sharp point, using the same incident-entity rule as Move.
- Preserve a coordinate string verbatim if that evaluated component stays exactly unchanged. Reject a changed expression component or fixed-axis/fixed-point component with its actual owner. Never rewrite a formula into a rotated formula or numeric string. Other relation records stay exact; normal solver checks decide whether the requested pose satisfies them. No automatic H/V swapping, directed-dimension deletion or release of an external relation.
- Reject when a changed point supports an unselected entity. Require the user to include that incident entity deliberately; do not silently drag, rotate or stretch it. A pivot point that stays exactly unchanged can remain shared with a stationary edge. Distinct Coincident aliases outside the selection remain dependencies, not inferred selection expansion. Include the required alias explicitly or reject if moving one side would require outside propagation. Keep every original coordinate and declared relation; no coordinate welding or representative substitution.
- Linked Use supports and all pattern-owned geometry, including a circle-row seed, reject until explicit Detach. Placement must not reconcile unselected generated instances or rotate a saved world-axis pitch. Existing Move's seed-translation behavior stays available unchanged. Read-only linked geometry may supply an anchor/target position without being edited.
- Unselected points and all old legacy/plugin profiles/packages remain exact. Profile Copy precedes placement when the source is legacy/DXF/plugin. No legacy promotion, persistent transform relation or saved-schema migration is required.

## Exactness and acceptance boundary

Use local vectors around the anchor, finite supported coordinate checks and existing arithmetic closure policies. Exact multiples of 90° can use signed coordinate permutations, without a near-angle threshold. A full-turn angle with identical anchor/target is a true no-op with no history. Reject any nonzero requested displacement that cannot be represented.

Independently compare each covered entity's transformed local supports with the rotated original supports, so a distant component cannot license small-feature distortion. Check line lengths, circle radii and signed arc coverage/minor-major-half-turn intent using existing analytic helpers. Rotation preserves orientation, so CW/CCW stays unchanged. Do not sample curves, project points onto circles or change tolerances. Preserve exact declared joints without introducing new joints at contacts.

Add this edit to the existing geometry-dependent branch of [cadEditPreparation.ts](../../src/features/cad/cadEditPreparation.ts): flush earlier intents, construct the exact candidate, solve numeric copies, require complete edited-prefix equality, then permit only the already-defined transitive external-reference suffix refresh. Solver movement to a merely nearby pose rejects. Existing private sketch drafts provide local Undo/Cancel, one Finish, strict full-part validation and deliberate consumer-area repair if needed.

## Human owner and implementation seams

Extend Move's compact editor with an angle and direct **Choose anchor / Place anchor** actions. Keep ΔX/ΔY Move available unchanged. Reuse the document/version/submission ownership in [CadSketchMirrorEditor.tsx](../../src/features/cad/CadSketchMirrorEditor.tsx), the accepted-ID picker in [cadSketchGraphSelection.ts](../../src/features/cad/cadSketchGraphSelection.ts), and Workbench's current `geometryPick` route. Before rechoosing, clear the prepared preview synchronously and lend picks only the accepted source canvas; consume background/invalid picks without changing the frozen source selection.

The existing picker accepts graph IDs only. A small operation-owned position-pick arm is therefore needed for grid/midpoint/profile targets, reusing Canvas `getRawPoint`, the prepared geometry snap resolver and existing ambiguity chooser. It must not call drawing or attachment constructors. Show anchor, target and signed angle on canvas. Keyboard-focused actual-point picks and exact coordinate/angle inputs remain available. Escape, source/version/frame change, external workflow and late abort clear the owner and preview through existing hooks.

Likely ownership: one focused domain module plus CadEdit/reducer tests; preparation/private allowlist/discovery and native tests; editor/Workbench/Canvas pick integration and one complete journey. Estimate 140–220 domain lines and 150–250 UI/adapter lines before tests, depending on reusable position-pick wiring. Do not refactor Mirror, Copy or the solver into a transform framework.

## Meaningful red-first proof

1. Copy a legacy D profile into its existing separate editable sketch. Its R10 lower major arc goes from A[-8,6] to B[8,6], CCW, with the closing chord. Select that detail, anchor at its center, type +90°, and place at [30,20]. Expect A[24,12], B[24,28], center[30,20], unchanged radius/direction and all original profile/package records. Bounds become X24–40/Y10–30. Area stays `100π − (100 acos(.6) − 48)`; Pad5 stays about 1347.148717794 mm³ while its location/orientation changes. Prove human/API exact parity, private Cancel/Finish, one placement Undo/Redo and save/reopen.
2. Pure source tests cover pivot-only, zero-angle anchor translation, a full-turn no-op, one ordinary oblique angle, CW/major arcs and a declared Coincident joint. Assert exact untouched strings/IDs/relations and local support invariants. Include one large-origin precision rejection, not a numerical sweep.
3. Reproduce a fixed/expression coordinate or world H/V constraint preventing the requested rotation; reject atomically with the owner retained. Include linked/generated/seed ownership, a changed shared point with an unselected incident edge, and an outside Coincident alias. Also allow a stationary shared pivot. Do not weaken the candidate certificate to make these pass.
4. Mounted events pin source selection preservation during both position picks, ambiguous target choice, synchronous preview clearing before repick, keyboard entry and cancellation of deferred preparation/Apply after source/frame change.

Before implementation acceptance, authorize only a bounded native check of the cardinal D pose, one ordinary oblique mixed line/arc detail and one incompatible driver. Existing native support should need no new primitive, but exact whole-candidate retention has not been measured for these new poses. If an ordinary pose fails structural arc acceptance, report that concrete failure; no tuning, projection or unit/translation experiment follows automatically.

## Independent design decision

Review is GO for this bounded workflow. Entity atoms explicitly own their incident supports; selecting every point of an unselected entity does not implicitly select that entity for Placement. Apply this consistently to the changed-support boundary, complete corner ownership and per-entity certificates. A stationary shared pivot remains allowed. This differs deliberately from the unchanged legacy exact Move. Fixed/coordinate and dependency rejection must name actual point/entity/relation owners.

## Acceptance receipt

The three deliberate native candidates are GO: cardinal major-D and37° mixed detail retain their complete candidate, while a retained Horizontal driver causes native movement and is independently rejected. Evidence: tmp/sketch-rigid-placement-native-preflight.{mts,json,log}. Production foundation uses one focused domain module and existing exact-prefix/private command paths; it leaves Translation untouched. One real neutral-semicircle branch regression was reproduced and repaired without source projection or tolerance changes.22 focused domain/native/Translation and one private lifecycle case pass. Root editor/tool34, existing Workbench/relation/storage206 and affected Canvas/snap/path/GraphLayer146 cases pass; groups overlap. Full production types/docs/source/shared-control checks pass.

Complete Chromium/Firefox copied-D journeys preserve source, private cancellation, exact rigid pose/history, analytical section, agent parity and save/reload. Kernel bounds are compared physically at existing precision, rather than asserting arithmetic decimal spellings; authored geometry and all source/history records remain exact. Native pointer proof chooses the center anchor, trackpad-pans and picks grid[30,20], then+90°. Source is unchanged until Finish. TheR10 major curve retains sweep4.428594871176362, one1347.1487177940908 mm³ Pad5 solid and exact two-entity section. Undo/Redo pass; disposable draft is empty/closed without Save. tmp/sketch-placement-native-{editor.png,solid.png,proof.json}.

Native interaction also found F-to-fit blocked during Ready preview although its visible button worked. A mounted regression and strengthened production journey reproduce it before the navigation-only guard repair. Canvas54, scoped types, final packaging and both complete journeys pass afterward; mutation/view/IME/modifier/focus guards remain intact. Independent review is clean. No saved schema, migration, native binary/tolerance, version or remote change. This accepts precise reused-detail placement, not the entire sketch goal.
