# Independent profile copy into an editable graph sketch

2026-10-16. Read-only assessment of priority 2 in [next user workflows](2026-10-16-sketch-next-user-workflows.md). Mirror production acceptance is still the parent's active work. This note changed no source/tests and ran no tests, probes, browser, native, package or build operations.

## Smallest useful result

Select one accepted legacy, imported-DXF or plugin **profile outline**, then create a separate editable graph sketch in the same local frame. Leave the original sketch, profile, constraints, expressions, DXF text and pinned plugin package exact. The new outline has numeric points/radii and fresh identities, without plugin inputs, source dimensions or an associative reference. It can use existing point/edge selection, dimensions, corner treatment and boundary edits.

Copy one outline, not the source sketch's material region or automatically nested holes. A copied hole outline becomes an independent closed outline in its new sketch. Preserve construction status. State these choices in the preview; do not turn the original into construction or replace its representation. The separate sketch avoids the current restriction on mixing material legacy profiles with graph-cell material. Curves, cross-plane projection, solid edges, multi-profile copies and geometry transforms remain outside the first slice.

Fusion documents copying sketch elements into another active sketch and finishing the source before editing the destination. Its projection documentation separately describes an optional persistent Projection Link. These support separating copy from projection; they do not define our identity or constraint policy. [Fusion Copy a sketch](https://help.autodesk.com/cloudhelp/ENU/Fusion-Sketch/files/Fusion_Sketch_sketches_copy_sketch_html.htm), [Fusion Project/include](https://help.autodesk.com/cloudhelp/ENU/Fusion-Sketch/files/SKT-SKETCH-CREATE-PROJECT-INCLUDE.htm). The existing official-reference matrix likewise distinguishes Onshape Use from an explicit independent copy. [reference](2026-10-16-sketch-workflow-reference.md), [Onshape Use](https://cad.onshape.com/help/Content/Sketch/use.htm)

## Existing modules and actual gaps

| Source seam | Reuse and limit |
| --- | --- |
| `resolveCadProfile` + `cadProfileToEntities` in `cadSketchGeometry.ts` | Resolve one profile, including its current pinned plugin, once. Output is an ordered exact line/arc/circle contour. No new sampling or DXF conversion. A plugin's already-authoritative polygon vertices remain vertices; do not infer smooth curves from them. |
| `cadDxfImport.ts` / `cadDxfSource.ts` | Accepted DXF contours are already clean local-mm profiles with exact stored originals. Read those profiles, without reparsing/reimporting or scaling original DXF text again. Copying one contour does not copy all contours or import lineage onto the new sketch. |
| `cadSketchOffset.ts` | Its deterministic ring point/entity allocation, structural checks, signed-sweep/radius certificates and slot half-turn semantics are relevant. Public Offset at zero intentionally emits nothing. Do not change that behavior or invoke a tiny nonzero offset to obtain a copy. |
| `cadFreshSketchGraph.ts` | Deliberately accepts only fresh numeric rectangle/circle/polygon authoring. Saved path/slot/plugin conversion is a different explicit operation. Do not weaken the fresh-authoring guard or call this a migration/promotion. |
| `cadSketchGraphGeometry.ts` / `cadAnalyticSegments.ts` | Validate exact graph supports, declared joints, cycle encoding and simple closure. Ordered profile adjacency can supply new joints; graph proximity search cannot. |
| `cadDatumPlanes.ts` / `cadDocumentFrames.ts` | Resolve the accepted source placement and preceding datum. A shared normal or merely coplanar position is insufficient to prove the same local U/V coordinates. |
| `cadEditPreparation.ts`, `cadOperations.ts` | Reuse preceding-intent flush, source resolution, normal native solve and full constructed-candidate equality from exact operations. A plain caller-built add-feature would make humans/agents reconstruct the difficult geometry themselves. |

All paths above are under [domain/cad](../../src/domain/cad/) except [preparation](../../src/features/cad/cadEditPreparation.ts). No existing public operation provides this exact copy result. A small profile-to-graph module is justified; a general transform/copy framework is not.

## Concrete shared contract

Propose strict `CadSketchProfileCopyRequestSchema` / type with these fields:

```ts
type CadSketchProfileCopyRequest = {
  sourceSketchId: string;
  profileId: string;
  newSketchId: string;
  name: string;
  idPrefix: string; // identifier alphabet, max64
};
// CadEdit: { kind:'copy-sketch-profile', ...request }

prepareCadSketchProfileCopy({ sketch, parameters, ...request }): {
  readonly sketch: CadSketchFeature; // the NEW feature, not changed source
  readonly sourceSegments: readonly ResolvedCadPathSegment[];
  readonly resultEntityIds: readonly string[];
};
```

Require `sketch.id === sourceSketchId`, an active actual source profile, a fresh document feature ID and a valid name. The reducer appends the constructed feature through the ordinary feature-validation path. The target has `profiles:[]`, a new graph and `suppressed:false`; omit `source` import metadata and plugin configuration. Original provenance remains on the untouched source, rather than falsely declaring that a derived single outline is another import of the full file.

Allocate `${prefix}_p<i>` in ordered joint traversal, `${prefix}_e<i>` in edge order and `${prefix}_c<edgeIndex>` for arc centers. A standalone circle uses `_c0`/`_e0`. The prefix and new feature ID are allocated once per owned preview. All indices are derived, not caller-computed geometry or boundary-name arrays. Keep graph IDs sketch-local; feature IDs remain document-wide. Reuse the existing parser/namespace checks. No retry/renaming, old ID reuse, or coordinate-based center deduplication.

Add one narrow edit to the existing guarded edit/discovery/preparation path. Flush preceding parameter/native intent before evaluating the source. Native Success must leave the entire constructed document equal, including the source and all other features. Reject drift/conflict/redundancy honestly. Agents use actual profile IDs from existing feature/document reads, call this same edit, then inspect/edit the new graph through existing tools. No new standalone tool, clipboard service or region-proposal variant is necessary: the original consumed sketch is unchanged, the target is new and unconsumed, and its one simple copied loop can use ordinary Whole sketch material. Subsequent graph-cell/consumer repairs retain their established APIs. [operations](../../src/domain/cad/cadOperations.ts), [append](../../src/domain/cad/cadSketchGraphEdits.ts), [tools](../../src/features/cad/cadSiteTools.ts)

## Placement is explicit

Derive the destination plane directly from the source's principal plane or exact datum reference. Evaluate the source sketch offset once and store a numeric destination offset. Resolve/validate both placements at the accepted parameters and require the same frame before publication. No target-plane picker, arbitrary coplanar-frame comparison, rotation, projection or matrix inversion is needed.

For a principal plane, this gives a fixed same-plane numeric position even if the source's offset expression later changes. For a datum plane, both sketches still explicitly reference the **same existing datum**. Later edits to that datum move both; the copied local geometry remains independent of profile inputs. Help must distinguish that ordinary placement dependency from a profile association. Do not promise a frozen world frame. Freezing a datum would require an explicitly created numeric datum feature and is deferred, rather than hiding an extra dependency/model in this operation. Existing source/datum ordering and native placement restrictions remain unchanged. [placement resolver](../../src/domain/cad/cadDatumPlanes.ts), [document frames](../../src/domain/cad/cadDocumentFrames.ts)

## Exact curve and joint construction

Use the source profile's validated ordered contour as the authority for adjacency. At each declared joint, choose one deterministic outgoing start as the new shared point and check it against the incoming endpoint and both supports under the existing arithmetic closure budget. Never average, snap to a nearest endpoint or cluster nearby coordinates. If the joint cannot be represented on both analytic supports, reject. Independent centers remain separate new points; equal coordinates do not establish a shared center identity.

Retain line supports, arc centers, radii, traversal/major-minor coverage and full-circle meaning. Current `cadProfileToEntities` may normalize traversal to CCW; copying that physical contour is acceptable without rewriting the original path direction or scalar text. A full circle becomes a circle entity, never a degenerate endpoint arc. Known Slot caps retain their authored exact half-turn interpretation as in accepted Offset; generic path/plugin arcs do not receive a near-π reclassification. Check true Cartesian side, signed sweep error and physical support error with existing budgets.

The result contains shared boundary points and structural graph arcs, with no inferred capsule/tangency/equality, H/V or dimension relations. A slot initially looks exactly like the source, but later edits are ordinary free graph edits. Do not advertise a persistent Slot treatment. Require one isolated simple cycle, unchanged analytic area/perimeter/bounds within the existing arithmetic policy and exact saved-path closure. Reject collapse, wrong branch, self-contact/overlap, nonrepresentable coordinates or unavailable/inexact profile output. This selection has its own validated outline; do not resolve the source's whole material forest just to include unrelated holes/profiles.

If two real consumers justify it, extract only the existing ring allocation/certificate from Offset into one focused analytic-loop builder shared with Copy. Keep Offset's public zero, join and containment behavior untouched. Otherwise keep the constructor local initially. Do not route this operation through Mirror or build a transform abstraction.

## Human flow and ownership

Provide **Copy outline to editable sketch** from the accepted sketch feature/context action. In a read-only source-pick stage, use the actual Canvas profile picker and `onSelectProfile` callback to choose the outline, including plugin profiles. Preserve current overlap/profile ownership instead of making users choose opaque indices or export/reimport a file. Capture document/version, source sketch/profile, parameters/frame and allocated target IDs. A compact preview needs only the source label, “Independent numeric copy; outline only”, Apply and Cancel. Rename remains available through the existing feature naming flow.

Two current guards require deliberate integration:

- `CadSketchEditDraft` only permits edits to its owned sketch. Creating another feature must remain outside that allowlist. A live private sketch draft must be Finished or Cancelled explicitly before invoking this document-level command; do not implicitly discard or publish it. The read-only pick stage can show the accepted source sketch without beginning a private draft, with drawing/grips/other edits blocked and only the owned profile choice enabled.
- Canvas accepts `previewSketch` only when its ID equals `sourceSketch.id`; Workbench also extracts preview geometry by the active ID. Do not spoof the new target ID to bypass these ownership checks. Display the actual candidate sketch in a temporary **read-only** Canvas view using the existing renderer. On returning to Choose outline, synchronously clear that published preview before restoring accepted-source picking. Apply uses the full prepared document; after acceptance, open the real new sketch through the ordinary owned editing entry.

Reuse Mirror/Offset's abort, current-source, exact-own-publication and deferred-result guards. Invalid/background clicks are consumed without changing another selection. A frame/source/version replacement, foreign workflow, Cancel/Escape or unmount aborts. Pan/zoom invalidates a captured pick menu without changing an already captured profile ID. Copy creates one global Undo entry. Later editing of its new sketch uses ordinary local Undo/Cancel/Finish. The source's existing consumers and area selectors are unchanged, so this copy itself needs no repair of them. [Workbench](../../src/features/cad/CadWorkbench.tsx), [Canvas](../../src/features/cad/CadSketchCanvas.tsx), [private draft](../../src/features/cad/cadSketchEditDraft.ts), [prepared preview](../../src/features/cad/useCadPreparedPreview.ts)

## Bounded acceptance and go/no-go risk

Before implementation claims, authorize a small real-native preflight for a rotated legacy slot and one accepted mixed major-arc DXF path. Exact graph initial endpoint radii and shared G1 joints may cause native adjustment/redundancy even when the source looks closed; full candidate equality must expose that. The existing successful nonzero Offset of a rotated slot is useful evidence, not proof of an exact zero-distance profile copy. Stop/report ordinary failure instead of tuning native thresholds or projecting coordinates.

Keep pure tests at the preparer/reducer seam: a circle, one rotated slot/rounded outline, signed major path, and a plugin's accepted polygon/path output. Check worked area/length, exact originals/packages/DXF Unicode and unit interpretation, shared new joints, independent centers, deterministic IDs, source/feature collisions and one uncertain-joint/branch rejection. Verify principal offset expression snapshot and the explicit shared-datum behavior. No shape sweep or copy of every existing cancellation test is needed.

For one complete human/API proof, use an unconsumed plugin rectangle outline at 40×20 with a named width input and pinned polygon-recipe package. Copy into the new graph sketch, Cancel once, then Apply. Original package/inputs/parameter metadata and all old features remain exact. Treat one copied right-angle corner with the existing graph Fillet radius 2, then Pad 5. The expected area is `796+π` and volume `3980+5π`. Changing the original plugin width to 60 leaves that copy and solid unchanged. Copy creation Undo removes only the new feature; normal later sketch Finish/Undo restores its edits without changing the source. Repeat with the exact shared edit through WebMCP and save/reopen through cache and folder adapters. A DXF fixture separately proves its original text remains exact and its already-mm profile is not scaled again.

No migration, installed package change or saved reference model is proposed. New output uses ordinary schema-2 graph entities; older apps can reject the additive edit kind but need no hidden file rewrite. Expected production budget is roughly 180–240 lines for the constructor/certificates, 40–70 for shared edit/preparation/discovery, and 90–150 for the read-only source/target owner. These are estimates. The main risks are exact joint encoding/native preservation, the cross-ID preview, and honest datum placement semantics, not a need for another solver or transform framework.

## Independent design review

Compared the plan with the actual profile resolver/analytic contour conversion, Offset ring construction, document placement validation, reducer/schema normalization, prepared-edit detection and owned-sketch entry. Read-only design assessment: no production/test changes, probes, tests or builds.

The scope is coherent: copy one accepted outline into a new graph feature, snapshot its evaluated local geometry and offset, retain its exact principal-plane/datum reference, and leave all source data and consumers untouched. An explicit shared datum is an honest placement dependency, not a profile link. Separate output avoids mixed legacy/graph material and provenance ambiguity. The contour's ordered adjacency can establish fresh shared joints; it must not become a general coordinate-clustering or center-deduplication rule. Full-circle entities, signed arc coverage, Slot half-turn semantics and nonrepairing support/closure checks match the existing exact pipeline. The proposed single-corner area `796+π` and Pad-5 volume `3980+5π` are consistent.

Pin these narrow integration requirements before implementation:

1. Add `copy-sketch-profile` explicitly to `needsCadSketchPreparation`, as well as the exact-operation preparation branch. The accepted source can be schema 1 with only legacy profiles, so detecting preexisting graph geometry is insufficient. Preview and final acceptance must both run native preparation for the newly constructed graph. Existing reducer normalization should introduce schema 2 only through this accepted explicit edit.
2. Keep document checks at their actual owner. The pure `{sketch, parameters}` constructor can verify source/profile identity, graph geometry, copied plane reference and numeric offset; it cannot prove document-wide new-feature freshness or resolve preceding datum ordering without document context. The reducer/full-document validation must enforce fresh `newSketchId`, source eligibility/order and placement. Reusing the exact plane reference and evaluated offset needs no new frame-comparison or transform service.
3. Retire the copy command and its pending workflow before opening the accepted new sketch through the normal editing entry. `useCadSketchEditing.begin` calls `session.assertWorkflowClosed()` even when the target is unconsumed. An acceptance callback running while the old editor still publishes pending would otherwise accept the copy but fail to open it. Prove the real parent handoff; do not bypass the workflow guard or add an arbitrary delay. Preserve exact own-publication recognition until authoritative acceptance.

The read-only source picker and cross-ID target view must remain one operation owner: source picks come from the accepted snapshot, target rendering is noninteractive, Change outline clears preview before restoring picks, and null/invalid choices cannot clear or retarget normal selection. Keep copy creation outside a private consumed-sketch allowlist; requiring Finish/Cancel first is necessary. After that handoff, ordinary new-sketch edits and any later consumption use their existing owners.

No blocking design flaw remains if these seams are observed. Native exact-joint preservation is still a go/no-go gate, not established by this review or by successful nonzero Offset. A rotated Slot and accepted mixed-arc outline are appropriate bounded preflight cases. Detached copy does not satisfy linked projection, Curve reuse or completion of the broader sketch goal.
