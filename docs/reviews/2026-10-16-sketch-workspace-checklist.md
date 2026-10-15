# Sketch mode and CAD workspace

Goal started 16 October 2026. Base `01e6380`, merged PR #14. Local branch `feature/sketch-workspace-polish`, with no remote upstream. User instruction: work locally, commit checkpoints, never push, create a PR, merge or deploy during this goal.

## Order and acceptance

- [x] Start a durable goal and a fresh local branch from merged main.
- [x] Replace the dashboard's three header selectors with one Filter button immediately right of Search. Preserve combined filtering, sorting, archive restore, keyboard dismissal and focus.
- [x] Record official CAD sketch references and an implementation/acceptance matrix.
- [ ] Reproduce and correct point/segment/profile picking and dragging. A free point must move independently of the whole closed contour.
- [ ] Establish stable geometry references and a coherent constraint model, including dimensions, degrees of freedom, conflicting/redundant constraints and cancellation.
- [ ] Complete direct editing across supported line, arc, circle, rectangle, slot, polygon and generated/reference geometry. Distinguish free and driven controls without misleading edit affordances.
- [ ] Complete the sketch tool and interaction inventory established by the research. Cover selection, snapping, construction/reference geometry, trim/extend/offset, transforms and other core sketch operations as supported by a consistent domain model.
- [ ] Keep human commands and agent operations equivalent, guarded, versioned, discoverable and documented.
- [ ] Verify complete part-building workflows, exact geometry, undo/redo, rejected edits, saves/reopens and downstream rebuilds. Test meaningful math and state invariants at shared application/domain operations; inspect interaction and visuals in the actual browser.
- [ ] Independently audit sketch mode against the original goal and source-backed scenarios. Investigate missing or weak evidence, rather than treating passing tests as completion.
- [ ] Only after the sketch audit is satisfied, continue interaction, shared-control and agent usability improvements across existing CAD tools.
- [ ] Final audit of the complete objective, local commits and evidence. No completion claim while required work remains.

## Initial findings

The canvas picker currently returns a profile ID. Selecting/dragging a boundary therefore translates its whole profile. The constraint module records explicit dimensions for primitive profile sizes and preserves expressions, but has no general point/segment relationship solver. Paths and polygons expose no dimension quantities. These are model and interaction gaps, not styling issues.

Research runs in parallel and will be recorded in `2026-10-16-sketch-workflow-reference.md`. The first implementation slice is the requested dashboard filter, followed by granular sketch selection and editing.

## Checkpoint: project filters and reference review

One shared Filter menu follows Search and contains state, source and sort radio groups. Combined filters, restore focus, keyboard navigation, Escape dismissal and menu ownership are preserved. Verified: 12 focused cases; TypeScript and shared UI standards; full production build; 3 Chromium journeys; Firefox archive/restore including widths 390–1705 px. Actual in-app browser appearance inspected; screenshot at tmp/sketch-project-filter.png. Icon integration inventory refreshed. No remote action.

Official source comparison and 22 sketch acceptance scenarios are recorded in 2026-10-16-sketch-workflow-reference.md. Granular editing and the rest of the sketch goal remain outstanding.
