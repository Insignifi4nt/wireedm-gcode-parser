# Exact graph split before trim and extend

Investigation only, 2026-10-16. Source inspected at `54fed37` plus the pending inferred-coincidence integration. No production/test changes, builds, native experiments, commits or remote writes.

## Recommended first slice

Add one checked `split-sketch-entity` edit for a selected graph line or open arc at a normalized **numeric** source parameter. Keep the source ID on its start-side child, allocate one new end-side entity ID and one shared split-point ID, and preserve all existing point/center IDs and scalar strings. Block whole-entity relation owners initially. Preview both surviving exact pieces, with no removed material implied.

For a line, add one visible ordinary `parallel` relation between the two children to retain a straight support. For an arc, share the original center ID; the existing structural endpoint-radius checks already keep both children on their common circular support. Do not add a redundant equal-radius relation. The split location remains a free joint on that support, not a hidden fixed coordinate, distance dimension or persisted fractional constraint.

This is a bounded part of **S16** in the [workflow reference](2026-10-16-sketch-workflow-reference.md). S16 also requires trim and extend, which remain incomplete. **S17 is offset**, not another split requirement; this slice does not implement it. The [workspace checklist](2026-10-16-sketch-workspace-checklist.md) still has the broader sketch-tool inventory open.

## Official behavior and evidence limits

