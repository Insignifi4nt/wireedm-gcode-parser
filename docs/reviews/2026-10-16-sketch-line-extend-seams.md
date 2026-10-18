# Line Extend after the frozen end-Trim slice

Read-only preparation, 2026-10-16, at `e6049dc` plus the pending end-Trim checkpoint. Only this note was written. No production/test edits, native probes, builds or package commands. The [Trim/Extend plan](2026-10-16-sketch-trim-extend-plan.md) remains the scope reference; this note pins its next implementation seam.

## One operation and one ray query

Extend one graph **line endpoint** outward to the nearest unambiguous finite line/arc/circle boundary. Preserve the source line ID and construction flag. Do not shorten, extend an arc/circle source, join entire curves, move the cutter or use a free cursor location. [Fusion](https://help.autodesk.com/cloudhelp/ENU/Fusion-Sketch/files/SKT-TRIM-EXTEND.htm) documents preview/next-intersection Extend with no-hit rejection. [Onshape](https://cad.onshape.com/help/Content/Sketch/extend.htm) and [FreeCAD](https://github.com/FreeCAD/FreeCAD-documentation/blob/main/wiki/Sketcher_Extend.md) also offer free-location or automatic-constraint modes; those are explicitly outside this first slice.

Add one narrow analytic entry point in [intersections.ts](../../src/domain/path-intel/intersections.ts):

```ts
classifyLineRayPathSegmentIntersection(
  line: LinePathSegment,
  boundary: PathSegment,
  end: 'start' | 'end',
  coincidenceEpsilon: number
): ParameterizedSegmentIntersection
```

Reuse the already exposed detached/frozen parameterized result. `leftParameter` remains the original line's source parameter; `rightParameter` remains the finite cutter's parameter, with null for circles. There is no new normalized ray parameter or artificial endpoint. The existing finite classifier keeps its current behavior and default clipping exactly.

Make the private `intersectLines` and `intersectLineCircular` accept a small defaulted left-range value: segment `[0,1]`, start ray `(-infinity,0]`, end ray `[1,+infinity)`. Change only left clipping and the collinear overlap interval; right-line clipping and circular finite-sweep membership stay unchanged. The line/circle quadratic coefficients, stable roots and tangent discriminant handling are reused verbatim. A collinear cutter interval intersecting the selected ray reports overlap; a single contact remains a point for the domain's transverse check. No long proxy line, sampled curve or unbounded cutter is introduced.

The private range endpoints can be infinite interval bounds, but every returned parameter and point must be finite. Do not feed infinities into midpoint evaluation. The public ray query dispatches only line-line or line-circular cases and owns its detached result just like the finite wrapper.

## Domain contract and reuse

Keep the implementation in [cadSketchTrimExtend.ts](../../src/domain/cad/cadSketchTrimExtend.ts). Proposed concrete exports:

```ts
CadSketchLineExtendTargetSchema
type CadSketchLineExtendTarget = {
  readonly kind: 'line';
  readonly entityId: string;
  readonly end: 'start' | 'end';
  readonly boundary: {
    readonly entityId: string;
    readonly index: number;
    readonly parameter: number; // original source t, below 0 or above 1
    readonly position: readonly [number, number];
    readonly endpointPointId?: string;
  };
  readonly endPointId: string;
};

prepareCadSketchLineExtend({ graph, parameters, entityId, end })
// frozen { target: Omit<Target,'endPointId'>, added: LinePathSegment,
//          extended: LinePathSegment, boundary: PathSegment,
//          point: readonly [number,number] }

extendCadSketchEntity({ graph, parameters, extend })
// frozen { graph, retainedEntityId, endPointId }
```

The constant line kind states actual source intent and leaves room for a separately designed future arc variant. Boundary `parameter` must be any **finite** number, not `CadNumberSchema`'s world-coordinate range or Trim's `[0,1]` range: a short valid line may reach an ordinary target with `|t| > 1e9`. Returned positions still obey existing coordinate limits.

Reuse Trim's source evaluator, `at(line,t)` (already unclamped for lines), support/finite-boundary residual checks, transverse test, exact endpoint detection, declared-joint tie policy, deep freeze, stale-witness comparison and source construction. Extract only the actual common event work into one private helper. Do not add a general geometry-edit framework. Keep operation-specific errors/messages; Extend must not report a Trim-only instruction.

For an end ray, outward distance is `(t-1)*line.length`; for a start ray it is `-t*line.length`. Consider only strictly positive outward events, with a gap exceeding the current nondegenerate/roundoff budget. Order by outward distance, then stable entity ID. The original source endpoint is an existing contact, not an extension. A nearer ambiguous event must never be skipped to choose a farther hit. Initial tangent/overlap rejection may stay conservative across the selected ray, consistently with Trim; that can reject a valid nearer crossing when another unsupported event exists farther away. Record that limitation rather than claiming a more permissive nearest-event proof.

Line/arc/circle boundaries remain finite: a line's infinite extension, an arc's complementary circle sector and hits behind the selected source endpoint cannot become candidates. Construction boundaries remain usable and unchanged. Validate the independently evaluated source point against the actual finite boundary before accepting it; arithmetic that cannot represent both supports rejects under existing roundoff. No projection or tolerance change.

## Identity and acceptance

The witness uses the exact pair/event index, source parameter, position and optional endpoint identity returned by the query. The constructor recomputes it and demands equality before editing; moved/replaced boundaries or a changed nearest hit cannot silently retarget. Menu/source/version guards remain necessary even when a geometric witness happens to match.

When `endpointPointId` is present, require `endPointId` to equal that actual witnessed endpoint ID. Otherwise require a fresh ID and append one numeric point. Preserve every old point/scalar and relation; replace only the selected endpoint reference of the retained line. Keep the detached old endpoint under the established no-GC policy. A boundary-interior hit is a one-time numeric contact, with no point-on-object relation, automatic cutter split or saved coincidence. Explicit endpoint reuse is a real authored attachment. Branch/intersection material limits remain those of the current compiler.

Reuse the conservative owner predicate: whole-line relations and any driver/point relation on the endpoint being detached block; untouched-end and unrelated drivers survive exactly. A string coordinate on the detached endpoint is a source driver, including numeric text. Expose actual bounded relation/point IDs through an Extend dependency error; explicit earlier removal in the same batch is permitted, automatic release is not.

Add one `extend-sketch-entity` edit and mutually exclusive region-proposal arm using this constructor. Existing preparation must flush preceding solves and require full-candidate equality after normal native solving, just as Split/Trim do. No new native primitive or equation is required. Whole-part acceptance, private consumed-sketch draft/local Undo, Finish, explicit stale-area repair and one atomic agent batch stay on existing paths.

Root can add endpoint-specific context-menu choices beside Split/Trim; hovering/focusing highlights only the added line interval, actual target and final endpoint. Do not infer an end from source-vector direction or silently select at a midpoint tie. IDs are allocated once, and source/frame/cancel/late-result ownership is the existing menu submission owner.

## Small red-first proof and expected size

1. Ray math: forward and backward line hits with source `t=2`/`t=-1`; preserve finite cutter range. A circle yields both real roots when on the ray, while an arc exposes only its saved signed sector. Original finite-classifier results remain unchanged; output is detached/frozen.
2. Domain: select the nearer of two outward crossings; reversed source endpoints and reordered arrays preserve the same physical end. No hit, behind-only hit, zero-length extension, tangent, collinear overlap and undeclared tied contacts reject. A declared endpoint-joint tie is stable, with exact endpoint reuse and no extra relation.
3. Numeric/ownership: a valid small source can have a large finite t without a fake range rejection; independently check actual support at the returned coordinates. Stale witness, ID collision, source-circle/arc, fixed-string endpoint and whole-line owners reject unchanged; unrelated driver strings survive. A finite cutter's complementary support never qualifies.
4. Shared acceptance: one ordinary numeric endpoint and one explicit endpoint-attachment case through the existing real native preparation must return exactly the constructor candidate. An injected projected cutter/end rejects. Prior parameter edits, abort, changed version and late completion preserve snapshot/history. Reuse the existing consumed-area proposal/repair regression rather than inventing another workflow.

Estimate before implementation: **25–45 net production lines** in intersections for range clipping, dispatch and frozen exposure; **100–150 net lines** in the existing domain module for schema/query/construction plus shared-helper extraction; roughly **30–50 adapter lines** across the existing edit/preparation/draft/proposal paths. UI is separate, likely a small existing-preview/menu extension. These are estimates, not a reason to compress guards or add a framework. No implementation starts until the Trim checkpoint is accepted and root dispatches it.
