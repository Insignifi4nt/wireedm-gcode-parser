# Datum planes and sketch placement

Status: world datum slice implemented and verified locally after checkpoint 5dc6b1a. Domain/native, storage, UI and shared agent acceptance gates pass. Plane creation, local Sketch/Curve placement, Pad/Revolve and bounded inspection/capture are enabled. Face attachment and frame-aware Loft/Sweep/Pocket remain follow-on work. The historical proposals below explain the implementation decisions.

## Useful next slice

Add an independent world datum plane, then create ordinary local sketches and open Curves on it. A tilted mounting pad currently requires drawing on a principal plane, building a body and rotating that body afterward; the sketch and open references remain in the original plane. A datum permits the sketch and its design intent to share the actual tilted placement. Origin and tilt can follow named parameters without transforming saved profile coordinates.

Ship world datums before live face attachment. The first native gate is tilted Pad/Revolve, local editing, 3D reference viewing, analytic measurement and JSON/DXF interchange. Loft/Sweep/Pocket must either gain verified frame-aware handling in that slice or reject new datum inputs with explicit capability diagnostics before accepting an edit. Existing principal inputs remain supported. Do not expose a plane choice that later falls through principal-only branches.

## Strict additive document contract

Keep `CadPlane = 'XY' | 'XZ' | 'YZ'` for principal planes, mirror planes and current section requests. Introduce a separate sketch placement reference:

```ts
type CadSketchPlane = CadPlane
  | { readonly kind: 'datum-plane'; readonly featureId: string };

interface CadDatumPlaneFeature extends CadFeatureBase {
  readonly kind: 'datum-plane';
  readonly definition: {
    readonly kind: 'world';
    readonly basePlane: CadPlane;
    readonly origin: CadPoint3;
    readonly rotation: CadPoint3;
  };
}
```

Sketch and Curve widen only their `plane` field to `CadSketchPlane`. Their existing `offset` remains a signed displacement along the resolved normal. Profiles, segments, parameters and exact import sources are unchanged. A datum's origin is a world millimetre point; rotation is degrees applied around world X, then Y, then Z to its base basis, matching existing Transform order. Rotation does not rotate its origin. This supports expression-backed angles using the current arithmetic grammar, which has no trigonometric functions.

Use strict own-data schemas with no inactive normal, matrix or attachment fields in the world definition. Keep document schema version 1 and the existing 256-feature/8192-edge/4 MiB limits. Old principal documents must serialize without adding fields or changing XZ's negative-Y offset semantics. Older builds cannot read the new kind/placement arm; release compatibility must state that. No storage migration or new namespace is needed.

## One frame interface

Use a pure frozen resolved frame `{ origin, u, v, normal }`, with right-handed orthonormal axes. Focused helpers should resolve the world datum and sketch placement, map local points/directions, and inspect supported precision. Consumers receive frames rather than repeating principal-plane switches. Principal adapters return the existing bases exactly.

Evaluate coordinates/angles through existing bounded scalar rules. Reduce whole turns as existing rotations do; handle exact cardinal angles explicitly so a nominal quarter-turn does not acquire a spurious far-coordinate component. Normalize only bounded arithmetic residuals from the computed rotation; reject malformed or uncertain frames instead of choosing a fallback axis. Bound dimension-amplified angular/translation uncertainty for native construction, preserving the current operation precision reserves. Never bake resolved frames or parameter values into saved geometry.

World bounds need a deliberate change. Curve and viewport currently transform only two opposite local-bound corners; that works for principal axis permutations but underbounds arbitrary rotations. Use line endpoints and each circle/arc's coordinate extrema (`u_i*cos(t)+v_i*sin(t)`) with outward rounding, or clearly marked conservative four-corner bounds. Display tessellation remains bounded and does not decide dimensions or native validity. Local path continuity and nesting retain their existing tolerances.

## Dependencies and later face attachment

Extend typed inputs with `datumIds` and `bodyReferenceIds`. `bodyIds` remains Boolean/transform operands consumed by successful solid features. A datum is reference geometry, produces no body, adds no pattern instances and consumes nothing. Sketch/Curve reference only a preceding datum; missing/later/wrong-type references fail even when suppressed. Active sources must resolve; suppressed dependent history remains repairable. Delete/cascade, reorder and undo use the same dependency graph.

The later datum definition can be `planar-face`, with an explicit source body, geometric `CadFaceQuery` requiring exactly one planar face, an explicit origin anchor and an explicit roll direction. The anchor must distinguish face centroid from a projected world point. Never use undocumented native UV axes, raw topology keys or automatic fallback roll. Reject a roll direction parallel to the face normal.

