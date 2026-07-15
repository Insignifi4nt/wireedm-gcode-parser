# Editor Control Migration Ledger

Date: 2026-07-15

Status: Implemented and reconciled against the final actionable-JSX audit below. Every current control is assigned to one responsibility and canonical surface.

| Current surface/control | Actual responsibility | Canonical home | Role | Disposition |
|---|---|---|---|---|
| Header Back | Leave editor | Header | Global | Retain |
| Header Undo / Redo | Document history | Header | Global | Retain as sole history controls |
| Header Save | Persist committed project/program | Header | Global | Retain as sole persistence control |
| Header Path Project Export Preview | Controller export | Export > Controller Export | Launcher | Remove header duplicate |
| Header Machine Program Import / Export | Machine Program file workflow | Machine Program Header | Global | Retain after Program Lines duplicates are removed |
| Editor file drop import | Program/project import | Dashboard or Machine Program Header | Duplicate launcher | Removed; one-off imports remain available through canonical dashboard/header controls |
| Header Help/Controls | Usage guidance | Header | Global | Retain |
| Eight quick-panel icons | Panel discovery/toggle | None | Duplicate launcher | Remove all |
| Panels selector and grouped inventory | Panel discovery/toggle | None | Duplicate launcher | Remove; panel chrome retains layout actions |
| Project > Save Project | Persist project | Header Save | Duplicate launcher | Remove command/menu if empty |
| Geometry > Transform Geometry | Transform | Geometry > Transform | Workflow launcher | Retain; start/focus Transform workflow |
| Geometry > Path Actions | Mixed responsibilities | Dedicated workflows below | Duplicate/mixed launcher | Remove |
| Machining > Set Start | Operation start | Machining > Set Start | Workflow launcher | Retain |
| Machining > Cut Sequence | Operation order/planning | Machining > Cut Sequence | Workflow launcher | Retain |
| Machining > Contour Tree | Read-only hierarchy/selection | View > Contour Tree | Workflow launcher | Move |
| Machining > Initial Wire Position | Project G92 setup | Machining > Initial Wire Position | Workflow launcher | Retain |
| Machining > Entry/Exit & Rethreading | Operation transitions/threading | Same | Workflow launcher | Retain |
| Machining > Program Stops | Operation stop events | Same | Workflow launcher | Retain |
| Machining > Machining Participation | Active/inactive spans | Same | Workflow launcher | Retain |
| Construction > Measurement | Measurement/construction | Construction > Measurement & Construction | Workflow launcher | Rename/regroup |
| Construction > Hover / Snap Assist | Passive hover + active snapping | View preference + active tool option | Mixed launcher | Remove after splitting responsibilities |
| View > Summary/Topology/Diagnostics/Statistics/Position | Read-only inspection | Respective View workflows | Workflow launcher | Retain one at a time |
| Previous Machine > Project Machine label | Project machine/source setup | Machine > Project Machine & Source Setup | Workflow launcher | Renamed in the menu, workflow title, and description |
| Export > Controller Export Preview | Export readiness/preview/download | Export > Controller Export | Workflow launcher | Retain/rename |
| Path Actions Save | Persist project | Header Save | Duplicate workflow action | Remove |
| Path Actions Export Preview | Controller export | Export > Controller Export | Duplicate workflow action | Remove |
| Path Actions Reverse | Operation direction | Machining > Contour Setup | Workflow step | Move |
| Path Actions Planning Mode / Reapply | Operation planning strategy | Machining > Cut Sequence | Workflow step | Move |
| Path Actions planned rapid source/destination | Operation routing entry | Machining > Entry/Exit & Rethreading | Workflow step | Move |
| Path Actions Create manual lead | Manual entry | Machining > Entry/Exit & Rethreading | Workflow step | Merge with Manual Entry |
| Path Actions Geometry Basis | Document machining geometry basis | Geometry > Geometry Setup | Workflow step | Move |
| Path Actions Compensation | Selected-operation machining intent | Machining > Contour Setup | Workflow step | Move |
| Path Actions Contour Role | Selected-contour classification | Machining > Contour Setup | Workflow step | Move |
| Path Actions Start | Operation start | Machining > Set Start | Duplicate action | Remove |
| Path Actions Pierce | Circle-center entry | Machining > Entry/Exit & Rethreading | Duplicate action | Remove; existing Entry/Exit action remains |
| Transform panel target/exact/rotate/mirror/move controls | Geometry transform | Geometry > Transform | Workflow steps | Retain only inside active Transform workflow |
| Canvas geometry drag | Geometry transform | Geometry > Transform | Workflow canvas step | Gate to active Transform |
| Canvas segment/arc-center drag | Geometry transform | Geometry > Transform | Workflow canvas step | Gate to active Transform |
| Canvas endpoint Set Start action | Operation start target | Machining > Set Start | Workflow target selector | Gate to active Set Start; never launch independently |
| Contour Tree endpoint Set Start flag | Operation start target | Machining > Set Start | Workflow target selector | Gate to active Set Start; remove direct mutation doorway |
| Initial Wire Position panel controls | Project G92 setup | Machining > Initial Wire Position | Workflow steps | Retain; provisional until Save |
| Entry/Exit manual/circle entry, exit, threading controls | Operation transitions | Machining > Entry/Exit & Rethreading | Workflow steps | Retain; provisional until Save |
| Program Stops controls | Stop events | Machining > Program Stops | Workflow steps | Retain; provisional until Save |
| Machining Participation controls | Span participation/side/review | Machining > Machining Participation | Workflow steps | Retain; provisional until Save |
| Cut Sequence row up/down | Operation order | Machining > Cut Sequence | Workflow steps | Retain as sole Path Project reorder control |
| Contour Tree rows/expand/collapse | Hierarchy selection/navigation | View > Contour Tree or embedded workflow target picker | Read-only/target selector | Retain without direct mutation |
| Path Summary | Document summary | View > Path Summary | Read-only workflow | Retain |
| Endpoint Topology | Join/open-end inspection | View > Endpoint Topology | Read-only workflow | Retain |
| Diagnostics linked rows/Repair Workspace | Diagnostic inspection/navigation | View > Diagnostics | Read-only/launcher | Retain diagnostic navigation; route repairs through owning workflow |
| Diagnostics “Open Repair Workspace” multi-panel action | Repair target navigation | View > Diagnostics -> owning repair workflow | Conflicting launcher | Replace with one workflow transition; never open several panels |
| Statistics | Geometry/move statistics | View > Statistics | Read-only workflow | Retain |
| Position/grid snap summary | Cursor/grid state | View > Position | Read-only workflow | Retain; active-tool snap options live with tool |
| Hover cross-highlighting toggle | Passive selection feedback | View workflow preference | Workflow-local preference | Move from Hover Assist |
| Magnetic snap toggle | Set Start/construction input behavior | Owning active workflow | Workflow option | Move into Set Start and Construction |
| Canvas Select mode | Select workflow target | Active workflow/canvas | Target selector | Retain; not a workflow doorway |
| Canvas Point mode | Measurement point placement | Construction > Measurement & Construction | Workflow mode | Gate to active Construction |
| Persistent preview Select/Point buttons | Target selection / measurement placement | Active workflow | Duplicate mode launchers | Remove persistent duplicates; render the relevant mode inside the active workflow |
| Canvas zoom, fit, pan, wheel/pinch | Viewport navigation | Canvas | Persistent view controls | Retain; never mutate document or launch a workflow |
| Measurement add/delete/clear/move/export | Measurement workspace | Construction > Measurement & Construction | Workflow steps | Retain in single workflow |
| Perpendicular / Tangent | Construction point authoring | Construction > Measurement & Construction | Workflow steps | Retain; session-owned |
| Machine profile/fit/source unit/reimport | Machine/source setup and inspection | Machine > Project Machine & Source Setup | Workflow steps/info | Regroup; provisional/destructive rules preserved |
| Export readiness, trace, diagnostics, exact text, download | Controller export | Export > Controller Export | Workflow stages | Retain as one workflow |
| Panel hide/close | Close active workflow | Active panel chrome | Lifecycle action | Route through Save/Discard warning when dirty |
| Panel dock left/right, float, move, resize | Layout | Active panel chrome | Layout-only | Retain; never affect workflow state |
| Machine Program Program Lines Undo/Redo/Save/Export | Global program history/persistence/export | Machine Program Header | Exact duplicates | Removed, including props/wiring and stale guide targets |
| Machine Program normalize, select/edit, clear selection, delete, move lines/groups, pins, Set Start | Text fallback editing | Machine Program editor | Workflow-local | Retained; distinct from Path Project capabilities |
| Machine Program Program Lines drawer and group expand/collapse | Dense program navigation/layout | Machine Program editor | View-local | Retained; does not mutate or launch a workflow |
| Machine Program Program Text | Raw program editing | Machine Program editor | Workflow-local | Retain |
| Guide highlight targets and diagnostic panel links | Guided navigation | Canonical workflow router | Workflow transition | Remap every stale panel ID; never bypass dirty-workflow warning |

