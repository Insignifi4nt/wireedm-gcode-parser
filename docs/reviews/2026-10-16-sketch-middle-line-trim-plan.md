# Deliberate middle-line Trim

16 October 2026, after local checkpoint `7bfc806`. Complete an ordinary missing boundary-editing action before broader CAD polishing. Keep the goal active, local and unmerged. The [remaining-workflow priorities](2026-10-16-sketch-remaining-workflow-priorities.md) distinguish this slice from unfinished arc/circle Trim, Offset, tangency, associative references and intersecting material cells.

## Human result

Right-click a source line between two finite transverse intersections and choose the existing Trim here action. Hover/focus previews the removed middle span, both retained outer spans, the two cutting boundaries and actual contact markers. Escape edits nothing. Accept keeps both survivors as one undoable operation, retaining the old source-start side's entity identity. The same witnessed query/proposal/edit supports agents. A consumed sketch remains privately editable and needs deliberate replacement-area approval before Finish when its boundary identity changes.

[Onshape Trim](https://cad.onshape.com/help/Content/Sketch/trim.htm) describes trimming to bounding/intersecting geometry and deleting a curve when none exists. [Fusion Collinear](https://help.autodesk.com/cloudhelp/ENU/Fusion-Sketch/files/SKT-CONSTRAIN-COLLINEAR.htm) describes a common supporting line. Our retained-support relation is an explicit application policy; these sources do not establish that those products automatically add that relation during Trim.

## Exact contract

Add one strict middle target to `CadSketchTrimTargetSchema`:

```ts
{
  kind: 'middle', entityId, parameter,
  boundaries: [firstWitness, secondWitness],
  cutPointIds: [firstId, secondId],
  newEntityId, supportRelationId
}
```

The witnesses retain the current boundary entity/index/source-parameter/position/optional exact endpoint ID format. Select the adjacent events bracketing the pick, including with four or more cutters; never remove everything from the first to last intersection by default. Both cuts must be representable and leave nondegenerate survivors/removal. Existing tangent/overlap/undeclared-tie and pick-on-intersection refusals remain.

The source line becomes original start → first cut, retaining its ID. The explicitly named new line becomes second cut → original end, retaining construction state. Source-start ownership is independent of screen direction or source-array order. Each witnessed endpoint reuses its exact ID; otherwise allocate one fresh numeric point. Retain all old points, scalar strings, legacy profiles, source bytes and unrelated records. Requery and compare complete witnesses before construction. ID namespace/conflict checks and complete native candidate acceptance remain authoritative.

Existing end/delete query receipt fields remain unchanged. Internal query name becomes `prepareCadSketchTrim`, returning `CadSketchTrimPreparation = CadSketchEndTrimPreparation | CadSketchMiddleTrimPreparation`. The middle form has `target` without allocated IDs, `removed`, `survivors: [startPiece,endPiece]` and `cuts: [{boundary,point},{boundary,point}]`. The constructor's middle result is `{graph,retainedEntityId,removedEntityId:null,cutPointIds,newEntityId}`; old end/delete results keep their existing shape. UI can branch on the truthful union instead of manufacturing an empty graph or maintaining a second preview state.

## Support, constraints and limits

Add one inspectable/removable scalar-free relation `{id:supportRelationId,kind:'collinear',lineIds:[retained,new]}`. Parallel alone cannot preserve the common support of disjoint pieces. Compose the pinned native Parallel and point-on-line constraints, mapping both native equations to that actual source relation. For lines sharing an actual endpoint, only the independent Parallel condition is needed. Native freedoms and independent physical residuals must verify this behavior before it is claimed.

Reuse the existing dimensionless angular contract and world-mm driver precision for orientation and support distance, including separated segments. Do not widen tolerances, alter native convergence, repair solver output or freeze cut coordinates. Matching/free/reversed and incompatible fixed cases must use the real pinned runtime. A native Success with an independently invalid support still rejects atomically with its actual evidence.

Middle Trim retains both original outer points. Their point relations, including endpoint-pair H/V and span distances, retain their exact operands. Existing Parallel/Perpendicular/Collinear support references keep the original line ID; the new Collinear relation carries that support to the second piece. Finite whole-edge sizes, explicit angle rays, corner treatments and other ambiguous entity owners block until removed/recreated deliberately. Do not copy end Trim's detached-point blockers onto unchanged middle outer points.

Cutting an edge's interior remains one-time numeric contact, without a cutter attachment. Actual witnessed endpoints share declared identity. No cutter noding, hidden middle/construction edge, automatic contour healing, generated-reference attachment or intersecting-cell promise. Arc/circle middle removal and arc Extend remain unavailable.

## Implementation and acceptance

- Domain/native owner: graph relation/schema/visitors, strict support checker, pinned solver composition, feedback/inspection and focused real-native tests.
- Boundary domain owner: target/query/constructor, existing edit preparation and region proposal/tool adapters, meaningful identity/dependency/stale/atomicity tests.
- UI owner: shared preview/markers/request allocation and existing Canvas menu ownership, plus existing relation inspection/removal presentation. Reuse current controls/styles.
- Root: complete human/agent/solid/save browser acceptance, native interaction, public docs, checklist, compatibility record and local commit. Independent review follows a frozen implementation.

Write meaningful REDs before production edits. Pin four-cut adjacent selection, reversed orientation/reordered source, exact endpoint reuse and nearby distinct identities, strict namespace/stale/precision refusal, retained point/direction drivers and finite-edge blockers. Prove composed relation freedoms and ordinary edit support with real native geometry, not only compiled constraint objects.

One complete consumed-part journey should remove a middle span, reconnect deliberately, repair the selected area, Finish, compare human/agent source and native volume, Undo and save/reopen. Keep Cancel/source/frame/version and late-completion checks through existing shared ownership; add tests only where behavior materially differs. Run focused suites/types first, then one frozen build and affected Chromium/Firefox journeys. No concurrent package rebuild/tests, no full-suite counting as a substitute for product acceptance.

This adds a schema-2 relation and a tool edit/query variant. Older readers reject unfamiliar data. Preserve end/delete read contracts, document additive changes and limits, and record compatibility before a future reviewed PR. No storage migration, installed post/machine package change, app-version bump or remote action during this goal.