At the datum's position in history, its source must be a current native body. Resolve the face and freeze only its numeric frame in the build's reference map. Later features may consume that body normally. The current kernel deletes consumed body/topology records; replaying the ordered prefix and retaining the frame avoids keeping all historical topology alive. A missing/ambiguous/nonplanar query stops rebuild and blocks solid export, preserving the preceding valid preview.

Pick-generated plane/centroid/area predicates are fixed geometric signatures, not general topological naming. A source resize may invalidate them. Following a known top face can use an explicit plane offset expression such as `thickness` and exact expected count; no nearest-face fallback or silent query repair. A face pick conversion must pin document version, opaque build ID and body ID, validate the returned identity after cancellation/version checks, then persist the reviewed geometric query only.

Face-attached placement needs current-build frame receipts for viewport/world inspection. Keep those detached, bounded, version/build stamped and ephemeral. Local dimensions and local DXF can remain independently measurable, but must not claim a resolved world placement when native attachment fails. JSON preserves the original definition and source, not native BRep or cached topology.

## Inventory and ownership

- Domain: `cadDocument`, `cadPrimitives`/`cadSchema`, `cadFeatureInputs`, `cadPlanes`, Curve resolution/measurements, Loft, Sweep and Pocket placement/preflight. Keep analytic sketch geometry and local DXF/CAM geometry unchanged.
- Kernel: `cadKernelPlane`, model sketch construction, Loft bound checks, Sweep transport, Pocket extent/tool placement and later face-prefix resolution. Pocket must project complete target bounds and retain authoritative absolute cap placement plus the datum's tangential origin; it cannot reuse current normal-axis extraction.
- UI: Sketch/Curve plane editors, Workbench creation/tree, viewport references/controls and signed direction labels. The local canvas edits the same 2D coordinates. Mirror and principal section dialogs remain explicit existing operations.
- Root: shared controller/tools, immutable frame receipt validation, workflow/busy/stale/cancel guards, discovery, public docs, release compatibility and production verification.

## Acceptance gate

Verify unchanged old principal documents, all signed offsets and exact source bytes in both adapters. Test world origin/rotation expressions, exact cardinal bases, right handedness, whole turns, far-coordinate uncertainty, atomic parameter failure, suppressed repair, dependency deletion and reorder.

Native tests should compare a tilted datum Pad/Revolve with a principal solid transformed by the same rotation/translation: volume, bounds, topology, exact sections where analytic and STEP reopen. Include negative and symmetric pads, winding, holes/islands and failure cleanup. Local DXF export/import must preserve the same dimensions and signed arcs regardless of datum; no world flattening or machining role prompts.

Test rotated circle/arc world extrema and viewer Fit, fixed-pixel reference picking, local drawing, pending-edit cancellation and shared agent authoring. For each existing solid consumer, test a supported datum case or an explicit preflight rejection. Later face attachment adds unique/missing/ambiguous/reversed-face queries, parameter-following expressions, downstream source consumption, stale picks, worker recycling, cancellation and bounded receipt regressions.

## Domain handoff — proposed implementation contract

This section records the agreed world-datum contract implemented in this slice. Add only `datumIds` to typed feature inputs now; `bodyReferenceIds` belongs to the later face definition and must not enter this slice speculatively.

### Pure APIs and lookup ownership

```ts
interface CadResolvedFrame {
  /** Un-offset base origin: principal frames use [0, 0, 0]. */
  readonly origin: CadNumericPoint3;
  readonly u: CadNumericPoint3;
  readonly v: CadNumericPoint3;
  readonly normal: CadNumericPoint3;
  readonly precision: {
    readonly angularUncertainty: number;
    readonly originUncertaintyMm: number;
  };
}
interface CadDatumFrameLookup {
  get(datumId: string): CadResolvedFrame | undefined;
}
interface CadResolvedPlacement {
  readonly plane: CadSketchPlane;
  readonly datumId: string | null;
  readonly offsetMm: number;
  readonly frame: CadResolvedFrame;
}
declare function resolveCadWorldDatum(feature: CadDatumPlaneFeature,
  parameters: Readonly<Record<string, number>>): CadResolvedFrame;
declare function prepareCadDatumFrames(features: readonly CadFeature[],
  parameters: Readonly<Record<string, number>>): CadDatumFrameLookup;
declare function resolveCadSketchPlacement(feature: CadSketchFeature | CadCurveFeature,
  parameters: Readonly<Record<string, number>>, precedingFrames: CadDatumFrameLookup): CadResolvedPlacement;
declare function cadFramePointToWorld(frame: CadResolvedFrame, offsetMm: number, point: CadNumericPoint2): CadNumericPoint3;
declare function cadFrameDirectionToWorld(frame: CadResolvedFrame, direction: CadNumericPoint2): CadNumericPoint3;
declare function prepareCadDocumentFrames(document: CadDocument): CadDatumFrameLookup;
```

