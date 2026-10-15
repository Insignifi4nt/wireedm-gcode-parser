# Through-all Pocket

Status: approved domain and native implementation. Focused domain, storage and native tests pass; root owns UI/tool and production verification.

## Concrete need

Current Pad/Pocket persists only a signed `distance` and `symmetric` flag. The property editor exposes Length and Symmetric; the kernel extrudes that distance before Boolean Cut. A 20×20 plate with `distance: 'thickness'`, initially thickness 10, and a circular cut of fixed depth 15 is through. Changing thickness to 20 remains a valid history but leaves a 5 mm cap. This follows directly from the current saved contract and native construction; this audit did not run a new native test. Authors can manually couple known dimensions, but imported solids have no declared thickness parameter to bind.

Add a cut whose extent follows its selected target shape at every rebuild. [Autodesk's Extrude reference](https://help.autodesk.com/cloudhelp/ENU/Fusion-Model/files/SLD-REF-EXTRUDE.htm) separates All extent, direction and Objects to Cut. Our proposed behavior selects one explicit history body; viewport visibility never changes its target.

## Strict saved contract and compatibility

Prefer a dedicated feature kind, keeping every existing `extrude` document unchanged:

```ts
interface CadPocketFeature extends CadFeatureBase {
  readonly kind: 'pocket';
  readonly sketchId: string;
  readonly targetId: string;
  readonly extent: {
    readonly kind: 'through-all';
    readonly direction: 'positive' | 'negative' | 'both';
  };
}
```

The strict schema permits only these own-data fields. It has no inactive distance, symmetric, operation, cached bounds or resolved-length fields. Pocket always cuts. This avoids a duplicate `extrude` discriminant that would complicate generated feature discovery, and avoids weakening legacy distance validation. Existing Pad/Pocket remains the distance-based New/Join/Cut feature. A shared editor may offer Distance/Through all for Cut; converting a feature requires an explicit validated replacement with the same ID. Never rewrite a loaded distance cut into a through-all cut.

Keep CAD document format/schema version 1, existing source/size limits and both persistence adapters. Older preview builds cannot read the new kind; document this in the release compatibility record and import diagnostic. No post-processor, CAM or storage namespace changes are needed.

Dependencies are one preceding sketch and one preceding current solid target. The sketch remains reusable; only a successful cut consumes the target. Preserve suppression semantics: always validate structure, typed references and target relationship; skip active region/extent eligibility while suppressed. Unsuppression can fail atomically. New Pocket preflight counts actual material-region tool operands plus target instances, matching native construction; legacy Pad/Revolve counts stay unchanged.

## Direction semantics

Positive and negative refer to the sketch's world normal, including XZ `[0,-1,0]`.

- **Positive:** cut from the authored sketch plane through all target material on its positive side. Target material behind the plane stays intact.
- **Negative:** the corresponding cut on its negative side.
- **Both:** cut all target material intersected by the profile projection in either direction. The sketch may lie inside or outside the target.

The target can contain disconnected solids, including an imported or patterned compound. Extent covers the complete selected shape, not just the closest solid or mesh group. Solids that do not intersect the profile are unchanged. Other history bodies are untouched. No implicit all-visible-body search, nearest face, topology key or viewport-dependent scope is allowed.

Through all is finite geometry derived from native bounds, not an infinite extrusion. It preserves the sketch's plane, coordinates, contours, holes, islands and construction exclusion. It does not promise a face attachment, taper, counterbore, or arbitrary-plane sketch support.

## Pure extent and native preparation

Published focused APIs:

```ts
resolveCadPocketInputs(feature, precedingFeatures, parameters)
resolveCadPocketExtent({ plane, offsetMm, direction, targetBounds, nativeToleranceMm, sectionScaleMm })
```

The first resolves every active sketch/material region and typed dependencies against the complete preceding feature map. It cannot determine an imported or previously transformed solid's final bounds in the document parser. The second accepts validated native target bounds and returns authoritative absolute `startStationMm`/`endStationMm`, receipt-only relative offsets, positive tool span, cap margin and target normal interval. Current principal normals use exact coordinate extraction.

Let the selected native shape's outward projected interval be `[minN,maxN]`, the sketch station `o`, and the cap margin `m`. Positive uses absolute stations `[o,maxN+m]`; negative uses `[minN-m,o]`; Both uses `[minN-m,maxN+m]`, with caps rounded outward. Require actual target extent beyond precision in a requested one-sided direction before adding the margin. Otherwise padded native bounds could turn a tangent/no-material direction into a misleading tiny cut. Both receipt offsets may have the same sign when the sketch lies outside the shape. Native placement uses absolute stations directly: reconstructing `o + (minN-o-m)` can lose cap precision for a distant source plane.

All bounds, tolerances and derived values must be finite and ordered. The supported precision budget uses `arithmetic = 64*EPS*coordinateScale`, `precision = max(1e-7, nativeTolerance, arithmetic)` and `m = max(1e-6, 4*nativeTolerance + arithmetic)`, in millimetres. Both excludes the remote authored station from cap arithmetic; one-sided extents include it. Required unpadded span is limited to one million millimetres, with a small allowance for native bound padding. Margins may extend beyond that dimensional limit.

Reject unless `m < min(requiredSpanMm, sectionScaleMm)/8`. Section scale is the smallest contour bounding-box dimension or positive circular radius across all material/void contours; it is invariant to splitting an arc into shorter segments. This is a conservative supported-precision rejection heuristic, not minimum wall thickness or a topology/accuracy certificate. Tiny bores in large bodies remain supported when their own section scale exceeds the reserve. Rounded absolute caps must stay finite, separated and outward of the target interval. Never clamp bounds or widen Boolean fuzzy tolerance to rescue failure.

At the feature's position in history, obtain the complete exact target's native bounds and tolerance reserve from faces, edges and vertices. Resolve extent again after every parameter/import/transform change. Place the temporary section plane at the absolute start station and extrude its positive resolved span; the saved source sketch remains unchanged. Reuse region/void construction and ordinary Boolean Cut with finally-owned native resources. Validate the resulting nonempty closed positive solid/compound and existing mesh/topology/instance limits before replacing the target. Native failures retain the preceding body and block solid export. A target erased entirely is an explicit empty-solid error.

Positive closed native `Common(target,tool)` solids prove intersected material. Each target solid, cutting region and positive Common component must exceed its own `max(1e-9 mm³, 4*actualTolerance*surfaceArea)` uncertainty; a larger component cannot hide an unresolved sliver. Isolated contact faces do not count as removal. The target check runs before either Boolean: a native Common can omit an unresolved thin target component entirely, so examining only its returned components is insufficient. A far-origin compound with a 6e-7 mm thin cylinder reproduced that failure. The final Cut is validated independently, including every retained/split solid. Common/final tolerances must fit the cap reserve. Whole-target volume subtraction is unreliable: a tested cube of side `1e6` with a bore radius `0.001` has Common volume approximately π, while whole-target subtraction reports −128 from floating-point cancellation. No-overlap and unresolved removal produce explicit diagnostics.

## Expressions, shared operations and receipts

Named parameters remain in the original sketch and upstream features. Through all saves semantic direction, not an expression containing a sampled target height. Current scalar grammar needs no bounding-box function, hidden parameter, `eval`, or expression baking. Native build recomputes actual extent from the target at that prefix.

Normal `cad_edit_document` authoring handles the new strict feature. `cad_describe_features('pocket')` describes target scope, signed directions and derived finite extent. Existing compact advertisements include the new kind; runtime still validates the complete strict feature.

An optional guarded read-only `cad_inspect_pocket` can report a new-feature-at-end preview from the current exact build. Require current document version/build identity, no competing workflow/busy operation, and cancellation checks before/after worker work. Return only sketch/target IDs, direction, target normal interval, start/end/span/margin, units and eligibility diagnostics. Keep receipts below 32 KiB and exclude original sources, native BRep, contour arrays and geometry meshes. A successful preflight does not replace a successful native cut/build.

The UI can keep the current Pad/Pocket command family compact: Cut offers Distance or Through all; Through all exposes Target and Positive/Negative/Both instead of Length/Symmetric. The implemented direction labels follow the world normal. Direction arrows and a read-only resolved-extent preview remain a future enhancement; they are not required to edit or build the strict feature. Pending edits use the same workflow lock and Apply/Cancel behavior. Default direction must be explicit; never infer it from camera orientation or choose a nearest body.

## Meaningful verification and ownership

First test the pure directional extent on all principal planes and signed offsets: inside/outside/tangent stations, disconnected target intervals, positive/negative/both, finite bounds, coordinate-scale uncertainty, overflow and unsupported span. Parser/edit tests cover strict inactive-field rejection, typed preceding refs, suppressed repair/unsuppression, safe deletion/cascade, preserved legacy distance files, expression propagation and new-instance budget alignment.

Native regressions must show a plate's through hole remains through after thickness 10→20, while the old fixed-depth cut remains intentionally distance-based. Cover imported STEP, a transformed target, multiple disconnected solids at different depths, sketch holes/islands, one-sided preservation behind the plane, no-overlap/complete-removal diagnostics, all plane signs, exact sections and STEP roundtrip. Failure injection must preserve target handles and release temporary tools. UI/agent tests must share request guards and receipt bounds; production workflows must verify both human and agent parameter changes.

Domain owns the saved feature, dependencies/strict validation and pure extent/region APIs. Kernel owns exact target-bound/tolerance preparation, finite tool generation, removal evidence and native failure tests. UI owns compact extent authoring/feedback; root owns guarded controller/tools, public documentation and integration. API/native acceptance precedes exposing controls.
