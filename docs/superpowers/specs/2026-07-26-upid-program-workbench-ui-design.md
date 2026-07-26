# UPID Program Workbench UI Design

**Date:** 2026-07-26  
**Status:** Approved direction; implementation pending written-spec review

## Purpose

Refine Wire EDM Workbench into a clean, canvas-first technical application without discarding its current identity or workflow model.

The editor will retain its existing dark workbench styling, six workflow menus, local-first persistence, single active workflow, and explicit Save/Discard behavior. The main structural change is a persistent left rail that accurately projects the sequential UPID program and makes its editable actions direct entry points into the existing workflow panels.

This design is informed by:

- the user-provided Onshape workbench and contextual-dialog screenshots;
- the current live editor at 1280×720;
- Onshape's stable feature tree and contextual commit/cancel model;
- Fusion Manufacture's ordered operation browser and per-node status;
- Mastercam's execution-oriented Wire workflow and progressive disclosure.

The product should adopt those interaction principles without copying a generic CAD ribbon or exposing functionality that is not backed by tested domain behavior.

## Goals

1. Preserve the current visual identity and canonical workflow categories:
   **Geometry, Machining, Construction, View, Machine, Export**.
2. Remove empty docks and return unused space to the path canvas.
3. Add a persistent, collapsible UPID rail that distinguishes project setup from actual program execution.
4. Show operations and their actions in true planned execution order.
5. Make setup, operation, transition, entry/exit, machining-span, and stop nodes open their existing editor workflows.
6. Keep one active workflow at a time with preview, validation, Save, Discard, and Cancel semantics.
7. Reduce the size and visual weight of header dropdowns and other nested panel chrome.
8. Keep the workbench usable at the established 1024px laptop target and provide an explicit drawer/compact-rail model below that width.
9. Add regression coverage at the domain projection, component, application, and real-browser workflow levels.

## Non-goals

- No new machining, controller, post-processing, or geometry capability.
- No fake toolbar commands, placeholder rows, or screen-only navigation.
- No new feed generation.
- No change to G-code text based solely on the selected output extension.
- No attempt to represent geometric containment as execution nesting.
- No direct drag-to-reorder behavior in this pass. Existing Cut Sequence behavior remains the authoritative reorder workflow.
- No wholesale dashboard redesign. Dashboard changes are limited to responsive overflow and shared visual-density corrections.
- No replacement of the external machine-program cleanup/editor pipeline.

## Approved Spatial Model

The approved direction is a persistent program tree with a contextual workflow panel over the canvas.

```text
[ Back | project | PATH PROJECT ] [ Geometry | Machining | Construction | View | Machine | Export ] [ history/save/help ]

[ UPID rail                   ] [ canvas and relevant overlays                                  ]
[ Program | Geometry          ] [ floating contextual workflow, when active                     ]
[ Source & Setup              ] [                                                                 ]
[ Program Sequence            ] [ optional right dock only while an active panel is docked there ]

[ document/selection/readiness/cursor status ]
[ storage/machine/output status             ]
```

The current empty left and right dock placeholders must not render. A workflow dock exists only while the active workflow is explicitly docked. The canvas receives every other pixel.

## Persistent UPID Rail

### Rail modes

The rail has two lenses:

- **Program** is the default. It shows setup plus actual execution order.
- **Geometry** reuses the existing contour/segment hierarchy for containment and source inspection.

These lenses must not be merged. Containment and execution answer different questions and can order the same contours differently.

### Width and collapse behavior

- Desktop default width: 260px.
- Laptop default width: 220px.
- Resizable range: 190–360px.
- The expanded width and rail collapsed state are persisted as workspace preferences.
- Collapsing the rail produces a 36px strip with:
  - expand control;
  - current rail-lens icon;
  - rolled-up ready/review/blocked status;
  - selected operation ordinal when one exists.
- Source & Setup and Program Sequence collapse independently.
- With existing operations, Program Sequence starts expanded and Source & Setup starts collapsed.
- In a new/empty project, Source & Setup starts expanded.
- The selected operation expands automatically. Manual operation expansion is retained for the current editor session while matching node keys remain valid.
- Per-operation expansion is not persisted across reloads because generated operation IDs can change after geometry re-analysis.

### Keyboard and accessibility model

The expanded rail uses `role="tree"` and `role="treeitem"` with correct `aria-level`, `aria-expanded`, `aria-selected`, and roving tab focus.

