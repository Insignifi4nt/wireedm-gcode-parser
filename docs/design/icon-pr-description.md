The workbench previously mixed library icons and text symbols, with a cube representing Pad, Pocket and Shell and a copy symbol representing several different modeling operations. This change supplies 132 original SVGs with shared 24-unit geometry and 1.75-unit strokes, a typed React catalog, manifest, original favicon and an interactive size/state preview. Current app consumers use the catalog while preserving names, handlers and guards.

This is a stacked draft after `feature/parametric-cad-workbench`, intended for app 0.0.698 after CAD 0.0.697. The icon-only review basis is `c16a15e`; until the CAD branch publishes its final reviewed base, GitHub may include earlier CAD commits in the comparison. Rebase onto that reviewed commit and apply the included mappings to its newer consumers before marking ready. This branch did not copy the concurrent uncommitted CAD implementation. No merge is requested.

The frozen CAD handoff inventory is preserved and reconciled across 1,964 rows, 282 direct references, 214 imports and all 206 expanded variants. Exact feature/call metadata distinguishes overloaded glyphs; every excluded model drawing, mathematical notation, native control or cursor has a reason. Current checkout references reconcile 228/228 with 15 added semantic/text-symbol replacements. Sources, three Image Gen studies, hand-authored geometry, dark/light review sheets, browser screenshots and independent review evidence are in `docs/design/`.

Validation: 62 React UI files / 542 tests pass; six SVG/catalog/accessibility tests pass; source reference checks, six-size raster bounds, semantic mapping checks, TypeScript/Vite, hosted docs/link/schema checks and pinned STEP/CAD source distribution verification pass. Independent review fixed compact Categories alignment, diagnostic SVG padding and shared-container mapping errors. A separate broad app/features run passed 126 files / 1,056 tests, with the unchanged native topology stress test exceeding its explicit 20-second limit, including on an isolated retry. No topology fix is included.

Compatibility checklist:

- App release advances once to 0.0.698 after CAD 0.0.697. UPID, post schema and engine API versions retain their existing sequence.
- Installed post schemas and package capabilities remain compatible.
- Post execution events, audits and controller output are unchanged, including numbering, encoding, line endings, wrappers and feed behavior.
- Machine package installation, saved revisions, browser cache and folder storage have no migration or cleanup.
- UI actions and WebMCP checks retain their existing guards and cancel/version behavior.
- Release compatibility record: `docs/releases/0.0.698.json`. No controller hardware verification is claimed.
