# Detached graph Mirror copy

2026-10-16. Read-only proposal following [next user workflows](2026-10-16-sketch-next-user-workflows.md), against accepted arc Extend `f6a7cb9` and the separately frozen radius-owner slice. No production/test changes, tests, probes, native work, package operations or builds were performed for this note.

## Recommended scope

Mirror 1–64 explicitly selected graph entities about one existing graph line in the same sketch. Support lines, signed circular arcs and circles, including construction entities and open selections. Preserve construction flags. Evaluate the accepted geometry once and append an independent numeric copy with fresh identities. Preserve every original point, scalar string, entity, relation and legacy profile exactly. No source formula, dimension, radius/equality, corner or symmetry relationship is copied onto the result.

Preserve shared source point identities and declared Coincident joints **inside** the copy. That is required to retain an authored closed chain; it does not attach the copy to the original or axis. Unselected operands, point-only selections, legacy/plugin profiles, other sketches/frames, linked symmetry and editable patterns are outside this slice. The axis is its infinite support line, may be construction or material, and cannot also be in the copied set.

Onshape documents preselecting sketch entities, starting Mirror and then picking a mirror line. This is a useful interaction reference. Fusion's current API explicitly adds Symmetry constraints, matching its interactive command. Our independent-copy semantics are therefore an explicit product choice, not a claim of identical vendor behavior. [Onshape Sketch Mirror](https://cad.onshape.com/help/Content/Sketch/sketch_mirror.htm), [Fusion Sketch.mirror](https://help.autodesk.com/cloudhelp/ENU/Fusion-360-API/files/fusion_Sketch_mirror.htm)

## Small shared authoring interface

Propose one new pure `cadSketchMirror.ts` module with strict schemas and these exports:

```ts
type CadSketchMirrorRequest = {
  entityIds: readonly string[]; // unique, nonempty, at most 64, all existing
  axisLineId: string;          // existing same-graph line, outside entityIds
  idPrefix: string;            // current identifier alphabet, at most 64 chars
};

prepareCadSketchMirror({ sketch, parameters, ...request }): {
  readonly sketch: CadSketchFeature;
  readonly sourceEntityIds: readonly string[];
  readonly resultEntityIds: readonly string[];
};
// CadEdit: { kind:'mirror-sketch-geometry', sketchId, ...request }
```

The preparer constructs the full deterministic result; callers never submit reflected coordinates. Sort selected source entity IDs and referenced source point IDs for allocation, independently of array order or picking order. Assign `${prefix}_e<i>` and `${prefix}_p<i>` respectively. All centers are ordinary copied points, so a center shared by selected curves is copied once. Generated internal joint relations use `${prefix}_j<i>` in deterministic component/member order. Check every emitted identity against graph points/entities/relations and legacy profile IDs through the existing append boundary. Reject collisions without retry or silently changing the prefix. These suffixes fit the current 96-character identifiers. [identifiers](../../src/domain/cad/cadPrimitives.ts), [append](../../src/domain/cad/cadSketchGraphEdits.ts), [selection limit](../../src/domain/cad/cadSketchGraphSelection.ts)

One prefix is allocated when the human command opens and retained while choosing/rechoosing the axis and previewing. Agents provide the same prefix. Source and axis are actual IDs at the guarded accepted version, rather than persisted ordinal labels. No additional topology witness or stored mirror feature is needed: the human owner pins its source snapshot; public edits already carry expectedVersion; deliberate preceding parameter edits are solved before recomputing the requested copy.

Add `proposal.mirror` to the existing mutually exclusive region proposal union, using this same request/preparer and optional numeric `parameterValues`. Current inspect/read calls can then obtain proposed region references before one atomic mirror-plus-consumer repair. No standalone Mirror tool or new receipt registry. Agents discover actual graph entities from existing `cad_get_feature` / `cad_read_document` and the edit from `cad_describe_edits`. Proposal reads certify source geometry only, not native/full-part acceptance. [operations](../../src/domain/cad/cadOperations.ts), [proposals](../../src/domain/cad/cadSketchRegionInspection.ts), [tools](../../src/features/cad/cadSiteTools.ts)

## Copy topology without coordinate merging

