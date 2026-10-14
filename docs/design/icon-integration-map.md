# Icon integration map

Published CAD checkpoint: `8375c294d09e0a43b48b7c37d977cc59fd9a4065`. Complete set: 134 original glyphs, 282 direct usages, 8 dynamic slots, 206 expanded variants and 15 text controls. This is a concrete mapping for integration; the CAD implementation has not been copied into this worktree.

The [JSON](icon-integration-map.json) includes semantic component exports, original path data, exact SVG SHA-256 digests, stable usage IDs, source-file hashes and owning control/call metadata. The [crosswalk](final-inventory-crosswalk.md) also accounts for excluded geometry, cursor, native and text channels.

## Apply the set

- Use the stable usage ID, owning control and expression to relocate each call. Snapshot line numbers are evidence, not edit offsets.
- Resolve overloaded library names per occurrence. Import bindings alone cannot select the correct feature or command icon.
- Preserve original geometry renderers, controller checks, labels, handlers, disabled states, refs and accessibility.
- Dynamic-slot rows describe render sites and their allowed semantic replacements, not extra direct occurrences. For dispatchers such as the CAD history map or toolButton, update the matching concrete direct usages and keep the renderer dynamic.
- Lead tree rows select LeadInIcon or LeadOutIcon from travelRole. The source Flag binding is a dynamic pair, not a global flag replacement.
- Keep WireEdmMarkIcon in the app heading and the generated favicon. FolderStorageIcon identifies folder-specific persistence controls; BrowserCacheIcon identifies cache storage and the cache-first Storage category.
- Apply only icon implementation/integration changes onto the latest reviewed CAD base. CAD functionality and version 0.0.697 remain owned by its existing PR.

Carry `src/assets/icons/`, `src/components/icons/`, `scripts/icon-source.mjs`, the generation/check scripts, `icon-catalog/index.html`, the Vite catalog entry, and the favicon reference. Use the usage table for newer CAD files rather than restoring older feature implementations. Release compatibility remains in `docs/releases/0.0.698.json`.

## Dynamic render sites

These are renderer slots, not additional occurrences. Match each parent ID to expanded variants and the concrete direct usages that supply its icon components.

| Stable slot ID | File | Snapshot line | Slot expression | Available replacements | Expanded variants |
| --- | --- | --- | --- | --- | ---: |
| `use.ff7ede67da54` | src/app/WorkbenchSettingsDialog.tsx | 124 | `{icon}` | browser-cache, adjust, body | 0 |
| `use.560ea95b7eba` | src/components/ui/SlidingTabs.tsx | 51 | `{tab.icon}` | cam-editor, simulation | 0 |
| `use.526981a64633` | src/features/cad/CadContextHelp.tsx | 64 | `{triggerContent ?? <Info size={12} aria-hidden="true" />}` | info, link, close, help | 0 |
| `use.575772b2f782` | src/features/cad/CadFeatureTree.tsx | 194 | `<Icon size={14} />` | datum-plane, sketch, curve, imported-body, pad, pocket, revolve, loft, sweep, fillet, chamfer, shell, boolean, move-3d, linear-pattern, circular-pattern, mirror | 17 |
| `use.ca1d7d33f3d0` | src/features/cad/CadWorkbench.tsx | 555 | `<Icon size={15} strokeWidth={1.5} />` | sketch, datum-plane, curve, add, select, rectangle, circle, slot, polyline, closed-path, measure, move, pad-pocket, revolve, loft, sweep, fillet, chamfer, shell, boolean, move-3d, mirror, linear-pattern, circular-pattern, pattern | 0 |
| `use.1e307a885857` | src/features/editor/EditorProgramLinesPanel.tsx | 170 | `<ToggleIcon className="size-3 shrink-0" />` | expand-right, expand-down | 2 |
| `use.29a204b4a6e6` | src/features/editor/EditorProgramLinesPanel.tsx | 198 | `<ToggleIcon className="size-3 shrink-0" />` | expand-right, expand-down | 2 |
| `use.73945173632f` | src/features/editor/EditorWorkspacePanels.tsx | 306 | `<ExpandIcon aria-hidden="true" className="size-3.5" />` | panel-right-open | 1 |

## Direct usage mapping

### src/app/AppShell.tsx

| Stable usage ID | Snapshot line | Original symbol | Semantic replacement |
| --- | --- | --- | --- |
| `use.351faffd1991` | 214 | `HardDrive` | `WireEdmMarkIcon` |
| `use.78943e173e76` | 233 | `Database` | `BrowserCacheIcon` |
| `use.c5338283623c` | 244 | `SettingsIcon` | `SettingsIcon` |
| `use.71939959dbc4` | 291 | `PanelLeftOpen` | `PanelLeftOpenIcon` |
| `use.e0fbf85c2057` | 293 | `PanelLeftClose` | `PanelLeftCloseIcon` |

### src/app/CadSettingsPanel.tsx

| Stable usage ID | Snapshot line | Original symbol | Semantic replacement |
| --- | --- | --- | --- |
| `use.fad5a0003529` | 27 | `Mouse` | `NavigationMouseIcon` |
| `use.179a2e44f703` | 27 | `Laptop` | `NavigationTrackpadIcon` |

### src/app/MachinePostSettingsPanel.tsx

| Stable usage ID | Snapshot line | Original symbol | Semantic replacement |
| --- | --- | --- | --- |
| `use.51bd069cf165` | 124 | `Trash2` | `DeleteIcon` |
| `use.ab466740bb3c` | 139 | `ChevronRight` | `ExpandRightIcon` |
| `use.1f99357c6c3e` | 140 | `Check` | `ConfirmIcon` |
| `use.69bd5eef9821` | 341 | `Upload` | `UploadIcon` |

### src/app/WorkbenchSettingsDialog.tsx

| Stable usage ID | Snapshot line | Original symbol | Semantic replacement |
| --- | --- | --- | --- |
| `use.b90dc30e24b4` | 75 | `X` | `CloseIcon` |
| `use.93ac6a6b9f50` | 77 | `Database` | `BrowserCacheIcon` |
| `use.dc1fdd5c85c9` | 78 | `SlidersHorizontal` | `AdjustIcon` |
| `use.c07867970fec` | 79 | `Box` | `BodyIcon` |
| `use.e3148f56c967` | 105 | `RefreshCw` | `RefreshIcon` |