Frame objects, tuples, precision records and lookup are frozen. The lookup captures a private Map; it exposes no Map mutation or backing entries. Prefix structural validation guarantees referenced datums precede the Sketch/Curve. `prepareCadDocumentFrames` crosses `parseCadDocument` and caches only that parser's immutable accepted output in a private WeakMap. Put the validating document facade in a separate module from the pure schema/resolver to avoid initialization cycles. Mutable inputs or unrelated frozen lookalikes never enter the cache directly. History replacement/undo obtains its own accepted document key; garbage collection bounds retention. Face frames will later be build-pinned and cannot reuse this document-only cache.

All datum definitions evaluate their bounded origin/rotation expressions even when suppressed, matching dimensional validation of other declarative reference features. Suppressed datums do not appear in the active frame lookup. Active Sketch/Curve requires an active preceding datum; a suppressed dependent may retain its typed reference while local geometry remains valid. Suppress dependent features in the same atomic batch before suppressing their datum. Wrong-type/missing/later references always fail. Reorder/delete/cascade and unsuppression use the ordinary dependency graph. World datums produce no body, consume no operands, and add zero expanded solid instances.

### Numeric frame policy

The resolved frame always retains its base origin; it never incorporates a Sketch/Curve offset. Placement carries `offsetMm` separately, and point mapping is `origin + normal*offsetMm + u*x + v*y`. Kernel `createCadKernelPlane(frame, stationMm)` owns only the native Plane and uses the same mapping at local `[0,0]`. Symmetric Pad supplies `offsetMm - distance/2` as its station, preserving signed distance behavior. Offset arithmetic uncertainty is derived per placement/station, not written back into the frozen base frame.

Reduce each evaluated angle modulo 360 before radians, trig or cardinal detection. Only exact reduced multiples of 90 use exact signed axis permutations; nearby angles are never snapped. Apply world X, then Y, then Z rotations to the base principal axes. The origin is translated world data, not rotated by these angles.

Require finite nonzero computed axes, unit-length and perpendicular residuals no greater than `64*Number.EPSILON`, and positive right-handed orientation. Normalize/reorthogonalize only within that computed-roundoff band; reject outside it. Cardinal-only frames carry zero angular uncertainty. Other frames carry a conservative engineering `64*EPS` angular allowance after normalization, rather than a formal interval certificate. Preserve legacy principal adapters exactly.

Use named constants `CAD_DATUM_ORTHONORMAL_RESIDUAL = 64*EPS` and `CAD_DATUM_NATIVE_PLACEMENT_PRECISION_MM = 1e-7`. A world datum's supplied numeric origin has no transform arithmetic; its initial origin uncertainty is zero. Applying nonzero normal offset adds `64*EPS*max(1, |origin components|, |offsetMm|)` to origin uncertainty. Mapping a local section/native travel adds `64*EPS*max(1, |placed origin components|, localCoordinateScaleMm, normalTravelMm, axisLeverMm)`. Total native eligibility allowance is these origin/mapping terms plus `angularUncertainty*(localCoordinateScaleMm + normalTravelMm + axisLeverMm)`. Pad supplies its distance/symmetric station travel; Revolve supplies its local pivot lever arm. These are conservative new-datum support reserves, not retroactive restrictions on legacy principal documents. Focused numerical tests and native tolerance evidence must verify the implementation uses the same terms.

Translation/offset arithmetic must report a conservative scale-dependent origin uncertainty. Point mapping adds its own arithmetic allowance. Reference display and local measurement may remain useful where native construction is unsupported: do not reject a whole valid local profile merely because a tilted native operation cannot preserve its precision. Before accepting an active datum Pad/Revolve, amplify angular uncertainty by local section extent and offset/revolve-axis lever arms, add origin/world arithmetic allowances, and reject total placement uncertainty above `1e-7 mm`. Native validity/tolerance guards remain necessary downstream. Diagnostic advice is to reduce distance from origin, simplify placement or use an exact cardinal frame; never silently increase tolerance.

