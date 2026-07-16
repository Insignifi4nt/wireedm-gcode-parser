# Single-Workflow Editor Design

Date: 2026-07-15

Status: Approved through the interactive design review in task `019f651c-9fea-78d3-83e7-d248e342b0a5`.

## Goal

Replace the editor's overlapping workflow menus, panel shortcuts, Panels selector, and mixed panel-local actions with one coherent rule: every capability has one doorway, and exactly one workflow panel may be present in the editor at a time.

This is an interaction-architecture change over the existing local-first and controller-safe domain implementation. It must preserve the completed Initial Wire Position, Entry/Exit, rethreading, Program Stops, machining participation, transform, construction, planning, preview, persistence, and post behavior.

## Non-Negotiable Product Invariants

1. Every capability has exactly one canonical doorway.
2. Exactly one workflow panel may be visible at a time.
3. Opening a workflow command opens or focuses that workflow panel and activates its workflow session.
4. Opening a different workflow never leaves the preceding workflow or panel visible.
5. Closing or switching away from a workflow with provisional changes opens a warning with `Save` and `Discard` actions. The warning's `X` dismisses the warning and leaves the current workflow untouched.
6. `Save` commits the valid provisional workflow as one labelled Undo transaction and then performs the requested close or switch. When the workflow is incomplete or invalid, `Save` is disabled and the warning explains why.
7. `Discard` restores the workflow's opening snapshot and then performs the requested close or switch.
8. Closing an untouched workflow is immediate.
9. Docking, floating, moving, or resizing the active workflow panel changes layout only. It never starts, applies, or cancels work.
10. The canvas, header, and status bar remain persistent. Reference information needed by a workflow is embedded in that workflow rather than shown in competing panels.
11. Hidden or displaced controls may not mutate the project outside the active workflow.
12. Header Undo/Redo is the only global document-history surface, Header Save is the only project-save surface, and Cut Sequence is the only Path Project operation-reorder surface.

## Canonical Shell

### Persistent header

The Path Project header contains:

- Back to Workbench;
- document identity and context;
- workflow menus;
- global Undo;
- global Redo;
- global Save;
- Help/Controls.

The eight quick-panel icons and the Panels selector are removed. Path Project Export is removed from the header because Export has one dedicated workflow doorway. Machine Program keeps its context-specific header import/export only after duplicate Program Lines actions are removed.

### Workflow menus

Only menus with real, distinct capabilities render:

- Geometry: Geometry Setup; Transform.
- Machining: Contour Setup; Set Start; Cut Sequence; Initial Wire Position; Entry/Exit & Rethreading; Machining Participation; Program Stops.
- Construction: Measurement & Construction.
- View: Contour Tree; Path Summary; Endpoint Topology; Diagnostics; Statistics; Position.
- Machine: Project Machine & Source Setup.
- Export: Controller Export.

Menus launch workflows. They do not toggle arbitrary panel visibility.

### Active workflow panel

The active panel may be docked left, docked right, or floating. Its last geometry and dock side remain a layout preference. Only the active panel is rendered. Panel chrome contains layout actions and a close action. The close action delegates to the workflow lifecycle rather than hiding the panel directly.

Every mutating workflow shows:

- workflow name and current target;
- prerequisites and concrete blocked reasons;
- the controls belonging to that responsibility;
- current provisional result/preview;
- Save and Cancel actions;
- step guidance when the canvas must provide a point or selection.

View workflows are read-only. They close or switch immediately because they cannot become dirty.

## Workflow Lifecycle

The editor owns a single `EditorWorkflowSession` independent of persisted panel layout:

```ts
interface EditorWorkflowSession {
  commandId: string;
  panelId: EditorWorkspacePanelId;
  label: string;
  historyLabel: string | null;
  kind: 'mutating' | 'view';
  openingSnapshot: EditorWorkflowSnapshot;
  dirty: boolean;
  saveAvailability: { enabled: true } | { enabled: false; reason: string };
}
```

For Path Project document workflows, mutations update the visible draft provisionally without pushing Undo entries. Saving pushes the opening snapshot exactly once and retains the provisional document. Discard restores the opening snapshot without creating history. This allows the existing preview and domain functions to operate on the provisional document while preserving atomic history.

