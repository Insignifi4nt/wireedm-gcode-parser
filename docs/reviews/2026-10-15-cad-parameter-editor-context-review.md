# Preserve context while opening a parameter value editor

Opening `height` on a selected Loft automatically opened its Outlet sketch; opening the same value in an already active Base sketch also discarded that context/profile selection. Both mounted public-controls cases reproduce the transition before repair (`tmp/cad-parameter-context-red.log`).

The repair removes only four lines that automatically delegated parameter-editor opening to the first active usage. `inspectedParameter`/input metadata, current-sketch highlighting, value editing and the existing explicit Inspect usage handler remain intact. The explicit Inspect action still navigates to Outlet; Cancel after that deliberate action retains the chosen Outlet context. No parameter evaluation, geometry, API, source or history semantics change.

Two regressions cover selected solid and different active sketch/profile through editor opening, value draft, Cancel, exact source/version/history retention and explicit usage inspection. The existing gear pressure-angle case now deliberately clicks its usage Inspect action and retains all geometry/workflow assertions. These use the existing Workbench harness: real domain/session/editor/SVG/public-control behavior, with the unavailable native solid renderer replaced.

Node24.22: **107/107** across Workbench, parameter panel, feature tree and gear integration suites; full `npx tsc -b --pretty false` and scoped `git diff --check` pass. Logs: `tmp/cad-parameter-context-focused.log`, `tmp/cad-parameter-context-types.log`.

SHA-256: Workbench `9315677A26AAA54B653E12B9E350B47C1B9E4AE4CE1942D42D601DBDA9FFA108`; Workbench tests `E634711DC0BE8157C69ABC903CB90B718ECA76A68052233CB621881FB3B3F7FB`; gear test `DC21D035FEB3F521755213F0A311363F686C3848943ABB12290F05A1D70CD44A`. `tmp/cad-parameter-context-freeze.json` seals this slice. Independent review and actual saved Loft browser verification belong to the parent checkpoint; no build/server/browser/commit/publication was performed here.
