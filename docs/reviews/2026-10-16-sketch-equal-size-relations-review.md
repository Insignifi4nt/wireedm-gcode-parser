# Equal-size relations review

Independent review of the local changes after `e4dbf90`, 2026-10-16. Scope: equality source/parser/references, independent acceptance, pinned solver mapping, feedback/inspection, and selected-pair relation editing. Compared with the [equal-size plan](2026-10-16-sketch-equal-size-relations-plan.md). Unwired arrangement work is excluded.

No actionable correctness or ownership issue found. No production repair was needed.

- Relations keep their exact source tuple order and IDs. Operands must be distinct existing entities of the required kinds. Construction and shared endpoints remain supported. Scalar traversal is a no-op; existing coordinate, radius and dimension drivers are retained.
- Panel matching is symmetric, while restoring an accepted relation reuses its original object rather than creating a reversed replacement. Mixed/extra selections do not expose equality controls. The existing disposable preview, AbortSignal submission, stale-source rejection and session history paths remain in use.
- Equal length compares actual finite line lengths in world millimeters. Equal radius compares circle scalars and both actual endpoints of each arc. Circle centers do not widen scalar precision. Existing strict tolerances and structural arc checks remain unchanged.
- The pinned native mapping uses line equality, circle-radius equality, existing arc radial spokes, and a direct native circle-radius parameter reference for mixed pairs. It adds no copied radius driver, native arc ownership model or source rewrite. Two free sizes retain a size degree of freedom; the numerical solution does not establish a master.
- The known pinned solver limitation for fully string-driven circle radii is reported honestly: matching fixed radii can return Success without redundancy IDs. Mismatching fixed radii are independently rejected as an invalid solution. No diagnostic IDs are invented, and rejected preparation leaves the accepted session unchanged.

Verification: **14 focused cases passed**, including reversed/shared lines, actual arc endpoint validation, major signed arcs, free size, parameter propagation, constrained drag, exact worker-reply tuples, atomic rejection, pair Cancel/Apply/restoration and Undo. Evidence: ignored `tmp/cad-equality-independent-focused.log`.

```powershell
npm test -- --run src/domain/cad/__tests__/cadSketchEqualRelations.test.ts src/features/cad/sketch-solver/cadSketchSolverEqualRelations.test.ts src/features/cad/CadSketchRelationsPanel.test.tsx -t 'owned scalar-free|real PlaneGCS scalar-free|keeps .* pair edits private'
```

No full suite, production build or browser journey was rerun for this review. The implementation owners retain those acceptance checks.

## Root acceptance

The domain/native/boundary group passes 153 cases across 19 suites (`tmp/sketch-equal-size-trial/equality-focused-tests.log`). All 23 panel cases pass (`tmp/sketch-equal-ui.log`); the two new cases initially fail on missing equality controls (`tmp/sketch-equal-ui-red.log`). Full production build, TypeScript, docs/source distributions, shared controls and sequential icon integration pass. Chromium and Firefox each pass all 18 production sketch/region journeys against the frozen completed build (`tmp/sketch-equal-all-{chromium,firefox}.log`).

The new journey exercises side equality, two diameter-linked bores, Undo/Redo, material measurement, exact native extrusion and Save/reload. The separate native in-app browser uses registered WebMCP plus real controls: preview/Cancel leaves accepted source unchanged; Equal length makes the 40×20 plate square; Equal radius plus Ø8 changes both bores to radius 4 while retaining exact ` side ` / ` bore ` expressions and tuple order. Freedom falls 2 → 1 → 0. Pad5 yields one 7497.345175425631 mm³ solid, bounds [0,0,0]–[40,40,5], without diagnostics. Four versioned Undo steps restore the full original feature and parameters. Screenshot: `tmp/sketch-equal-sizes.png`; disposable unsaved tab closed. No real saved records or remote state changed.
