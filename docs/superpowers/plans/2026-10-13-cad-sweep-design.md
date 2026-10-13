# Open reference curves and solid sweep

Status: Curve foundation approved for implementation by the coordinator under the ongoing autonomous CAD request. Path authoring is checkpointed at `14b6914`. Ship the reusable Curve foundation first; add Sweep only after its clearance preflight and native regressions pass. Sweep remains a design proposal.

## Terms and scope

A material contour is a closed boundary in a sketch. Existing nesting determines material regions, voids and islands. An open reference curve is one ordered connected planar chain of analytic lines and circular arcs. It has a start and an end, remains editable in feature history, and produces no solid. A sweep transports one material section along a reference curve to produce a solid.

Keep open curves separate from existing `CadProfile` values. In particular, do not weaken the closed-path invariant, encode a rail as a construction material contour, or insert an invisible closing edge. Curve references are useful on their own for exact lengths, bounds, endpoints, dimension editing and interchange.

## Proposed saved contracts

```ts
interface CadCurveFeature extends CadFeatureBase {
  readonly kind: 'curve';
  readonly plane: CadPlane;
  readonly offset: CadScalar;
  readonly segments: readonly CadPathSegment[];
  readonly source?: CadDxfImportSource;
}

interface CadSweepFeature extends CadFeatureBase {
  readonly kind: 'sweep';
  readonly sketchId: string;
  readonly curveId: string;
  readonly operation: 'new' | 'join' | 'cut';
  readonly targetId: string | null;
}
```

`CadPathSegment` already contains expression-backed line endpoints and circular center, radius, start angle and signed sweep. Reuse those primitives without giving the open chain a material-profile type. No contour roles, implicit expressions, tessellated rail data, raw topology keys or native BRep belong in these features. A Curve has no `construction` flag because its feature kind already defines it as reference geometry.

These additions retain document format/schema version 1 and the existing 4 MiB limit. Old documents parse and save without adding fields or rewriting geometry. Older app builds cannot read the new feature kinds; release compatibility documentation must say so. Browser cache and folder persistence use the same immutable document and existing journal writes. DXF provenance retains exact original text, filename and explicit source units under existing validation and aggregate source limits.

## Curve validation and APIs

Use strict own-data TypeBox boundaries before reading values. Persist 1–2048 segments per Curve and count them in the existing 8192 document-edge budget. All scalars keep the existing expression parser, parameter count, expression length and finite coordinate limits. Evaluate angles through the existing normalized start-angle helper and signed sweep without changing its magnitude. Radii remain greater than `1e-7` and at most `1e6` mm. Every edge needs nonzero length beyond the existing geometry precision.

Resolve ordered endpoints and analytic entities without signed-area canonicalization. Require every consecutive joint to satisfy the unchanged `cadPathClosureTolerance`; never move endpoints or bridge gaps. The first and last endpoints must be distinct beyond that precision. Reject overlap, crossing, repeated edges, non-adjacent touching, full-circle loops and closed chains. Adjacent edges may share their single chain joint but cannot overlap elsewhere. A simple sharp corner is valid reference geometry even if it is not eligible for Sweep.

Factor the existing analytic edge preparation and exact line/arc intersection predicates so closed material paths and open curves share math but explicitly select different closure invariants. Do not pass an open rail into `cadProfileToEntities`, which can reverse a closed contour based on its area. Existing closed-path acceptance and rejection must remain unchanged by this extraction.

Proposed focused modules and functions:

```ts
resolveCadCurve(curve, parameters): CadResolvedCurve
inspectCadCurve(curve, parameters): CadCurveInspection
measureCadCurve(document, curveId): CadCurveMeasurements
createCadOpenCurveSegments(start, steps): readonly ResolvedCadPathSegment[]
finishCadCurveDraft(draft): readonly ResolvedCadPathSegment[]
```

`CadResolvedCurve` contains frozen ordered numeric segments/entities, local and world start/end, start/end unit tangents, plane/offset, length and local/world bounds. `resolveCadCurve` validates geometry regardless of suppression for editing and display. Inspection reports activity and geometry diagnostics explicitly. Measurement reports length, bounds and endpoints without inventing area or CAM classification.

