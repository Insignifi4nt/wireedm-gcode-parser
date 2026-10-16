# Free-circle span Trim

2026-10-16, after local midpoint checkpoint `bbdefd4`. Design only: no production/test changes, native probes, builds or package changes in this assessment.

## Recommended scope and part workflow

Complete the existing Trim command for a **graph circle with a numeric radius**. Remove the clicked circular span between the neighboring finite, transverse contacts; keep its complementary analytic arc. Preserve the source entity ID, center ID, construction flag, every old point and every unrelated source record. This is a deliberate identity policy for this app. Fusion's API instead documents replacing a trimmed closed curve, so source-ID retention must not be described as vendor parity. Fusion also defaults to creating constraints; this slice deliberately adds none. [Fusion SketchCircle.trim](https://help.autodesk.com/cloudhelp/ENU/Fusion-360-API/files/fusion_SketchCircle_trim.htm)

The useful proof is a free R10 circle at `[0,0]` plus a **material** chord A `[-8,6]` → B `[8,6]`. Trim the top cap, retaining the lower major arc with the old circle ID and center, and reuse the actual chord endpoint IDs. The result is an editable closed D without a hidden middle edge, fake circle seam, sampled geometry or invented radius driver. Its area is `100π - (100 acos(0.6) - 48)` mm²; Pad 5 has volume approximately `1347.148717794` mm³. A construction chord remains construction and cannot silently close material.

