# World-space Sketch references

Internal implementation plan following the local Sweep checkpoint `11d3eda`.

## Problem and intended behavior

A completed Sketch currently disappears from the 3D viewport: only solid meshes and Curve references are rendered. Two Loft sections can therefore leave an empty scene, and Sweep shows its Curve without showing the profile's actual placement. A saved or imported far-origin Sketch also opens in the 2D editor at origin/span 160, while saved Curves already fit on entry.

Render actual Sketch contour outlines at their saved world planes and offsets. Preserve the current single header, toolbar and panel layout. Add no bar, placement correction, persistent visibility property, geometry repair or native solid-engine dependency for reference-only views.

## Visibility and selection policy

- Preserve existing always-visible active Curve references.
- When there are no active body-producing features, show every active nonempty Sketch, including construction profiles. Suppressed references remain absent.
- When active body-producing features exist, show the selected active Sketch, or the active Sketch sources reached through the selected active body's dependency graph. Use `cadFeatureDependencies` and a bounded visited set; do not encode separate lists of feature kinds or replay transforms onto historical source geometry.
- With bodies and no relevant selection, show no Sketch outlines. Existing Curve visibility remains unchanged. Selecting a source shows its authored world placement, even when a later body transform places its result elsewhere.
- Physical reference picking selects the feature, using the existing six-pixel tolerance and solid occlusion rule. It operates in Body mode only and never intercepts Face/Edge topology picking. Selecting a world contour does not enter the sketch editor automatically or change a profile dimension.
- Keep normal tree selection, source highlighting and editor entry behavior. No new eye controls or visibility toolbar are required for this chunk. Selection changes are view state, not document edits or undo steps.

## Shared rendering payload

Introduce a focused generic helper, `cadViewportReferences.ts`, replacing the Curve-only preparation path without maintaining two tessellation algorithms. The proposed payload is:

```ts
interface CadViewportReference {
  readonly referenceId: string; // stable feature ID for Curve; feature/profile ID pair for Sketch
  readonly featureId: string;
  readonly featureKind: 'sketch' | 'curve';
  readonly name: string;
  readonly construction: boolean;
  readonly positions: readonly number[]; // display-only world line pairs
  readonly bounds: CadBounds3;
}
```

One Sketch profile forms one reference entry so material and construction contours can use different styles without losing feature-level picking. IDs are display keys, not persisted topology selectors. Bounds and source geometry remain analytic; the sampled positions are used only to render and pick the outline.

Prepare active source payloads once against immutable `document.features` and `document.parameters`, then filter the prepared entries by the visibility policy. Keep payload identities stable across selection-only changes. Use `resolveCadProfile` and `cadProfileToEntities` for contour geometry, existing exact profile measurements for bounds, and `cadPlanePointToWorld` for placement. Reuse shared signed arc traversal, including clockwise/major imported paths. XZ offsets follow negative world Y. Do not derive fit bounds from sampled vertices or replace saved expressions with evaluated numbers.

The existing shared geometry budget bounds source data. Rendering has one aggregate `MAX_CAD_REFERENCE_DISPLAY_SEGMENTS = 32768` budget across prepared Sketch and Curve entries. Every analytic edge receives at least one display segment; arc subdivision requests are bounded by the remaining shared budget. Circles request a complete display loop. No full region analysis or geometric validation runs during pointer hover. Validation, measurement, DXF, native geometry and saved originals remain analytic and unchanged.

## Viewport resource and style behavior

Replace all-reference disposal on selection-driven visibility changes with keyed installation. Keep geometry/materials for unchanged reference payloads, create newly visible entries, and dispose removed/replaced entries once. Release every installed entry on unmount or graphics retry. Maintain the existing per-reference origin rebasing before Float32 uploads so radius-1 contours around coordinates `1e8` remain visible and pickable.

Normal contour outlines use the existing reference palette; selection highlights the feature's profiles. Construction geometry uses a subdued dashed material with visible screen-scale dashes. Solid depth testing remains enabled for all references. Grid/axes render first without depth writes; preserve the coplanar visibility correction and body occlusion.

Fit unions exact visible reference bounds and solid bounds. Adding references to a reference-only scene may perform the existing first-scene fit. Ordinary feature selection should not reset the user's camera or start a continuous render loop. Reference installation, visibility changes and captures use the existing demand-render mechanism. Capture redraws synchronously and checks the installed payload before copying WebGL pixels.

## Capture contract agreed with root