### src/components/StatusToasts.tsx

| Stable usage ID | Snapshot line | Original symbol | Semantic replacement |
| --- | --- | --- | --- |
| `use.02a154bf9bca` | 64 | `X` | `CloseIcon` |
| `use.cd3bcf4fca37` | 138 | `Bell` | `NotificationsIcon` |
| `use.a9f8dce5e4a6` | 180 | `CheckCircle2` | `SuccessIcon` |
| `use.6098589afaef` | 181 | `XCircle` | `ErrorIcon` |
| `use.c3539dfcbc2b` | 182 | `AlertTriangle` | `WarningIcon` |
| `use.49f40e3f0d26` | 183 | `Info` | `InfoIcon` |

### src/features/cad/CadCommandDock.tsx

| Stable usage ID | Snapshot line | Original symbol | Semantic replacement |
| --- | --- | --- | --- |
| `use.17d6c49b16a9` | 26 | `ChevronDown` | `ExpandDownIcon` |

### src/features/cad/CadContextHelp.tsx

| Stable usage ID | Snapshot line | Original symbol | Semantic replacement |
| --- | --- | --- | --- |
| `use.28edd08da582` | 64 | `Info` | `HelpIcon` |
| `use.3c1668dc8ef2` | 67 | `X` | `CloseIcon` |

### src/features/cad/CadDxfExportDialog.tsx

| Stable usage ID | Snapshot line | Original symbol | Semantic replacement |
| --- | --- | --- | --- |
| `use.cc33f7279b12` | 96 | `X` | `CloseIcon` |
| `use.f9943ed70d45` | 117 | `Download` | `DownloadIcon` |

### src/features/cad/CadEdgeTreatmentCommand.tsx

| Stable usage ID | Snapshot line | Original symbol | Semantic replacement |
| --- | --- | --- | --- |
| `use.0b1978b5a87b` | 46 | `CircleDot` | `FilletIcon` |
| `use.fc19db06cb31` | 46 | `ChevronDown` | `ExpandDownIcon` |
| `use.07e7fdc0245c` | 66 | `CircleDot` | `FilletIcon` |
| `use.f981c2c08004` | 67 | `Scissors` | `ChamferIcon` |

### src/features/cad/CadFeatureEditor.tsx

| Stable usage ID | Snapshot line | Original symbol | Semantic replacement |
| --- | --- | --- | --- |
| `use.b50916bf515c` | 181 | `X` | `CloseIcon` |
| `use.6a0d90150189` | 189 | `X` | `CloseIcon` |
| `use.93740cde18a9` | 189 | `Check` | `ConfirmIcon` |
| `use.0d09ad9a6e7d` | 251 | `X` | `CloseIcon` |
| `use.725c3eba6ecf` | 251 | `Check` | `ConfirmIcon` |

### src/features/cad/CadFeatureTree.tsx

| Stable usage ID | Snapshot line | Original symbol | Semantic replacement |
| --- | --- | --- | --- |
| `use.047f602eb9ce` | 11 | `Square` | `DatumPlaneIcon` |
| `use.c852c0918f44` | 11 | `PencilRuler` | `SketchIcon` |
| `use.1ba6f6748829` | 11 | `Spline` | `CurveIcon` |
| `use.e6667ec280ad` | 11 | `Box` | `ImportedBodyIcon` |
| `use.b044d357b6f1` | 11 | `Box` | `PadIcon` |
| `use.5a762a40dc64` | 11 | `Box` | `PocketIcon` |
| `use.be0c8f9fb9d1` | 11 | `RotateCw` | `RevolveIcon` |
| `use.51534565bfce` | 12 | `Layers` | `LoftIcon` |
| `use.64a0d11df153` | 12 | `Spline` | `SweepIcon` |
| `use.1ebb2c885ccc` | 12 | `CircleDot` | `FilletIcon` |
| `use.a6799be9b032` | 12 | `Scissors` | `ChamferIcon` |
| `use.c9b2338e159b` | 12 | `Box` | `ShellIcon` |
| `use.215d64bb494c` | 12 | `Layers` | `BooleanIcon` |
| `use.716ff3e6f613` | 12 | `Move3D` | `Move3dIcon` |
| `use.6f827927337e` | 13 | `Copy` | `LinearPatternIcon` |
| `use.c2c41105223b` | 13 | `RotateCw` | `CircularPatternIcon` |
| `use.3f1edecc92fd` | 13 | `Copy` | `MirrorIcon` |
| `use.2f77851c1e33` | 154 | `ChevronRight` | `ExpandRightIcon` |
| `use.fcf02c091bb0` | 154 | `FileBox` | `FileBodyIcon` |
| `use.1eb2f4a20ae0` | 159 | `ChevronRight` | `ExpandRightIcon` |
| `use.ebfc71d9bb7f` | 159 | `Square` | `DatumPlaneIcon` |
| `use.41090c5821df` | 163 | `Square` | `DatumPlaneIcon` |
| `use.d59977f0aa01` | 164 | `PencilRuler` | `SketchIcon` |
| `use.61875549904e` | 169 | `ChevronRight` | `ExpandRightIcon` |
| `use.d187b69fb127` | 169 | `SlidersHorizontal` | `AdjustIcon` |
| `use.fca58697fbbd` | 175 | `ChevronRight` | `ExpandRightIcon` |
| `use.64be08614163` | 175 | `Layers` | `LayersIcon` |
| `use.762baa8d0d08` | 188 | `ChevronRight` | `ExpandRightIcon` |
| `use.3e4076277ba8` | 202 | `Circle` | `CircleIcon` |
| `use.dd39086cd35d` | 202 | `Square` | `RectangleIcon` |

### src/features/cad/CadFields.tsx

| Stable usage ID | Snapshot line | Original symbol | Semantic replacement |
| --- | --- | --- | --- |
| `use.3013b47df60f` | 80 | `MousePointer2` | `SelectIcon` |

