# Deliberate coincidence while creating fresh shapes

Investigation only, 2026-10-16, source at `d705840` plus the pending shared-snap integration. No production/test changes, builds or solver experiments. This follows the [geometry snap plan](2026-10-16-sketch-geometry-snaps-plan.md); it does not change the frozen snap resolver.

## Recommended scope

Add opt-in, visible coincidence for fresh rectangle first/opposite corners, circle centers and polygon vertices. Keep both the fresh and existing point records. Each chosen link creates one ordinary, removable `coincident` relation. Use the existing append/preparation/session path for one atomic operation.

The required new domain behavior is a small fresh-authoring constructor that retains authored point roles and exact picked coordinates. It should return the append payload plus its typed role-to-point-ID mapping. No new persisted graph variant, edit kind, WebMCP tool, solver equation or history mechanism is necessary. Leave Path's existing deliberate point-ID reuse unchanged initially; it has stronger shared-identity semantics than a removable coincidence relation.

## Existing support and missing data

| Current source | Finding |
| --- | --- |
| [cadFreshSketchGraph.ts](../../src/domain/cad/cadFreshSketchGraph.ts) | Already creates numeric rectangle/circle/polygon graphs with unique point/entity IDs and four rectangle H/V relations. It rejects expression strings, unsupported shapes and invalid geometry. Its public return type is just `CadSketchGraph`, with no authored role mapping. |
| [CadSketchCanvas.tsx](../../src/features/cad/CadSketchCanvas.tsx) | Other than Path references, accepted drawing picks retain coordinates alone. Rectangle clicks become a normalized profile; polygon points are an ordered array. The current snap candidate and its source ID are lost before fresh shape creation. |
| [CadWorkbench.tsx](../../src/features/cad/CadWorkbench.tsx) | `addProfile` calls the fresh helper for rectangle/circle/polygon, then `addSketchGraph` sends one `append-sketch-entities` edit. Slots and rounded rectangles remain legacy profiles. |
| [cadSketchGraphEdits.ts](../../src/domain/cad/cadSketchGraphEdits.ts), [cadOperations.ts](../../src/domain/cad/cadOperations.ts) | Append merges new points/entities/relations with the existing graph before parsing references. A relation in the append payload can therefore reference a fresh point and an existing point without copying the existing point record. Collision/reference checks remain authoritative. |
| [cadSketchGraphJoints.ts](../../src/domain/cad/cadSketchGraphJoints.ts), [cadSketchGraphGeometry.ts](../../src/domain/cad/cadSketchGraphGeometry.ts) | Explicit coincidence already supplies declared, transitive connectivity while retaining source coordinates and IDs. Position equality alone does not. Construction/material membership and actual analytic support remain separate. A point on an edge interior does not split the edge. |
| [cadEditPreparation.ts](../../src/features/cad/cadEditPreparation.ts), [cadSession.ts](../../src/features/cad/cadSession.ts), [cadSketchEditDraft.ts](../../src/features/cad/cadSketchEditDraft.ts) | Existing preparation solves the complete candidate and validates it before one accepted history change. Cancellation/version/workflow guards already cover ordinary edits and owned sketch drafts. The append edit is already allowed in a private sketch draft. |
| [cadToolSchemas.ts](../../src/features/cad/cadToolSchemas.ts), [cadSiteTools.ts](../../src/features/cad/cadSiteTools.ts), [agent guide](../site/agents.md) | Hosted agents can already append a complete graph payload containing explicit source references and coincidence, or add/remove an exact relation. They need neither screen coordinates nor a snapping tool. |

## Small shared authoring interface

The following are proposed transient domain types, not stored schemas. `CadConstructionPoint` is the existing readonly numeric point type. A point pick has one placement intent, rather than an optional flag that can disagree with its source data.

```ts
type CadFreshSketchPick =
  | { readonly kind: 'position'; readonly point: CadConstructionPoint }
  | { readonly kind: 'coincident'; readonly point: CadConstructionPoint;
      readonly sourcePointId: string; readonly relationId: string };

type CadFreshSketchDrawing =
  | { readonly kind: 'rectangle'; readonly first: CadFreshSketchPick;
      readonly opposite: CadFreshSketchPick }
  | { readonly kind: 'circle'; readonly center: CadFreshSketchPick;
      readonly radius: number }
  | { readonly kind: 'polygon'; readonly vertices: readonly CadFreshSketchPick[] };

type CadFreshSketchCreated =
  | { readonly kind: 'rectangle'; readonly geometry: CadSketchGraph;
      readonly pointIds: { readonly first: string; readonly opposite: string } }
  | { readonly kind: 'circle'; readonly geometry: CadSketchGraph;
      readonly centerPointId: string }
  | { readonly kind: 'polygon'; readonly geometry: CadSketchGraph;
      readonly vertexPointIds: readonly string[] };

// createCadFreshSketchDrawing({ drawing, construction, createId,
//   existingGraph?, parameters? }): CadFreshSketchCreated
```