Use `cadSketchEntityPointIds` to collect only the selected entities' support points. The same source point ID always maps to the same new point ID. Distinct source IDs stay distinct even if their evaluated coordinates are equal. Evaluate each selected point separately and reflect it separately; do not choose or average a representative position.

Use existing `resolveCadSketchPointIdentities` / validated joints to group selected support points by declared Coincident component. For each component containing multiple selected source IDs, emit a deterministic spanning tree of new Coincident relations between their copies. A declaration chain can pass through an unselected source point; copy the selected members' declared connectivity without copying that outside point or linking to it. Do not copy arbitrary partially covered source relations. Existing line/arc adjacency, shared centers and Coincident closure survive; undeclared equal-position points never become a joint. [reference expansion](../../src/domain/cad/cadSketchGraphReferences.ts), [declared joints](../../src/domain/cad/cadSketchGraphJoints.ts), [compiler](../../src/domain/cad/cadSketchGraphGeometry.ts)

These minimal joints are the only generated relations. Copied H/V, radius, equal, angle, midpoint and corner intent is deliberately absent. A copied fillet has its initial exact line/arc geometry, but its later edits do not retain a fillet treatment. State this in the preview help. A reflected point lying on the axis or an original point has its own new ID, with no outside coincidence or automatic weld. The old source remains untouched.

## Analytic reflection and acceptance

Choose the axis origin from its lexically first endpoint ID, so swapping its start/end records does not change evaluation order. With unit axis normal `n`, origin `A` and point `P`, compute `R(P) = P - 2*dot(P-A,n)*n`. The axis is not limited to the finite segment. Reject an invalid/degenerate axis under the existing graph checks, nonfinite results and coordinates outside ±1e9. This is an operation-local numeric calculation, not a solver frame/conditioning change.

Map line endpoints directly. Map arc center/start/end directly and reverse `cw`/`ccw`, preserving endpoint correspondence. A circle copies its evaluated radius unchanged and reflects its center. No tessellation, sampled midpoint reconstruction, source-point projection or generic transform matrix service is needed.

Independently certify signed normal reversal and retained tangential displacement, then each entity's local support vectors/lengths. Use local vector checks as in Move so a distant component cannot license distortion of a small edge. For arcs, preserve both endpoint radii and expected signed sweep `-sourceSweep`, including genuine major/minor sides and exact Cartesian half-turn treatment. Radius, closure, degenerate support and saved-path encoding keep current policies; no wider driver/structural budget is proposed. Any loss of a nonzero separation or an uncertain angular branch rejects. [Move certificates](../../src/domain/cad/cadSketchTranslation.ts), [analytic precision](../../src/domain/cad/cadAnalyticSegments.ts), [graph validation](../../src/domain/cad/cadSketchGraph.ts)

Parse/check the isolated copy and complete append, then reuse the existing exact-operation preparation branch: flush preceding intent, construct, run the pinned solver, and require complete candidate equality. In particular, a roundoff-consistent but nonidentical Coincident pair may be moved by native solving; do not silently accept that movement or average its points. Actual ordinary declared-joint and mixed-arc acceptance needs a bounded native test before advertising it. Existing source/copy curve overlaps should reject through the analytic classifier rather than append duplicate coincident geometry. Transverse intersections can retain their ordinary graph meaning; they create no automatic union or selected material. Reuse the existing material catalog and explicit area repair, without changing arrangement. [intersection classifier](../../src/domain/path-intel/intersections.ts), [prepared edits](../../src/features/cad/cadEditPreparation.ts)

## Direct canvas axis choice under one owner

Preselect source entities, invoke **Mirror copy**, then click the actual axis line. Keep the source highlight and a short “Choose mirror line” cue. After a valid line pick, show source, axis and prepared reflected geometry with Apply/Cancel; allow returning to Choose line. No geometric dropdown is required.