### src/features/cad/CadLoftSections.tsx

| Stable usage ID | Snapshot line | Original symbol | Semantic replacement |
| --- | --- | --- | --- |
| `use.1dc8c7e68f65` | 95 | `ArrowUp` | `MoveUpIcon` |
| `use.d9db26598fe1` | 96 | `ArrowDown` | `MoveDownIcon` |
| `use.d06973660aff` | 99 | `X` | `CloseIcon` |
| `use.b797db969075` | 114 | `Plus` | `AddIcon` |

### src/features/cad/CadParametersPanel.tsx

| Stable usage ID | Snapshot line | Original symbol | Semantic replacement |
| --- | --- | --- | --- |
| `use.d33474a1b2b7` | 88 | `Puzzle` | `PluginIcon` |
| `use.4a3c8cd796ef` | 88 | `Link2` | `LinkIcon` |
| `use.34955e8e553d` | 93 | `FolderPlus` | `FolderPlusIcon` |
| `use.789ef07f7f97` | 93 | `Plus` | `AddIcon` |
| `use.ae21b0d3fafd` | 95 | `Puzzle` | `PluginIcon` |
| `use.2a2707e4826f` | 95 | `Pencil` | `RenameIcon` |
| `use.b6df9e398c55` | 98 | `Puzzle` | `PluginIcon` |
| `use.0902ff6fab0f` | 101 | `X` | `CloseIcon` |
| `use.aa7e54ebafda` | 108 | `Trash2` | `DeleteIcon` |
| `use.731cfdb8fcff` | 108 | `Check` | `ConfirmIcon` |

### src/features/cad/CadPatternCommand.tsx

| Stable usage ID | Snapshot line | Original symbol | Semantic replacement |
| --- | --- | --- | --- |
| `use.1b4373040eb9` | 46 | `Copy` | `PatternIcon` |
| `use.35556bc89fbd` | 46 | `ChevronDown` | `ExpandDownIcon` |
| `use.c64fb6db37f0` | 66 | `Copy` | `LinearPatternIcon` |
| `use.ca37ba8f0761` | 67 | `RotateCw` | `CircularPatternIcon` |

### src/features/cad/CadPluginFields.tsx

| Stable usage ID | Snapshot line | Original symbol | Semantic replacement |
| --- | --- | --- | --- |
| `use.51761460b85b` | 62 | `RotateCw` | `RotateClockwiseIcon` |
| `use.382d4df6a591` | 67 | `LockKeyhole` | `LockedIcon` |
| `use.50af36cd5551` | 80 | `LockKeyhole` | `LockedIcon` |
| `use.76bc31ca8063` | 85 | `LockKeyhole` | `LockedIcon` |

### src/features/cad/CadPluginsPanel.tsx

| Stable usage ID | Snapshot line | Original symbol | Semantic replacement |
| --- | --- | --- | --- |
| `use.289f1bfde371` | 45 | `X` | `CloseIcon` |
| `use.161531e02dfd` | 47 | `Search` | `SearchIcon` |
| `use.b6a1f02fda26` | 50 | `FileCode2` | `FileCodeIcon` |
| `use.a4d9025259a0` | 51 | `Plus` | `AddIcon` |
| `use.b5b3999cf6af` | 56 | `ArrowLeft` | `NavigateBackIcon` |

### src/features/cad/CadSketchCanvas.tsx

| Stable usage ID | Snapshot line | Original symbol | Semantic replacement |
| --- | --- | --- | --- |
| `use.677f18c1c4b5` | 473 | `Maximize2` | `FitViewIcon` |
| `use.e847dcdbea73` | 473 | `Grid2X2` | `GridIcon` |
| `use.9e3c15469d52` | 473 | `Magnet` | `SnapIcon` |
| `use.fe732cfdd5c1` | 480 | `Check` | `ConfirmIcon` |
| `use.425d9ab4e8af` | 480 | `Undo2` | `UndoIcon` |
| `use.e9fc8e08e6ce` | 480 | `X` | `CloseIcon` |
| `use.6f3a6f726e66` | 482 | `Check` | `ConfirmIcon` |
| `use.9ac7844c966d` | 482 | `X` | `CloseIcon` |

### src/features/cad/CadSketchDimensionControls.tsx

| Stable usage ID | Snapshot line | Original symbol | Semantic replacement |
| --- | --- | --- | --- |
| `use.2cab08ecef82` | 117 | `Link2` | `LinkIcon` |
| `use.aa76997bff44` | 117 | `LockKeyhole` | `LockedIcon` |
| `use.8d1f67cb7f6d` | 123 | `X` | `CloseIcon` |
| `use.2c9511b19310` | 124 | `LockKeyhole` | `LockedIcon` |
| `use.cd64ca9e6fe7` | 126 | `Link2` | `LinkIcon` |
| `use.775c42ec0882` | 128 | `Check` | `ConfirmIcon` |

### src/features/cad/CadSketchProfilePanel.tsx

| Stable usage ID | Snapshot line | Original symbol | Semantic replacement |
| --- | --- | --- | --- |
| `use.5d911fda75e4` | 123 | `Ruler` | `MeasureIcon` |
| `use.e3d6697f4e56` | 123 | `Move` | `MoveIcon` |
| `use.fc42ade3967c` | 123 | `CircleDot` | `FilletIcon` |
| `use.369ab5e2a250` | 124 | `Link2` | `LinkIcon` |
| `use.e2b460790ee8` | 124 | `X` | `CloseIcon` |
| `use.9c0dc37794dc` | 134 | `Check` | `ConfirmIcon` |

### src/features/cad/CadTreeRename.tsx

| Stable usage ID | Snapshot line | Original symbol | Semantic replacement |
| --- | --- | --- | --- |
| `use.65e90c80c4f4` | 25 | `Check` | `ConfirmIcon` |
| `use.3361055a2b45` | 26 | `X` | `CloseIcon` |

### src/features/cad/CadViewport.tsx