Onshape describes Trim to the first intersection/bounding geometry and whole-curve deletion when none exists. Fusion documents hover preview followed by clicking the span to the next intersection, also deleting geometry without intersections. These establish the intended interaction, not our driver-transfer or identity policy. [Onshape Trim](https://cad.onshape.com/help/Content/Sketch/trim.htm), [Fusion Trim/Extend](https://help.autodesk.com/cloudhelp/ENU/Fusion-Sketch/files/SKT-TRIM-EXTEND.htm)

Use the current right-click span owner and Trim preview. Do not introduce another tool, numeric span form or keyboard-generated cursor. A circle selected from an overlap chooser still needs the owned actual pointer position to choose its span.

## Additive contract

Add one strict arm to `CadSketchTrimTargetSchema` in [cadSketchTrimExtend.ts](../../src/domain/cad/cadSketchTrimExtend.ts); keep all current end/middle/delete fields and public receipts unchanged:

```ts
{
  kind: 'circle',
  entityId: string,
  parameter: number, // existing request range [0,1]; 1 is phase-zero alias
  boundaries: readonly [BoundaryWitness, BoundaryWitness], // previous, next CCW
  cutPointIds: readonly [string, string],                  // same order
}
```

`BoundaryWitness` stays the existing `{entityId,index,parameter,position,endpointPointId?}`. Its `parameter` is the canonical source-circle phase in `[0,1)`, not the cutter parameter. `index` is the phase-sorted root index for that source/cutter pair. A wrapped span can have previous phase greater than next phase; do not sort the chosen tuple numerically afterward. Required cut IDs are the witnessed endpoint IDs when present, otherwise caller-allocated fresh IDs. Allocate them once per owned preview and reuse on Apply. No new entity/support/relation ID is needed.

Add `CadSketchCircleTrimPreparation` to the existing preparation union:

```ts
{
  target: Omit<CadSketchCircleTrimTarget, 'cutPointIds'>,
  removed: ArcPathSegment,
  survivor: ArcPathSegment,
  cuts: readonly [
    {boundary: PathSegment, point: readonly [number, number]},
    {boundary: PathSegment, point: readonly [number, number]},
  ],
}
```

The result arm is `{graph,retainedEntityId,removedEntityId:null,cutPointIds}`. Existing `prepareCadSketchTrim` and `trimCadSketchEntity` remain the only query/constructor entry points. Keep the existing `trim-sketch-entity` edit, `trimAt` inspection request, mutually exclusive `proposal.trim` arm and guarded document operation. The schema-derived tool discovers the additive target arm; no separate circle tool is needed. [Trim constructor](../../src/domain/cad/cadSketchTrimExtend.ts), [region proposal/read](../../src/domain/cad/cadSketchRegionInspection.ts), [shared edit union](../../src/domain/cad/cadOperations.ts)

Add one narrowly named exported helper beside Trim, for example `cadSketchCircleTrimParameter(segment: CirclePathSegment, point: Point2): number | null`. It measures the radial direction from the actual center using fixed +X / CCW phase; it does not establish membership on the circle. Return null for nonfinite/center input or a direction that cannot be represented in the canonical half-open phase without losing its side. Normalize signed zero only; never use an epsilon to merge a near-one phase into zero. The query converts an invalid analytic hit to precision rejection; UI converts an invalid cursor to an unavailable preview. Do not change generic Path Editor nearest-point semantics.

## Exact events and cyclic span ownership

1. Resolve and validate the accepted graph through the current compiler. Use actual finite analytic intersection results against all other graph lines/arcs/circles, including construction cutters. Reuse the shared boundary validation and transversality checks; do not create a proxy full-turn open arc.
2. Keep the path-intel contract: `circularParameterAtCandidate` returns null for circles. Derive source phases privately from the actual hits, validate each hit against both original supports and finite cutter membership, then sort root indexes by source phase. UI must also use the new helper: `nearestPointOnSegment(circle).t` is deliberately always zero. [intersection math](../../src/domain/path-intel/intersections.ts), [nearest-point implementation](../../src/domain/path-editor/pathPointInference.ts)
3. Phase zero is an ordinary **real intersection** when present. A circle has no endpoint to skip. Never synthesize zero/one seam events or apply the open-source `t === 0 || t === 1` skip. Keep event identity independent of arbitrary display tessellation and source-array order.
4. Reuse a cutter endpoint only when its actual finite endpoint parameter is exactly 0 or 1 and the existing unchanged support/roundoff checks validate it. Preserve its exact ID and scalar strings. Interior contacts get new numeric points and remain one-time contact snapshots, without hidden Coincident or cutter noding.
5. Preserve the current close-distinct-contact rejection. Compare the cyclic last/first pair as well as adjacent sorted events. Only demonstrated shared endpoint identity/declared Coincident identity may combine contacts; proximity, a loose phase-wrap epsilon or the circle's nonexistent seam cannot establish identity. Undeclared multiway, tangent, overlapping or numerically uncertain contacts reject.
6. Circle conversion requires at least two distinct transverse contacts. One contact rejects; it cannot imply a nearly full circle or deletion. Accepted no-hit policy: retain the existing delete arm only for a genuinely event-free, otherwise eligible numeric-radius circle. Tangent/overlap/uncertain events reject before no-hit deletion and are never filtered into absence.
7. Find cyclic predecessor and successor around the clicked phase. Reject a click on/roundoff-near either event using cyclic arc distance and the existing closure policy. Validate only selected cut positions against `CadNumberSchema`; an unrelated, unselected farther event outside the coordinate range must not invalidate a valid chosen span.

The target's exact witnesses remain the stale-intent certificate. Constructor requery must match the full target after removing allocated IDs; changing a cutter, event order, phase branch, endpoint ownership or effective parameter invalidates the old receipt instead of selecting a replacement event. Preserve the existing public query range `[0,1]`: for circle span math only, request `1` means phase `0`. Keep the caller's original `parameter` in the returned target, so `1` rechecks as `1` and the exact receipt remains coherent. Event phases and the pointer helper stay canonical `[0,1)`. The two request aliases select identical geometry unless phase zero is an actual cut, in which case both reject the ambiguous pick.

## Construction and driver ownership

For cut IDs `[previous,next]`, the removed arc is CCW previous→next and the survivor is CCW next→previous. The survivor replaces the old circle entity **in place** as `{id,kind:'arc',centerPointId,startPointId:next,endPointId:previous,direction:'ccw',construction}`. Preserve all old points, even unused ones; append only genuinely new cut points. No source field normalization, endpoint averaging or identity garbage collection is allowed.

Numeric `circle.radius` is a free coordinate, not an explicit persistent radius driver; conversion drops that field because the entity becomes an arc. Block a **string** radius, including a numeric-looking string, rather than silently discarding authored driver intent. Block every relation whose entity references own the circle, including radial-size/equal-radius and future whole-curve owners. Do not fabricate native conflict/redundancy IDs for this source-ownership rejection. [graph model/checks](../../src/domain/cad/cadSketchGraph.ts), [relation reference visitor](../../src/domain/cad/cadSketchGraphReferences.ts), [radial source ownership](../../src/domain/cad/cadSketchRadialRelations.ts)

The center is retained, so its expression coordinates, fixed/axis-distance/midpoint relations and other point-only owners remain exact. Do **not** pass it to the open-curve detached-endpoint guard. Reused boundary endpoint drivers also remain exact. Reject cut IDs that collide with the complete namespace, contradict a witnessed endpoint, alias the retained center, or collapse to the same declared point component. No implicit release, constraint transfer or circle-to-arc relation reinterpretation.

For the one selected circle's string radius, prefer a named `CadError`, for example code `driven-sketch-trim-radius` with “Edit or release this circle's radius expression before trimming.” The target already supplies the actual entity identity; no new diagnostic array is needed. Existing curve-relation blockers retain `CadSketchTrimDependencyError` and their actual relation IDs. Never report the radius as a synthetic relation or point. Add a typed entity-source field only if a demonstrated consumer needs it.

Before returning a ready result and after constructing the actual graph, independently certify both endpoint radii against the original radius, center/support preservation, nondegenerate chord/arc lengths, removed+survivor full-turn coverage and expected complementary sweep. Preserve the chosen minor/major side strictly. For an exactly calculated half-turn, do not invent a strict side from `atan2` rounding; retain the existing signed angular/physical/radius checks. This exact-half-turn treatment needs an explicit regression, not a near-π tolerance. Use current structural closure/branch gates throughout; no new tolerance, projection or JS solve. [existing arc partition certificate](../../src/domain/cad/cadSketchTrimExtend.ts), [analytic encoding](../../src/domain/cad/cadAnalyticSegments.ts)

## Preview, preparation and consumed material

[CadSketchBoundaryPreview.tsx](../../src/features/cad/CadSketchBoundaryPreview.tsx) already renders analytic removed/surviving strokes and two-cut overlays. Add only circle target allocation/help and the private phase pick. Preview one removed arc, one survivor and the two real cutter boundaries; explain whether endpoints are shared or numeric snapshots, and that no new radius driver is created. Keep the context menu's captured graph/document/version/frame/filter/abort owner in [CadSketchCanvas.tsx](../../src/features/cad/CadSketchCanvas.tsx). Cancel, source replacement and late completion must not publish geometry or selection.

The normal preparation boundary already flushes earlier solved edits, constructs the exact Trim candidate, invokes the pinned solver and requires complete candidate equality (`sketch-trim-intent`). Reuse it unchanged unless a concrete missing arm is reproduced. A created arc adds the existing structural equal-radius equation; ordinary native acceptance is **not established by this design pass**. Safe redundancy/conflict/invalid-solution or candidate drift remains rejection, not reason to loosen precision. [shared preparation](../../src/features/cad/cadEditPreparation.ts), [existing arc runtime](../../src/features/cad/sketch-solver/cadSketchSolverRuntime.ts)

A saved graph-cell reference owns source kind/topology. Retaining the circle ID while changing kind to arc must invalidate its old witness. In a consumed sketch, edit inside the current private draft; explicitly choose the new lower-D material for each affected consumer, then Finish validates the whole part and makes one accepted history commit. Cancel restores the original circle/selector/solid; one Undo restores the accepted pre-Trim state. No automatic selector rewrite or material fallback. [graph-cell witnesses](../../src/domain/cad/cadSketchRegionSelection.ts), [private sketch draft](../../src/features/cad/cadSketchEditDraft.ts)

Agents use the existing version-guarded `trimAt` read to obtain the same two-boundary receipt, supply stable cut IDs, propose the same Trim to inspect current replacement cells, and atomically submit Trim plus explicit consumer updates. There is no inspection registry or agent-only bypass. A retained circle→arc is already expressible in saved graph schema 2, so no storage migration is needed; the added edit arm is unavailable to older app versions. Parameter/source preparation, cache/folder preservation and exact new selector acceptance still need the ordinary boundary tests.

## Bounded red-first acceptance and ownership

- **Cyclic analytic constructor:** chord/circle D above; removed top minor and lower retained major, exact old ID/center/cutter strings, no added relation. Top-cap cuts are `[B,A]`, so retained CCW arc starts A and ends B. Select the wrapped opposite span and an exact diameter/half-turn case. Pin request `0`/`1` equivalent geometry with exact respective receipt values, a real phase-zero event (neither alias may pick on it), cyclic pick-distance on both sides, reordered source/cutter arrays, stale witness and near-wrap distinct-event rejection. No seam-created cut.
- **Eligibility/atomic rejection:** string radius and radial/equal owner identify real blockers; center-only drivers remain accepted. Tangent/overlap/one-contact/aliased cuts/invalid IDs reject without source changes. A truly isolated eligible circle follows the agreed no-hit policy. Ordinary line/middle/arc Trim behavior stays covered by its existing focused suite.
- **Bounded actual preparation, only after authorization:** real free/partly driven D candidate equals constructor exactly, including retained endpoint strings, circle→arc structure and no diagnostics. One incompatible driven case must reject atomically. If this ordinary mapping safely rejects, record it and withhold the corresponding UI claim; no numerical investigation loop.
- **One complete human and same-agent part proof:** consumed union of both circle cells (whole disk) → pointer-owned top-cap preview → Cancel unchanged → Apply inside private draft → old selector rejects → deliberate lower-D repair → Finish → native area/Pad volume → one Undo/Redo → exact save/reopen. Repeat with shared `trimAt`/proposal/edit operations, not another API. The part visibly loses its top cap.

Ownership: domain owner extends Trim target/preparation/constructor and its focused tests plus the narrow phase helper (roughly 100–160 net production lines if shared event extraction stays focused). Adapter owner covers exhaustive typed arms and shared preparation/proposal/storage/API tests; UI owner updates BoundaryPreview and one realistic Canvas/private part journey. Root owns public discovery/help/compatibility wording and final native/browser/build gates. No new geometry framework, solver relation, persisted selection type, standalone tool or arrangement changes are needed.

Excluded: legacy circle promotion, string/radial/equal driver transfer, arc middle Trim, arc Extend, tangent acceptance, multiway identity inference, new constraints, sampled curves and automatic material repair. Existing arc solver/strict representability limits remain; this note supplies seams and acceptance requirements, not proof that every ordinary arc candidate passes native preparation.