- Arrow Up/Down moves between visible nodes.
- Arrow Right expands or enters children.
- Arrow Left collapses or moves to the parent.
- Enter invokes the node's primary edit action.
- Space selects/highlights the node without opening a workflow.
- Tooltips expose compacted labels and status reasons.

## Program Projection

### Domain boundary

Add a pure domain projection:

```ts
buildUpidProgramTree(
  document: PathPlanningDocument,
  machine: MachineProfile
): UpidProgramTree
```

Suggested location:

`src/domain/upid/upidProgramTree.ts`

It must not depend on React, browser storage, or UI component state.

The projection produces:

- setup nodes;
- source operations in `orderIndex` order;
- effective posted-operation references when machining participation derives or suppresses source operations;
- ordered action/phase children;
- edit targets;
- source selection references;
- derived ready/review-required/blocked/inactive statuses;
- rolled-up diagnostics.

Every UI node exposes a stable-within-revision `treeKey` and an explicit edit-target union. The UI must not infer workflow behavior from display labels.

### Source and setup section

The non-execution section may contain:

1. Source geometry and units
2. Geometry basis
3. Project machine and output setup
4. Initial wire position / G92
5. Project rethread default

These nodes remain separate from Program Sequence because they describe shared inputs and defaults rather than contour execution.

### Program sequence

Source operations are ordered by `plan.operations[].orderIndex`.

Each expanded operation projects the phases that apply to it:

```text
01 · Hole 1
├─ Incoming connection
├─ Before-entry program stop(s)
├─ Entry / lead-in
├─ Cut path
│  ├─ Contour start
│  ├─ Active/inactive machining-span projection
│  └─ Before-operation-end stop(s) at resolved cut positions
├─ After-contour program stop(s)
├─ Exit / lead-out
└─ After-exit program stop(s)
```

Rules:

- Initial wire position feeds the first operation's incoming connection.
- A later incoming connection uses the destination operation's `threadingTransition`, falling back to the project threading default.
- Rethread and positioning are displayed under the destination operation even though they occur between source operations.
- Entry occurs after positioning and before the contour cut.
- `before-operation-end` stops are placed within Cut Path at their resolved remaining-cut position.
- `after-contour` stops appear before Exit.
- `after-exit` stops appear after Exit.
- Disabled stops remain visible but muted so they can be reopened and enabled.
- An absent optional action may appear as a compact muted row only when it is directly configurable, such as `Exit · none`. It must not create a fake persisted entity.
- Partial machining keeps the source operation as the editing target and exposes an effective posted-path child. Derived `op_*__span_*` IDs are never treated as persistent editable operations.

### Status projection

Do not add redundant persisted status fields to UPID.

Use existing resolvers and diagnostics:

- Initial position: `resolveInitialWirePosition`
- Incoming transition: `resolveOperationThreadingTransition`
- Stops: `validateProgramStops`
- Participation: `deriveActiveMachiningOperations`
- Compensation: existing compensation resolution
- Entry/exit: strategy and review state
- General validity: existing UPID/path diagnostics

Supported visible statuses:

- **Ready** — green
- **Review required** — amber
- **Blocked** — red
- **Inactive/disabled** — muted

An active dirty workflow may add an ephemeral **Modified** marker, but this belongs to `EditorWorkflowSession`, not the saved UPID document.

Parent nodes roll up the worst child status. Hover/focus provides the exact reason. Clicking a blocked or review-required status selects the node and opens the relevant workflow or diagnostics view.

### Accuracy constraints

The UI must not:

- nest operations according to contour `parentId`/`childIds`;
- display derived rapids as persisted contour children;
- repeat the project threading default under every operation;
- expose a derived `PathElement` or effective span as an independently persisted operation;
- claim machine-specific emitted codes are ready when the current machine resolver blocks them.

## Node-to-Workflow Behavior