### Local geometry and consumer APIs

Split Curve resolution into `resolveCadCurveGeometry(curve, parameters)` (ordered local entities, endpoints/tangents, length and bounds) and `placeCadCurveGeometry(local, placement)` (world endpoints/tangents/bounds). Preserve the old `resolveCadCurve(curve, parameters)` behavior for principal inputs; datum inputs require an explicit prepared placement or a document facade. `measureCadCurve(document, curveId)` prepares immutable frames once and returns the same local dimensions plus resolved frame/world data. Sketch analytical measurements remain local; their plane metadata widens explicitly and may include the resolved world frame. Source originals and local DXF export never require rewriting dimensions.

Viewport preparation consumes the prepared document lookup and maps local entities with the resolved frame. Its bounds use analytic world-coordinate extrema, and display sampling keeps the existing aggregate budget. Capture receipts retain reference version/IDs and include only bounded frame metadata when needed, not source geometry. CAD-only datums/sketches/curves must remain usable without loading WASM.

The first parser capability gate permits datum Sketch/Curve plus Pad/Revolve only. Use a single `assertCadPlacementCapability(operation, placements)` preflight with explicit diagnostics, not scattered principal assumptions or fallback enum values. Direct new datum Loft/Sweep/Pocket requests remain rejected until their individual native gates pass. Mirrors and section requests retain the principal enum and are unchanged.

Straightforward follow-on contracts are:

- Loft sections return `frame` as well as local geometry. Compare common oriented basis and translated normal stations with existing monotonic/gap rules. Allowing any differently oriented/twisted sections requires a separate explicit scope decision. Native end bounds must be measured in the resolved local frame: projecting a wide tilted solid's world AABB can falsely report overshoot.
- Sweep returns placed section/Curve frames. Anchor coordinates become dot products of `curveStart - sectionOrigin` with section axes; residual plane distance uses the same translated difference. Use the rail frame normal as binormal and run fresh amplified alignment/transport precision checks. Keep local clearance geometry and every existing segment/work/tolerance limit.
- Pocket inputs return placed frame and authored absolute normal station. Project all eight target AABB corners outward for the complete normal interval, including arithmetic uncertainty. Native tool placement must retain the datum's tangential origin and authoritative absolute caps, avoiding subtraction/readdition of a remote authored plane. Current per-target/per-tool/per-Common precision evidence stays mandatory. Frame-aware native preparation and far-origin cancellation tests precede enabling this capability.

### First runnable acceptance gate

Independent ignored native probes have now passed 13 direct-frame/rigid-transform parity cases at origin `[37,-24,11]` and rotation `[23,-37,61]`: all principal bases, negative symmetric and signed nonsymmetric Pads, both local Revolve axes, exact cardinal placement with holes/islands, inverse-local analytic sections and two STEP reopens. Maximum near-origin bound difference was `7.11e-15 mm`, volume difference `4.55e-13 mm³`, with matching topology and Common. A far `1e8` rotated Pad remained native-valid but its volume changed by `5.27e-7 mm³` and bounds by one ULP; native validity alone does not justify removing the conservative amplified precision gate. These probes establish feasibility, not production implementation or arbitrary-frame consumer support.

Add a world datum, dimension-driven tilted Sketch/Curve and Pad/Revolve through normal atomic edits. Compare native results with the same principal model transformed X→Y→Z then translated, including signed/symmetric pads, local revolve axis/pivot, holes and failures. Verify large reduced angles, exact cardinal frames, noncardinal amplified rejection and unchanged principal acceptance. Test suppression batches, invalid expressions, lookup immutability/cache boundaries, reorder/cascade, both-adapter exact-source roundtrip, local DXF parity and 3D reference bounds/picking/capture. Explicit parser tests must reject each not-yet-enabled datum Loft/Sweep/Pocket before publishing a draft. Enable those individually only after their described native regressions pass.

## Implemented UI flow

The following recommendations were checked against the current `CadWorkbench`, `CadFeatureEditor`, `CadCurveCreationFields`, `CadExtrudeFields`, `CadSketchCanvas` and world-reference renderer. The implemented flow covers world datums only; face attachment remains outside this slice.

### Creation and editing

Add one compact **Plane** command to the existing Sketch/Curve tool group. Keep the current single header and thin toolstrip; add no plane toolbar, attachment menu or mode selector while World is the only supported definition. The initial draft is XY, origin `(0,0,0)`, rotation `(0,0,0)`. It does not copy a selected face, body transform or earlier plane definition implicitly.

