# Wire EDM Workbench

A local-first Wire EDM workbench that preserves controller-neutral CAM state and generates exact machine programs through complete, human-installable machine packages.

When a version-1 workbench is opened, usable projects migrate to the current neutral format. Exact pre-migration manifests and projects remain preserved under `legacy/v1/`; old machine/output settings are never guessed into a trusted machine package.

## Commands

- `npm run dev` - start the Vite dev server
- `npm test -- --run` - run Vitest once
- `npm run build` - type-check and build the static app
- `npm run preview` - preview the production build
- `npm run machine-package:build -- <source-directory> [output.wireedm-package]` - build a complete machine package
- `npm run machine-package:validate-source -- <source-directory>` - validate package sources without writing an archive
- `npm run machine-package:validate -- <package.wireedm-package>` - validate an installable package
- `npm run machine-package:inspect -- <package.wireedm-package>` - inspect a package inventory

## Current Scaffold

- Client-only app, static-hostable.
- Dashboard plus an initial contained editor view for program import/preview.
- Chosen workbench folder support with remembered-handle reconnect, plus browser cache fallback.
- If persistent browser storage is blocked, the app falls back to a clearly labeled temporary workbench.
- Tested DXF import API for `LINE`, `ARC`, `CIRCLE`, and `LWPOLYLINE` entities, with library-backed SPLINE flattening fallback, generating G-code bodies without feeds.
- Editor imports `.gcode`, `.nc`, `.iso`, and `.txt` files directly into the active workbench and previews parsed G0/G1/G2/G3 paths.
- Controller output is generated from a saved revision and the active setup supplied by an installed machine package.
- No feed generation by default; feeds are controlled on the machine.
- Controller-file rules, including extension, encoding, line endings, wrappers, and numbering, are owned by the exact installed post processor.