Root adds `visibleReferenceIds: readonly string[]` to `CadViewportBindings`; Workbench supplies the sorted, unique IDs of exactly the visible reference features. Keep this list bounded to the saved document feature limit (256, or the shared domain constant when available).

The solid variant of `CadRenderedViewState` gains optional read-only `referenceFeatureIds`. The renderer publishes a frozen, sorted installed ID list. Preserve the existing `referenceVersion` name and meaning as the document revision whose reference batch is actually installed. Publish the supplied document version after installing even an empty batch, with installed IDs `[]`; an empty batch must not leave metadata from earlier references.

Root requires current installed version and equal wanted/installed IDs whenever the document contains an active nonempty Sketch or Curve. This guards hidden-Sketch/body captures and selection-driven visibility transitions without duplicating the traversal in the controller. Reference-only Sketch/Curve capture requires no WASM build; mixed body/reference views still require the current native body build. Include installed IDs and the normal renderer revision in visual identity and bounded tool schemas. Keep document-version, cancellation, workflow, graphics-loss and post-capture checks intact.

Workbench should synchronously withhold previous meshes in reference-only documents, as it already does for Curve-only documents. The file capture action becomes available for actual visible Sketch references with the same accepted-document guards. The truthful blank-scene action remains only when neither body meshes nor visible reference geometry is displayed.

## Initial 2D fit correction

Fit a saved nonempty Sketch on editor entry, as for a saved Curve. Measure the actual container aspect before computing the first fit and publishing a settled capture state. This includes imported analytic paths, rounded rectangles, rotated slots, polygons, circles and construction profiles; preserve exact analytic bounds.

Fit only once per editor entry/reference identity. Keep a new empty Sketch at the normal origin/span, and do not refit when a first contour is drawn, dimensions/parameters change, a pending form is edited, or the container resizes. Manual Fit/F remains available. Avoid an initial ResizeObserver delivery changing the view after capture availability has been reported.

## Focused verification

1. Pure preparation tests cover every profile kind, all principal planes/signed offsets and expression evaluation; clockwise/major imported arcs; construction flags; source/original immutability; exact fit bounds; suppression; and the single 32768-segment aggregate budget.
2. Pure visibility tests cover reference-only documents, selected Sketch, selected Loft/Sweep and transitive body dependencies, no selection, suppression, missing sources, sorted unique IDs and history selection without document mutation.
3. Viewport tests cover feature picking and solid occlusion, no Face/Edge interception, dashed construction styles, guide ordering, far-origin local GPU precision, stable unchanged Curve resources across source selection, removal/replacement/unmount disposal, synchronous capture, installed revision/IDs including an empty batch, and graphics recovery.
4. Workbench tests cover existing Sketch outlines without a native build, selected source visibility, source picking restoring Properties, correct capture-action availability, preserved pending locks, selection/undo invariants, and synchronous stale-solid suppression.
5. Canvas tests cover far-origin saved/imported Sketch entry at wide and narrow aspect ratios, settled first capture before initial observer delivery, no automatic refit on dimension/parameter changes or resize, empty/new drawing behavior, and manual Fit.
6. Root adds capture/controller tests for reference-only Sketch and mixed body/reference views, stale installed IDs/version, visibility change during capture, cancellation and bounded tool output. Production tests verify actual colored Sketch pixels for Loft/Sweep sources, far-origin editor fit, source selection/occlusion and no WASM load for Sketch-only capture.

Use focused suites and the application typecheck first. Root owns the eventual production build and browser verification; no independent server or broad concurrent test run.

## Ownership and coordination

- `cad_ui`: this plan; generic preparation/visibility helper and focused tests; `CadViewport.tsx`/tests; `CadWorkbench.tsx`/tests integration; `CadSketchCanvas.tsx` initial fit/tests; narrowly scoped construction styling if necessary.
- Root: `cadViewportControls.ts`, `cadWorkbenchViewport.ts`, controller/capture/tool schemas and tests, hosted agent documentation, production E2E and local checkpoint.
- Do not edit `CadFeatureEditor.tsx`; the next Pocket work may own it. Coordinate before any overlapping Workbench changes for Through-all Pocket. Keep that operation outside this rendering chunk.
- Native solids/edges/highlights also have a separately reported far-origin Float32 issue. This chunk preserves their current behavior; root will schedule that fix after reference work and assign ownership before changes to shared viewport files.

Sweep checkpoint is committed and the implementation contract is approved. Source work may start after this plan is saved and root's viewport-contract changes are coordinated.
