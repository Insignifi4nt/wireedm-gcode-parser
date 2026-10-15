# Reusable icon package and current app integration

Baseline: merged main `bfac8563ca03be28f1462e8ffbb49b76b39d5e9e`, app 0.0.697. PR12 was merged with a merge commit first, as requested; Pages deployment 38808617092 passed. This continues existing icon PR13 for app 0.0.698 in `665a/Wire_EDM`.

## Package and integration

`packages/icons-react` is npm workspace `@wire-edm/icons-react`, version 0.1.0. Its 134 original drawings have 227 semantic/compatibility exports, ESM, TypeScript declarations and individual `icons/<id>` entries. React is its sole runtime peer. Named modules contain their own paths and a small native SVG renderer; the dynamic renderer/catalog require explicit subpaths. Former app implementations are compatibility re-exports. Production consumers import the package directly.

One editable geometry source generates package modules, SVGs, manifest and searchable catalog. Build checks generated source without rewriting it. The CAD text safeguard ignores type annotations and conditional branches made entirely of imported icons; its self-check still rejects axis-label rewrites. Root install/build hooks prepare the package; PR/Pages gates verify generation, purpose mapping, assets, geometry and package behavior. Actual tarball installation in an isolated offline consumer checks exports and declarations without repository aliases. A named AddIcon bundle is 775 bytes with React external, retaining one drawing and the renderer without the dynamic catalog.

Current source has 309 imported icon references. All 285 surviving references from the original 286-use snapshot resolve. The removed header storage badge is explicitly retired; 24 later/text-glyph references are recorded separately. All 17 feature kinds and the original eight dynamic slots remain mapped. The complete refreshed inventory also records current expanded profile maps, assets, glyphs and purposes. Historical snapshots remain intact.

Independent source review repaired missing rail/lens/disclosure/category icons and the misleading rectangle fallback for noncircle profiles. The profile map is exhaustive for rectangle, circle, slot, polygon, path and plugin. Shared controls, sentence case, header cleanup and quiet project rows remain intact. Domain/kernel, WebMCP/controller, display mesh, source output, capture and simulation-scene code have no delta from merged main. See `2026-10-16-icon-app-integration-review.md`.

## Verification

- Complete existing unit run: 395 files / 4,161 cases pass in 256.98 s; final narrow editor/tree repairs additionally pass 23/18 existing cases. No new app UI case was added in this integration. Two package behavior cases cover native SVG/ref/stroke and accessibility; the packed consumer verifies distribution and tree shaking.
- All 55 selected existing Chromium journeys pass: CAD workflows, dashboard/native Tab order, controller export settings, tree/canvas selection, workspace panels and direct manipulation. No timeout, retry, native precision or workflow check was weakened.
- Final TypeScript/Vite, 30 generated documentation pages / 95 checked files and pinned corresponding native sources pass. UI ownership, icon generation/geometry/mapping/text preservation, package/type/bundle and release gates pass.
- Actual localhost:3778 production shows new dashboard, tree and toolbar icons. The saved module 3 gear was opened through discovered WebMCP tools without editing/saving. Fingerprint remains `68478d8934b638195b4e856c4225de0193516a852e72a3bc6cd661780b19f18d`; native volume remains 21,344.063921829482 mm³, one solid, no diagnostics. View controls and normal/disabled icons were inspected. The app returned to the dashboard.

Logs: `tmp/icon-package-{full-tests,browser-tests,final-build,verification}.log` and `tmp/icon-final-{current-audit,inventory}.log`. Screenshots: `tmp/icons-dashboard-final.png`, `tmp/icons-cad-final.png`. Preview uses Node 24.22.0 on 3778. Retained prior hashed assets are ignored local preview artifacts, excluded from CI publication.

App/icon package versions are independent. Installed post/machine schemas, capabilities, events, audits, output, installation, saved revisions, pinned CAD plugins and browser/folder storage remain unchanged. No migration or registry publication occurs. PR13 remains the icon release's reviewed publication route.