The actual reusable route is `CadSketchGraphLayer.choose → graphControls.onSelect`; Canvas's background and existing overlap chooser also call that callback. Rendered edge Enter/Space supplies an exact entity ID. Canvas Shift+F10 already reads the focused `data-cad-sketch-entity`, so it can offer **Use as mirror line** without inventing a cursor. Move currently opens the RelationsPanel; Offset already owns document/version/source/prefix, shared prepared preview and submission. Reuse those lifetimes, not Move's coordinate-edit semantics. [GraphLayer](../../src/features/cad/CadSketchGraphLayer.tsx), [Canvas](../../src/features/cad/CadSketchCanvas.tsx), [Workbench](../../src/features/cad/CadWorkbench.tsx), [Offset owner](../../src/features/cad/CadSketchOffsetEditor.tsx)

One narrow optional operation-local `graphControls.entityPick` can hold eligible line IDs and `onPick(entityId)`. During the owner's Choose line stage, route existing canonical edge hits, overlap choices and focused keyboard choices there, without calling `selectGraphSet`. Use an ephemeral edges/eligible-lines query; do not overwrite the user's saved Auto/Points/Edges filter. The normal selection array continues to own the frozen source set. Store the axis only in the Mirror owner. Reject curves, points and the selected source entities as axes.

The current `editorPending` locks Canvas, so interception alone is insufficient. Workbench must exempt only its own current axis-pick stage from that Canvas lock while all foreign/editor/storage/submission locks still apply. In this stage, eligible edges can be picked/focused, while point/radius dragging, drawing, legacy profile selection, box selection, Delete and dimension/topology commands stay blocked. This is a temporary selection-only route, not a globally unlocked editor or another persistent selection mode. Reuse the overlap menu when the axis is obscured; never repick the nearest geometry after the menu opens.

Pin document object/version, sketch ID, graph/parameters, source IDs and prefix at command start. Pin axis ID to that owner. Current source replacement, sketch/frame switch, foreign workflow, Cancel/Escape/unmount aborts the operation. Axis menu choices also carry the existing projection/frame capture and invalidate on pan/zoom. Once an axis ID is chosen, navigation need not change its geometric meaning; it may close only a pending menu, not retarget the axis. Publish ready prepared documents through the existing preview callback. Late results cannot Apply or change selection. Keep Offset's exact-own-publication allowance during a successful submission. [preview](../../src/features/cad/useCadPreparedPreview.ts), [submission](../../src/features/cad/useCadEditSubmission.ts)

## Meaningful gates and one paired-bore part

1. At the pure preparer/reducer seam, mirror known line/arc/circle coordinates about horizontal, vertical and one oblique line, with reversed axis endpoints/source record order. Check exact originals, deterministic IDs, copied numeric circle expression, signed major/CW arc coverage, shared point/center identities, explicit Coincident closure through an outside alias, and no undeclared joins. Pin invalid axis/source/collision/duplicate-overlap and actual finite-precision rejection. Keep this to a few functional groups rather than a transform matrix sweep.
2. At shared preparation, prove an ordinary mixed curve plus declared-joint copy equals its complete constructor candidate under real WASM. Solve a preceding source/axis parameter edit first. A deliberately changed solved candidate or native conflict must reject atomically; successful Copy must not move any old record. Test that later source/axis parameter edits leave the new numeric geometry independent. No new native equations are needed.
3. At human ownership, direct-click a construction line after source selection; source selection stays unchanged and no grip moves. Escape leaves no added records. Keyboard Enter and focused-line Shift+F10 reach the same exact axis. Pin an overlap menu, then source/frame change and a deferred preview/submission completion; no stale append. Existing generic cancellation tests need not be copied wholesale.

For the complete part, use a 60×30 graph plate, a driven Ø6 bore at `[15,15]`, and a construction axis `x=30`. Consume the one-bore plate with Pad 5. Inside its owned sketch, Mirror the bore to `[45,15]`: preview/Cancel first, then Apply, deliberately repair the plate area if its explicit selector becomes stale, and Finish once. Expected volume changes from `9000−45π` to `9000−90π` mm³. Whole-part Undo/Redo restores/remakes the original exact source plus new copy and selector together.

