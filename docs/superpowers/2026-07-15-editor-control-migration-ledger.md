# Editor Control Migration Ledger

Date: 2026-07-15

Status: Implementation ledger for the approved single-workflow editor. Every current control must be accounted for before completion.

| Current surface/control | Actual responsibility | Canonical home | Role | Disposition |
|---|---|---|---|---|
| Header Back | Leave editor | Header | Global | Retain |
| Header Undo / Redo | Document history | Header | Global | Retain as sole history controls |
| Header Save | Persist committed project/program | Header | Global | Retain as sole persistence control |
| Header Path Project Export Preview | Controller export | Export > Controller Export | Launcher | Remove header duplicate |
| Header Machine Program Import / Export | Machine Program file workflow | Machine Program Header | Global | Retain after Program Lines duplicates are removed |
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
| Machine > Project Machine | Project machine/source setup | Machine > Project Machine & Source Setup | Workflow launcher | Retain/regroup |
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
| Statistics | Geometry/move statistics | View > Statistics | Read-only workflow | Retain |
| Position/grid snap summary | Cursor/grid state | View > Position | Read-only workflow | Retain; active-tool snap options live with tool |
| Hover cross-highlighting toggle | Passive selection feedback | View workflow preference | Workflow-local preference | Move from Hover Assist |
| Magnetic snap toggle | Set Start/construction input behavior | Owning active workflow | Workflow option | Move into Set Start and Construction |
| Canvas Select mode | Select workflow target | Active workflow/canvas | Target selector | Retain; not a workflow doorway |
| Canvas Point mode | Measurement point placement | Construction > Measurement & Construction | Workflow mode | Gate to active Construction |
| Measurement add/delete/clear/move/export | Measurement workspace | Construction > Measurement & Construction | Workflow steps | Retain in single workflow |
| Perpendicular / Tangent | Construction point authoring | Construction > Measurement & Construction | Workflow steps | Retain; session-owned |
| Machine profile/fit/source unit/reimport | Machine/source setup and inspection | Machine > Project Machine & Source Setup | Workflow steps/info | Regroup; provisional/destructive rules preserved |
| Export readiness, trace, diagnostics, exact text, download | Controller export | Export > Controller Export | Workflow stages | Retain as one workflow |
| Panel hide/close | Close active workflow | Active panel chrome | Lifecycle action | Route through Save/Discard warning when dirty |
| Panel dock left/right, float, move, resize | Layout | Active panel chrome | Layout-only | Retain; never affect workflow state |
| Machine Program Program Lines Undo/Redo/Save/Export | Global program history/persistence/export | Machine Program Header | Exact duplicates | Remove |
| Machine Program normalize, edit, delete, move lines/groups, Set Start | Text fallback editing | Machine Program editor | Workflow-local | Retain; distinct from Path Project capabilities |
| Machine Program Program Text | Raw program editing | Machine Program editor | Workflow-local | Retain |

## Completion Checks

- [ ] Every row is implemented or explicitly removed.
- [ ] Search of editor JSX finds no unlisted actionable control.
- [ ] Every direct Path Project document mutation is reachable only from its active canonical workflow.
- [ ] No Path Project capability appears in more than one menu, header action, canvas launcher, tree launcher, or panel-global action.
- [ ] Exactly one workflow panel is visible.
- [ ] Warning actions and X behavior match the approved lifecycle.

