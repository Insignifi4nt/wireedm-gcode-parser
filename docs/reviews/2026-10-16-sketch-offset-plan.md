# Exact detached sketch offset

2026-10-16, assessment at accepted checkpoint `b77d517`. Implementation of this bounded S17 slice is now in progress on the local branch. The assessment itself performed no source/test edits, probes, tests, builds, package changes or remote writes. Acceptance evidence will be recorded separately after implementation.

## Recommended scope

Create one independent numeric copy of one selected simple closed loop, at a typed signed distance. Positive means outside that loop; negative means inside. This is geometric inside/outside of the selected outline, independent of its nesting or whether it currently bounds a material hole. Show the full source loop, result and actual side before Apply. Retain the source exactly. The result has new graph identities and shared authored joints, with no association, copied source constraints or persistent offset dimension.

Support circles, simple line polygons, and closed mixed line/circular-arc chains whose curved joints are smooth. Use intersection/miter joins at sharp line-line corners and analytic common-normal joins at smooth joints. This covers ordinary rectangles, polygons, slots, rounded rectangles and suitable graph paths. Initially reject sharp line-arc/arc-arc joints, open/branched/intersecting sources, topology-changing offsets and arbitrary plugins. Do not present this as all of S17 being complete.

These choices are our contract. Onshape supports selected curves/loops, a typed distance and an explicit direction arrow; negative distance reverses side. Fusion accepts curves, connected chains or profiles and creates offset constraints/dimensions, with a separate association-removal action. Our first slice deliberately creates the detached copy directly. [Onshape Offset](https://cad.onshape.com/help/Content/Sketch/offset.htm), [Fusion Offset](https://help.autodesk.com/cloudhelp/ENU/Fusion-Sketch/files/SKT-OFFSET.htm)

FreeCAD documents lines/circles/arcs, separate Arc/Intersection modes and an optional offset constraint. That supports making join and association behavior explicit; it does not establish our exact identity or rejection policy. [Official FreeCAD Offset source](https://github.com/FreeCAD/FreeCAD-documentation/blob/main/wiki/Sketcher_Offset.md)

## Existing code and reuse decision

| Existing boundary | What to reuse, and what it does not provide |
| --- | --- |
| `cadSketchGraphGeometry.ts`, `compileCadSketchGeometry.ts` | Exact validated degree-two cycles, source-oriented `sourceRefs` and signed circular paths; graph circle becomes one closed contour. Branching/crossing cycles are withheld. No new arrangement work. |
| `cadSketchGeometry.ts` | Resolve standard legacy profiles once, exact `cadProfileToEntities` and existing contour closure/intersection/containment validation. Its primitive output is counterclockwise. New graph copies do not promote or rewrite the original legacy group. |
| `cadAnalyticSegments.ts`, path-intel `segments.ts` and `intersections.ts` | Signed sweeps, analytic area/bounds, current arithmetic closure policy and exact finite intersection classification. Reuse them for acceptance; do not use tessellation or path-planning endpoint clustering. |
| `cadSweepClearance.ts` private `envelope` | Existing line-normal translation and signed arc-radius formulas are relevant math. The enclosing sweep has tangent-only open-path assumptions, caps and clearance reserves. Do not call that private operation as a general sketch offset or move its entire policy into sketching. |
| `cadSketchTranslation.ts`, `cadEditPreparation.ts` | Preceding-edit flush, numeric-copy evaluation, immutable source and full constructed-candidate equality after native solving. Offset needs the same exact-edit certificate. Translation is not offset geometry. |
| `cadSketchRegionInspection.ts`, `cadSketchRegionSelection.ts` | Existing proposal/read paths, current graph contour witnesses, nesting and explicit consumer-area repair. A loop is one boundary, not an entire cell plus all holes. |
| `domain/compensation/*` | Controller compensation intent and post-dependent resolution. There is no reusable contour-offset builder here, and sketch authoring must not change these records or installed packages. |

Pinned Replicad 1.1.0 offers `Wire.offset2D(distance, 'arc'|'intersection'|'tangent')`; installed `dist/replicad.js` calls OCC `BRepOffsetAPI_MakeOffset`, consumes the input wire and requires one returned wire. `Drawing.offset` has different 2D join options; its installed `offsetBlueprint` splits/prunes/stitches intersecting curves and can return several blueprints. Neither supplies our graph identity mapping, source-preserving preparation or strict analytic result certificate. [Official Wire API](https://replicad.xyz/docs/api/classes/Wire/#offset2d)

Use a small pure analytic module for the scope above. Native offset remains a possible later route for broader joins/topology changes, but would need an async kernel operation, exact ordered edge extraction/type rejection and fresh-ID correspondence. Merely returning a successful wire would not meet this slice's contract. No new native binding, dependency, package redistribution or solver relation is needed for the proposed scope.

## Geometry and nonrepairing acceptance

1. Resolve one current loop into a detached ordered analytic chain. Normalize only this working traversal to counterclockwise. Preserve original IDs, scalars, arrays, direction and package definitions. Keep a source-to-output edge map even when traversal reverses.
2. For signed outward distance `d`, move each oriented line along its right unit normal by `d`. For a circular arc with signed traversal `s`, use the same center and `r' = r + sign(s) * d`. A standalone circle uses `r' = r + d`. Concave arcs therefore shrink on an outward offset. Check radius/coordinate/length limits before publishing a preview.
3. At a sharp line-line joint, intersect the two offset infinite supports. Require a numerically determined intersection, directed nondegenerate remainders and the same local corner branch. Do not fabricate a long proxy segment. A straight continuous line-line joint translates its explicit source joint once. A reversal/overlap is unsupported. Miter corners extend supports and can be farther than `abs(d)` from the original vertex; do not describe every miter point as an equal nearest-distance point.
4. At a smooth joint involving an arc, require matching directed source tangents under the existing precision policy. Translate a deterministic authored endpoint along its common right normal once and reuse its new point ID for both output edges. Check it against both exact target supports, including arc endpoint radii. Declared graph adjacency or ordered legacy primitive ownership supplies the joint; coordinate proximity never creates one. Do not average disagreeing supports or project/heal an endpoint. Sharp curved joints need a later explicit branch/join policy and reject initially.
5. Check line support distance, preserved direction, arc center/radius/signed coverage and every shared joint independently. Preserve major/minor branch and traversal. Reject collapse, radius sign changes, lost/reversed segments, uncertain remote miters and unrepresentable coordinates. Apply existing domain policies, including strict structural arc checks; no tolerance widening.
6. Validate the new loop alone, then the complete source-plus-copy sketch using existing analytic self/intersection and containment checks. Reject self-touch/overlap, nonadjacent crossings and contact with other material contours. Do not prune lobes, remove edges, choose a remaining island or integrate arrangement cells. For an inset require strict containment in the source; for an outset require the reverse. This prevents a large inward request from becoming an unrelated inverted loop.
7. Allocate one new graph point per output joint, one center per output arc and one entity per retained source edge; a full circle has one new center and entity. Reuse a generated joint identity by authored adjacency, never by a coordinate search. No old point ID is borrowed. Return a deeply immutable graph addition and check the complete identity namespace when appending.

Zero distance is a true no-op: no emitted geometry or reserved identities, appended coincident copy, history entry or native work. The UI can retain already allocated preview names without appending them. A nonzero request that rounds back to the original support is a precision rejection. The requested expression is evaluated against current parameters for this operation; it is not saved as an associative driver on the result. Parameter/source changes after acceptance leave the copy in place. Source formulas retain their exact original strings.

## Minimal shared authoring contract

Prefer one domain module, `cadSketchOffset.ts`, with a source resolver/preparer and constructor used by preview, reducer and proposal. Proposed request shape:

```ts
type CadSketchOffsetSource =
  | { kind: 'profile'; profileId: string }
  | { kind: 'graph-cycle'; sourceRefs: readonly CadSketchGraphSourceRef[] };
type CadSketchOffsetRequest = {
  source: CadSketchOffsetSource;
  distance: CadScalar;
  idPrefix: string;
};
// CadEdit arm, strict schemas derived at their owning boundaries:
// { kind: 'offset-sketch-loop', sketchId, ...request }
```

The graph witness must match one current complete compiler cycle, not a subset or a guessed chain. Existing region reads already expose graph contour `sourceRefs`; legacy profiles use their actual source ID. For the first complete checkpoint, limit eligibility to nonconstruction material outlines so the current inspection API can discover every eligible source. Construction-loop discovery and plugin sources can follow without pretending they are already covered.

`prepareCadSketchOffset({sketch, parameters, ...request})` returns `{sketch, sourceSegments, resultSegments, distanceMm}`. One shared preparer constructs and validates the complete result. `idPrefix` uses the identifier alphabet and has a maximum length of 64 characters, leaving room for deterministic suffixes within existing identifiers. A circle emits `_c0` and `_e0`; a chain emits joint `_p<i>`, edge `_e<i>` and each arc center `_c<edgeIndex>`. Pin indices to deterministic resolved source traversal before evaluating the distance. Keep this naming convention stable. Topology changes are rejected, so distance or side changes retain the same identities. Check actual emitted IDs against the complete sketch namespace; no random retries, prefix reservation or whole-document namespace change. The UI allocates its prefix once per owned editor. Agents supply one prefix rather than identity arrays. Zero emits nothing and leaves the prefix unused. Do not accept caller-computed geometry in place of this operation. Reuse the existing append/parser boundary where appropriate.

Do not route rounded/slot output through `createCadFreshSketchGraph`, which deliberately rejects those fresh profile kinds. This operation constructs a new free analytic graph chain directly. Initial G1 geometry does not promise persistent slot/capsule correlations or a Tangent relation. The original legacy group/package and the existing fresh-authoring policy remain unchanged. Actual rounded-loop closure, radius preservation and native whole-candidate equality must pass before advertising those sources.

Use one narrow new edit arm in `CadOperations`, available through existing guarded `cad_edit_document` and private draft paths. Flush preceding solves before source resolution; run normal native preparation and require full-candidate equality afterward. A source-only numeric offset needs no solver optimization, but structural arcs still undergo the real native/checker acceptance. Native drift or source movement rejects the edit atomically.

Add `proposal.offset` to the existing mutually exclusive region proposal union. It calls this same preparer with the same request and optional preceding numeric parameter values, then returns proposed cells/references. Agents can batch offset plus deliberate consumer-selector updates. No standalone offset tool, history mechanism or saved feature/schema migration is required. Public edit discovery/guide must explain signed side, detached result, deterministic naming and limits.

## Human ownership and consumed parts

Selecting one graph edge resolves its unique whole eligible cycle; selecting a legacy profile uses that profile. Highlight the complete loop before opening Offset. Multiple loops, point-only selection or an ineligible component must ask for a unique source rather than guessing. Reuse the existing ScalarField/context/preview/submission controls with an explicit visible Inside/Outside choice and the message "Independent copy. No offset relation." Direction changes must update the displayed signed scalar deliberately, including an explicit expression wrapper when needed.

Pin document/sketch/version, source graph/profile, parameters and selected loop witness for the owned editor. The numeric form does not depend on a pointer position or camera frame; panning need not retarget it. A source replacement cancels/requires reopening. Escape/Cancel/unmount abort pending work; stale completion cannot append or restore selection. Apply makes one local sketch edit and selects the new loop. No mutation occurs during preview. A direct distance drag handle is optional only if it reuses an existing owner and the same scalar update; it is not required for the first complete typed-distance workflow.

Adding a nested loop can turn part of an existing automatically consumed profile into a hole. Preserve the current private sketch local Undo/Redo and Cancel; Finish validates the entire part once. Existing explicit region signatures can become stale through changed nesting, so use the established area-repair picker instead of quietly choosing new material. Agent proposals supply the same repair opportunity. Saved source and installed packages remain untouched until normal accepted session/storage operations.

## Red-first evidence and ownership budget

Keep tests at the new constructor, shared edit preparation and actual UI/session boundaries.

- Known analytic results: `40 × 20` rectangle at `+2` gives `44 × 24`, area `1056`; at `-2` gives `36 × 16`, area `576`. A radius-10 circle gives radius 12 or 8. A rotated capsule with length 30/width 10 retains its cap centers at offset 2, has radius 7 and area `280 + 49π`. Include a concave line polygon and one signed major-arc loop where the stated join scope applies, source reversal/reorder, exact formula retention and detached behavior after later source changes.
- Real boundaries: collapse/large inset, sharp curved corner, self-intersection/contact, stale cycle membership, bad/colliding IDs, output model limits and zero no-op. Assert failures preserve the full source. Check generated closure by shared IDs and actual analytic supports, not sampled pixels or a test that repeats the implementation.
- Two useful pinned native preparation cases: ordinary graph line/arc offset and legacy rotated slot copied to graph. Require exact whole candidate equality, unchanged original strings/entities/relations, correct region area and later independent movement. Report any structural-precision rejection; do not start a tuning matrix.
- One consumed plate workflow covers live side/distance preview, Cancel, deferred abort/source replacement, Apply/local Undo and Finish with deliberate area repair, actual Pad volume, part Undo and save/reopen. Exercise the same source/identities through region proposal plus guarded agent batch. Reuse existing journeys where practical.

Implementation ownership: the domain owner handles `cadSketchOffset.ts` and pure geometry/identity tests; the adapter owner handles operations/preparation/private/proposal/discovery and two real-native cases; the UI owner handles selection-to-loop resolution, the compact editor and prepared preview. Root handles public docs, complete browser journey, acceptance and local checkpoint. The shared request/result and prefix convention above are agreed before parallel writes. Independent review checks joins, branch preservation and receipt ownership after freeze.

Expect roughly 200–300 production lines for the bounded analytic builder, 80–140 across shared adapters, and 100–180 for selection/form/preview integration, excluding tests and documentation. This is an estimate, not a budget to fill. If general curved joins or topology surgery are required to make the first accepted example work, stop and reduce/clarify the claimed scope rather than importing a second offset framework. No runtime evidence was collected in this assessment.