## Final Actionable JSX Audit

Audit command:

```sh
rg -n '<(Button|button|input|select|textarea|summary|a)\b|\bon[A-Z][A-Za-z]*=' src/features/editor --glob '*.tsx' --glob '!**/__tests__/**'
```

The 2026-07-15 audit returned 589 syntactic matches across 18 production files after root file-drop removal. The match count includes opening elements, forwarded callback props, and their handlers, so it is intentionally larger than the number of rendered controls. Every matched file and control family is assigned below; no unmatched control file or unassigned control family remains.

| Actionable component | Control families found | Responsibility and canonical ownership | Audit result |
|---|---|---|---|
| `EditorHeaderBar.tsx` | Back; Undo; Redo; Save; Machine Program Export/Import; guide | Global document navigation, history, persistence, Machine Program file I/O, and help | Canonical global surface; the only document Undo/Redo/Save and Machine Program export controls |
| `EditorWorkflowMenuBar.tsx` | Six menu summaries and workflow commands | Sole Path Project workflow launch surface | Canonical launcher; no quick-panel or Panels-selector alternative |
| `EditorPage.tsx` | Workflow Cancel/Save; inspector-rail expand/collapse; callback wiring | Active workflow commit/cancel, non-mutating rail layout, and ownership-gated composition | Session/layout only; mutations are delegated only to the active workflow; root file-drop import handlers are absent |
| `EditorWorkflowTransitionDialog.tsx` | X; Discard; Save | Dirty workflow transition resolution | Canonical lifecycle warning; X is the only stay action |
| `EditorWorkspacePanels.tsx` | Dock collapse/expand; dock/float; close; drag; resize | Layout and active-workflow close request | Layout-only except close, which routes through workflow lifecycle |
| `EditorCanvasPanel.tsx` | Ownership-gated canvas callback forwarding | Canvas composition for Transform, Construction, Set Start, selection, and viewport state | No independent doorway; only callbacks supplied by the active owner can mutate |
| `EditorPreview.tsx` | Zoom/fit/pan; canvas selection; active-workflow target dragging/picking | Persistent viewport navigation plus target input owned by Transform, Construction, or Set Start | No workflow launcher; mutating callbacks are present only for the owning workflow |
| `EditorPathNavigatorPanel.tsx` | Geometry transform; Cut Sequence; Contour Tree; summary/topology/diagnostics/statistics/position selection and navigation | Dedicated Path Project workflow content rendered through the singleton panel frame | Each family is conditionally rendered only for its command-owned workflow |
| `EditorWorkflowSetupPanels.tsx` | Geometry Basis; Contour Setup target/reverse/role/compensation; Set Start target/snap/pick | Geometry Setup, Contour Setup, and Set Start workflow steps | One responsibility per workflow; no panel-global duplicate |
| `EditorInitialWirePositionPanel.tsx` | Exact X/Y and geometry-linked circle-center selection | Initial Wire Position workflow | Provisional mutating workflow only |
| `EditorEntryExitPanel.tsx` | Operation target; planned rapid; manual/circle entry; exit; threading | Entry/Exit & Rethreading workflow | Provisional mutating workflow only |
| `EditorProgramStopsPanel.tsx` | Placement/reason/note; add, enable, remove stop | Program Stops workflow | Provisional mutating workflow only |
| `EditorMachiningParticipationPanel.tsx` | Source span; wire side; entry review; restore active cut | Machining Participation workflow | Provisional mutating workflow only |
| `EditorInspectorPanel.tsx` | Read-only lineage/diagnostic navigation; Machine/source re-import; Construction modes/snap/points/point export | The active View workflow, Project Machine & Source Setup, or Measurement & Construction, according to the rendered section | Action families are gated to their canonical active workflow; point-only export remains Construction-owned, not document export |
| `EditorUpidExportPreview.tsx` | Readiness stages; trace/diagnostic selection; download | Export > Controller Export workflow | Sole Path Project controller-export surface |
| `EditorProgramLinesPanel.tsx` | Drawer/group navigation; select/edit; move/delete; pins; fallback Set Start; Normalize Draft | Machine Program structured-text editor | Program-specific controls retained; duplicate Undo/Redo/Save/Export removed |
| `EditorProgramTextPanel.tsx` | Raw Program Text editing | Machine Program raw-text editor | Program-specific editing only |
| `EditorGuideDialog.tsx` | Close; language; Show me | Help and canonical-control navigation | Stale Program Lines Save/Export targets removed; copy points operators to header controls |