This avoids a flat attachment list whose rectangle role or polygon index can belong to another shape. The result describes exactly the authored picks, not every synthetic corner. A radius pick has no persisted point and cannot receive a coincidence link. Polygon vertex IDs preserve input order; reversing vertices is an explicit new drawing order, never an internal sort.

Keep `createCadFreshSketchGraph({geometry,...}): CadSketchGraph` available for its current callers and tests. Share the small point/edge/relation allocation implementation between it and the authored-pick constructor. Do not route expression-bearing saved profiles through the fresh helper, migrate groups or build a generalized authoring registry. A focused `cadFreshSketchAuthoring.ts` module is suitable if the existing helper would otherwise mix its old normalized-profile interface with drawing-pick ownership.

Canvas should store these typed picks as the single fresh-shape draft and derive its rendered coordinate array, rather than maintain parallel point and attachment arrays. A narrow `onAddFreshSketch?(drawing, signal)` callback can parallel the existing `onAddPath` callback and converge immediately on Workbench's existing `addSketchGraph`. Keep the legacy profile callback for unsupported geometry and old consumers. If a drawing contains an attachment but the fresh callback is absent, reject instead of falling back and silently dropping that attachment.

## Rectangle mapping must precede coordinate encoding

For a rectangle, choose lower/higher X and Y directly from the two authored points. Build its four canonical corners from those original axis values, in existing LL, LR, UR, UL order. Derive first/opposite roles from the direction comparisons:

| First relative to opposite | First ID | Opposite ID |
| --- | --- | --- |
| Left and below | LL | UR |
| Right and below | LR | UL |
| Right and above | UR | LL |
| Left and above | UL | LR |

Use those named roles while the new point objects are allocated. Never find the resulting corner by nearest coordinate, a tolerance match, source array reorder or an opaque factory allocation index exposed to callers. Preserve the four H/V structural relations and free numeric coordinates; attaching a corner must not create fixed-axis drivers or an unintended size dimension.

There is a concrete floating-point reason to retain the picked axes. In a read-only Node 24 arithmetic check, `firstX = -100000` and `oppositeX = 1.23456789e-9` produced width `100000.00000000124`. Reconstructing the high X as `firstX + width` produced `1.2369127944111824e-9`, which is not bit-equal to the actual pick. This can pass ordinary geometric roundoff checks while failing deliberate exact source-reference checks. Direct axis combinations retain the actual pick. Existing size/range/degeneracy validation still applies; this is no tolerance change or healing rule.

## Construct and validate the append payload

