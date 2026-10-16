# Declared coincident material joints

Investigation on `feature/sketch-workspace-polish`, after the selection checkpoint `9fdee5c`. Read the sketch checklist, graph compiler, relation validation, solver preparation, region references, analytic export/kernel adapters and isolated arrangement module. The initial investigation changed no production code. The authorized implementation after `d109abe` and its bounded evidence are recorded below; this does not complete sketch mode. No build, remote action or saved user data changed in this agent's work.

## Reproduced gap

The solver already preserves distinct IDs while satisfying `coincident`; its existing rectangle case produces eight solved endpoint records for four edges. `compileCadSketchGraph` still connects only equal endpoint IDs. Its later intersection filter also exempts only shared raw IDs, so fixing adjacency alone would still withhold the new contour.

A read-only audit of a 20 × 10 rectangle with separate closing IDs produced:

| Closing endpoints | Explicit coincidence | Production compiler | Isolated arrangement |
| --- | --- | --- | --- |
| Exactly equal | No | Open, no cycle | One cell |
| Exactly equal | Yes | Open, no cycle | One cell |
| Gap `5e-13` mm | No | Open, no cycle | No cell |
| Gap `5e-13` mm | Yes | Open, no cycle | One cell |

All four retained exact source JSON, including ` width ` expressions. Reproduction script: `tmp/sketch-declared-joint-audit.ts`. The isolated module performs real intersection noding, including exact undeclared endpoint contacts. **Do not wire it into production material for this fix.** Borrow only its declared union and accumulated-residual reasoning.

## Smallest implementation

1. After existing `checkCadSketchGraph` succeeds and coordinates are resolved once, build a transient union of point IDs using **only** `coincident` relations. Shared source IDs already represent the same point. Equal coordinates, zero distance, matching fixed values, H/V relations and proximity do not declare unions. Include every point, so a chain through an orphan or a construction entity's center remains transitive. Points themselves have no construction flag.
2. Check complete coincidence classes against existing `cadPathClosureTolerance`, not just individual relation pairs. The existing arrangement code has a bounding-box fast path and an exact pairwise fallback for accumulated residuals. For example `0 → 8e-13 → 1.6e-12` must reject even though both pair relations pass near the origin. Reject with an honest precision error; never average, snap, rewrite coordinates, widen tolerances or initialize another solver. A small private helper/module is sufficient. No generic topology framework is needed. Keep the unwired arrangement algorithm otherwise separate; a compiler rejection may require its existing accumulated-residual test to expect that earlier rejection.
3. Use class keys for line/arc adjacency, component degree and traversal. Keep construction and ordinary edges in their existing separate passes. A class with degree greater than two remains branched; joining an endpoint to another edge's interior does not split that edge. Reject a nonzero edge whose two endpoints collapse to one class instead of inventing a one-edge closed path.
4. Preserve original analytic segments. During intersection filtering, allow a hit only when it lies within the existing tolerance of **both actual endpoints** belonging to the same declared class. Overlaps and other intersections still require arrangement work. Circles have no endpoint adjacency; a center coincidence never attaches a line to the circle rim. Arc centers, radii, direction and major/minor sweep stay unchanged. Retain `checkCycleEncoding` after ordered path conversion.
5. Preserve deterministic cycle witnesses. Start with the same smallest source entity and its original endpoint-ID ordering; use class keys only to walk connections. Choosing orientation from a new class representative could flip every `reversed` bit when an unrelated lower-ID alias is added. Derived profile IDs and `graphSourceRefs` remain the original entity IDs and orientations, with no saved class IDs or relation-ID hashes.

No saved schema, storage migration, expression rewrite, selector fallback or export-specific joining is required. Ordinary identity-only sketches must compile identically. A compact helper can later be reused by arrangement integration, without importing its intersection events now.

## Focused proof before UI