Cross-check searches after the audit:

```sh
rg -n "\\bUndo\\b|\\bRedo\\b|Save Program|Export ISO|Save active document" src/features/editor --glob '*.tsx'
rg -n "export-iso|save-program" src
rg -n "Project Machine(?! & Source Setup)" src/features/editor --pcre2
rg -n "data-editor-drop-zone|handleEditorDrop|handleEditorDragOver" src
```

The first search returns only Header Undo/Redo/Save. The remaining searches return no production matches (the drop-zone selector remains only in the invariant test). Focused application tests also prove that the Machine Program header contains the sole import/history/save/export controls while Normalize Draft, line editing/order/deletion, pins, fallback Set Start, and Program Text remain available.

## Completion Checks

- [x] Every row is implemented or explicitly removed. Evidence: dispositions above plus focused workflow and Machine Program tests.
- [x] Search of editor JSX finds no unlisted actionable control. Evidence: 18-file actionable-JSX audit matrix above.
- [x] Every direct Path Project document mutation is reachable only from its active canonical workflow. Evidence: workflow-ownership application tests gate panel handlers and canvas callbacks.
- [x] No Path Project capability appears in more than one menu, header action, canvas launcher, tree launcher, or panel-global action. Evidence: canonical-menu/regrouping tests and the duplicate cross-check searches above.
- [x] Exactly one workflow panel is visible. Evidence: canonical workflow test opens every command in sequence and asserts one panel ID at each transition.
- [x] Warning actions and X behavior match the approved lifecycle. Evidence: lifecycle/dialog tests cover Save, Discard, and X-only stay behavior.