The existing Properties column contains Name, Base plane, an Origin group with X/Y/Z scalar fields in mm, and a Rotation group with Around X/Y/Z scalar fields in degrees. Reuse the existing expression fields and show resolved values only for expressions/errors. Keep rotation order and its world-axis meaning in the group tooltip/accessibility description; do not repeat a paragraph below the fields. There are no inactive normal, attachment or matrix fields to serialize.

Plane creation starts one pending editor workflow immediately. Apply commits one complete definition and selects its tree/history row; Cancel/Escape leaves document/version/history unchanged. Draft field changes can show an ephemeral plane preview after pure frame validation, without loading WASM. Invalid fields hide that draft preview and show one compact field/form error; they must not display a previous direction as the current one. Previewing a draft never adds saved references or becomes capturable through accepted-document capture APIs. Cancellation restores the accepted scene and prior camera rather than discarding accepted geometry.

Selecting an accepted datum opens this same compact form. The existing toolbar Sketch and Curve actions use the selected active datum explicitly. One selected-datum context action, **Sketch on plane**, can make that connection discoverable without another bar; its title names the chosen plane, and it passes that ID rather than relying on a last-selected sketch. Curve remains available in the existing toolbar. No automatic coordinate reprojection occurs when an existing Sketch/Curve changes its placement: local geometry and the signed offset stay authored values, and Apply moves them using the resolved frame.

### Shared placement selector and unavailable inputs

Introduce one focused placement-field component shared by Sketch properties and provisional/accepted Curve forms. Its native select contains principal XY/XZ/YZ first, then eligible preceding datums in history order. Use internal select keys such as `principal:XY` and `datum:<id>`; decode explicitly to the typed placement union. Never pass a placement object directly as an HTML select value or render it as text. Names are labels; feature IDs remain references through rename.

For an existing feature, eligibility uses its preceding prefix, not the final visible body list. A suppressed or otherwise unavailable referenced datum remains the selected disabled option, labeled `<name> (unavailable)`; a new unchosen value uses a disabled `Choose reference plane` option. The native select must never show its first active datum as though that were the stored reference. Preserve unavailable IDs until an explicit valid replacement or Cancel. Missing/later/wrong-type saved references are rejected by the shared domain contract, not repaired by the UI. Cache option inspection by immutable document/prefix so typing a dimension does not repeatedly inspect every frame.

Only expose datum placement after every relevant consumer has passed its native gate or gained the agreed explicit capability rejection. In particular, the current principal-only Revolve/Loft/Sweep/Pocket branches cannot silently interpret a datum as XY. Repairable unsupported inputs need their actual selected name and concise reason, not a substituted principal value.

### Tree and local canvas semantics

Keep the three current principal **REFERENCE PLANES** actions as fixed creation shortcuts. Put authored datums once in the ordered **FEATURES** tree and timeline, with their own plane icon, normal selection/suppression/error styling, and the existing cascade/delete/reorder/undo behavior. Do not duplicate them into a second mutable plane library. A datum is a non-consuming reference: it is never a body row, volume, pattern operand or solid-export prerequisite. Referencing Sketches/Curves retain their existing feature/profile rows; show the datum name in their placement field rather than inventing another nested copy of the feature.

The 2D canvas still edits local X/Y millimetres, with its existing drawing and fit behavior. Replace the current principal-only plane caption with the resolved placement's compact name; retain signed Offset in Properties. Do not rotate the local editor to imitate a world camera or add a coordinate bar. Changing a datum/offset must not refit local contours, move a pending keyboard anchor, or rewrite imported source text. Capture/view schemas will need the typed placement and accepted frame identity before any object-valued plane reaches existing captions or receipts.

For principal inputs, keep the current truthful direction labels: XY `+Z/−Z`, XZ `−Y/+Y`, YZ `+X/−X`. A genuinely tilted frame uses **Along plane normal (+n)** / **Opposite plane normal (−n)** / **Both directions**, with one compact numeric normal row or accessible tooltip, e.g. `n = (0, −0.707107, 0.707107)`. Obtain that vector from the shared resolved frame; never guess a nearest world axis. Use the same feedback for signed offsets, negative/symmetric pads and any verified frame-aware Pocket. Invalid or unsupported frames show their diagnostic and no fabricated axis label. The selected 3D source can show a small +n arrow as visual reinforcement; readable form feedback remains available when the arrow is occluded or edge-on.

