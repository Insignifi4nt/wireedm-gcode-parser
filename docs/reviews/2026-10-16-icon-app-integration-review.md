# Icon application integration review

Reviewed 2026-10-16 in `design/original-workbench-icons`, worktree `665a/Wire_EDM`. Fixed comparison: `git diff bfac8563ca03be28f1462e8ffbb49b76b39d5e9e -- src`, including working changes. This is the merged PR 12 main baseline. Standards were `AGENTS.md` and `docs/maintainers/ui-components.md`, especially semantic named icons, preserved native controls, workflow guards and focused verification.

## Findings resolved

- `EditorUpidRail.tsx` retained raw rail arrows and P/G lens glyphs. Replaced these with panel-open/close and current-lens program/geometry icons. Names, help, state and commands remain unchanged.
- `EditorProgramTree.tsx` retained plus/minus disclosure glyphs. Replaced these with expanded/collapsed icons, preserving propagation, expansion, focus and selection behavior.
- `EditorWorkflowMenuBar.tsx` retained the Categories back-arrow glyph. Replaced it with `NavigateBackIcon`, preserving the shared menu and navigation owner.
- `CadFeatureTree.tsx` displayed rectangles for every noncircle profile. Added an exhaustive map derived from `CadSketchProfile['geometry']['kind']`: rectangle, circle, slot, closed polygon/path and plugin. Profile row labels, handlers, guards, keys and rename branches remain unchanged.

The first three existing suites reproduced four missing-icon failures before repair and passed all 23 cases afterward. The existing `CadFeatureTree.test.tsx` passed all 18 cases after its repair. This reviewer added or modified no test cases.

## Source assessment

Reviewed 54 changed production TSX files. An import/binding-normalized TypeScript comparison found 45 with unchanged bodies; manually reviewed the nine residuals. They contain the repairs above, warning/disclosure/segment glyph replacements, distinct lead-in/out icons and the intentional canonical stroke default. Receipt: `tmp/icon-app-source-body-review.json`. Normalization is a review aid, not an equivalence proof.

No unintended domain, geometry, source-output or workflow change was found. The domain/kernel, display-mesh, capture and simulation-scene files have no delta against the fixed baseline. Current shared-control behavior, theme/header cleanup and layout remain intact. Production consumers use the icon package; remaining directional/unit notation is meaningful technical text.

No unresolved documented-standard violation or actionable Fowler smell was found in this bounded application review. Package generation, root audits, final inventory, full gates and browser acceptance belong to the other owners and were still integrating. This review does not certify those separately changing artifacts or runtime appearance.
