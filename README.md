# Wire EDM Workbench

A client-only Wire EDM editor for DXF geometry and existing machine programs. Projects start in browser storage; a workbench folder is optional. Controller output comes from saved revisions and installed `.wireedm-package` files.

When a version-1 workbench is opened, usable projects migrate to the current neutral format. Exact pre-migration manifests and projects remain preserved under `legacy/v1/`; old machine/output settings are never guessed into a trusted machine package.

## Commands

- `npm run dev` - start Vite on port 3777
- `npm test -- --run` - run Vitest once
- `npm run build` - type-check and build the static app
- `npm run preview` - preview the production build on port 3778
- `npm run test:e2e` - run Playwright on its reserved port 3107
- `npm run post:docs:check` - verify generated post schemas and SDK declarations
- `npm run post:conformance -- <post.wireedm-post.json>` - run a post's conformance fixtures
- `npm run machine-package:build -- <source-directory> [output.wireedm-package]` - build a complete machine package
- `npm run machine-package:validate-source -- <source-directory>` - validate package sources without writing an archive
- `npm run machine-package:validate -- <package.wireedm-package>` - validate an installable package
- `npm run machine-package:inspect -- <package.wireedm-package>` - inspect a package inventory

## Editing and output

- DXF imports become controller-neutral UPID path projects. Import supports lines, arcs, circles, lightweight polylines, and flattened splines, with explicit unit review.
- The editor provides contour starts, geometry transforms, cut order, initial wire position, entry/exit, threading, machining participation, program stops, and measurement tools.
- Measure reports picked-point distance and minimum source-feature gap without editing the project. Canvas filters and Alt-click resolve overlapping geometry; the Geometry lens provides exact source selection.
- Geometry → Source & Machine Setup shows source units and planning-machine fit. Changing DXF units requires reviewing the rebuild from the preserved source.
- Each editing workflow commits one undo step. Header Save persists those committed changes. Controller Export uses the saved project and the selected machine's active setup.
- Existing `.gcode`, `.nc`, `.iso`, and `.txt` files use a separate text editor with G0/G1/G2/G3 preview and cleanup tools.
- Machine packages own controller syntax and file rules, including extension, encoding, line endings, wrappers, and numbering. The app does not generate feeds by default.
- Persistent browser cache requires Web Locks to serialize edits across tabs. If Web Locks or persistent storage is unavailable, the app uses explicitly marked temporary storage until the page closes or reloads. Existing browser-cache files remain untouched and can be opened in a browser with Web Locks support. Folder selection and remembered-folder reconnect remain optional.
- Folder writes also require Web Locks. This coordinates workbench tabs, not other applications editing the same folder. Package installation, saved revisions and project deletion/restoration have recovery journals; ordinary project add/rename/edit operations use in-session rollback and report inconsistent files if interrupted before completion.

## Documentation

- [Project vocabulary](CONTEXT.md) and [contributor rules](AGENTS.md)
- [Machine package decision](docs/adr/0002-install-complete-machine-packages.md)
- [Post and machine package authoring](docs/post-authoring/v1/README.md)
- [Browser testing](docs/playwright.md)
- [CAM feature audit and supported limits](docs/cam-product-audit.md)

`docs/superpowers/` contains dated research, designs, and implementation history. Older plans describe the app at that time; current schemas, contributor rules, and the machine-package decision take precedence.
