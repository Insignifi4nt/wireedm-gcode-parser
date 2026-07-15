# Task 5 Report — Workflow ownership and provisional saves

## Outcome

The path editor now enforces one active workflow as the exclusive owner of provisional UI and document mutations. Inactive workflow panels are unmounted, their mutation handlers reject calls outside the owning command, and canvas-only affordances are supplied only to their owner.

Every mutating workflow exposes local Save and Cancel actions. Save commits the workflow snapshot as one history entry and closes the panel. Cancel requests closure; a dirty workflow presents Save and Discard, while the dialog X is the only Stay action. Incomplete local inputs keep Save disabled with a concrete reason even when another valid action changes the same workflow.

## Ownership map

| Workflow | Owned responsibility | Provisional/pending state |
| --- | --- | --- |
| Geometry Setup | document geometry basis | basis change |
| Transform Geometry | translate, place, rotate, mirror, drag, segment-centre movement | target and translation drafts tracked independently |
| Contour Setup | direction, role, compensation intent | contour document edits |
| Set Start | selected-contour endpoint/split start | active pick step and magnetic start mode |
| Cut Sequence | planning strategy and operation order | ordering edits |
| Initial Wire Position | reviewed manual or geometry-linked initial position | coordinate draft until applied |
| Entry / Exit & Rethreading | rapid endpoints, lead entry/exit, threading policy | entry, exit, rapid-source, and rapid-destination drafts tracked independently |
| Program Stops | add, enable, remove operation stops | unfinished stop form |
| Machining Participation | retained/inactive spans, controller side, entry review | unfinished span form |
| Measurement & Construction | measurement points, grid/magnetic snap, point/tangent/perpendicular construction | coordinate input and active construction mode tracked independently |

Machine Profile, Position, Statistics, Path Summary, Endpoint Topology, Diagnostics, and Contour Tree are view workflows. Machine owns profile/fit/provenance inspection and the externally gated Re-import action; Position is read-only and reports Grid Snap On/Off without owning its control. Normal canvas selection remains globally available.

## Canvas and lifecycle boundaries

- Measurement-point drag and point/construction click modes exist only in Measurement & Construction.
- Endpoint start picking exists only in Set Start and rejects endpoints from other contours.
- Path drag and segment-centre movement exist only in Transform Geometry.
- Escape first backs out of an active tool/mode; a later Escape closes the workflow. Dirty closure uses the Save/Discard warning.
- Back, import/drop, and DXF re-import wait for the active workflow decision before applying their existing project-unsaved protection.
- `beforeunload` protects both committed-unsaved document changes and dirty provisional workflow state.
- Workflow snapshots restore document selection, measurement/construction state, transform drafts, start mode, snap flags, and other provisional local state on Discard.

## Regression coverage

- A real-mutation matrix exercises all ten mutating workflows, proves Save becomes available, proves Save closes the workflow, and proves the result survives reopening.
- Construction Save is verified as one Undo/Redo unit; document workflow Save has an exact one-history-entry regression.
- Incomplete Measurement and Transform drafts remain blocking across unrelated valid actions.
- Hidden workflow handlers are absent/inert; Position does not expose grid snap; workflow X/Cancel, Back, drop/import, beforeunload, Set Start targeting, and discard restoration are covered.
- The editor path boundary suite passes 65 tests and the localized supporting suites pass 20 tests.
- Repository-wide verification passes all 80 files and 1,264 tests. The production build and `git diff --check` both succeed; Vite reports only the existing chunk-size advisory.