1. Check every picked coordinate is finite numeric input. Before allocating IDs, resolve each explicitly attached `sourcePointId` in the existing graph and compare **both evaluated source coordinates exactly** with the captured pick, using accepted parameters. Follow [Path's existing source-reference policy](../../src/features/cad/cadPathDraftGraph.ts). Missing, changed or foreign references reject; no nearest-point substitution or formula evaluation into stored source fields.
2. Allocate the fresh points/entities/internal H/V relations with the existing namespace rules. Bind the authored roles at allocation time. Every new point retains its own ID even when it starts at the same coordinate as a source point.
3. For each `coincident` pick, append `{id: relationId, kind:'coincident', pointIds:[freshPointId, sourcePointId]}`. Preserve this explicit tuple order. Do not sort IDs, reuse the source point as the fresh record, create duplicate source records or manufacture a relation for a numeric-only pick.
4. Parse/check against the **combined** graph so cross-source references and global ID collisions can be validated. Return only the new append records and frozen role mapping. The payload is an append graph, as with Path; it need not be a standalone graph with all borrowed source points copied into it.
5. Submit that exact payload through the existing prepared append operation. The shared solver and unchanged independent checks decide acceptance. A failed or canceled attempt does not accept the new outline first and add its relations later. Preserve structured candidate diagnostics and the user's attempted drawing for repair/cancel.

Source strings, source IDs and source relation records are never rewritten by the constructor. No existing driver is released or converted into a numeric fixed value. Native solving can still propagate through its existing relations; show the actual prepared candidate and do not claim a new freeze guarantee for free numeric geometry. Initially coincident fresh coordinates introduce no intentional displacement of the source. Real preparation tests should establish that ordinary examples leave old values exact, rather than assume native success proves that property in all models.

IDs must be stable for the proposed operation. Capture a relation ID when an attachment is accepted into the drawing draft. Allocate the finished fresh graph once and reuse it through preview/Apply/retry of that same intent; do not rerun a random factory on each asynchronous preparation. A changed drawing is a new candidate; stale results retain the existing source/version/abort guards. The role mapping is transient and is not a new persistence record.

## Visible consent and lifetime

Use a shared Checkbox labeled "Create coincident relations" for these three fresh tools. Default it off for the first rollout, local to the sketch editing session. No storage preference change is needed. With it on, only an unambiguous point-bearing snap can become an attached pick. The hint should name the pending relationship and source, for example "Coincident with Point 3", and retain a small marker/count for previously picked attachments. The final click still accepts the shape through the existing workflow; a second modal approval is unnecessary.

With it off, show the current position-only hint and save no relation. Turning it on applies to future picks; it must not retroactively constrain points copied earlier. Turning it off explicitly releases pending attachment intents while preserving their numeric positions. It never removes already accepted relations. Ctrl/Cmd suppression affects the current pick and leaves earlier pending attachments intact. This policy needs an event test, not an inferred implementation detail.

Midpoint and draft-start candidates do not identify an existing graph point and remain position/closure operations. A midpoint snap must not become an accidental fixed coordinate or a hidden pair of dimensions. A deliberate existing center or reference point is eligible because it has a real point ID; label its role honestly. Ambiguous source identities require a deliberate choice or a position-only pick. Do not choose one merely because the coordinates coincide.

Capture accepted document identity, version, sketch ID, parameters and source graph with the owned drawing. Discard hover state on view changes and re-resolve final input with current suppression. Source changes that invalidate an earlier attached pick must cancel or reject the owned draft; never silently rebind it to a same-position replacement ID. Preserve local sketch Undo/Cancel/Finish ownership and external workflow locks. Path, legacy Curve, slot and rounded-rectangle authoring keep their current semantics in the first slice; an unchecked coincidence toggle must not be advertised as disabling Path's existing shared-point reuse.

## Agent parity through existing contracts

An agent can already send this single append intent through `cad_edit_document` with the current `expectedVersion`:

```json
{
  "kind": "append-sketch-entities",
  "sketchId": "sketch",
  "geometry": {
    "points": [{ "id": "newCenter", "position": [12.5, 7] }],
    "entities": [{ "id": "newCircle", "kind": "circle", "construction": false,
      "centerPointId": "newCenter", "radius": 3 }],
    "relations": [{ "id": "joinCenter", "kind": "coincident",
      "pointIds": ["newCenter", "existingPoint"] }]
  }
}
```

The example assumes `existingPoint` belongs to this sketch. Existing edit schema, reference parsing, solver, document validation and version guards remain authoritative. The new human constructor adds authored-pick provenance validation before emitting the same graph edit; an agent explicitly declaring coincidence may intentionally ask the existing solver to align initially different points. Do not restrict that established explicit constraint operation with a new global exact-coordinate guard.

Consequently no separate inference tool or serialized pixel target is needed. Update the public guide to say which human picks create saved coincidence, distinguish it from Path shared IDs and midpoint position snaps, and show the same append relation payload. Keep the typed role constructor internal until a real hosted authoring need requires another public convenience operation.

## Red-first acceptance and ownership

| Seam | Meaningful cases |
| --- | --- |
| Fresh authored constructor | Four rectangle drawing directions attach the actual first/opposite IDs, preserve four H/V relations and exact original axis values, including the cancellation example above. Circle attaches only its center. Polygon indices/order survive reversal and nearby distinct vertices. Numeric-only picks add no links. Existing normalized helper behavior remains green. |
| Source/reference validation | An expression-driven source point retains its exact strings and ID. Missing/deleted/moved IDs, nearly equal coordinates, wrong sketch, duplicate relation/factory IDs and unsupported fresh shapes reject unchanged input. No orphan attachment survives a malformed role/index because the shape union owns those roles. |
| Real shared preparation/session | Append one matched circle/rectangle with coincidence; edit the source parameter and observe the linked fresh point follow. Remove the exact relation, verify position remains and later source motion no longer attaches it. Undo/Redo restores the complete graph. Add an incompatible driver in the same batch and verify accepted document/version/history stay unchanged, with structured attempted-relation feedback. |
| Human drawing events | Checkbox off/on, current-pick Ctrl/Cmd suppression, off clearing only pending links, point-bearing versus midpoint/radius picks, reverse rectangle draw, Cancel and late completion. Final append contains exactly the displayed pending relations, with stable IDs and no extra history step. |
| Existing public append | The example payload and equivalent human payload use the same accepted graph/driver rules. Stale `expectedVersion`, active external workflow and invalid existing source IDs reject. Owned sketch local history and full-part Finish remain the established operation path. |

Domain ownership can cover the fresh authoring constructor, its meaningful tests and the smallest shared allocator extraction. Root owns Canvas/Workbench draft picks, checkbox/hints, public guide and browser proof. Native/runtime work is unnecessary unless a concrete existing failure is found. Arrangement integration, associative midpoint, inferred dragging, legacy promotion and changing Path reuse are separate scopes.