Add a separate Ø8 driving relation to the new bore through the existing Dimension editor; the source remains Ø6 and expected volume is `9000−125π`. Change the original bore parameter to Ø10 and verify the copied bore stays Ø8 at `[45,15]`; final volume is `9000−205π`. Preserve the original source formula text and new dimension text. Native walls/section must show the two actual centers/radii, not just mesh or area estimates. Save/reopen through existing cache/folder boundaries, and repeat the same request plus proposed-area repair through existing guarded WebMCP edits. [private draft](../../src/features/cad/cadSketchEditDraft.ts), [region selection](../../src/domain/cad/cadSketchRegionSelection.ts)

## Ownership, budget and limits

Domain owner: new pure preparer/schema plus focused tests, roughly 150–220 production lines including topology and certificates. Adapter owner: narrow CadEdit/reducer, exact preparation, private allowlist, proposal/discovery and cache/folder/native tests, roughly 40–70 production lines. UI owner: command/source capture, direct eligible-line pick route and the existing preview/Apply/Cancel pattern, roughly 100–160 production lines. These are estimates, not a requirement to trade correctness for a line target.

Saved output uses existing schema-2 numeric points, line/arc/circle entities and Coincident relations. There is no saved Mirror model, migration, storage rewrite, package change or symmetry solver addition. Older apps may reject the new edit kind but already understand the emitted records they otherwise support. Public help must say independent copy and retained internal joints. Cross-frame/legacy copies, persistent Mirror/Symmetry and pattern propagation remain separate work. The native proof and browser/source-lifetime gates above are unexecuted proposals, not measured success claims.

## Independent design review

Read against accepted radius-owner checkpoint `979e2f6`, the actual selection/reference/joint helpers, append/compiler behavior, Move certificates and Canvas/Offset ownership. No source/test edits, probes, test runs or builds were performed. This review approves no implementation or native acceptance by itself.

The bounded contract is sound. One same-sketch entity set, one real line axis and one stable prefix are sufficient; callers need not author reflected coordinates or persist a Mirror feature. Canonical allocation must preserve shared support IDs while keeping distinct source IDs distinct. A tree connecting only selected members of a **validated** declared Coincident component preserves internal connectivity without copying outside points, source drivers or hidden symmetry. Evaluate each point independently. Reflection maps both arc endpoints and center, reverses direction and preserves the signed sweep's magnitude; source/copy geometry still needs the stated local-vector, radius and Cartesian branch checks. Do not average coincident aliases to obtain native equality.

Two concrete implementation requirements should be pinned before coding:

1. **Do not delegate duplicate-overlap rejection to append.** `appendCadSketchEntities` checks namespaces and graph shape; `compileCadSketchGraph` can report intersecting/overlapping entities as arrangement geometry and withhold cycles without rejecting an open graph. The pure Mirror preparer must explicitly classify pairs involving new geometry against the accepted graph and other new geometry, including unselected and construction supports. Reject actual overlap under existing classifier policy; ordinary transverse crossings remain separate from identity joining or material selection. No new topology engine is needed.
2. **Make Ready → Choose line a real accepted-source pick stage.** Clear the published prepared preview before re-entering it. Canvas's `isPreview` guard otherwise disables ordinary background/overlap picking even if the owner's `editorPending` lock is exempted. Eligible-line queries must use the captured accepted prepared graph, never reflected preview entities. Consume empty/invalid picks without clearing the frozen source set. Preserve the saved filter; disable mutation/box/grip routes independently of the narrow line-pick capability. Own pending/menu feedback must not masquerade as a foreign lock and cancel the command.

Keep the lifetime distinctions explicit: document/sketch/placement replacement cancels the command; pan/zoom invalidates a captured axis menu, but does not retarget an already chosen axis ID. Axis choices must be rechecked against the current owner synchronously before closing a menu; stale callbacks cannot choose for a replacement command. Preview readiness and exact own-publication acceptance remain under the existing prepared-preview/submission owners. Short help should say that the result is numeric, independent and retains only internal joints; it must not promise source dimensions or later symmetry.

The paired-bore fixture is mathematically consistent: Pad 5 gives `9000−45π`, then `9000−90π`, then `9000−125π`, finally `9000−205π` for the stated diameters. The later source-diameter edit is a meaningful independence check. Native preflight still needs to prove complete source/copy equality, especially newly generated joint trees; one successful unconstrained circle copy alone would not prove that contract. No further blocking design flaw was found in this read.
