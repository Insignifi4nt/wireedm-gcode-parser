# Intersecting sketch cells: integration seams

2026-10-16, independent read-only architecture review at local `83e0942`. Read the proposed plan, current schema, selection/inspection, source eligibility, private repair, placement/depth and native consumers, and the isolated arrangement draft. No production edits, tests, probes, builds, staging or package/remote work. This pins an implementation contract, not extractor or native certification.

## 1. One explicit catalog at a time

Do not append arrangement cells to the current contour catalog. A nested circle would otherwise appear as both the existing disk and an arrangement disk; a divided closed cycle could appear beside its own subdivisions. Keep two mutually exclusive views behind the existing preparation seam:

- `contours`: the current complete contour forest, current rows/references/default flags/picking and whole-contour union, unchanged.
- `graph-cells`: **all** current graph-owned atomic bounded cells, including ordinary cycles, disconnected disks and nested annuli/disks, exactly once. No old graph-cycle rows are appended. Require a graph and zero nonconstruction legacy profiles. Construction legacy references remain display-only. Reject mixed old/new selection shapes.

Absent selection still means the old Whole sketch resolver. An old reference array still resolves only against that old forest, even when an unrelated graph component now has intersections. A new graph catalog failure must not suppress either compatibility path. Mixed legacy/graph material remains supported through its existing path; explicit graph-cell mode rejects it initially.

Pin these exports at the domain seam; derive persisted types from their TypeBox schemas:

```ts
// Keep CadSketchCellReference and its existing schema byte-shape unchanged.
type CadSketchRegionSelection =
  | readonly CadSketchCellReference[]
  | CadSketchGraphCellSelection;

type CadSketchGraphCellSelection = {
  readonly kind: 'graph-cells';
  readonly sources: readonly CadSketchGraphCellSourceWitness[];
  readonly cells: readonly CadSketchGraphCellDescriptor[];
};
type CadSketchCellMode = 'contours' | 'graph-cells';
type CadSketchCellId = number; // nonnegative safe integer; receipt, never saved

// Pure material accepted by the existing native drawing adapters.
interface CadSketchMaterialBoundary { readonly geometry: ResolvedCadProfile }
interface CadSketchMaterialRegion {
  readonly boundary: CadSketchMaterialBoundary;
  readonly voids: readonly CadSketchMaterialBoundary[];
}
```

Export `CadSketchGraphCellSelectionSchema`, `CadSketchGraphCellSourceWitnessSchema` and `CadSketchGraphCellDescriptorSchema`; extend `CadSketchRegionSelectionSchema` to the old array OR new envelope. Retain old `validateCadSketchRegionSelection` semantics for arrays, and dispatch shape validation for the new envelope. New envelopes require nonempty unique cells and valid source/event references; no transient cell IDs, numeric parameters or coordinates are accepted in them.

`prepareCadSketchCells(sketch, parameters, mode = 'contours')` is the sole picker/inspection preparation entry. Return a discriminated `CadPreparedSketchCatalog` with `mode`, immutable `cells`, `pick(point)`, `selectedCellIds(selection)`, `pack(cellIds)` and `resolve(selection)`. Default overload retains the old prepared-contour type. Common prepared rows have ordinal `id: CadSketchCellId`, `name`, derived `boundary`/`voids`, area/length/bounds. Graph rows additionally have their descriptor, **not** a fabricated profile ID. Legacy rows retain their existing reference and rich contour metadata. The new inspection arm publishes the prepared ordinal as `cellId`; its default legacy arm keeps the old output. The common geometry is `CadSketchMaterialRegion`; old rich contours are structurally compatible. Graph catalogs have no automatic default selection. `pack(ids)` packs one canonical envelope; UI/tool callers do not assemble witness tables themselves.

Keep one preparation/cache owner with lazy catalog slots. Both catalog kinds use the same captured sketch and relevant parameter values. Source replacement or graph/legacy driver changes invalidate them; placement-only changes need not recompute local topology. Do not create a second UI geometry store.

`resolveCadSketchRegions` remains the single material dispatcher: undefined/old array runs the exact current forest branch; a graph envelope runs the pure graph-cell union/resolver. Preserve its rich return overload for undefined/old selectors so default sketch measurements keep `.profile`/depth metadata. Unified/new-selector calls return `readonly CadSketchMaterialRegion[]`. Pad, Pocket, datum-placement checks and depth bounds consume that narrow geometry type. The native code already reads only `boundary.geometry` and hole geometry; it does not need counterfeit profiles or source points.

**Import constraint:** the graph-cell implementation must be schema-independent. Do not import `cadSketchRegionInspection` from `cadSketchGeometry`: Inspection constructs proposal schemas from `cadSchema`, creating a Schema → Geometry → Inspection → Schema initialization cycle. Put pure preparation/union in a leaf domain module reused by the geometry dispatcher and Inspection adapter. Existing accepted-source caching may remain in Inspection; do not move proposal/document parsing into the leaf module.

## 2. Compact persisted topology, transient ordinal receipts

One source witness per participating source across the **entire selection**, not per cell or per span. Each captures entity ID, kind, exact endpoint/center IDs and arc direction, plus its complete ordered event descriptors. Exclude scalar values, radius, coordinates, numeric `t` and expressions from topology identity. Events name the exact declared point component or canonically ordered analytic operand pair/branch, including exact endpoint membership. No proximity class or nearest-event replacement.

Use the analytic incidence-component closure of selected outer/hole supports to capture crossing-operand ownership as well. Each included source/order is serialized once; unrelated disconnected components are excluded. Adding an event anywhere on these witnessed supports may conservatively invalidate the selection. Construction or source-ownership changes invalidate it. This is more conservative than local geometric equivalence and must be documented as such.