| Primary source | Documented behavior and implication |
| --- | --- |
| [Onshape Sketch Split](https://cad.onshape.com/help/Content/Sketch/sketch_split.htm) | Open curves need one or more split points; closed curves need at least two. The page's Bezier discussion describes connected split curves with independent control points. It does not specify this app's line/arc constraint transfer or stable-ID policy. |
| [Fusion line split](https://help.autodesk.com/cloudhelp/ENU/Fusion-360-API/files/fusion_SketchLine_split.htm), [arc split](https://help.autodesk.com/cloudhelp/ENU/Fusion-360-API/files/fusion_SketchArc_split.htm) | Split accepts a position on a curve, returns the original plus a new curve for line/arc and returns an empty collection for closed curves. Constraint creation defaults on and can be disabled. The pages do not enumerate which old relations transfer. They support making source identity and new support constraints explicit, not guessing a transfer rule. |
| [Fusion modification tools](https://help.autodesk.com/cloudhelp/ENU/Fusion-Sketch/files/SKT-SKETCH-MODIFY-TOOLS.htm), [Trim/Extend](https://help.autodesk.com/cloudhelp/ENU/Fusion-Sketch/files/SKT-TRIM-EXTEND.htm) | Break chooses sketch intersections; trim/extend preview their affected portions. Trim without an intersection deletes the entity, while extend without one cannot proceed. A source-parameter split is therefore a separate narrower operation, not an advertised full Break/Trim tool. |
| [Fusion trim interface](https://help.autodesk.com/cloudhelp/ENU/Fusion-360-API/files/fusion_SketchCurve_trim.htm) | Endpoint trims modify the original line/open arc; a middle removal deletes it and returns two new entities. Constraint creation is an explicit option. A single retained-ID rule should not be blindly copied from split into future trim. |
| [SOLIDWORKS Split Entities](https://help.solidworks.com/2025/English/SolidWorks/sldworks/c_split_entities.htm) | Split adds a point between two sketch entities; that point can be dimensioned. A circle requires two split points. The documented delete-point merge is a separate capability we do not yet have. |
| [SOLIDWORKS Trim PropertyManager](https://help.solidworks.com/2024/english/SolidWorks/sldworks/HIDD_TRIM_CHOICES.htm?format=P&value=) | Keeping trimmed geometry as construction is an explicit option. The page distinguishes maintained dimensions from geometric relations whose retention depends on conditions. This is evidence against a blanket promise that all relations survive trimming, and does not authorize changing our source construction flags automatically. |

No cited source provides a general identity-preserving relation rewrite algorithm. The conservative blocking policy below is an app decision. No vendor CAD session or actual split/native trial was run for this investigation.

## Existing math and integration inventory

* [segments.ts](../../src/domain/path-intel/segments.ts) supplies exact analytic line/arc/circle factories, oriented endpoints/sweeps, `arcParameterAtPoint`, `pointOnArcAtParameter` and support/area functions. The arc evaluator uses the original radial support and signed sweep. Reuse it, including its endpoint special cases, rather than reconstructing endpoints through saved degree angles or a polyline.
* [pathPointInference.ts](../../src/domain/path-editor/pathPointInference.ts) exports `nearestPointOnSegment`. It can supply a transient human hover projection and parameter. It clamps to endpoints and returns an endpoint for an arc's complementary sector, so the split command must independently require a strictly interior source parameter. Its result is a pointer convenience, not a source validation certificate.
* [pathDocumentOperations.ts](../../src/domain/path-editor/pathDocumentOperations.ts) has **private**, machining-specific `splitSegment`/`splitCircle` helpers. The arc helper partitions signed sweep and reuses analytic support. The surrounding workflow generates machining IDs, rewrites operation spans and calls endpoint clustering. Do not invoke or export that workflow for the graph. The circle helper invents an antipodal second cut, which is unsuitable as an implicit graph edit.
* [intersections.ts](../../src/domain/path-intel/intersections.ts) classifies exact finite supports as none, points or overlap, with broad spatial support. The exported classifier returns points; detailed analytic parameters are private. It is useful for later explicit boundary/intersection operations, but a source-parameter split needs no all-sketch intersection search. Near roots, tangency and overlap must not be turned into invented unique cut events.
* The frozen, unwired arrangement module has transient subranges. It is not an authoritative editing operation and is outside this slice. Do not wire it, persist its half-edges or use its event vertices as saved graph IDs.
* [cadSketchGraphReferences.ts](../../src/domain/cad/cadSketchGraphReferences.ts) already distinguishes point operands from entity-owned relations. [cadSketchGraph.ts](../../src/domain/cad/cadSketchGraph.ts) parses unsolved shape/references and separately checks actual residuals. [cadSketchGraphGeometry.ts](../../src/domain/cad/cadSketchGraphGeometry.ts) derives only declared-joint simple cycles and checks their saved analytic encoding. Reuse these checks unchanged.
* [cadOperations.ts](../../src/domain/cad/cadOperations.ts), [cadEditPreparation.ts](../../src/features/cad/cadEditPreparation.ts) and [cadSketchEditDraft.ts](../../src/features/cad/cadSketchEditDraft.ts) already provide the checked edit union, preceding-solve flush pattern, one worker/preparation path and private prefix Undo/Cancel/Finish ownership.

## Proposed shared edit and pure constructor

One edit kind, with a discriminated target that makes the line's new support-relation ID mandatory and avoids an unused relation ID for arcs:

```ts
type CadSketchSplitTarget =
  | { readonly kind: 'line'; readonly entityId: string;
      readonly parameter: number; readonly splitPointId: string;
      readonly newEntityId: string; readonly supportRelationId: string }
  | { readonly kind: 'arc'; readonly entityId: string;
      readonly parameter: number; readonly splitPointId: string;
      readonly newEntityId: string };

// New arm of the existing strict CadEdit union:
// { kind: 'split-sketch-entity'; sketchId: string; split: CadSketchSplitTarget }

// splitCadSketchEntity({ graph, parameters, split }): {
//   graph: CadSketchGraph;
//   retainedEntityId: string;
//   newEntityId: string;
//   splitPointId: string;
// }
```

Schema-derive the immutable command type like the existing named corner command. All new IDs are explicit and stable across preview/Apply. `split.kind` is checked against the current source entity type. The parameter is finite and strictly between 0 and 1; it is a one-time placement request, not a stored formula or driver. A hosted agent can supply `.5` without reproducing arc trigonometry. UI projection uses native source orientation, not whichever traversal the material cycle currently chooses.

Do not make the caller replace the complete feature or manually reproduce this topology/math. Expose the same narrow edit through the existing edit schema, discovery and `cad_edit_document`; add it to the existing same-sketch draft allowlist. There is no new WebMCP tool, separate history or split solver. Keep raw full-graph updates available under their current rules.

## Human placement and ownership

Use **Split here** in the graph edge's context menu, with the cut taken from the actual owned cursor projection. This first slice needs no persistent toolbar mode, dimension panel or numeric form. A unique eligible line/arc hit can offer the action directly; at overlapping hits, require the existing explicit entity choice before offering it. [CadSketchCanvas](../../src/features/cad/CadSketchCanvas.tsx) currently routes graph right-click through its Select other chooser, so that routing must admit edge actions without selecting an arbitrary coincident stroke or falling through to the legacy profile menu.

Resolve `nearestPointOnSegment(sourceSegment, {segmentId: entityId, reversed: false}, cursorMm)` from [pathPointInference.ts](../../src/domain/path-editor/pathPointInference.ts). Convert the cursor with the actual SVG frame and retain the returned normalized parameter in **source** orientation. It is an analytic on-curve nearest-point utility, not an endpoint snap or a cut-validity check: its clamped endpoints and complementary-arc fallback remain ineligible under the domain's strict interior/child-size guards. No all-sketch intersection lookup or sampled projection is required.

At menu opening, pin the document/sketch identity, accepted source version, prepared graph/parameter snapshot, entity ID, cursor projection and actual SVG frame. Allocate stable new IDs once for that request. Preview M and both surviving child strokes, including the new line support relation; submit the same named edit through existing preparation and one Undo. A source, parameter, cancel-signal, interaction-lock or frame change invalidates the request; closing/aborting it accepts nothing, and a late preview cannot revive it. Recheck ownership before submission. A keyboard context menu without an owned curve location must not invent a cursor cut; the API's explicit numeric parameter remains available.

## Identity and source changes

For source `E: A -> B`, produce `E: A -> M` and `newE: M -> B`. Preserve `E`'s kind/construction flag and, for arcs, its original center ID and direction on both children. M is one newly allocated numeric point shared by both children. Do not borrow an existing point because its coordinates match M, or add coincidence to a crossing curve without a separate deliberate command.

All old point records, including A/B/center strings and orphan/reference points, remain exact and in their original ownership. Unrelated entities and relations stay unchanged. Keep the changed entity at its existing source-array position and insert its new sibling beside it; source-array reorder must never affect retained-side policy. The retained ID is always the **source-start** side, irrespective of lexical ID order, screen direction or reversed cycle traversal.

This is an explicit semantic narrowing of E from a whole curve to its start-side child. Consequently it is safe only after the reference guard below. The preview should identify the retained and new sides. There is no persistent split feature or provenance ancestry record in this first slice; Undo restores the actual pre-edit graph snapshot.

## Constraint policy

Find blocking relations with `cadSketchRelationEntityIds(relation).includes(sourceId)` before changing topology. Return their exact IDs for machines and existing bounded descriptive labels/operands for humans. The default action is rejection with a specific repair instruction. No cascade flag, silent deletion or automatic retarget map is needed initially.

| Existing relation/source | Initial policy |
| --- | --- |
| Point coordinate strings; fixed point/axis; distance; H/V; coincidence on retained old point IDs | Preserve exact records and scalar strings. A distance between A and B still measures the original endpoint span, never the new shorter child. Point H/V remains on its named operands. The new line parallel relation keeps M on that straight support. |
| Parallel/perpendicular/equal-length referencing the source line | Block. Keeping E on the shorter child would change whole-entity intent, especially equal length; duplicating relations across children is not a generally valid substitute. |
| Radial size/equal-radius referencing the source arc | Block conservatively. Shared-center children could preserve radial meaning mathematically, but there is no reviewed transfer policy yet. Do not duplicate a driver or silently change its entity ownership. Users may deliberately remove/recreate it in the same atomic batch. |
| Fillet/chamfer relation referencing the source line or treatment arc | Block. [Corner topology](../../src/domain/cad/cadSketchCornerGeometry.ts) requires exact incident support and trim endpoint identities. Keeping only one child under that ID can change its finite-side semantics or invalidate the persistent corner. |
| Existing graph point at the cut, or another entity geometrically intersecting it | Create a distinct M anyway. Source identity is not recovered by position. Explicit later coincidence or an explicit multi-entity split is another operation. Initial UI can refuse crowded/ambiguous targeting without changing this domain rule. |
| Legacy profile, plugin outline, separate Curve or full circle | Unsupported in this command. No automatic promotion or conversion. |

The new line support relation is `{id: supportRelationId, kind:'parallel', lineIds:[E,newE]}`. It is saved, inspectable and removable. A shared joint alone would add a free kink; this relation avoids that surprise while reusing the already supported shared-endpoint native relation and independent direction checks. It does not fix M's fraction or make the two child lengths equal.

Arc children share C and M. Their existing structural equal-endpoint-radius equations already enforce `|A-C| = |M-C| = |B-C|`. An extra equal-radius relation would repeat that requirement and may be redundant. Both children retain source CW/CCW direction and their correct initial minor/major subranges.

Later deliberate geometric edits can move a free split joint along its support. This slice does not promise M permanently stays between the old outer endpoints or preserves an original fraction/arc sector after arbitrary edits. Folded line children or overlapping arc coverage must retain the current no-fake-cell behavior. A permanent split feature with finite-interval guards would be a separate persisted relation design, not a hidden JS correction loop. Splitting a child again while the generated parallel relation owns it is initially blocked until the user explicitly removes/rebuilds that relation.

## Exact construction and acceptance

1. Parse the current graph, resolve the source by exact ID and expected kind, check its accepted numeric geometry and collect blocking entity relations. Do not use DXF endpoint tolerances, reference curve sampling or global point clustering.
2. Evaluate M from the actual source support. For a line use `A + (B - A) * t`; for an arc use `pointOnArcAtParameter(source, {segmentId:E,reversed:false}, t)`. Keep A/B/C source records unchanged. No projection or radial rescaling of M after evaluation.
3. Reject endpoint parameters, nonfinite input, unsupported source kinds, ID collisions and child geometry that is degenerate or numerically indistinguishable. Require each actual child chord/line to exceed the existing `1e-7` geometry threshold and the applicable unchanged roundoff uncertainty. A mathematically interior t is insufficient if its representable point collapses onto A or B.
4. Build the two exact graph records. For arcs, reconstruct both actual signed sweeps from unchanged center/endpoint supports and verify their orientation and combined coverage match the source sweep. Compare radial/endpoint/locus errors under existing `cadPathClosureTolerance`; a full-turn branch error cannot pass as roundoff. Check actual lengths/supports and saved cycle encoding through existing helpers. Never tighten native convergence or widen acceptance to rescue an uncertain split.
5. The line's existing parallel checker additionally imposes its present world-mm and dimensionless direction gate. Cancellation at a distant origin may make an otherwise plausible cut uncertain. Reject it honestly; do not move the cut off its evaluated support to force that check green.
6. In shared preparation, flush preceding parameter/relation edits before constructing the split, as for the existing corner command. Construct against that solved revision. To preserve split-as-shape-preserving-edit, use the existing exact Move pattern: reduce the complete split candidate, solve through the same worker, and reject any projected/numerically changed result rather than silently accept a different cut/source. The full candidate equality guard is already an established acceptance pattern; do not create a second native solve strategy. A follow-on edit in the batch can intentionally change geometry afterward.
7. Complete graph/document/consumer validation and all source/version/cancellation checks still run. A failed operation accepts neither child, point nor support relation. No IDs are merged and no source expression is normalized.

This math/acceptance recommendation still requires bounded real pinned-WASM evidence during implementation. In particular, current arc numerical safe rejects remain possible. No performance, universal arc acceptance or native redundancy claim follows from this read-only plan.

## Consumer regions and private editing

[Compiled graph profiles](../../src/domain/cad/compileCadSketchGeometry.ts) carry ordered exact entity source refs. [Cell selection](../../src/domain/cad/cadSketchRegionSelection.ts) compares those refs as part of the selected boundary, holes and nesting. A shape-preserving split still changes its boundary topology. The derived contour/profile ID may also change if the new entity sorts earlier. Therefore an old explicit selector must become stale, even when area and perimeter are identical. Retaining E does not authorize replacing old `[E]` with `[E,newE]` inside consumers automatically.

Humans editing a consumed sketch use the existing private prefix and local Undo. After split they inspect the current cells and choose replacements with the existing area-repair workflow for supported active Extrude/Pocket consumers. Finish applies the changed sketch and explicit replacement selectors as one guarded full-part commit; Cancel restores the accepted part. [Private draft](../../src/features/cad/cadSketchEditDraft.ts), [region inspection](../../src/domain/cad/cadSketchRegionInspection.ts).

Agents need the same usable repair path. The current region-inspection/reference-read proposal accepts a complete same-ID `sketch`, numeric `parameterValues`, or both; it cannot yet preview a split command. Requiring agents to reconstruct the complete post-split graph would undo the benefit of the shared edit. Add one narrow `split` proposal arm to those **existing** read tools, reusing exactly the same pure constructor as the reducer:

```ts
// Existing complete-sketch and parameter-only proposals keep their behavior.
type CadSketchRegionProposal =
  | { readonly sketch?: CadSketchFeature;
      readonly parameterValues?: CadDocument['parameters'] }
  | { readonly split: CadSketchSplitTarget;
      readonly parameterValues?: CadDocument['parameters'] };
// Strict schema: split and sketch are mutually exclusive; an empty object is invalid.
```

The requested sketch ID already belongs to the enclosing read operation. Merge any numeric additions/overrides using the proposal's current parameter semantics, then run the shared split constructor on that evaluated source and resolve its actual cells. Do not create a generic edit executor, accept private UI state, bypass graph checks or claim the read certifies the full part. This arm is limited to source construction and region inspection; a parameter change that needs an ordinary native solve before a valid source split must be prepared through the existing accepted editing path instead of being guessed by this synchronous read.

The agent supplies stable split IDs, reads the proposed regions and complete reference signatures, then submits **one atomic batch** with any equivalent parameter edits, the same split and explicit consumer selector updates. The ordinary preparation still flushes preceding edits and validates the complete resulting part; a stale version, different solved source or unmatched selector rejects the batch. Never splice guessed `[E,newE]` refs into `graphContours` or automatically rewrite a consumer. This bounded proposal arm is part of the recommended first slice, not implemented by this investigation. Automatic whole-sketch consumers may remain valid if the source locus is unchanged; only actual validation establishes that. Unsupported consumers stay blocking. Dormant/suppressed selector behavior remains unchanged.

## Scope after split

Trim needs a deliberate removed interval and exact bounding event identity. Extend needs a chosen eligible boundary, source end and unambiguous analytic intersection. They can later reuse the source constructor and exact math, but must define different retained/new-ID and relation policies, especially middle removal. Tangencies, overlaps and near-coincident roots require explicit rejection or reviewed disambiguation. Never turn an absent intersection into deletion merely because another CAD product's Trim does so.

Circle splitting requires at least two deliberate cut locations or a separately named circle-to-arc conversion. One graph arc cannot have the same start/end ID, and our circle owns a scalar radius that may be an exact expression driver. An invented antipode or converting that radius into free numeric endpoint coordinates would change source intent. Leave circle splitting unsupported initially, along with merge/delete-split-point, automatic crossing noding, arrangement integration and S17 offset.

## Red-first acceptance and ownership

| Public seam | Bounded realistic proof |
| --- | --- |
| Pure constructor | Horizontal/oblique and reversed-source lines retain the source-start ID, add one real joint and correctly named child/support IDs, preserve unrelated exact strings and construction flags, and preserve total analytic length. Tiny/cancellation-prone cuts either pass unchanged precision checks or reject without repair. |
| Arc constructor | CW/CCW major arcs, a split that leaves one major child, and reversed traversal preserve actual center, signed coverage, joint coordinates, area/perimeter and original endpoint IDs. Endpoint/near-endpoint cuts and tiny unsupported child chords reject. Circle never gains an invented second cut. |
| Dependency guard | Point-only endpoint dimensions remain exact, while equal-length, radial-size and structural corner owners block with their actual relation IDs. Explicit removal before split in one batch works; no relation is silently dropped, duplicated or rebound. |
| Shared real preparation/session | Preceding parameter edit is solved before computing M. Ordinary line/arc splits preserve the complete precomputed candidate; injected projection or actual failed native solve rejects atomically. One Undo restores the original entity/point/relation set; cancellation/stale source and late completion cannot accept partial topology. |
| Region/owned workflow | A rectangle-edge split keeps area/perimeter but invalidates its old explicit graph selector. Private local Undo/Cancel restores it; explicit area repair plus Finish succeeds as one full-part step. The read-only split proposal and actual reducer produce identical references for the same source/parameters/IDs; agents use those refs in one split-plus-repair batch. Mixed `sketch`/`split` proposals reject. A batch missing repair rejects its accepted version/history unchanged. |
| Human/agent command | Both emit the same named-ID edit and preview actual source-oriented pieces. Right-click on a unique edge offers Split here; overlap requires an explicit source choice. Source-order changes cannot swap the retained side. Pan/source/parameter/lock changes close or invalidate the pinned menu, and stale preview completion cannot submit. No empty-space or near-endpoint click deletes a profile. |

Suggested ownership is one focused `cadSketchSplit.ts` domain module and its pure tests, plus narrow strict-edit/preparation/draft allowlist integration, the split arm on existing region inspection/reference reads, and real shared-preparation tests. Root can own the edge context menu, preview, selection, public discovery/guide and browser proof. No graph entity schema change, solver protocol change, toolchain work or arrangement integration is required for the recommended existing-parallel/shared-center approach. The audit must continue to mark full S16 and S17 incomplete afterward.