Numeric drawing construction shares `createCadThreePointArc`, including its conditioning and actual stored-endpoint checks. `createCadOpenCurveSegments` and `finishCadCurveDraft` never add a closing edge. They retain the draft after success or failure; the application clears it only after the complete feature edit commits. Declarative edits can retain expressions directly instead of using these numeric constructors.

Move the pure right-handed principal-plane basis into a shared domain helper, with the kernel forwarding to it. The XZ normal is `[0,-1,0]`; offset advice must use that sign. Local-to-world mapping is `u*x + v*y + normal*offset`. Compute an arc tangent from its stored angle and signed sweep, preserving clockwise and major-arc traversal.

## History and body semantics

Extend `cadFeatureInputs` with `curveIds`. Sweep references exactly one preceding sketch and one preceding Curve; body inputs contain only its optional target. Dependencies include every typed reference, so reordering, safe deletion and explicit cascade work through the existing operations. A Curve remains reusable after any number of sweeps.

Introduce one exhaustive reference/body classification helper. Current `kind !== 'sketch'` tests would incorrectly classify a Curve as a solid and must be replaced across domain, kernel and UI. Reference features produce and consume no bodies. New Sweep produces one generated operand; join/cut consumes its target only after a successful native operation, and conservative instances equal one plus target instances. Existing Pad/Revolve budget behavior stays unchanged. Patterns and the new generator share the 1000-instance limit.

Suppressed Sweep still validates strict structure, preceding typed references and new/join/cut target relationships. Skip active section, alignment and clearance eligibility while suppressed, as for Loft. Its source curves and sketches retain their own geometry validation. Unsuppressing an incompatible sweep must fail atomically without losing the edited draft.

## Curve authoring and interchange first

Create Curve as one pending workflow containing plane, offset and the open Line/3-point Arc draft. Do not save an empty feature before drawing. Use the existing numeric draft and SVG primitives, with explicit **Finish curve**, **Undo last** and **Cancel drawing**. Finish validates the open chain and applies one complete feature edit. Keyboard placement and cancellation use the same guards as Path; a different pending name, parameter or property workflow blocks drawing.

The tree and timeline identify Curve separately from Sketch. A plane-local canvas edits its segments; scene reference rendering shows its world placement separately from solid meshes and selectable body topology. The property editor retains numeric or expression dimensions. Length/bounds inspection, CAD JSON and Curve DXF export provide immediate utility without a Sweep button.

Add explicit open-curve DXF import using the existing bounded parser, exact segment math, unit metadata and unsupported/3D rejection. Initially accept one complete connected open chain only. Reject closed components, multiple chains, branches and mixed open/closed content rather than dropping data or duplicating a large original source across many features. Preserve original source on the single Curve. Existing closed-sketch DXF import keeps its behavior and entry point.

Curve DXF export uses local millimetres and a standard ordered open LWPOLYLINE with signed bulges. Check its endpoint/bulge encoding against the original circular support, sweep and joints at existing precision; reject uncertain encoding explicitly. This retains authored direction, which separate DXF ARC entities cannot encode for a single clockwise rail. Add no proprietary XDATA, material/CAM layers or implicit handoff. Import reconstructs the polyline's supplied order and signed sweeps; never silently reverse a rail.

Shared agent operations use normal guarded edits for Curve mutation, plus read-only construction/measurement helpers and bounded DXF receipts. Construction remains numeric; feature edits preserve expressions. No Curve-to-CAM operation is added.

## Sweep placement and native scope

Preserve the source sketch's world position and orientation. Require its plane to contain the actual rail start and its normal to be parallel or antiparallel to the first rail tangent. Do not automatically relocate, rotate, centre, reverse or scale the profile. With current principal sketch planes, the initial rail tangent must align with a principal plane normal. Return actionable required plane/offset advice when it does not. Future arbitrary sketch planes can broaden this without changing the Curve model.

Initially require one active material boundary without voids or additional regions, and an active simple open G1 rail. Construction profiles are ignored explicitly. Shared `inspectCadSweepInputs` and `resolveCadSweepInputs` return the section, resolved curve, frame, precision and eligibility diagnostics. Reuse section resolution with Loft while preserving its existing error contracts; avoid a second nesting algorithm.

