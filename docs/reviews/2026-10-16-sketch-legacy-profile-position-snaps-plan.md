# Drawing from legacy profile positions

2026-10-16. Read-only assessment against `7117fe6` while relative-axis acceptance is in progress. No source/test edits, tests, native probes, builds or package commands were run. This is a proposed next slice, not a claim that legacy profiles support graph relations.

## Useful first slice

Let new drawing acquire current endpoints, centers and analytic midpoints from the active sketch's accepted legacy profiles. These are numeric position snapshots, with an explicit `Position only · No relation` hint. A new Path endpoint at such a location gets its own fresh point ID. Rectangle/circle/polygon authoring stores a normal position pick even when the existing Create coincident relations toggle is enabled. Later movement or regeneration of the legacy source does not move the new geometry.

This closes a visible everyday gap for slots, rounded rectangles and older saved geometry without promoting, flattening or migrating them. It can also reuse points on the currently generated plugin boundary. Persistent references, graph constraints against legacy edges, and attached centers on regenerated plugins remain separate unsupported capabilities.

## What the current code actually provides

| Existing seam | Consequence |
| --- | --- |
| `cadSketchGeometry.ts`: `resolveCadProfile` and `cadProfileToEntities` | Accepted profiles already resolve to analytic lines, circles and signed arcs. Rectangle X/Y is lower-left; slot X/Y is its center, and slot length is the complete capsule length. Path output follows its signed analytic support. |
| `cadSketchHandles.ts`: `inspectCadSketchHandles` | Handles describe edit controls, not snap topology. Rounded-rectangle corner grips are the virtual sharp corners, slot length/angle grips include control locations, and plugins return no handles. Reusing every handle as an endpoint would be wrong. Locked dimensions also should not make a real location unavailable as a drawing reference. |
| `cadViewportReferences.ts`: `cadProfileReferenceGeometry` | Already returns the resolved analytic boundary and exact bounds, with no display-polyline sampling. It can prepare position candidates once per accepted profile/parameter snapshot. |
| `cadSketchPicking.ts`: profile picker | It also resolves exact boundaries, but its prepared segments are private and Canvas feeds it visual preview profiles/parameters. Do not reuse preview geometry as an accepted snap source merely to save a resolver call. |
| `cadSketchGeometrySnaps.ts` | Graph candidates are detached, ranked by independent screen X/Y distance and return none/hit/ambiguity. Actual graph point identity is distinct from position-only midpoint intent. |
| `CadSketchCanvas.tsx` | Source graph preparation already separates accepted source from visual preview. Drawing Path joins and fresh coincidence inference require a target containing an actual `pointId`. The source/camera/unfinished-drawing owner already invalidates stale chooser actions. |
| `CadSketchSnapChooser.tsx` / `CadSketchSnapHint.tsx` | The existing paged menu and marker are reusable, but labels currently assume graph points/entities. Canvas also requires `sourceGraph` both to open and render its chooser, so a legacy-only sketch currently cannot use it. |

These are local implementation facts, not external CAD behavior claims. Relevant source files are under `src/domain/cad/` and `src/features/cad/` with the exact names above.

## Candidate identity and geometry

Add one transient target arm to the shared snap result. Keep it distinct from a graph endpoint or midpoint:

```ts
type CadSketchProfileSnapLocation =
  | { readonly kind: 'center' }
  | { readonly kind: 'endpoint'; readonly boundaryIndex: number }
  | { readonly kind: 'midpoint'; readonly boundaryIndex: number }
  | { readonly kind: 'arc-center'; readonly boundaryIndex: number };

// Additional CadSketchSnapTarget arm:
{ readonly kind: 'profile-position'; readonly profileId: string;
  readonly location: CadSketchProfileSnapLocation }
```

`boundaryIndex` addresses only this prepared accepted contour revision. It is not a persistent entity identity and must never be stored in a relation. The candidate retains the existing numeric `point`, `distancePx` and detached/frozen ownership. Its graph `entityIds` is empty. Its target has no `pointId` or `entityId`, so the current graph Join/coincidence predicates cannot mistake it for a saved graph point. Include profile ID plus the complete location descriptor in the transient target key and capture identity. Do not synthesize IDs such as `profile_4_vertex_7` and feed them into graph code.