### Standalone datum visualization and bounded lifecycle

A datum with no sketch needs a visible representation; otherwise creating it produces another apparently empty workbench. Draw a small translucent planar patch with a border, local u/v marks and a +n arrow. These illustrate an infinite reference plane, not a finite material face or saved dimensions. The initial display span can be a fixed 25 mm; it is view-only. Do not add saved width/height, a permanent plane grid or a visualization settings panel.

Show the selected active datum. In a document containing only datums, show all active datum glyphs so clearing selection does not erase the only scene content. With other geometry, avoid displaying every unused plane: show a selected Sketch/Curve's datum or the relevant datums of a selected body's source graph on demand. Keep each unique datum represented once. Suppressed/unresolved datums stay absent. Selection/visibility changes use the shared workflow lock and change only view state.

Do not let a distant frame origin ruin Fit for a small far-origin contour. A datum-only fit targets its authored origin and nominal glyph span. When showing a plane beside its referencing contour, a patch/normal arrow can be anchored at a projected contour-bounds center on that plane; it must not label that display point as the authored origin. Datum glyphs do not inflate the part/source fit bounds when outlines or bodies already provide meaningful bounds. The actual origin remains available in Properties. Geometry position, precision bounds and frame resolution remain domain-derived; display extent is never an analytic measurement.

Use the existing keyed reference installation, local-coordinate uploads, demand rendering and context-loss cleanup. A glyph needs only a constant number of line segments/triangles, bounded by at most 256 visible feature IDs and one aggregate display budget. Derive its frame once per accepted immutable revision; screen-sized arrow styling updates on camera redraw, not through a continuous loop or whole-document hover evaluation. Distinguish glyph objects from material bodies and topology: Body-mode reference picking can select the datum, while Face/Edge mode must never turn the illustrative patch into native topology. Preserve body occlusion and prioritize actual contour hits over a broad illustrative patch.

Datum-only rendering and capture require no WASM. Extend installed `referenceVersion`/sorted `referenceFeatureIds` provenance to visible accepted datum glyphs, including removal/empty batches, before allowing that capture. Keep provisional glyphs separate and blocked by the pending workflow. Root owns this controller/tool/capture extension; the UI must publish what is actually installed rather than claiming a current frame from props alone.

### Focused UI acceptance checks

- Real-session Plane create/edit/Cancel/Apply/undo/redo with expression-backed origins/angles, unchanged imported originals, one pending workflow, native text undo, and no inactive saved fields.
- Shared placement selection across Sketch and new/saved Curve, rename-stable IDs, preceding/suppressed/unavailable choices, explicit repair and rejected missing/later references without changing the accepted document.
- Tilted +n/−n feedback, cardinal/XZ/YZ compatibility, signed offset/pad behavior, and explicit unsupported-consumer rejection. No fallback XY labels or automatic placement.
- Datum-only scene and no-WASM capture, selected-source visibility, body-occluded picking, no Face/Edge interception, frozen installed IDs/version, cancellation and disposal after replacement/removal/context recovery.
- Small far-origin references and a far-authored local contour on an origin-based datum: bounded glyphs and camera Fit must keep the useful contour visible without pretending the glyph extent is material geometry.

Suggested UI ownership is a shared `CadReferencePlaneField`/pure option helper, a focused `CadDatumPlaneFields`, Workbench command/tree integration, placement-aware direction feedback, and one bounded datum-reference renderer/helper. Keep domain frame resolution and root controller/capture contracts outside those UI components. Coordinate Workbench/viewport ownership before concurrent feature edits; no implementation starts from this design note alone.

## Root integration decision

For the first implementation, expose a guarded read-only `cad_inspect_plane` accepting the current document version and one datum/Sketch/Curve feature ID. Return only its authored placement identity, resolved origin/basis/normal, offset, units and supported-precision metadata. Use the same pure resolution as rendering and native preflight, with no WASM load, save, source text or geometry arrays. It must reject suppressed/unavailable references, stale versions, active workflows and cancellation consistently with existing inspections. Keep datum-only viewport capture tied to actual installed reference IDs/version. This gives agents a direct way to verify a tilted local frame before adding downstream features; it does not certify a solid build.

Root owns this controller/tool boundary, discovery, public docs and production end-to-end workflow. Plane/schema and native APIs must pass focused domain and native gates before the UI command becomes available. All work continues locally on the existing branch and PR, retaining candidate app version 0.0.697.