| Stable usage ID | Snapshot line | Original symbol | Semantic replacement |
| --- | --- | --- | --- |
| `use.62591a390eb6` | 618 | `Box` | `ViewIcon` |
| `use.fd11477e899b` | 624 | `Maximize2` | `FitViewIcon` |
| `use.915c2834aa5d` | 625 | `Grid2X2` | `GridIcon` |

### src/features/cad/CadWorkbench.tsx

| Stable usage ID | Snapshot line | Original symbol | Semantic replacement |
| --- | --- | --- | --- |
| `use.ffbedae0ccd1` | 572 | `ArrowLeft` | `NavigateBackIcon` |
| `use.c494ed73f649` | 577 | `ChevronDown` | `ExpandDownIcon` |
| `use.24e503e16fcc` | 577 | `FilePlus2` | `FileNewIcon` |
| `use.3261c4d9f21e` | 577 | `FolderOpen` | `FolderOpenIcon` |
| `use.d52af307f1cf` | 577 | `FolderOpen` | `FolderOpenIcon` |
| `use.3b585d03403a` | 577 | `Download` | `CameraCaptureIcon` |
| `use.0cd36f04fccd` | 577 | `RotateCw` | `RefreshIcon` |
| `use.818349233a7e` | 577 | `Download` | `DownloadIcon` |
| `use.0a7050bd4261` | 577 | `Download` | `DownloadIcon` |
| `use.3e2d9a7c3d4e` | 577 | `Download` | `DownloadIcon` |
| `use.432a18f28d08` | 577 | `Download` | `DownloadIcon` |
| `use.ece394eff765` | 577 | `Scissors` | `SectionCamIcon` |
| `use.1368999d2fba` | 577 | `ArrowRight` | `SendCamIcon` |
| `use.29a3dfe947d1` | 578 | `Undo2` | `UndoIcon` |
| `use.160c8492030a` | 578 | `Redo2` | `RedoIcon` |
| `use.1dcb0c279c21` | 579 | `Save` | `SaveIcon` |
| `use.818660cf2e65` | 586 | `PencilRuler` | `SketchIcon` |
| `use.c1c926964b90` | 586 | `Square` | `DatumPlaneIcon` |
| `use.1ae3003246f1` | 586 | `Spline` | `CurveIcon` |
| `use.1fef8cf86aba` | 587 | `Plus` | `AddIcon` |
| `use.44dfce0d43cd` | 588 | `MousePointer2` | `SelectIcon` |
| `use.25a39a36a1f2` | 588 | `Square` | `RectangleIcon` |
| `use.922198d4907f` | 588 | `Circle` | `CircleIcon` |
| `use.231452e8a1ee` | 588 | `Pill` | `SlotIcon` |
| `use.23e14bc3b52c` | 588 | `Waypoints` | `PolylineIcon` |
| `use.04dbc087560c` | 588 | `Spline` | `ClosedPathIcon` |
| `use.676bcd56ca48` | 588 | `Ruler` | `MeasureIcon` |
| `use.5df247ea8252` | 588 | `Move3D` | `MoveIcon` |
| `use.d983619fea3c` | 588 | `Box` | `PadPocketIcon` |
| `use.1347774db40e` | 588 | `RotateCw` | `RevolveIcon` |
| `use.6c84f5504736` | 588 | `Layers` | `LoftIcon` |
| `use.3ffd3b024538` | 588 | `Spline` | `SweepIcon` |
| `use.48266e7a505c` | 588 | `Box` | `ShellIcon` |
| `use.9ce98e0beeb3` | 588 | `Layers` | `BooleanIcon` |
| `use.38a8ebd487f4` | 588 | `Move3D` | `Move3dIcon` |
| `use.0b858cd3e4c0` | 588 | `Copy` | `MirrorIcon` |
| `use.2af473557279` | 594 | `PencilRuler` | `SketchIcon` |
| `use.8ffc473be209` | 595 | `Loader2` | `BusyIcon` |
| `use.0d302f8f9511` | 599 | `Check` | `ConfirmIcon` |
| `use.1de7a7ef0b1e` | 599 | `Check` | `ConfirmIcon` |
| `use.3bae9f90a86c` | 599 | `ChevronDown` | `ExpandDownIcon` |
| `use.5e016a2c9d0e` | 599 | `ChevronRight` | `ExpandRightIcon` |
| `use.38385a11e472` | 599 | `Trash2` | `DeleteIcon` |
| `use.45b56f5e6d35` | 601 | `Loader2` | `BusyIcon` |
| `use.5745191fface` | 603 | `Spline` | `CurveIcon` |
| `use.c0d304036f6d` | 603 | `PencilRuler` | `SketchIcon` |
| `use.4ce2b07dee65` | 607 | `Trash2` | `DeleteIcon` |

### src/features/dashboard/DxfImportConfirmationDialog.tsx

| Stable usage ID | Snapshot line | Original symbol | Semantic replacement |
| --- | --- | --- | --- |
| `use.2fe8078312dc` | 191 | `X` | `CloseIcon` |

### src/features/dashboard/ProjectActionDialog.tsx

| Stable usage ID | Snapshot line | Original symbol | Semantic replacement |
| --- | --- | --- | --- |
| `use.2b2607e90e98` | 129 | `X` | `CloseIcon` |

### src/features/dashboard/ProjectListPanel.tsx

| Stable usage ID | Snapshot line | Original symbol | Semantic replacement |
| --- | --- | --- | --- |
| `use.b835195d89af` | 133 | `Pencil` | `RenameIcon` |
| `use.58113c82f54b` | 161 | `Trash2` | `DeleteIcon` |
| `use.ac128b91e45e` | 174 | `History` | `HistoryIcon` |
| `use.bc331d149c85` | 193 | `Save` | `SaveIcon` |
| `use.bb4b76dd20d6` | 193 | `ChevronDown` | `ExpandDownIcon` |

### src/features/dashboard/ProjectRevisionsDialog.tsx

| Stable usage ID | Snapshot line | Original symbol | Semantic replacement |
| --- | --- | --- | --- |
| `use.95c192eef4cf` | 212 | `X` | `CloseIcon` |
| `use.fc529b58637d` | 219 | `Trash2` | `DeleteIcon` |