Prepare from `sourceSketch.profiles` and accepted source parameters, including visible construction profiles. Exclude graph-derived cycles, preview replacements, other sketches/planes and hidden external references. A small feature-local preparer can call `cadProfileReferenceGeometry` once per source profile. Reuse the existing resolver and signed-arc midpoint math; do not sample SVG paths, tessellated viewport lines or fitted curves. Memoize the resulting numeric candidate copies. No per-pointer plugin evaluation or new shared cache is needed.

| Profile/output | Positions to expose, and exclusions |
| --- | --- |
| Straight rectangle / polygon | Actual boundary joints and finite edge midpoints. Do not infer a polygon centroid. A rectangle center is a legitimate optional shape center computed from its declared rectangle, not from arbitrary bounds. |
| Rounded rectangle | Actual line/arc tangency joints, arc centers, and line/arc midpoints. Its virtual sharp corners are not boundary endpoints. If a straight side has zero length and the existing analytic converter omits it, do not invent that side's endpoint/midpoint. |
| Circle, including a circular degenerate capsule or a full-turn path arc | Actual center only for this slice. A circle has no endpoint or unique midpoint; do not expose its converter/display seam as one. Quadrants are a separate possible feature. |
| Slot | Declared capsule center; actual tangency joints, cap arc centers, straight-side midpoints and cap arc midpoints. Cap centers lie at `±(length-width)/2` along the rotated axis, not at `±length/2`. Arc midpoints lie on their signed half-turn supports. A circular capsule has no two distinct cap ends. |
| Closed path | One start per finite analytic boundary segment as the declared contour joint, actual arc centers, and midpoints along the signed sweep. A major arc midpoint is not the midpoint of its endpoint chord. Never add a second candidate for the same contour joint merely by also emitting every preceding segment's end. |
| Plugin | Features of the current generated analytic boundary only. Do not guess a semantic plugin center from bounds, a centroid, or inputs named `x`/`y`. Repeated circle/arc centers may happen to give a useful center position, but the label remains an actual boundary arc center. Regeneration can reorder or replace every boundary index. |

Within one profile, identical center candidates may be coalesced by exact coordinates and the same semantic role, retaining a deterministic representative descriptor for this snapshot. Never proximity-cluster nearby vertices/centers or merge targets across different profiles. Keep endpoints and midpoints distinct if their roles differ. Closed-boundary start enumeration avoids inventing a coordinate-welding rule at analytic joints with native roundoff. All chosen coordinates remain one actual resolved source location.

For generated gears, these are positions on the package's current generated output. The existing generator can approximate an ideal flank according to its own tolerance. This slice adds no approximation and must not advertise a generated polyline vertex as an exact theoretical involute point.

## Ranking, choice and visible ownership

Feed the additional prepared candidates into the existing screen-distance ranking, with the current 6 px default, tie handling and geometry-before-grid behavior. Preserve graph-only preparation as the default for `CadSketchGraphLayer`; this slice changes drawing, not graph dragging or legacy handle movement. The existing preparer can take one optional readonly profile-candidate input. A legacy-only caller must work without constructing a synthetic empty graph.

Do not compare only one graph hit against a grid fallback, run an independent nearest-profile state, or choose the first profile at an overlap. Exact graph points and profile positions at the same coordinate may represent different intents, especially with coincidence enabled, so preserve that cross-owner ambiguity and let the existing chooser resolve it. Keep the existing graph-point-over-its-position-only-midpoint behavior for graph sources. Owned draft closure and Ctrl/Cmd suppression retain their established precedence.

Use the same paged `CadSketchSnapChooser` for all tied candidates. Make graph metadata optional and provide current profile names for profile rows. Examples are `Mounting slot · Center · Position only`, `Rounded plate · Boundary point 3 · Position only`, or `Gear · Arc midpoint 7 · Position only`. Append a transient ordinal when duplicate profile names need distinguishing. The row help already displays coordinates. Do not label these targets `Point N`, `Join`, or `Coincident`.