Selection changes may occur within a workflow and are normalized against the provisional document. A saved workflow retains its final selection. A discarded workflow restores its opening selection when the original target still exists.

Workflow transition requests are explicit:

```ts
type EditorWorkflowTransitionRequest =
  | { kind: 'close' }
  | { kind: 'open'; commandId: string };
```

If the current session is dirty, the request is held while the warning is visible. `Save` or `Discard` resolves the held request. The warning `X` clears only the request.

## Canvas Ownership

Canvas mutations are available only to the workflow that owns them:

- Set Start owns start-point picking.
- Transform owns geometry drag, exact translation, rotation, mirroring, and arc/segment-center moves.
- Measurement & Construction owns point placement, Perpendicular, Tangent, and magnetic snapping.
- Entry/Exit owns entry and exit point picking.
- Machining Participation owns span selection and participation authoring.

Outside those workflows, the canvas permits selection, hover, zoom, fit, and read-only inspection only. A tree or canvas selection may choose a workflow target, but it is not a second doorway that starts or applies a capability.

## Responsibility Regrouping

The existing Path Actions panel is removed as a capability hub. Its controls move as follows:

- Save -> Header Save.
- Export Preview -> Controller Export workflow.
- Planning strategy/reapply/order controls -> Cut Sequence.
- Reverse operation, Contour Role, Compensation -> Contour Setup.
- Geometry Basis -> Geometry Setup.
- Set Start -> Set Start workflow.
- Center Pierce, planned rapid source/destination, manual lead -> Entry/Exit & Rethreading.
- Perpendicular/Tangent -> Measurement & Construction.
- Hover cross-highlighting -> the relevant View workflow preference.
- Magnetic snap -> option inside Set Start or Measurement & Construction when consumed.

The legacy `path-actions` panel ID is removed after migration. No temporary duplicate controls remain.

## Global and Contextual Controls

A control belongs to exactly one of these roles:

- global header action;
- workflow launcher;
- workflow-local step/action;
- workflow-local target selector;
- read-only workflow information;
- layout-only panel chrome;
- removed/merged duplicate.

Contextual tree and canvas actions may select an operation, contour, segment, endpoint, or point for the active workflow. They may not directly mutate the document or start another workflow.

## Export and Machine Program Boundaries

Controller Export is a single Path Project workflow with readiness, exact preview, diagnostic navigation, and download stages. Panel-local and header Path Project export doorways are removed.

Machine Program remains a separate fallback editor. Its Header owns Undo, Redo, Save, Import Program, and Export ISO. Duplicate Program Lines toolbar actions for Undo, Redo, Save, and Export ISO are removed; line editing, line/group movement, normalization, pinning, and Set Start remain Machine Program-specific capabilities.

## Error Handling

- Opening another workflow while the current workflow is dirty never silently discards work.
- Save is disabled with a visible reason when provisional state is incomplete or invalid.
- Discard always restores the exact opening document/selection snapshot.
- A failed project persistence save does not close or alter a workflow; workflow Save is an in-editor commit, while Header Save persists the committed project through the existing adapter.
- Back to Workbench or program import first resolves an active dirty workflow, then uses the existing unsaved-project protection.
- Escape backs out of the current provisional step where supported; at the initial step it requests close and therefore uses the same dirty warning.

## Acceptance Criteria

- At most one `[data-editor-workspace-panel]` is visible at any time.
- No quick-panel toolbar or Panels selector renders for Path Projects.
- Every menu command either opens one workflow, performs the sole global action it owns, or is absent.
- Transform active -> Entry/Exit and every other workflow require an explicit Save/Discard transition; no second panel appears.
- Closing a dirty workflow -> warning with Save, Discard, and an X that stays in the workflow.
- Save -> one Undo entry regardless of how many provisional controls changed.
- Discard -> opening document and selection restored with no Undo entry.
- Header Undo/Redo is the only global history surface.
- Header Save is the only Path Project persistence surface.
- Cut Sequence is the only Path Project reorder surface.
- Canvas mutation handlers are unavailable outside their owning workflow.
- The complete control migration ledger contains no unassigned control and no unexplained duplicate doorway.
- Existing domain/post/persistence tests and production build remain green.