### src/features/dashboard/StartWorkPanel.tsx

| Stable usage ID | Snapshot line | Original symbol | Semantic replacement |
| --- | --- | --- | --- |
| `use.8b5c7c9b591f` | 121 | `FileUp` | `FileImportIcon` |
| `use.3d042386bbdc` | 136 | `ChevronDown` | `ExpandDownIcon` |
| `use.f8d46f354c7c` | 158 | `FileJson2` | `FileJsonIcon` |
| `use.f3004ec95204` | 174 | `FileCode` | `FileCodeIcon` |
| `use.2b6d87f920bf` | 180 | `FileSearch` | `FileInspectIcon` |
| `use.876ee75552da` | 194 | `FilePlus2` | `FileNewIcon` |

### src/features/editor/EditorGuideDialog.tsx

| Stable usage ID | Snapshot line | Original symbol | Semantic replacement |
| --- | --- | --- | --- |
| `use.d22c1cd00a8f` | 71 | `X` | `CloseIcon` |
| `use.acb4ec7916e2` | 133 | `Crosshair` | `LocateIcon` |

### src/features/editor/EditorHeaderBar.tsx

| Stable usage ID | Snapshot line | Original symbol | Semantic replacement |
| --- | --- | --- | --- |
| `use.aa36c8c52358` | 108 | `ArrowLeft` | `NavigateBackIcon` |
| `use.c166fdc61875` | 145 | `FileSearch` | `FileInspectIcon` |
| `use.bc75d5fd9277` | 157 | `Undo2` | `UndoIcon` |
| `use.4c00aa4e42f3` | 170 | `Redo2` | `RedoIcon` |
| `use.e0f6c9384af8` | 183 | `Save` | `SaveIcon` |
| `use.77e2a4b208d4` | 197 | `FileOutput` | `FileExportIcon` |
| `use.c827f3071596` | 226 | `FileUp` | `FileImportIcon` |
| `use.bdd9ab92a039` | 242 | `CircleHelp` | `HelpIcon` |

### src/features/editor/EditorInspectorPanel.tsx

| Stable usage ID | Snapshot line | Original symbol | Semantic replacement |
| --- | --- | --- | --- |
| `use.cbc57f4ad9fc` | 1104 | `Magnet` | `SnapIcon` |
| `use.0e673e8e8a96` | 1122 | `MousePointer2` | `SelectIcon` |
| `use.620dbb21888c` | 1137 | `Magnet` | `CircleCenterIcon` |
| `use.6c239ce305c6` | 1163 | `Magnet` | `SnapIcon` |
| `use.c59907e59da2` | 1274 | `Trash2` | `DeleteIcon` |
| `use.aa22e4024d24` | 1289 | `ArrowRightFromLine` | `InsertPointsIcon` |
| `use.8220926976b8` | 1300 | `Download` | `DownloadIcon` |

### src/features/editor/EditorPage.tsx

| Stable usage ID | Snapshot line | Original symbol | Semantic replacement |
| --- | --- | --- | --- |
| `use.2c42ab59b954` | 935 | `PenTool` | `CamEditorIcon` |
| `use.38f814f048ca` | 936 | `Box` | `SimulationIcon` |
| `use.95c1560bd369` | 3728 | `PanelRightOpen` | `PanelRightOpenIcon` |
| `use.ddc539c3871d` | 3744 | `PanelRightClose` | `PanelRightCloseIcon` |

### src/features/editor/EditorPathNavigatorPanel.tsx

| Stable usage ID | Snapshot line | Original symbol | Semantic replacement |
| --- | --- | --- | --- |
| `use.040fa55fc9cc` | 529 | `Info` | `HelpIcon` |
| `use.dfe6ef6b1093` | 553 | `Ellipsis` | `MoreIcon` |
| `use.b3622ddc0543` | 886 | `Move` | `MoveIcon` |
| `use.781afc30f231` | 920 | `RotateCcw` | `RotateCounterclockwiseIcon` |
| `use.2a3a3d816ca2` | 932 | `RotateCw` | `RotateClockwiseIcon` |
| `use.2c47f4988f1a` | 956 | `FlipVertical` | `FlipVerticalIcon` |
| `use.93872f9ed796` | 968 | `FlipHorizontal` | `FlipHorizontalIcon` |
| `use.d0d8efc6bee2` | 1994 | `ArrowUp` | `MoveUpIcon` |
| `use.de7658408fb9` | 2004 | `ArrowDown` | `MoveDownIcon` |
| `use.8d40fb29dc4a` | 2148 | `ChevronDown` | `ExpandDownIcon` |
| `use.6f5616e3fd73` | 2148 | `ChevronRight` | `ExpandRightIcon` |
| `use.e6f0d818edcf` | 2273 | `ChevronDown` | `ExpandDownIcon` |
| `use.4f9e9b76cb45` | 2273 | `ChevronRight` | `ExpandRightIcon` |
| `use.7bb20f269b9d` | 2517 | `Flag` | `LeadInIcon` / `LeadOutIcon` |
| `use.6480b272ff61` | 2686 | `ChevronDown` | `ExpandDownIcon` |
| `use.29f53e332fd9` | 2686 | `ChevronRight` | `ExpandRightIcon` |

### src/features/editor/EditorPreview.tsx

| Stable usage ID | Snapshot line | Original symbol | Semantic replacement |
| --- | --- | --- | --- |
| `use.79b6ff2a42d7` | 948 | `MousePointer2` | `SelectIcon` |
| `use.224e71e5aace` | 963 | `Magnet` | `CircleCenterIcon` |
| `use.c12bc8666173` | 976 | `ZoomOut` | `ZoomOutIcon` |
| `use.f2501c9610ea` | 990 | `ZoomIn` | `ZoomInIcon` |
| `use.ea544ff90a81` | 1001 | `Maximize2` | `FitViewIcon` |

### src/features/editor/EditorProgramLinesPanel.tsx