| Existing seam | Meaningful cases |
| --- | --- |
| Graph compiler | Four separately authored sides close only after explicit coincidence. Equal and equally near undeclared endpoints stay open. Source JSON and supports remain exact. |
| Class validation | Transitive chain through an orphan/construction-only point; reversed relation/source arrays; accumulated residual rejection; translated coordinates using the existing roundoff scale. No coordinate-based retargeting. |
| Cycle and intersection rules | A declared endpoint branch stays branched. Another crossing or overlap still withholds material. Ordinary/construction edges do not combine into one contour. A collapsed endpoint class rejects. |
| Analytic supports | Line/arc and two-arc joins, clockwise major arcs and nested circles. Center-only coincidence does not connect a circle boundary. The existing path encoding precision gate still rejects unreproducible arc endpoints. |
| Regions | Stable source witnesses through reorder, parameter movement and adding a non-boundary alias. Deleting the required coincidence removes the cycle and rejects an active explicit consumer atomically. Deliberate repair uses the existing inspected region mechanism. |
| Shared preparation and native consumers | Extend the existing real-solver rectangle case through material inspection and Pad. One prepared acceptance and one Undo; conflict/cancel keeps the accepted source. Verify 200 mm² area and expected volume, exact DXF line/arc supports and STEP round-trip evidence using existing harnesses. |

`cadSketchToDxf` and CAM already consume the common resolved closed contours. Native Pad/Pocket/Revolve/Loft/Sweep use the same material resolution. Verify those existing adapters with a representative joined line/arc part; do not add separate welding or tessellation paths. Native wire tolerance cannot justify accepting an invalid world-mm joint.

## Compatibility and boundary

Recognizing saved coincidence intent changes material interpretation: a formerly open ignored chain can become a closed contour, potentially changing a whole-sketch consumer's automatic material or holes on rebuild. Record this behavior in compatibility notes and exercise an old schema-2 sketch containing both that chain and an existing closed contour. Explicit cell witnesses must reject changed nesting/source cycles normally. Saved bytes, dormant selectors, plugin snapshots and machine/post packages stay exact. This slice does not solve intersecting cells, point-on-edge relations, trim, general arrangements or broader sketch completion.

## Implemented domain checkpoint

`cadSketchGraphJoints.ts` now provides one transient coincidence-class resolver over already validated resolved points. The compiler uses it for adjacency, traversal and endpoint-only intersection exemptions. Supports, point IDs/scalars and source entity orientation remain authoritative. New precision errors use human wording without raw identity leakage. An ordinary graph with no coincidence relation retains the existing identity-only path. No schema/storage migration or installed package/post change was introduced.

Meaningful red cases first reproduced the missing declared cycle and undetected accumulated drift through unused intermediate points. Final focused verification passed **44 cases** across `cadSketchGraphGeometry.test.ts`, `cadSketchGraphDocument.test.ts`, the existing native solver runtime suite and `cadKernelRegionSelection.test.ts`. Evidence log: `tmp/cad-declared-joints-focused.log`.

Coverage includes exact and roundoff-only declared closure with equal undeclared controls, transitive orphan/construction aliases, original witness orientation under lower-ID aliases and source reorder, accumulated precision failure, branches, construction partitioning, a separate crossing, a collapsed far-origin edge, major arcs/two-arc loops and center-only circle coincidence. The real PlaneGCS eight-point rectangle now resolves to one 200 mm² region. A declared major clockwise arc/chord part preserves its 270° analytic DXF support and exact line endpoints, builds its independently calculated Pad volume and survives STEP import with one solid. Source JSON remains unchanged throughout.

The saved schema-2 regression includes a legacy disk inside the formerly ignored declared rectangle. Whole-sketch material now deliberately measures `200 − π` mm². Its old explicit disk reference rejects changed nesting; a suppressed old reference remains byte-equivalent. Removing a required joint from a selected active consumer rejects atomically, while adding an unrelated lower-ID alias preserves the inspected source witness. These assertions make the semantic compatibility change explicit instead of rewriting a save or repairing a selector.

The separate compiler/arrangement group passed 30 cases before the final export assertion. The unwired arrangement algorithm is untouched; its existing accumulated-drift test now expects the earlier compiler precision rejection. Both isolated arrangement files remain outside this checkpoint's commit scope. UI affordances, public documentation, build and actual browser acceptance belong to the root integration.
