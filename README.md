# Wire EDM Workbench

A local-first Wire EDM workbench for DXF import, clean IJ G-code generation, editing, verification, and export.

The previous vanilla JavaScript viewer/editor is preserved under `old_reference/current_app` and should be treated as the behavioral reference when editor functionality is ported.

## Commands

- `npm run dev` - start the Vite dev server
- `npm test -- --run` - run Vitest once
- `npm run build` - type-check and build the static app
- `npm run preview` - preview the production build

## Current Scaffold

- Client-only app, static-hostable.
- Dashboard plus an initial contained editor view for program import/preview.
- Browser-cache workbench by default, with optional folder persistence where the File System Access API is available.
- Tested DXF import API for `LINE`, `ARC`, `CIRCLE`, and `LWPOLYLINE` entities, with library-backed SPLINE flattening fallback, generating G-code bodies without feeds.
- Editor imports `.gcode`, `.nc`, `.iso`, and `.txt` files directly into the active workbench and previews parsed G0/G1/G2/G3 paths.
- Persistent header/body/footer G-code output.
- No feed generation by default; feeds are controlled on the machine.
- Output extension is selectable: `.iso`, `.nc`, `.gcode`, or custom.

## Reference App

The old app lives in `old_reference/current_app`. Preserve its cleanup, preview, drawer, pinning, normalization, and export behavior when porting those capabilities.
