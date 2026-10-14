# Standardized icon set for CAD integration

The concrete 134-icon set is integrated on published CAD checkpoint `25b3994af33d3a7f011651a42603f8dd898af597`. It includes the critical iterations, final cross-family corrections and actual-app review by three Luna subagents. The pull request targets `feature/parametric-cad-workbench`.

## Assets and mappings

- [Integration map](icon-integration-map.md) and [machine-readable map](icon-integration-map.json) describe all 134 original asset paths, semantic component names, SVG SHA-256 digests and source geometry.
- The map covers 282 direct icon usages, eight dynamic slots, 206 expanded variants, all 95 referenced renderer parents and 15 text controls. Use stable IDs and owning control metadata to relocate call sites after CAD edits. Do not select replacements from the old library import name alone.
- The [full crosswalk](final-inventory-crosswalk.md) accounts for all 1,964 rows and 155 renderer-route relations. There are no gaps. All 17 feature-kind bindings, 20 toolbar calls, 35 exact semantic expectations and both dynamic lead directions pass their checks.
- [Published snapshot evidence](inventory/checkpoints/25b3994/README.md) preserves the current inventory bytes and confirms they equal the Git blobs in `25b3994`. Its source manifest covers 455 production files. The original earlier snapshot remains intact.
- [Snapshot semantic review](inventory/checkpoints/25b3994/semantic-review.md) confirms all 282 occurrence IDs and meanings remain covered. Moved lines, changed vector-field renderer keys and principal-plane conditions do not require new command icons.

## Final visual decisions

The lead arrows sit inside matching closed contours and mirror about the contour center. Offset has a verified parallel inset, including its bevels. Selection targets retain distinct face, edge and body silhouettes using a consistent projection. Revolve, Loft and Sweep have distinct closed result geometry. File modifiers, machine controls, persistence and navigation share family rules while retaining different meanings.

The [final cross-family review](final-cross-family-review.md) additionally corrected the small file-body projection, aligned Section View to the exact shared body and removed redundant Boolean edges. Numeric bounds evidence is now serialized explicitly. Actual 12/14/15/16/20/24 pixel dark/light states remain in `icon-review/`; the [before/revised sheet](icon-review/refinement-dark.png) shows the main changes.

Small CAD pictures still rely on their control labels. The interior lead drawing illustrates center-pierce behavior; arbitrary coordinate-based leads can approach differently. Open curves, shafts, axes, hatch strokes and occluded page/gesture modifiers are intentional. Material/profile result contours are closed. These limits are recorded without calling the set perfect or changing application behavior to fit an icon.

## Apply and verify

Carry the asset/component source, generation scripts, static catalog entry, Vite catalog build entry and favicon reference. Apply the usage map to newer CAD consumers while retaining the current CAD implementations, checks, labels and handlers. Keep shared renderers dynamic. The integration map records parent contracts rather than exposing handlers or turning every variant into a separate action.

`npm run icons:audit` now uses the published `25b3994` snapshot. `npm run icons:integration` rebuilds the handoff map; `node scripts/build-icon-integration-map.mjs --check` verifies it against current assets and exports. `npm run icons:check` checks generated parity, current references, actual geometry constraints and accessibility/catalog tests. `npm run icons:review` regenerates all numeric bounds and actual-size sheets with review coverage.

The latest Node 24.22.0 batch passes all 104 UI/geometry files and 1,061 tests with two workers. The parent checkpoint repairs the earlier stale datum assertion; its fixes are preserved exactly. All icon, exact geometry, published-snapshot reconciliation and numeric bounds checks pass. The production build is recorded in `icon-verification.md`. Actual browser review used the repository's isolated Playwright build on 3107. The CAD task's 3777/3778 servers and checkout were left untouched.

The icon release remains 0.0.698, after CAD 0.0.697. Icon changes do not alter UPID/post/engine versions, installed machine packages, storage, controller output or WebMCP checks. CAD domain code matches the target branch. Parent CAD changes retain their own release and review records. Merging remains the pull request's review step.