| Stable usage ID | Snapshot line | Original symbol | Semantic replacement |
| --- | --- | --- | --- |
| `use.99c4f93b985c` | 143 | `Pin` | `PinIcon` |
| `use.fa6e48c4c779` | 157 | `ChevronDown` | `ExpandDownIcon` |
| `use.3957c858ce67` | 157 | `ChevronRight` | `ExpandRightIcon` |
| `use.b8decb16d910` | 185 | `ChevronDown` | `ExpandDownIcon` |
| `use.53b94b0ff79a` | 185 | `ChevronRight` | `ExpandRightIcon` |
| `use.66e19a039ace` | 213 | `ArrowUp` | `MoveUpIcon` |
| `use.25f588a1b453` | 222 | `ArrowDown` | `MoveDownIcon` |
| `use.66be428ac8b3` | 231 | `Trash2` | `DeleteIcon` |
| `use.0a9535ec04b9` | 324 | `ArrowUp` | `MoveUpIcon` |
| `use.aac6a0cb03e1` | 336 | `ArrowDown` | `MoveDownIcon` |
| `use.4dca56b9193d` | 344 | `ArrowRightFromLine` | `StartPointIcon` |
| `use.476a8abaec18` | 359 | `Pin` | `PinIcon` |
| `use.96f2efe51618` | 367 | `Trash2` | `DeleteIcon` |
| `use.9f24f8fc2d89` | 391 | `RefreshCw` | `RefreshIcon` |

### src/features/editor/EditorWorkflowSetupPanels.tsx

| Stable usage ID | Snapshot line | Original symbol | Semantic replacement |
| --- | --- | --- | --- |
| `use.380cf131f0f8` | 134 | `RefreshCw` | `RefreshIcon` |
| `use.33e09cc4ed31` | 319 | `MousePointer2` | `SelectIcon` |
| `use.b553a699ba45` | 333 | `MousePointer2` | `SelectIcon` |

### src/features/editor/EditorWorkflowTransitionDialog.tsx

| Stable usage ID | Snapshot line | Original symbol | Semantic replacement |
| --- | --- | --- | --- |
| `use.1360bb9ba1d7` | 106 | `X` | `CloseIcon` |

### src/features/editor/EditorWorkspacePanels.tsx

| Stable usage ID | Snapshot line | Original symbol | Semantic replacement |
| --- | --- | --- | --- |
| `use.c196f73798b6` | 189 | `X` | `CloseIcon` |
| `use.8cef7cfe766a` | 289 | `PanelRightOpen` | `PanelRightOpenIcon` |
| `use.f226093b2d18` | 374 | `PanelRightClose` | `PanelRightCloseIcon` |
| `use.45dfd97b0876` | 593 | `X` | `CloseIcon` |
| `use.9022d087ffa1` | 812 | `X` | `CloseIcon` |

### src/features/editor/GCodeInspectionDialog.tsx

| Stable usage ID | Snapshot line | Original symbol | Semantic replacement |
| --- | --- | --- | --- |
| `use.27644fc89b4b` | 42 | `Download` | `DownloadIcon` |
| `use.da83f1234509` | 43 | `X` | `CloseIcon` |

### src/features/editor/GCodeInspectionInput.tsx

| Stable usage ID | Snapshot line | Original symbol | Semantic replacement |
| --- | --- | --- | --- |
| `use.4435acf47cbc` | 24 | `FileUp` | `FileImportIcon` |

### src/features/onboarding/OnboardingDialog.tsx

| Stable usage ID | Snapshot line | Original symbol | Semantic replacement |
| --- | --- | --- | --- |
| `use.1fb291d654a2` | 50 | `X` | `CloseIcon` |

### src/features/simulation/MachineSetupPanel.tsx

| Stable usage ID | Snapshot line | Original symbol | Semantic replacement |
| --- | --- | --- | --- |
| `use.f1d993ccef92` | 104 | `LoaderCircle` | `BusyIcon` |
| `use.a014b3847704` | 104 | `X` | `CloseIcon` |
| `use.a5891c363c50` | 105 | `Upload` | `UploadIcon` |
| `use.ad50b0c82fb5` | 112 | `X` | `CloseIcon` |
| `use.4812cc4b1568` | 124 | `Check` | `ConfirmIcon` |

### src/features/simulation/SimulationPanel.tsx

| Stable usage ID | Snapshot line | Original symbol | Semantic replacement |
| --- | --- | --- | --- |
| `use.252245fcd474` | 149 | `Box` | `BodyIcon` |
| `use.633c9f62767a` | 150 | `FileBox` | `MachineSetupIcon` |
| `use.a35db817a3df` | 151 | `AlertTriangle` | `WarningIcon` |
| `use.bd618a68b9ac` | 153 | `Info` | `InfoIcon` |
| `use.b5256e77150b` | 156 | `AlertTriangle` | `WarningIcon` |
| `use.0a5c9537201c` | 156 | `ChevronRight` | `ExpandRightIcon` |
| `use.684073a3c471` | 157 | `LoaderCircle` | `BusyIcon` |
| `use.22276cfba1b3` | 157 | `ArrowLeft` | `NavigateBackIcon` |
| `use.49a035f29971` | 179 | `RotateCcw` | `RotateCounterclockwiseIcon` |
| `use.8d9b31c40020` | 180 | `SkipBack` | `StepBackIcon` |
| `use.5f91c930f602` | 181 | `Pause` | `PauseIcon` |
| `use.e3a784da06ef` | 181 | `Play` | `PlayIcon` |
| `use.976d1b514bce` | 182 | `SkipForward` | `StepForwardIcon` |
| `use.a67eb1c62514` | 186 | `AlertTriangle` | `WarningIcon` |
| `use.6cdd08618d1a` | 186 | `ArrowLeft` | `NavigateBackIcon` |
| `use.d58bf547f995` | 189 | `X` | `CloseIcon` |
| `use.922e8ec6b9c7` | 196 | `Check` | `ConfirmIcon` |
| `use.f66f3b8f1bd6` | 210 | `AlertTriangle` | `WarningIcon` |
| `use.2196142c9d3a` | 216 | `AlertTriangle` | `WarningIcon` |

### src/features/simulation/SimulationViewport.tsx

