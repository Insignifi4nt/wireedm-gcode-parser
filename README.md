# Wire EDM Workbench

A local-first Wire EDM workbench for DXF import, clean IJ G-code generation, editing, verification, and export.

## Commands

- `npm run dev` - start the Vite dev server
- `npm test -- --run` - run Vitest once
- `npm run build` - type-check and build the static app
- `npm run preview` - preview the production build

## Current Scaffold

- Client-only app, static-hostable.
- Dashboard plus an initial contained editor view for program import/preview.
- Chosen workbench folder support with remembered-handle reconnect, plus browser cache fallback.
- If persistent browser storage is blocked, the app falls back to a clearly labeled temporary workbench.
- Tested DXF import API for `LINE`, `ARC`, `CIRCLE`, and `LWPOLYLINE` entities, with library-backed SPLINE flattening fallback, generating G-code bodies without feeds.
- Editor imports `.gcode`, `.nc`, `.iso`, and `.txt` files directly into the active workbench and previews parsed G0/G1/G2/G3 paths.
- Persistent header/body/footer G-code output.
- No feed generation by default; feeds are controlled on the machine.
- Output extension is selectable: `.iso`, `.nc`, `.gcode`, or custom.