Native probes by `cad_kernel` establish that `PipeShell` at the actual start vertex with contact/correction disabled preserves authored placement. A fixed binormal equal to the rail plane normal gives deterministic planar transport for straight, quarter-circle, tangent line/arc, clockwise and major-270-degree rails. Use explicit native settings and finally-owned builder/wire/handle cleanup. Validate one closed positive solid and existing output limits before replacing a target. Holes and non-tangent corner modes remain separate later capabilities.

## Sweep clearance proof before release

Native solid validity is insufficient. The installed kernel accepts a radius-3 circular section along a radius-2 quarter-circle rail as one BRepCheck-valid positive solid despite a folded torus. A tight G1 return rail can also produce a valid-positive body with branching sections. Sharp corner transition modes materially differ. Do not infer geometric safety from volume or BRepCheck alone.

Use a conservative analytic clearance envelope for the planar rail:

1. Bound the entire section's distance from the actual rail start by a safely outward-rounded radius `r`. Include off-centre profiles and coordinate-scale uncertainty.
2. Every rail arc radius must exceed `r` by native/ULP margin, so the local normal-map Jacobian cannot vanish.
3. Construct exact planar offsets at `+r` and `-r` and two endpoint semicircle caps. Require the resulting ordered envelope to be closed, simple and free of touching/overlap, with valid traversal. Derived data is bounded by `2*2048+2` edges; do not materialize quadratic pair arrays.
4. Reject numerical uncertainty, not just obvious crossings. Reuse analytic predicates without broadening closure tolerance or repairing offsets.

This is a sufficient supported-scope proof, not a necessary test for every possible section. Report `unsupported-sweep-clearance` when a section's enclosing disk fails, with the measured section radius and rail limits. A rejected wide or offset section may still be valid under a more precise future proof. Once the tube is injective, its bounding disk contains the transported material and rules out local folding and nonlocal overlap. Kernel result checks still run afterward.

## Meaningful verification

Curve foundation tests should cover all principal planes and signed offsets, parameter propagation and invalid atomic edits, open lines, clockwise/minor/major/seam arcs, mixed chains, far-origin endpoint precision, disconnected/closed/self-touching/overlapping rejection, 2048/8192 limits, strict unknown input, suppression, reorder/cascade and immutable undo/redo. UI tests must prove no empty saved Curve, retained draft after failed Finish, no hidden closing edge, mode/undo/cancel semantics, pending workflow locks and constant work during hover. DXF tests must prove exact local geometry, chosen traversal contract, units/conflicts, provenance and rejection without partial import.

Sweep tests should include circle and non-circular sections, straight and G1 curved rails on all planes, negative normals, nonzero offsets, reversed/major rails, explicit placement errors, unsupported sharp corners, oversized radius, close return rails, endcap contact and numeric clearance uncertainty. Real-WASM checks should compare straight volume to section area times length, curved circular section volume to its exact analytic value, final sections to exact circles/lines where supported, and STEP export. Failure injection must release temporary native resources and preserve targets. Add parameter, dependency, suppression and expanded-budget regressions before exposing UI or agent authoring.

## Sources and ownership

The official [Open CASCADE PipeShell reference](https://occt3d.com/dev/doc/refman/html/class_b_rep_offset_a_p_i___make_pipe_shell.html) distinguishes explicit placement, correction and transition settings. [Autodesk's Sweep reference](https://help.autodesk.com/cloudhelp/ENU/Fusion-Model/files/SLD-REF-SWEEP.htm) describes profiles and paths as separate inputs. These sources guide terminology; installed-kernel probes above determine supported behavior.

Domain owns curve types/schema, shared ordered-chain and plane math, dependency/body classification and construction/measurement. UI owns atomic curve creation, editing/rendering and workflow tests. The kernel agent owns exact curve DXF exchange and current native dispatch integration for the Curve phase; future native sweep construction and preflight require their own reviewed checkpoint. Root owns controller/shared agent operations, public guides, integration tests and local checkpoint commits. API tests precede exposed controls.