Pin `CadSketchGraphCellDescriptor = { outer: DirectedSpan[]; holes: DirectedSpan[][] }`. A range span is `{kind:'range', entityId, from, to, reversed}`, where integer `from/to` index that source's witnessed ordered events and identify consecutive current subedges. A distinct `{kind:'full-circle', entityId, reversed}` has no fake endpoints. Circle event orders are cyclically canonical; the arbitrary angle-zero seam is not saved. Resolve indexes only after exact owner/event-order matching. Recompute analytic subranges from the current source, then require a unique current cell and exact current hole descriptor match. Never persist an ordinal face number as identity.

Use current transient subedge identity to cancel opposite selected incidences and retrace a union once, before native material. Reject duplicate interiors, point-only contacts, ambiguous degree or non-simple boundaries; do not independently extrude overlapping cells or invoke a native fuse to define their union. A disk plus its annulus cancels the circular interface; both divider sides cancel the divider. Store source orders once, construct event/subedge maps once, and serialize the packed selection once. Do not copy the draft's full `orderKey` into every boundary token or construct per-cell full-source serialized keys. Ordinary maps and compact structural tuples suffice; no hashing, crypto, async identity service or persistent catalog UUID.

Inspection keeps its old default/output. Add optional `mode:'graph-cells'` to the existing region read. New rows return small `cellId`, geometry measurements and a derived human label; do not repeat full packed witnesses in every row. Export `CadSketchRegionReadTargetSchema` and its derived `CadSketchRegionReadTarget = string | {readonly cellIds: readonly number[]}`. The string is the existing legacy boundary ID; the object requires nonempty unique nonnegative safe integers. Add mutually exclusive public `cellIds: number[]` arguments to the existing chunked tool alongside `boundaryProfileId`, deriving both from that target. It returns the one packed selection from `catalog.pack(ids)`. Pin version, sketch, mode and **identical optional proposal** on every page/chunk; proposal-owned ordinals never name accepted cells. Cache keys must include that complete scope. A stale receipt rejects, rather than selecting the new occupant of its ordinal. Controller/domain reads validate and detach the mutable target array before the first lazy-import await; guard/cache checks use the captured target. Keep the legacy string overload unchanged.

## 3. Source choice, validation and owned interaction

Pin one `cadSketchCellModeForAreas(sketch, parameters, selection)` helper for explicit picker activation: a current graph envelope requests graph mode; otherwise a graph-only source with usable intersection-derived cells requests graph mode; other sources retain contour mode. A simple/nested graph source may keep its current contour picker until it already owns a graph envelope. Detect intersection-derived cells from prepared topology, not counts, bounding boxes or rounded areas. A graph-catalog failure does not redirect an existing graph envelope to old material.

Opening Choose areas never publishes a replacement selection. If graph mode opens over an old array or Whole sketch, show no invented graph-selected IDs; retain the exact old baseline until a deliberate click. The first click creates the graph envelope. Cancel restores the exact baseline. Do not convert old references automatically, select every new cell or add a mode dropdown. A graph envelope that becomes stale may only be replaced through deliberate current-cell choice.

Export `cadSketchSourceAvailability(sketch, purpose, parameters)` from the existing source-choice module, returning `{kind:'default-material'}`, `{kind:'choose-areas'}` or `{kind:'unavailable', issue, message}`. Pad/Pocket may report explicit-area availability separately from old default material; Revolve can only report default material or unavailable. Keep existing default-material eligibility for Revolve, Loft/Sweep, sketch DXF/CAM handoff and measurements. In particular, globally loosening Workbench's shared `hasMaterial` would expose unsupported lens geometry to those other operations. New Pad may open on an explicit-only source, but cannot Apply until areas are chosen.

`cadSchema.ts:184` currently demands nonempty default regions before checking an Extrude selector. Change the Extrude branch to resolve its supplied selector first and require that result nonempty; absent selection uses the unchanged default. Revolve keeps the old check. Active Pocket already resolves its supplied selector in `resolveCadPocketInputs`; broaden only its selector/material types and retain principal-plane, target, extent, section-scale and instance guards. Shape-valid suppressed selectors remain dormant, as today. The sketch source itself may contain valid open/intersecting graph geometry without material; do not require every sketch to have a selectable cell.

Update the existing region field/overlay, depth bounds, placement precision, private repair and native Pad/Pocket inputs together. Share the same prepared catalog for draw/pick/receipt/union. Replace direct `boundaryProfileId`/`.length` assumptions with small domain helpers, not per-feature variant switches. Private repair must prepare the appropriate current catalog per consumer selector; old and new consumers may be repaired in one Finish without combining their selectors into one mixed catalog. Existing owner tokens, expected version, captured source/frame, abort, stale-result rejection, Back/Cancel and one-Undo Finish remain authoritative. Cache reads must run final public guards even on hits.

This is additive in CAD schema 2: preserve all old arrays/defaults and exact originals on read; no selector migration or saved path copy. Older releases reject the new envelope, so record forward compatibility explicitly. Browser-cache and folder save/reopen, interrupted/conflicting backup behavior and exact old originals remain required integration evidence. Current source operations/proposals, public inspection/chunk reads and human area repair must all resolve through the same graph selector path. No new tool, feature, solver or storage mechanism is needed.

Implementation should start with the shared selector/union plus compatibility regressions, then selected-first schema/eligibility and native material, then the existing owned picker/API adapters. The plan's lens/divider, nested disk/annulus, source-change and human/agent journeys are the acceptance evidence; this review ran none of them.