Highlight the actual owner profile plus the target marker without selecting it or clearing graph selection. Reuse the profile's existing `CadSketchProfileGeometry` and highlight class; a dot/center/midpoint marker communicates the exact location. A full-profile outline is sufficient initially and avoids another boundary-selection state. The hint can derive its existing marker symbol from the location kind. A tiny shared profile-target label helper is reasonable if Canvas and chooser would otherwise repeat it; a snap-provider registry is unnecessary.

## Lifetime, placement and API limits

Include the accepted legacy preparation in the current `drawingOwner`. Source sketch/document identity, version, parameters, tool, pending picks/path, snap settings, inference setting, camera and cancel signal continue to pin the chooser. Remove its graph-presence prerequisite and validate against this shared drawing owner instead. Unaccepted previews remain blocked. Highlighting and choosing use captured candidates, not a new nearest query at the menu cursor. Blur, Escape, outside click, source/parameter replacement, frame change or external workflow dismiss the existing owner with no phantom placement. Capture revision includes the profile target descriptor, coordinate and visible label.

Accepting a profile target consumes only its coordinate. With fresh authoring, construct the existing `{ kind: 'position', point }` pick. With Path, omit `existingPointId`. The current append/create validation, authored-joint logic, solver preparation and one accepted history step continue unchanged. Once a numeric pick is placed, later source changes do not retarget it; a subsequent live hint comes from a newly prepared accepted snapshot. Do not add attachment lifetime locks to plain numeric picks.

No saved schema, plugin package, relation, migration or tool write contract changes. Existing numeric append APIs can author the same detached result. Hosted agents can also operate the same exact chooser in the browser. Current `cad_inspect_sketch_handles` exposes useful primitive handles but deliberately exposes no plugin handles; it does not become a complete analytic-anchor enumeration by implication. Do not claim direct WebMCP discovery of arbitrary generated boundary points unless a separately approved read contract is added. This drawing slice does not require one to change geometry safely.

Persistent following would need a deliberate stable reference model and package-owned semantic anchors, regeneration/version rules, dependency visitors, conflict handling, and acceptance through the same domain operations. It cannot be obtained by saving transient boundary indices, sharing coordinates, promoting old profiles, or attaching to an invented graph point. Keep that larger gap explicit.

## Bounded implementation and acceptance

Expected ownership is one pure profile-position preparer/test file, additive candidate/ranking cases in `cadSketchGeometrySnaps.ts`, and root-owned Canvas/chooser/hint integration. Rough production estimate is 70–110 lines for preparation, 20–35 for the existing resolver, and 50–80 across UI consumers. No handle, graph schema, solver, plugin generator or Workbench add command should need behavioral changes. These are estimates, not measured patch sizes.

Meaningful red-first groups:

1. A rotated slot and rounded rectangle offer actual analytic joints/centers/midpoints, not virtual grip controls. Include a signed major path arc and circular capsule/full-circle case. Assert source scalar/package bytes are unchanged and no sampled geometry is introduced.
2. In a legacy-only sketch, draw a new Path or rectangle from an off-grid slot center with the coincidence toggle enabled. Assert its new point identity and absence of a source attachment, then edit the slot and verify the new coordinates stay detached. Cancel leaves accepted geometry/history unchanged.
3. At one graph point and two same-position profile targets, the existing paged chooser shows real owner labels. Choose the legacy owner, preview/highlight it without selection changes, and place only a numeric point. Escape or source/version/frame replacement dismisses a captured choice without placement. Ctrl/Cmd bypass and ordinary graph Join remain correct.

This is the smallest useful improvement found for gap 5. Reusing grip handles alone is shorter but gives wrong rounded endpoints and no plugin support. Persistent legacy/plugin references are substantially larger and should not delay honest position reuse. No other higher-value smaller workflow emerged from this bounded read; the already accepted keyboard and relative-dimension work should finish first.
