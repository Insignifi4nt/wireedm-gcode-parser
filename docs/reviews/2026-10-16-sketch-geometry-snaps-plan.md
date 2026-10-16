# Shared sketch geometry snaps

Design investigated at `4e7bee9`, including the then-pending exact Move preparation guard. The pure resolver/preparation slice was subsequently authorized at `d705840`; verified implementation evidence is recorded below. This note does not establish complete drawing/movement integration.

## Recommendation

Add one small pure snap resolver beside `cadSketchGraphInteraction.ts`, using that module's already prepared numeric source points and analytic segments. Use it for fresh shape picks and graph point drag targets. Start with endpoint, center and line/arc midpoint positions. Preserve Path's deliberate reuse of an existing point ID. Other tools initially place numeric coordinates and explicitly say that they add no relation.

This is a useful first slice, but position snapping alone does not complete parametric joining. Follow it with deliberate, removable coincident inference for fresh graph creation and existing-point movement. Do not call a copied coordinate a join, or imply that a midpoint will remain attached after its source changes. Midpoint association needs a real new relation and is outside the first slice.

## Evidence from CAD products

| Official evidence | Consequence for this app |
| --- | --- |
| Onshape can infer constraints while sketching. It highlights the referenced geometry and shows an inference indicator; some targets activate after moving near their source. Shift temporarily suppresses automatic inference. [Automatic inferencing](https://cad.onshape.com/help/Content/Sketch/automatic_inferencing.htm) | Show both the target and its reason. Supply temporary suppression. Hover activation and automatic constraint creation are distinct policies we need not copy together. |
| Fusion's Sketch Palette calls its Snap option a **grid** snap. Autodesk separately documents automatic sketch constraints and Ctrl on Windows or Cmd on macOS to avoid their creation. [Sketch Palette](https://help.autodesk.com/cloudhelp/ENU/Fusion-Sketch/files/GUID-4183A4B7-E002-4396-AD5A-7FF3C8B2F33A.htm), [Automatic constraint suppression](https://www.autodesk.com/support/technical/article/caas/sfdcarticles/sfdcarticles/Disable-creation-of-automatic-sketch-constraints-in-Fusion-360.html) | Name our setting accurately. A coordinate magnet and a saved relation are separate operations. |
| Fusion's explicit Midpoint command aligns geometry and displays a constraint badge. [Midpoint constraint](https://help.autodesk.com/cloudhelp/ENU/Fusion-Sketch/files/SKT-CONSTRAIN-MIDPOINT.htm) | A persistent midpoint promise requires an inspectable relation, not a transient computed coordinate. |
| SketchUp distinguishes endpoint, midpoint, arc midpoint and center inferences and gives each a marker and ScreenTip. Hovering a source can prioritize inference; its documented linear-inference toggle leaves other point inferences available. [Drawing basics and concepts](https://help.sketchup.com/en/sketchup/introducing-drawing-basics-and-concepts) | Use a stable glyph plus short text. Do not claim our proposed suppression key or ranking rules are SketchUp behavior. |

These pages do not specify a common acquisition radius, tie rule, solver target accuracy or persistent source-ID policy. The choices below are app design decisions, not claims about those products. Fusion Drawing-workspace object snaps were deliberately excluded as evidence for Sketch behavior.

## Current implementation and gaps

* [cadPathPointSnap.ts](../../src/features/cad/cadPathPointSnap.ts) already finds the uniquely nearest graph point within six screen pixels, before grid rounding. It refuses identity ties within eight screen-distance ULPs and returns a detached frozen exact coordinate plus ID. It currently searches every graph point, including centers and relation-only reference points.
* [CadSketchCanvas.tsx](../../src/features/cad/CadSketchCanvas.tsx) prepares `sourceGraph` separately from solved/display previews. `getDrawingPick` only uses graph point snapping for Path start/end picks; the arc-through pick and other shape tools use grid coordinates. Path alone has a visible square with the title "Join existing point". Keyboard placement uses the current stored cursor/ID.
* [cadPathDrawing.ts](../../src/features/cad/cadPathDrawing.ts) retains explicit start/end references. [cadPathDraftGraph.ts](../../src/features/cad/cadPathDraftGraph.ts) verifies referenced IDs and **exact evaluated coordinates** against the current graph before append, leaves old point scalars intact and reuses only declared references. A fresh closed chain's exact authored return shares its own start. A nearby return does not manufacture a joint.
* [cadFreshSketchGraph.ts](../../src/domain/cad/cadFreshSketchGraph.ts) creates fresh rectangle, circle and polygon IDs from numeric input. It receives no picked-point provenance. Matching numeric coordinates currently remain separate points. Slots and rounded rectangles retain their legacy representation.
* [cadSketchGraphInteraction.ts](../../src/features/cad/cadSketchGraphInteraction.ts) already owns evaluated points, explicit driven-axis flags and exact `PathSegment`s. Its picker gives points priority over edges. Snapping needs its own distance ranking, not a call to `pick()` that mistakes a nearby stroke for a point target.
* [CadSketchGraphLayer.tsx](../../src/features/cad/CadSketchGraphLayer.tsx) captures one pointer and source point, then grid-snaps a displacement target. Explicit driven axes are masked. The shared preview/submission paths cancel stale work, but the native point-drag request can project to a feasible location rather than reach the pointer target. [Preparation](../../src/features/cad/cadEditPreparation.ts), [preview](../../src/features/cad/useCadPreparedPreview.ts), [submission](../../src/features/cad/useCadEditSubmission.ts). The pending exact whole-selection Move guard does not make point drag exact.
* Accepted coincident relations already supply declared transient joints without rewriting coordinates or source IDs. [Joint resolver](../../src/domain/cad/cadSketchGraphJoints.ts), [graph compiler](../../src/domain/cad/cadSketchGraphGeometry.ts). No new arrangement or proximity clustering is needed for deliberate point coincidence.

## Small typed contract

Suggested names, not a second persisted schema. `SketchPoint`, source graph/entity/point types and prepared interaction types come from their existing owners.

```ts
type CadSketchSnapTarget =
  | { readonly kind: 'endpoint'; readonly pointId: string }
  | { readonly kind: 'center'; readonly pointId: string }
  | { readonly kind: 'point'; readonly pointId: string }
  | { readonly kind: 'midpoint'; readonly entityId: string }
  | { readonly kind: 'draft-start' };

interface CadSketchSnapCandidate {
  readonly target: CadSketchSnapTarget;
  readonly point: SketchPoint;
  readonly distancePx: number;
}
type CadSketchSnapResult =
  | { readonly kind: 'none' }
  | { readonly kind: 'hit'; readonly candidate: CadSketchSnapCandidate }
  | { readonly kind: 'ambiguous'; readonly candidates: readonly CadSketchSnapCandidate[] };

interface CadSketchSnapQuery {
  readonly cursor: SketchPoint;
  readonly mmPerPixel: SketchPoint; // Positive X/Y scales of the actual SVG rect.
  readonly tolerancePx?: number; // Default existing six pixels.
  readonly excludePointIds?: readonly string[];
  readonly excludeEntityIds?: readonly string[];
  readonly draftStart?: { readonly point: SketchPoint; readonly pointId?: string };
}
// Added to the existing prepared interaction object:
// snap(query: CadSketchSnapQuery): CadSketchSnapResult
```

`point` retains existing Path support for graph points that are not endpoints or centers, such as a virtual sharp reference corner. It is labeled "Point" or the existing reference-corner description, never falsely labeled "Endpoint". `draft-start` is an owned temporary closure target. It never supplies an invented saved ID. A bound draft start and the same saved point deduplicate by that explicit ID.

For integration, keep one transient owner with the gesture or drawing draft, rather than a global snap manager:

```ts
interface CadSketchSnapOwner {
  readonly document: CadDocument; // Existing immutable source identity.
  readonly version: string | undefined;
  readonly sketchId: string;
  readonly prepared: ReturnType<typeof prepareCadSketchGraphInteraction>;
  readonly cancelSignal: number;
  readonly frameKey: string; // Existing plane/view/actual SVG projection frame.
}
type CadSketchSnapPlacement =
  | { readonly kind: 'position'; readonly candidate: CadSketchSnapCandidate }
  | { readonly kind: 'reuse-point'; readonly point: SketchPoint; readonly pointId: string };
```

The resolver reports geometry only. The caller applies raw/grid fallback and chooses placement semantics. In particular, a midpoint result cannot be passed as `existingPointId`. No callbacks, React state, source mutation, solver call or serialized snap setting belongs in the resolver.

## Geometry and ranking

1. Prepare immutable candidates once per accepted graph/parameter snapshot. Emit each existing point once; derive its display role from entity incidence, preferring endpoint over center when one actual ID has both roles. Keep all source IDs. Construction geometry remains an eligible reference. A circle has a center and no artificial endpoint or midpoint.
2. A line midpoint is `start + (end - start) / 2` per axis. An arc midpoint is `pointOnArcAtParameter(segment, { segmentId: segment.id, reversed: false }, .5)` from [segments.ts](../../src/domain/path-intel/segments.ts). It follows the signed minor/major sweep and the exact start support. Never average arc endpoints, average wrapped angles, sample a polyline or substitute a full-circle midpoint.
3. Measure `hypot((target.x - cursor.x) / mmPerPixel.x, (target.y - cursor.y) / mmPerPixel.y)`. Validate finite cursor/scales/radius, require positive scales, use an inclusive six-pixel threshold and return none on invalid input. Model-space tolerance must not grow the acquisition zone at a distant origin.
4. Geometry and the owned draft-start target compete by screen distance before grid fallback. Preserve the existing eight-ULP distance tie policy. Canonical target kind/ID sorting makes ambiguous results stable, but must not select an arbitrary identity. Different IDs at the same coordinate remain ambiguous. No position deduplication or tolerance weld. Two already-declared coincident IDs may still be ambiguous in this first slice; explicit ID reuse can distinguish them.
5. Do not reuse selection filters as snap filters. Points/Edges controls what can be selected, not whether a line midpoint is a drawing reference. No hover delay, target lock, intersection, on-curve, quadrant or alignment inference is necessary initially. Add an index only if measured pointer-query cost warrants it; candidate preparation already removes expression/curve compilation from pointer movement.

## Creation, movement and visible meaning

| Input | First-slice saved behavior and hint |
| --- | --- |
| Path start/end over a uniquely chosen graph point | Reuse the exact point ID through the existing draft reference checks. Show "Join endpoint", "Join center" or "Join point" and highlight the referenced point. This deliberately preserves current shared topology. |
| Path arc-through over any target | Copy the exact numeric position into the three-point constructor. Show "Midpoint position" or the matching reason with "No relation". A through pick is not a persisted graph endpoint. |
| Rectangle corner, circle center/radius pick, polygon vertex, legacy slot pick | Position only. Keep fresh IDs and existing structural constraints. Show the target type and "No relation". A circle radius pick does not create a circumference point. Do not retrofit fresh-builder IDs from matching coordinates. |
| Graph point drag | Snap the requested position against the captured accepted source; preserve all expression strings and existing relations. Show a target marker and the actual solved geometry separately. No automatic relation or ID merge. |
| Draft closure | Use the exact owned start. Do not replace it with a nearby saved point merely because the two coordinates almost match. Keep explicit Close available. The existing Path and polygon closure code has separate precedence/radius rules; cover the intended replacement behavior in tests before changing those rules. |

For dragging, exclude the dragged point and directly dependent midpoint targets, and exclude the same declared joint aliases from self-acquisition. Never build magnets from the moving preview. Explicitly driven axes must remain unchanged; reject a candidate whose coordinate on a driven axis is not reachable under the existing world-roundoff policy. This does not prove the remaining geometric constraints allow the target.

A native solve can succeed at another feasible position. Only show an attained snap when the **current matching** solved point reaches the captured target under unchanged `cadPathClosureTolerance`. Otherwise clear attained styling and show "Constraints limit movement". Preserve the existing soft point-drag command's behavior and show its actual preview; do not silently introduce an exact move or saved coincidence. A future persistent inference must be a shared checked edit, not a UI-only promise. The last valid preview of an older request is insufficient evidence that a new target was reached.

Use the existing themed overlay, with distinct endpoint/center/midpoint glyphs, an in-canvas short reason and source highlighting. A native SVG title alone is too weak while the pointer is moving. IDs remain machine keys; human labels use source ordinals. One owned hint replaces `cursorPointId`, rather than adding a second parallel hint state. The hint and candidate should contribute to view-capture identity so a capture cannot finish with a stale displayed reason.

Keep the existing persistent Snap toggle and document that it enables grid and geometry targets. Proposed temporary suppression is **Ctrl on Windows/Linux or Cmd on macOS while drawing or an already captured drag is active**. Shift already toggles selection and prevents a grip drag, so copying Onshape's Shift would conflict. Suppression bypasses both grid and geometry magnets without changing the stored setting. Read it again on pointerup/click; key-only changes update the hint using the latest raw cursor. Do not consume browser/editable-field shortcuts, Ctrl-wheel zoom, Shift selection or native text input. This binding is an app choice informed by Fusion, not a cross-CAD standard.

## Source and acceptance ownership

* Prepare targets from `sourceGraph` and accepted parameters, not `visualGraph`, foreign sketches or a pending feature preview. First scope is active graph targets only. Exact legacy geometry could later offer position-only targets through [cadProfileReferenceGeometry](../../src/features/cad/cadViewportReferences.ts); it cannot provide graph point IDs. Imported/plugin outlines must never become identity-bearing targets by coordinate lookup.
* Store the snap result with its owner and current raw pointer or keyboard position. Pointerup/click recomputes from the owned source and current modifier state, rather than trusting the last hover event. Keyboard placement must invalidate or re-resolve a hint after arrow movement, view change or suppression.
* Source document/version/parameters/sketch replacement, cancellation, unmount or external workflow lock clears the hint and aborts the gesture/preview. A changed projection frame clears the old result; either cancel a drag or reproject explicitly, never mix frozen displacement scales with a new query frame.
* Creation drafts may pan/zoom between accepted picks. Keep their authored world points; discard/recompute only the hover result on view changes. Before a final append, validate every borrowed ID against the source as `createCadPathDraftGraph` already does. A source edit that invalidates an earlier referenced pick must reject or cancel the owned draft, not retarget it.
* Existing shared preparation, submission abort and session version guards remain authoritative. One accepted placement/move is one existing history operation. Cancel, lost capture, blur and late async completion must leave accepted source and history unchanged. Numeric coordinate snaps do not add history or require another worker protocol.

## Follow-up for persistent joining

For new rectangle/circle/polygon point attachments and existing graph-point movement, prefer a separately identified `coincident` relation between the new/moved point and the deliberately selected source point. Keep both point identities and all old drivers. Submit it with the geometry in one existing atomic edit batch; show the inferred relation before commit and make it inspectable/removable afterward. [Append](../../src/domain/cad/cadSketchGraphEdits.ts) already accepts relation payloads against the full graph; the compiler already understands declared coincidence.

This needs a small fresh-authoring seam that carries the picked **authored role** to the newly allocated point ID. A rectangle's first click can normalize to any of four corners; do not recover the intended corner by nearest coordinate after construction. Circle centers and polygon vertex indices are simpler. The seam must be shared by human and hosted-agent authoring. Exact current point-reuse for Path remains supported, with its stronger shared-identity semantics stated honestly.

A future midpoint relation should reference `{pointId, entityId}` and independently validate the actual signed-arc or line midpoint. Do not approximate it with a fixed coordinate, a hidden pair of dimensions or a transient radial spoke. Ordinary center attachment can use existing point coincidence; concentric entity intent can be considered separately. No automatic imported-geometry repair, source promotion or arrangement integration is needed.

## Bounded red-first implementation sequence

| Slice | Ownership | Meaningful acceptance proof |
| --- | --- | --- |
| Pure candidates/query | New `cadSketchGeometrySnaps.ts` + tests; additive preparation hook in `cadSketchGraphInteraction.ts` | Nearest screen-distance target wins over a nearer grid point and across nonuniform X/Y scales. Radius boundary inclusive; equal-distance/different-ID candidates remain ambiguous under reorder; same point's endpoint/center aliases deduplicate by ID. Frozen detached output and unchanged graph. |
| Exact midpoint math | Same pure suite | CW and CCW 270-degree arcs choose the actual arc midpoint, opposite to the chord midpoint; reversed traversal gives the same geometric midpoint. Tiny sweep/far-origin cases use the existing analytic function. Circle yields center only. |
| Creation and hint | Canvas integration + focused event tests; keep builders untouched initially | Off-grid rectangle/circle/polygon placement uses target coordinates but creates no phantom relation/borrowed ID. Path endpoint reuse still preserves exact source strings/IDs and stale-reference rejection. Arc-through snaps numerically without borrowing topology. Draft-start closure is unambiguous and suppression works on the committing event. |
| Movement and async ownership | GraphLayer integration + deferred real event tests | Self/dependent targets do not capture; driven-axis mismatch is not advertised as reachable. Real solve reaches a free target; a constrained projection never shows attained snap. Source/version/frame change, suppression, Escape, blur and late completion clear the old marker and cannot commit stale intent. |
| Deliberate inferred coincidence, after first slice | Narrow fresh-authoring/domain tests + shared UI/API wiring | Rectangle reverse draw preserves the selected corner's role; source IDs/scalars remain exact; adding/removing the visible relation changes declared connectivity, Undo restores it, and incompatible drivers reject the whole batch unchanged. |

The first four rows are the recommended first vertical slice. Keep native solver behavior and acceptance precision unchanged. Independent review should focus on wrong-target joins, stale owner reuse and a snap hint that overstates what was saved, rather than a large fixture matrix.

## Pure implementation evidence at d705840

The first public-seam test failed with `prepared.snap is not a function`, then passed after adding the resolver and additive hook. Source-role, identity ambiguity, drag exclusions and empty-source draft tests exposed their missing behavior before implementation. A further near-but-different bound-start case failed before the exact coordinate guard was added.

Implemented only [cadSketchGeometrySnaps.ts](../../src/features/cad/cadSketchGeometrySnaps.ts), its [pure tests](../../src/features/cad/cadSketchGeometrySnaps.test.ts), and the additive `snap` method in [cadSketchGraphInteraction.ts](../../src/features/cad/cadSketchGraphInteraction.ts). The original Path helper remains unchanged. The exported preparation function accepts an optional `{ graph, points, segments }` source and returns `(query: CadSketchSnapQuery) => CadSketchSnapResult`; calling it without a source supports an empty sketch or legacy Curve's owned draft start without a synthetic graph.

The actual contract matches the proposed target/result union above. Candidates also expose `entityIds: readonly string[]` for source highlighting. Query `kinds?: readonly CadSketchSnapTarget['kind'][]` filters roles before ranking. Source entity IDs are sorted and exclude disabled owners. A shared point retains an eligible owner; an entity-excluded point cannot reappear as an unowned generic point. Point exclusions expand only through already-declared coincident joints and suppress directly dependent midpoints. No geometric proximity creates an alias. A valid bound start deduplicates with its source point; a missing ID or either exact coordinate mismatch returns `none` for the entire query.

At 09:55 local test-run time, the focused command passed **3 suites / 28 tests**, including **10 new resolver cases**:

```powershell
& 'C:/Users/cristian/.codex/worktrees/cad-shared-controls/Wire_EDM/tmp/node24/node.exe' node_modules/vitest/vitest.mjs run src/features/cad/cadSketchGeometrySnaps.test.ts src/features/cad/cadSketchGraphInteraction.test.ts src/features/cad/cadPathPointSnap.test.ts
```

Evidence includes nonuniform screen metrics, inclusive radial acquisition, source-order/ULP ties and coincident-but-distinct point/midpoint identities; endpoint/center/reference roles and construction ownership; CW/CCW 270-degree and reversed arcs; tiny geometry, distant origins and a tiny sweep; alias/dependency exclusions; stale draft references; frozen detached source/query results and exact unchanged expression strings. Scoped syntactic/semantic TypeScript diagnostics on the three owned TS paths passed. No solver behavior, acceptance tolerance, UI, storage or public edit API changed in this slice; full production build and browser integration belong to the parent task.

## Human interaction implementation

Canvas creation now resolves one raw cursor through the shared query, retaining exact point-ID reuse only for Path endpoints. Other tools and arc-through picks use numeric positions. The shared `CadSketchSnapHint` renders an upright pixel-sized glyph and short reason inside the existing Y-up SVG; the source point or midpoint edge uses the existing pick highlight. Source/frame changes clear the borrowed hover, and temporary Ctrl/Cmd suppression is read again on the accepting click. Keyboard arrows bypass magnetic acquisition so a short step cannot become trapped at distant zoom. Polygon closure requires the acquired actual start instead of the old broad span-based zone.

The first creation regressions failed before the integration (`tmp/sketch-snaps-canvas-red.log`). The initial three related drawing suites pass 69 cases (`tmp/sketch-snaps-canvas.log`). Independent review is checking capture identity and accepted off-grid cursor retention before final acceptance.

GraphLayer drag uses its captured accepted preparation, with self/joint/dependent exclusions and explicit driven-axis reachability. It never builds magnets from a moving preview. Ctrl/Cmd key changes and the releasing event both update the requested target. Source/version/prepared/sketch or center/scale changes cancel the drag, preview and pending submission. Only the current ready preview's actual solved point can confirm attainment; a retained older preview is presentation continuity alone. A projected or failed target shows that constraints limit movement. Existing soft point-move semantics and exact driver strings remain unchanged.

The Layer owner verified 26 focused cases and scoped TypeScript on the two owned paths (`tmp/sketch-snap-layer-{green,types}.log`), including two red-first target/attainment regressions. Deferred preparation and released application cover frame invalidation and late results. Integrated checks and real browser evidence remain with the parent owner.