| Node | Selection effect | Workflow opened |
| --- | --- | --- |
| Source geometry | Select document/source | Path Summary or source details |
| Geometry basis | Select document | Geometry Setup |
| Machine and output | Select document | Project Machine & Source Setup |
| Initial wire / G92 | Select setup | Program Start / G92 |
| Rethread default | Select setup | Between Contours |
| Operation row | Select and highlight operation | Contour Setup on Enter/edit affordance |
| Operation order badge / sequence action | Select operation | Cut Sequence |
| Contour start | Select operation start | Contour Start |
| Incoming connection | Select destination operation | Between Contours |
| Entry / exit | Select operation transition | Entry / Exit |
| Active/inactive cut span | Select operation/span | Machining Participation |
| Program stop | Select operation and stop | Program Stops |
| Segment in Geometry lens | Select segment | Existing geometry inspection/transform path |
| Diagnostic/status indicator | Select related source ref | Path Diagnostics or owning workflow |

Opening a workflow for a node must be atomic:

1. resolve the explicit source selection/edit target;
2. ask the existing workflow-transition guard for permission;
3. select the operation/path element/stop target;
4. create the workflow session from that explicit target;
5. open the contextual panel.

Do not rely on a React state update completing before `openEditorWorkflow()` reads the selected operation. Introduce an explicit target-bearing command such as `openEditorWorkflowForTarget(commandId, target)`.

If another workflow has unsaved changes, the existing Save / Discard / Cancel transition dialog remains authoritative. Cancel leaves the original selection and panel unchanged.

## Contextual Workflow Panels

- Exactly one workflow panel remains active.
- Mutating workflows keep provisional preview and one-history-entry Save behavior.
- View workflows remain non-mutating.
- Floating is the default placement.
- A workflow may be docked right; the dock materializes only while it contains the active workflow.
- The persistent UPID rail always retains its left position.
- A legacy stored `docked-left` workflow placement migrates to floating using its remembered geometry so no panel is lost behind the new rail.
- Panel placement controls become Float, Dock Right, and Close. The obsolete empty-drop-zone model is removed.
- The active panel uses compact, consistent top-level commit/cancel affordances and retains named Save/Cancel buttons when the workflow needs explanatory disabled states.
- Only overlays relevant to the active node/workflow are emphasized. Unrelated construction overlays are dimmed or hidden without altering saved state.

## Header and Workflow Menu Polish

Keep the existing six category labels and their order.

Changes:

- Header category text: 11px, not a mix of tiny labels and oversized dropdown content.
- Dropdown width is content-driven, clamped to 220–300px.
- Command rows use separators rather than individual card borders.
- Primary command labels are one line at 11px.
- Descriptions no longer occupy a large second line for every enabled command.
  - The active/hovered command description appears in one compact footer area.
  - Disabled commands may show one concise blocking reason.
  - Full descriptions remain available through accessible descriptions/tooltips.
- Row height targets 30–34px.
- Menus close on outside click, Escape, command execution, and focus departure.
- Arrow-key navigation and first-item focus are supported.
- The open dropdown remains inside the viewport and may flip horizontally.
- The header retains project identity, document context, undo/redo, document Save, guide, notifications, storage, and Settings.
- At constrained widths, command labels disappear before the six workflow categories do.
- Below the compact breakpoint, categories move into one explicit Workflows launcher rather than overflowing or disappearing.

## Visual Density and Shared Styling

- Retain the existing dark palette, cyan accent, monospaced technical values, and thin square controls.
- Use 11–12px for primary controls and tree labels; reserve 9–10px for metadata, status bars, and uppercase section labels.
- Replace nested card borders/shadows with alignment, dividers, and one outer panel boundary.
- Preserve strong focus-visible states and minimum practical click targets.
- Keep the canvas as the dominant visual surface.
- Avoid new decorative imagery or inactive commands.

## Responsive Behavior

### 1280px and wider

- Expanded 260px UPID rail.
- Floating workflow panel by default.
- Optional active right dock.
- Full six workflow categories.

### 1024–1279px

- Expanded 220px UPID rail.
- Floating panel is clamped away from critical geometry and can dock right.
- Header command labels compact before workflow category labels.
- Canvas remains at least 480px wide when no right dock is active.

### 768–1023px

- UPID rail defaults to its 36px compact strip.
- A rail button opens the full tree as an overlay drawer.
- Active workflow panels become bounded overlays rather than disappearing.
- Workflow categories may collapse into one Workflows launcher.

### Below 768px

- The canvas remains primary.
- Program tree and active workflow use mutually exclusive full-height drawers.
- The current behavior of hiding essential docks with `display: none` is removed.

## Dashboard Corrections

The dashboard keeps its current project-library/start-work composition.

Only targeted corrections are included:

- project filters and rows stack metadata/actions at narrow widths;
- fixed column reservations do not create horizontal overflow;
- shared menu typography and border-density improvements apply consistently;
- no fake projects or unsupported action buttons are added.

## Error Handling and Recovery

- Projection functions return explicit blocked/review statuses rather than throwing for expected invalid program state.
- A malformed or unsupported document falls back to a small rail error state with a direct Path Diagnostics action; the canvas remains available.
- A node whose source target disappears after a saved geometry mutation clears selection and closes only the stale workflow, with an explanatory status notification.
- Failed Save leaves the workflow dirty and open.
- Discard restores the pre-workflow snapshot.
- Browser-cache and optional directory persistence keep their existing failure handling.
- Folder-picker cancellation or permission denial must not discard browser-cache state.

## Testing Strategy

### Domain tests

Add focused tests for `buildUpidProgramTree`:

- holes execute before their containing exterior while Geometry lens retains containment;
- setup nodes are separate from execution nodes;
- first incoming connection uses initial wire position;
- later incoming connection resolves destination-operation threading;
- entries and exits appear in correct order;
- each program-stop placement appears in its true phase;
- before-end stops sort by resolved cut position;
- disabled stops remain visible and inactive;
- unsupported machine features roll up blocked status;
- partial machining links effective operations back to source operations;
- diagnostic severity rolls up to operation and Program Sequence.

### Component tests

- tree ARIA and keyboard navigation;
- independent section/operation collapse;
- selected-node ancestor auto-expansion;
- clicking each editable node emits the correct typed edit target;
- compact rail retains selection/status cues;
- workflow menus meet compact row/description behavior and close correctly.

### Application integration tests

- tree node selection highlights the matching canvas geometry;
- tree action opens the correct workflow with the correct operation/stop target;
- switching targets while dirty uses Save / Discard / Cancel;
- Save commits exactly one undo entry;
- Discard restores the original document;
- saved tree-driven mutations survive reopen;
- legacy left-docked layout migrates without losing the active panel;
- empty docks never consume canvas width.

### Browser workflows

Playwright continues to own strict port `3107`; verify it is free before starting.

Required journeys:

1. Import DXF → confirm → inspect default Program rail → edit entry/exit from the tree → Save → reload → reopen and verify persistence.
2. Add/edit a program stop from its tree node and verify status plus exported placement.
3. Start a dirty workflow → click another tree action → test Cancel, Discard, and Save transitions.
4. Collapse/expand the rail and operations at 1440×900, 1024×720, and a compact viewport.
5. Verify the path canvas is not squeezed by empty docks.
6. Open every workflow dropdown and assert it stays within the viewport with proportionate rows.
7. Download/export a saved UPID project, import it into a clean browser-cache context, and verify the program tree/provenance round-trip.
8. Exercise the external machine-program import/edit/save/reload/export lifecycle to ensure the shell changes do not regress the old pipeline.

Run the cheapest focused tests first, then the complete Vitest suite, production build, and serialized Playwright suite.

## Implementation Boundaries

Recommended focused units:

1. Pure UPID program-tree projection and tests.
2. Persistent rail components and typed edit-target events.
3. Editor command/session integration for atomic target opening.
4. Workspace layout migration and conditional active dock.
5. Workflow menu and shared density polish.
6. Responsive rail/drawer behavior.
7. Integration and browser workflow coverage.

Subagents may implement separate units only when their file ownership is disjoint. Integration changes in `EditorPage.tsx`, shared CSS, and final browser verification remain centrally coordinated.

## Acceptance Criteria

- A new path project never opens with empty left/right dock placeholders.
- The Program rail is visible by default and reflects UPID operation order.
- Setup data is visibly separate from execution sequence.
- Entry, cut, stop, exit, and incoming-transition children appear in accurate order.
- Clicking editable action nodes opens the correct existing workflow for the correct target.
- Dirty workflow protection, undo, Save, and persistence remain correct.
- Geometry containment remains available as a separate rail lens.
- Header menus retain their current categories and become visibly proportionate to the rest of the workbench.
- At 1024×720 the program rail, canvas, essential header controls, and active workflow remain usable without page overflow.
- At compact widths essential rail/workflow content is accessible through drawers rather than hidden.
- Browser-cache operation and external machine-program behavior remain intact.
- Focused tests, the full Vitest suite, production build, and relevant Playwright workflows pass.