| Stable usage ID | Snapshot line | Original symbol | Semantic replacement |
| --- | --- | --- | --- |
| `use.e1e7cd9ccf49` | 70 | `Maximize` | `FitViewIcon` |
| `use.31370f9c4b32` | 71 | `Scan` | `ViewTopIcon` |
| `use.20f8457ce243` | 72 | `View` | `ViewIcon` |
| `use.872f3157397b` | 74 | `ScanLine` | `FitViewIcon` |
| `use.94e796f909a2` | 75 | `Eye` | `VisibleIcon` |
| `use.a81832371477` | 75 | `EyeOff` | `HiddenIcon` |
| `use.ac4e2349bd2a` | 78 | `Box` | `SimulationIcon` |
| `use.4692037ad7e6` | 79 | `AlertTriangle` | `WarningIcon` |

## Expanded-variant parent contracts

All 95 referenced parents are present in the JSON. This includes shared controls that are not themselves standalone icon occurrences. Preserve those controls and their checks; use the child variant to choose the glyph.

| Stable parent ID | Channel | File | Child variants |
| --- | --- | --- | ---: |
| `use.575772b2f782` | dynamicSlots | src/features/cad/CadFeatureTree.tsx | 17 |
| `use.1e307a885857` | dynamicSlots | src/features/editor/EditorProgramLinesPanel.tsx | 2 |
| `use.29a204b4a6e6` | dynamicSlots | src/features/editor/EditorProgramLinesPanel.tsx | 2 |
| `use.796a7b0cf0d7` | renderCalls | src/components/StatusToasts.tsx | 4 |
| `use.b19ef4df92fe` | renderCalls | src/components/StatusToasts.tsx | 4 |
| `use.d19f679c28ec` | sharedGraphicCalls | src/features/cad/CadCurveCreationFields.tsx | 2 |
| `use.9ee1443048e1` | sharedGraphicCalls | src/features/cad/CadDatumPlaneFields.tsx | 2 |
| `use.174134a202ff` | sharedGraphicCalls | src/features/cad/CadDatumPlaneFields.tsx | 2 |
| `use.950edd1365cf` | sharedGraphicCalls | src/features/cad/CadDxfExportDialog.tsx | 2 |
| `use.7d1e7f2a1cce` | sharedGraphicCalls | src/features/cad/CadDxfExportDialog.tsx | 2 |
| `use.5ac231ba45b6` | sharedGraphicCalls | src/features/cad/CadExtrudeFields.tsx | 2 |
| `use.b0d0c31b31e1` | sharedGraphicCalls | src/features/cad/CadFeatureEditor.tsx | 2 |
| `use.407466c3cb25` | sharedGraphicCalls | src/features/cad/CadFeatureEditor.tsx | 2 |
| `use.8bdb4df9d158` | sharedGraphicCalls | src/features/cad/CadFeatureEditor.tsx | 2 |
| `use.a290dc91bebc` | sharedGraphicCalls | src/features/cad/CadFields.tsx | 2 |
| `use.5c0a10e79516` | sharedGraphicCalls | src/features/cad/CadFields.tsx | 2 |
| `use.abd234bd1a63` | sharedGraphicCalls | src/features/cad/CadFields.tsx | 2 |
| `use.80d8e082c7fb` | sharedGraphicCalls | src/features/cad/CadParametersPanel.tsx | 2 |
| `use.1f57f9153839` | sharedGraphicCalls | src/features/cad/CadPathSegmentFields.tsx | 2 |
| `use.a7e092fbc058` | sharedGraphicCalls | src/features/cad/CadPluginFields.tsx | 2 |
| `use.404d5e8136ab` | sharedGraphicCalls | src/features/cad/CadPluginFields.tsx | 2 |
| `use.b8369c9b8938` | sharedGraphicCalls | src/features/cad/CadPluginFields.tsx | 2 |
| `use.b0772c5b00b7` | sharedGraphicCalls | src/features/cad/CadPluginFields.tsx | 2 |
| `use.6ebbb643064b` | sharedGraphicCalls | src/features/cad/CadPluginFields.tsx | 2 |
| `use.20973965f0bf` | sharedGraphicCalls | src/features/cad/CadPluginFields.tsx | 2 |
| `use.e6cd901e881b` | sharedGraphicCalls | src/features/cad/CadPluginFields.tsx | 2 |
| `use.48dcdb8381c2` | sharedGraphicCalls | src/features/cad/CadPluginFields.tsx | 2 |
| `use.b4be527dd8bb` | sharedGraphicCalls | src/features/cad/CadPolygonVertexFields.tsx | 2 |
| `use.04c246957807` | sharedGraphicCalls | src/features/cad/CadPolygonVertexFields.tsx | 2 |
| `use.8cf9c5c4ca15` | sharedGraphicCalls | src/features/cad/CadSketchCanvas.tsx | 2 |
| `use.d80a3b8e94d3` | sharedGraphicCalls | src/features/cad/CadSketchMeasurements.tsx | 2 |
| `use.dc44e5d9d93d` | sharedGraphicCalls | src/features/cad/CadSketchProfilePanel.tsx | 2 |
| `use.68e773dda172` | sharedGraphicCalls | src/features/cad/CadSketchProfilePanel.tsx | 2 |
| `use.582faecabec1` | sharedGraphicCalls | src/features/cad/CadSketchProfilePanel.tsx | 2 |
| `use.24e336dbfaa5` | sharedGraphicCalls | src/features/cad/CadTopologyInspector.tsx | 2 |
| `use.9ab8cd2122e2` | sharedGraphicCalls | src/features/cad/CadTopologyInspector.tsx | 2 |
| `use.6bd78965b8fe` | sharedGraphicCalls | src/features/cad/CadTopologyInspector.tsx | 2 |
| `use.32e7f2d62caf` | sharedGraphicCalls | src/features/cad/CadViewport.tsx | 2 |
| `use.3145599eebce` | renderCalls | src/domain/cad/cadParameters.ts | 2 |
| `use.6b1bbea3d4ee` | renderCalls | src/domain/cad/cadParameters.ts | 2 |
| `use.4d2842c3de57` | renderCalls | src/domain/cad/cadParameters.ts | 2 |
| `use.e329faefa660` | renderCalls | src/domain/cad/cadParameters.ts | 2 |
| `use.3f59d804d39e` | renderCalls | src/domain/cad/cadParameters.ts | 2 |
| `use.c23490de05d1` | renderCalls | src/domain/cad/cadParameters.ts | 2 |
| `use.c413b12d5ec1` | renderCalls | src/domain/cad/cadParameters.ts | 2 |
| `use.ce290c237992` | renderCalls | src/domain/cad/cadParameters.ts | 2 |
| `use.b14ca25cc0e8` | renderCalls | src/domain/cad/cadParameters.ts | 2 |
| `use.181d5dd17c0a` | renderCalls | src/domain/cad/cadParameters.ts | 2 |
| `use.9b6d5f382460` | renderCalls | src/domain/cad/cadParameters.ts | 2 |
| `use.6616752a2110` | renderCalls | src/domain/cad/cadParameters.ts | 2 |
| `use.897e5c97be3a` | renderCalls | src/domain/cad/cadParameters.ts | 2 |
| `use.9fffcdd2f08a` | renderCalls | src/domain/cad/cadParameters.ts | 2 |
| `use.c9e38d5b4cf1` | renderCalls | src/features/cad/CadFeatureEditor.tsx | 2 |
| `use.9820a5722d61` | renderCalls | src/features/cad/CadFeatureEditor.tsx | 2 |
| `use.2527dc1e1a83` | renderCalls | src/features/cad/CadFeatureEditor.tsx | 2 |
| `use.92bbe2e5b9d5` | renderCalls | src/features/cad/CadFeatureEditor.tsx | 2 |
| `use.b7356f58552f` | renderCalls | src/features/cad/CadFeatureEditor.tsx | 2 |
| `use.48731053eecd` | renderCalls | src/features/cad/CadFeatureEditor.tsx | 2 |
| `use.53378eecfe0b` | renderCalls | src/features/cad/CadFeatureEditor.tsx | 2 |
| `use.aa30f867b30e` | renderCalls | src/features/cad/CadFeatureEditor.tsx | 2 |
| `use.b31d8b162e18` | renderCalls | src/features/cad/CadFeatureEditor.tsx | 2 |
| `use.93b428ea4514` | renderCalls | src/features/cad/CadFeatureEditor.tsx | 2 |
| `use.ea82fa31fd6d` | renderCalls | src/features/cad/CadFeatureEditor.tsx | 2 |
| `use.624d62796eb7` | renderCalls | src/features/cad/CadFeatureEditor.tsx | 2 |
| `use.2aca0aa1dcde` | renderCalls | src/features/cad/CadFeatureEditor.tsx | 2 |
| `use.1937673bb775` | renderCalls | src/features/cad/CadFeatureEditor.tsx | 2 |
| `use.2c97fb2007dc` | renderCalls | src/features/cad/CadFeatureEditor.tsx | 2 |
| `use.b0af81e63820` | renderCalls | src/features/cad/CadFeatureEditor.tsx | 2 |
| `use.175504056663` | renderCalls | src/features/cad/CadFeatureEditor.tsx | 2 |
| `use.054962086f44` | renderCalls | src/features/cad/CadFeatureEditor.tsx | 2 |
| `use.05ecdeee5ba0` | renderCalls | src/features/cad/CadFeatureEditor.tsx | 2 |
| `use.f8c3ca83cca0` | renderCalls | src/features/cad/CadFeatureEditor.tsx | 2 |
| `use.b2b32148c5ed` | renderCalls | src/features/cad/CadFeatureEditor.tsx | 2 |
| `use.2f9fac0c537f` | renderCalls | src/features/cad/CadFeatureEditor.tsx | 2 |
| `use.e3e6b22472f0` | renderCalls | src/features/cad/CadFeatureEditor.tsx | 2 |
| `use.9bc5cb9e069f` | renderCalls | src/features/cad/CadFeatureEditor.tsx | 2 |
| `use.97896c130c91` | renderCalls | src/features/cad/CadFeatureEditor.tsx | 2 |
| `use.4fd288154d43` | renderCalls | src/features/cad/CadFeatureEditor.tsx | 2 |
| `use.75af74a5a202` | renderCalls | src/features/cad/CadFeatureEditor.tsx | 2 |
| `use.626fc275d055` | renderCalls | src/features/cad/CadFeatureEditor.tsx | 2 |
| `use.153928133a0e` | renderCalls | src/features/cad/CadFeatureEditor.tsx | 2 |
| `use.0d2c9a6a7523` | renderCalls | src/features/cad/CadFeatureEditor.tsx | 2 |
| `use.9dfa1656abe9` | renderCalls | src/features/cad/CadFeatureEditor.tsx | 2 |
| `use.8d0c33980ba2` | renderCalls | src/features/cad/CadPathSegmentFields.tsx | 2 |
| `use.a25cfaf6ab28` | renderCalls | src/features/cad/CadPathSegmentFields.tsx | 2 |
| `use.f1a3e75e298b` | renderCalls | src/features/cad/CadPathSegmentFields.tsx | 2 |
| `use.f14ee198d98c` | renderCalls | src/features/cad/CadPathSegmentFields.tsx | 2 |
| `use.f9b1eb999ebd` | renderCalls | src/features/cad/CadPathSegmentFields.tsx | 2 |
| `use.f73ec146d8a9` | renderCalls | src/features/cad/CadPathSegmentFields.tsx | 2 |
| `use.94ba65765c0b` | renderCalls | src/features/cad/CadPathSegmentFields.tsx | 2 |
| `use.0468aab85451` | renderCalls | src/features/cad/CadPathSegmentFields.tsx | 2 |
| `use.8ff3308f8319` | renderCalls | src/features/cad/CadPathSegmentFields.tsx | 2 |
| `use.73945173632f` | dynamicSlots | src/features/editor/EditorWorkspacePanels.tsx | 1 |
| `use.561e99af97c1` | sharedGraphicCalls | src/features/cad/CadFields.tsx | 1 |
| `use.595a203d1573` | sharedGraphicCalls | src/features/cad/CadPluginFields.tsx | 1 |
