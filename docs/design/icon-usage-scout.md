# Current Lucide icon usage scout

Generated 2026-10-14T12:48:47.306Z. This is a source-usage map for this checkout, based on TypeScript AST parsing. It records imports and individual references, including JSX elements, object-property values, dynamic icon declarations/references, and call arguments.

## Coverage

- Catalog entries: 122; catalog aliases: 82.
- Production TypeScript files scanned: 396; files with Lucide imports: 31.
- Lucide component imports: 159; individual references: 228; aliases referenced: 81.
- Catalog IDs covered by references: 77/122; context-dependent or unresolved references: 13.
- Catalog aliases absent from imports: 1; imported but unused components: 0.

## Catalog IDs and individual usages

### `navigate-back` — Back (navigation)

Aliases: `ArrowLeft`.
- [src/features/cad/CadWorkbench.tsx:357] imported `ArrowLeft` as `ArrowLeft` (jsx-component); control {"tag":"button","className":"cad-back","aria-label":"Workbench","title":"Back to Workbench"}; variable `header`
  - Context: `<button className="cad-back" aria-label="Workbench" title="Back to Workbench" onClick={() => run(props.onBack)} disabled={locked}><ArrowLeft size={14} /></button>`
- [src/features/editor/EditorHeaderBar.tsx:108] imported `ArrowLeft` as `ArrowLeft` (jsx-component); control {"tag":"Button","aria-label":"Back to Dashboard","className":"size-7 shrink-0 p-0","title":"Return to Workbench"}
  - Context: `<Button aria-label="Back to Dashboard" data-editor-back className="size-7 shrink-0 p-0" disabled={interactionLocked} onClick={onBackToDashboard} size="sm" title="Return to Workbench" variant="outline" > <ArrowLeft /> </Button>`
- [src/features/simulation/SimulationPanel.tsx:157] imported `ArrowLeft` as `ArrowLeft` (jsx-component); control {"tag":"button"}
  - Context: `<button type="button" onClick={onEdit}><ArrowLeft size={14} />Return to editor</button>`
- [src/features/simulation/SimulationPanel.tsx:186] imported `ArrowLeft` as `ArrowLeft` (jsx-component); control {"tag":"button"}
  - Context: `<button type="button" onClick={onEdit}><ArrowLeft size={14} />Review in editor</button>`

### `navigate-forward` — Forward (navigation)

Aliases: `ArrowRight`.
- [src/features/cad/CadWorkbench.tsx:361] imported `ArrowRight` as `ArrowRight` (jsx-component); control {"tag":"button"}; variable `header`
  - Context: `<button disabled={locked || !selectedSketch?.profiles.some((entry) => !entry.construction)} onClick={() => selectedSketch && run(() => props.onSendToCam(selectedSketch.id))}><ArrowRight size={14} /> Send sketch to CAM</button>`

### `move-up` — Move up (navigation)

Aliases: `ArrowUp`.
- [src/features/cad/CadLoftSections.tsx:91] imported `ArrowUp` as `ArrowUp` (jsx-component); control {"tag":"button","aria-label":"`Move section ${index + 1} up`","title":"Move section up"}
  - Context: `<button type="button" aria-label={\`Move section ${index + 1} up\`} title="Move section up" disabled={index === 0} onClick={() => move(index, -1)}><ArrowUp size={12} /></button>`
- [src/features/editor/EditorPathNavigatorPanel.tsx:1994] imported `ArrowUp` as `ArrowUp` (jsx-component); control {"tag":"button","aria-label":"Move cut sequence operation up","className":"flex items-center justify-center text-muted-foreground outline-none hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40","title":"Move cut operation up"}
  - Context: `<button aria-label="Move cut sequence operation up" className="flex items-center justify-center text-muted-foreground outline-none hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40" disabled={pathElement.orderIndex <= 0 || isSaving} onClick={(event) => moveOperation(event, -1)} title="Move cut operation up" type="button" > <ArrowUp className="size-3" /> </button>`
- [src/features/editor/EditorProgramLinesPanel.tsx:213] imported `ArrowUp` as `ArrowUp` (jsx-component); control {"tag":"button","aria-label":"`Move group ${group.id} up`","className":"flex size-5 items-center justify-center border border-border text-muted-foreground outline-none hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"}
  - Context: `<button aria-label={\`Move group ${group.id} up\`} className="flex size-5 items-center justify-center border border-border text-muted-foreground outline-none hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40" disabled={index === 0 || isSaving} onClick={() => onMoveGroup(group.id, -1)} type="button" > <ArrowUp className="size-3" /> </button>`
- [src/features/editor/EditorProgramLinesPanel.tsx:324] imported `ArrowUp` as `ArrowUp` (jsx-component); control {"tag":"button","aria-label":"Move selected lines up","className":"flex size-5 shrink-0 items-center justify-center border border-border text-muted-foreground outline-none transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40","title":"Move selected lines up"}
  - Context: `<button aria-label="Move selected lines up" className="flex size-5 shrink-0 items-center justify-center border border-border text-muted-foreground outline-none transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40" disabled={selectedLines.length === 0 || Math.min(...selectedLines) <= 1 || isSaving} onClick={() => onMoveSelectedLines(-1)} title="Move selected lines up" type="button" > <ArrowUp className="size-3" /> </button>`

### `move-down` — Move down (navigation)

Aliases: `ArrowDown`.
- [src/features/cad/CadLoftSections.tsx:92] imported `ArrowDown` as `ArrowDown` (jsx-component); control {"tag":"button","aria-label":"`Move section ${index + 1} down`","title":"Move section down"}
  - Context: `<button type="button" aria-label={\`Move section ${index + 1} down\`} title="Move section down" disabled={index === sketchIds.length - 1} onClick={() => move(index, 1)}><ArrowDown size={12} /></button>`
- [src/features/editor/EditorPathNavigatorPanel.tsx:2004] imported `ArrowDown` as `ArrowDown` (jsx-component); control {"tag":"button","aria-label":"Move cut sequence operation down","className":"flex items-center justify-center border-t border-border text-muted-foreground outline-none hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40","title":"Move cut operation down"}
  - Context: `<button aria-label="Move cut sequence operation down" className="flex items-center justify-center border-t border-border text-muted-foreground outline-none hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40" disabled={pathElement.orderIndex >= operationCount - 1 || isSaving} onClick={(event) => moveOperation(event, 1)} title="Move cut operation down" type="button" > <ArrowDown className="size-3" /> </button>`
- [src/features/editor/EditorProgramLinesPanel.tsx:222] imported `ArrowDown` as `ArrowDown` (jsx-component); control {"tag":"button","aria-label":"`Move group ${group.id} down`","className":"flex size-5 items-center justify-center border border-border text-muted-foreground outline-none hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"}
  - Context: `<button aria-label={\`Move group ${group.id} down\`} className="flex size-5 items-center justify-center border border-border text-muted-foreground outline-none hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40" disabled={index === bodyGroups.length - 1 || isSaving} onClick={() => onMoveGroup(group.id, 1)} type="button" > <ArrowDown className="size-3" /> </button>`
- [src/features/editor/EditorProgramLinesPanel.tsx:336] imported `ArrowDown` as `ArrowDown` (jsx-component); control {"tag":"button","aria-label":"Move selected lines down","className":"flex size-5 shrink-0 items-center justify-center border border-border text-muted-foreground outline-none transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40","title":"Move selected lines down"}
  - Context: `<button aria-label="Move selected lines down" className="flex size-5 shrink-0 items-center justify-center border border-border text-muted-foreground outline-none transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40" disabled={ selectedLines.length === 0 || Math.max(...selectedLines) >= lineRows.length || isSaving } onClick={() => onMoveSelectedLines(1)} title="Move selected lines down" type="button" > <ArrowDown className="size-3" /> </button>`

### `expand-right` — Expand (navigation)

Aliases: `ChevronRight`.
- [src/app/MachinePostSettingsPanel.tsx:139] imported `ChevronRight` as `ChevronRight` (jsx-component); control {"tag":"summary","className":"flex cursor-pointer list-none items-center gap-1.5 text-foreground [&::-webkit-details-marker]:hidden"}
  - Context: `<summary className="flex cursor-pointer list-none items-center gap-1.5 text-foreground [&::-webkit-details-marker]:hidden"> <ChevronRight className="size-3 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" /> {active && <Check className="size-3 shrink-0" />} <span className="truncate" title={setup.name}>{setup.name}</span> </summary>`
- [src/features/cad/CadWorkbench.tsx:385] imported `ChevronRight` as `ChevronRight` (jsx-component); control {"tag":"button","className":"`cad-tree-row ${selectedId === feature.id ? 'is-selected' : ''} ${feature.suppressed ? 'is-suppressed' : ''} ${diagnostic ? 'has-error' : ''}`","title":"diagnostic?.message ?? `${featureLabels[feature.kind]} · ${feature.name}`"}
  - Context: `<button className={\`cad-tree-row ${selectedId === feature.id ? 'is-selected' : ''} ${feature.suppressed ? 'is-suppressed' : ''} ${diagnostic ? 'has-error' : ''}\`} disabled={locked} title={diagnostic?.message ?? \`${featureLabels[feature.kind]} · ${feature.name}\`} onClick={() => choose(feature.id)} onDoubleClick={() => { if (feature.kind === 'sketch') editSketch(feature); else if (feature.kind === 'curve') editCurve(feature); }}><ChevronRight size={11} /><Icon size={14} /><span>{feature.name}</span>{diagnostic && <span className="cad-tree-error">!</span>}{feature.suppressed && <span className="cad-tree-muted">off</span>}</button>`
- [src/features/editor/EditorPathNavigatorPanel.tsx:2148] imported `ChevronRight` as `ChevronRight` (jsx-component); control {"tag":"button","aria-label":"`${expanded ? 'Collapse' : 'Expand'} ${label}`","className":"flex items-center justify-center text-muted-foreground outline-none hover:bg-accent focus-visible:ring-1 focus-visible:ring-ring","title":"`${expanded ? 'Collapse' : 'Expand'} ${label}`"}
  - Context: `<button aria-expanded={expanded} aria-label={\`${expanded ? 'Collapse' : 'Expand'} ${label}\`} className="flex items-center justify-center text-muted-foreground outline-none hover:bg-accent focus-visible:ring-1 focus-visible:ring-ring" onClick={(event) => { event.preventDefault(); event.stopPropagation(); togglePathElementExpanded(element.id); }} title={\`${expanded ? 'Collapse' : 'Expand'} ${label}\`} type="button" > {expanded ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />} </button>`
- [src/features/editor/EditorPathNavigatorPanel.tsx:2273] imported `ChevronRight` as `ChevronRight` (jsx-component); control {"tag":"button","aria-label":"`${cutPathExpanded ? 'Collapse' : 'Expand'} cut path in ${label}`","className":"`flex h-6 w-full min-w-0 items-center gap-1 border-b border-border/40 text-left text-[10px] text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring pr-2`"}
  - Context: `<button aria-expanded={cutPathExpanded} aria-label={\`${cutPathExpanded ? 'Collapse' : 'Expand'} cut path in ${label}\`} className={\`flex h-6 w-full min-w-0 items-center gap-1 border-b border-border/40 text-left text-[10px] text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring pr-2\`} data-upid-cut-path-disclosure onClick={() => toggleCutPathExpanded(element.id)} style={{ paddingLeft: \`${22 + (treeDepth + 1) * 10}px\` }} type="button" > {cutPathExpanded ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />} <span className="truncate">Cut path</span> <span className="shrink-0"> · {element.segmentRefs.length} {element.segmentRefs.length === 1 ? 'segment' : 'segments'} </span> </button>`
- [src/features/editor/EditorPathNavigatorPanel.tsx:2686] imported `ChevronRight` as `ChevronRight` (jsx-component); control {"tag":"button","aria-label":"`${detailsExpanded ? 'Collapse' : 'Expand'} segment ${index + 1} details in ${pathElement.displayName}`","className":"order-first flex items-center justify-center text-muted-foreground outline-none hover:bg-accent focus-visible:ring-1 focus-visible:ring-ring","title":"`${detailsExpanded ? 'Hide' : 'Show'} exact geometry and endpoints`"}
  - Context: `<button aria-controls={detailsId} aria-expanded={detailsExpanded} aria-label={\`${detailsExpanded ? 'Collapse' : 'Expand'} segment ${index + 1} details in ${pathElement.displayName}\`} className="order-first flex items-center justify-center text-muted-foreground outline-none hover:bg-accent focus-visible:ring-1 focus-visible:ring-ring" onClick={(event) => { event.preventDefault(); event.stopPropagation(); onToggleDetails(); }} title={\`${detailsExpanded ? 'Hide' : 'Show'} exact geometry and endpoints\`} type="button" > {detailsExpanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />} </button>`
- [src/features/editor/EditorProgramLinesPanel.tsx:157] imported `ChevronRight` as `ChevronRight` (declaration-or-reference); variable `ToggleIcon`
  - Context: `ToggleIcon = expanded ? ChevronDown : ChevronRight`
- [src/features/editor/EditorProgramLinesPanel.tsx:185] imported `ChevronRight` as `ChevronRight` (declaration-or-reference); variable `ToggleIcon`
  - Context: `ToggleIcon = expanded ? ChevronDown : ChevronRight`
- [src/features/simulation/SimulationPanel.tsx:156] imported `ChevronRight` as `ChevronRight` (jsx-component); control {"tag":"button"}
  - Context: `<button type="button" onClick={onEdit}>Return to editor to save<ChevronRight size={12} /></button>`

### `expand-down` — Expand menu (navigation)

Aliases: `ChevronDown`.
- [src/features/cad/CadPatternCommand.tsx:44] imported `ChevronDown` as `ChevronDown` (jsx-component); control {"tag":"button","className":"cad-tool","aria-label":"Pattern","title":"Pattern"}
  - Context: `<button ref={trigger} className="cad-tool" aria-label="Pattern" title="Pattern" disabled={disabled} aria-haspopup="menu" aria-expanded={open && !disabled} aria-controls={open && !disabled ? id : undefined} onPointerDown={event => { if (open) event.preventDefault(); }} onClick={() => { if (open) close(true); else { initialFocus.current = 'first'; setOpen(true); } }} onKeyDown={event => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); initialFocus.current = event.key === 'ArrowUp' ? 'last' : 'first'; setOpen(true); } }}><Copy size={15} strokeWidth={1.5} /><span>Pattern</span><ChevronDown size={11} /></button>`
- [src/features/cad/CadWorkbench.tsx:361] imported `ChevronDown` as `ChevronDown` (jsx-component); control {"tag":"button"}; variable `header`
  - Context: `<button disabled={locked} aria-haspopup="true" aria-expanded={fileMenu} aria-controls="cad-file-menu" onClick={() => setFileMenu(!fileMenu)}>File <ChevronDown size={12} /></button>`
- [src/features/dashboard/ProjectListPanel.tsx:193] imported `ChevronDown` as `ChevronDown` (jsx-component); control {"tag":"Button","aria-label":"`Export UPID project ${project.id}`","className":"relative size-7 text-muted-foreground hover:text-foreground","title":"Export UPID"}
  - Context: `<Button aria-expanded={exportMenuProjectId === project.id} aria-controls={exportMenuProjectId === project.id ? menu.menuId : undefined} aria-haspopup="menu" aria-label={\`Export UPID project ${project.id}\`} className="relative size-7 text-muted-foreground hover:text-foreground" disabled={interactionLocked} onClick={() => menu.toggle(project.id)} onKeyDown={(event) => menu.onTriggerKeyDown(event, project.id)} ref={exportMenuProjectId === project.id ? menu.triggerRef : undefined} size="icon" title="Export UPID" type="button" variant="ghost" ><Save className="size-4" /><ChevronDown className="absolute bottom-0 right-0 size-2.5" /></Button>`
- [src/features/dashboard/StartWorkPanel.tsx:136] imported `ChevronDown` as `ChevronDown` (jsx-component); control {"tag":"Button","aria-label":"More path project import options","className":"w-8 shrink-0 rounded-l-none border-l border-primary-foreground/25 px-0"}
  - Context: `<Button aria-expanded={upidMenuOpen} aria-controls={upidMenuOpen ? menu.menuId : undefined} aria-haspopup="menu" aria-label="More path project import options" className="w-8 shrink-0 rounded-l-none border-l border-primary-foreground/25 px-0" disabled={!connected || isImporting} onClick={() => menu.toggle('import')} onKeyDown={(event) => menu.onTriggerKeyDown(event, 'import')} ref={menu.triggerRef} type="button" > <ChevronDown className="size-3.5" /> </Button>`
- [src/features/editor/EditorPathNavigatorPanel.tsx:2148] imported `ChevronDown` as `ChevronDown` (jsx-component); control {"tag":"button","aria-label":"`${expanded ? 'Collapse' : 'Expand'} ${label}`","className":"flex items-center justify-center text-muted-foreground outline-none hover:bg-accent focus-visible:ring-1 focus-visible:ring-ring","title":"`${expanded ? 'Collapse' : 'Expand'} ${label}`"}
  - Context: `<button aria-expanded={expanded} aria-label={\`${expanded ? 'Collapse' : 'Expand'} ${label}\`} className="flex items-center justify-center text-muted-foreground outline-none hover:bg-accent focus-visible:ring-1 focus-visible:ring-ring" onClick={(event) => { event.preventDefault(); event.stopPropagation(); togglePathElementExpanded(element.id); }} title={\`${expanded ? 'Collapse' : 'Expand'} ${label}\`} type="button" > {expanded ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />} </button>`
- [src/features/editor/EditorPathNavigatorPanel.tsx:2273] imported `ChevronDown` as `ChevronDown` (jsx-component); control {"tag":"button","aria-label":"`${cutPathExpanded ? 'Collapse' : 'Expand'} cut path in ${label}`","className":"`flex h-6 w-full min-w-0 items-center gap-1 border-b border-border/40 text-left text-[10px] text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring pr-2`"}
  - Context: `<button aria-expanded={cutPathExpanded} aria-label={\`${cutPathExpanded ? 'Collapse' : 'Expand'} cut path in ${label}\`} className={\`flex h-6 w-full min-w-0 items-center gap-1 border-b border-border/40 text-left text-[10px] text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring pr-2\`} data-upid-cut-path-disclosure onClick={() => toggleCutPathExpanded(element.id)} style={{ paddingLeft: \`${22 + (treeDepth + 1) * 10}px\` }} type="button" > {cutPathExpanded ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />} <span className="truncate">Cut path</span> <span className="shrink-0"> · {element.segmentRefs.length} {element.segmentRefs.length === 1 ? 'segment' : 'segments'} </span> </button>`
- [src/features/editor/EditorPathNavigatorPanel.tsx:2686] imported `ChevronDown` as `ChevronDown` (jsx-component); control {"tag":"button","aria-label":"`${detailsExpanded ? 'Collapse' : 'Expand'} segment ${index + 1} details in ${pathElement.displayName}`","className":"order-first flex items-center justify-center text-muted-foreground outline-none hover:bg-accent focus-visible:ring-1 focus-visible:ring-ring","title":"`${detailsExpanded ? 'Hide' : 'Show'} exact geometry and endpoints`"}
  - Context: `<button aria-controls={detailsId} aria-expanded={detailsExpanded} aria-label={\`${detailsExpanded ? 'Collapse' : 'Expand'} segment ${index + 1} details in ${pathElement.displayName}\`} className="order-first flex items-center justify-center text-muted-foreground outline-none hover:bg-accent focus-visible:ring-1 focus-visible:ring-ring" onClick={(event) => { event.preventDefault(); event.stopPropagation(); onToggleDetails(); }} title={\`${detailsExpanded ? 'Hide' : 'Show'} exact geometry and endpoints\`} type="button" > {detailsExpanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />} </button>`
- [src/features/editor/EditorProgramLinesPanel.tsx:157] imported `ChevronDown` as `ChevronDown` (declaration-or-reference); variable `ToggleIcon`
  - Context: `ToggleIcon = expanded ? ChevronDown : ChevronRight`
- [src/features/editor/EditorProgramLinesPanel.tsx:185] imported `ChevronDown` as `ChevronDown` (declaration-or-reference); variable `ToggleIcon`
  - Context: `ToggleIcon = expanded ? ChevronDown : ChevronRight`

### `more` — More actions (navigation)

Aliases: `Ellipsis`.
- [src/features/editor/EditorPathNavigatorPanel.tsx:553] imported `Ellipsis` as `Ellipsis` (jsx-component); control {"tag":"button","aria-label":"Geometry tree options","className":"flex size-6 items-center justify-center text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring","title":"Geometry tree options"}; variable `contourTreeContent`
  - Context: `<button aria-expanded={geometryTreeOptionsOpen} aria-haspopup="menu" aria-label="Geometry tree options" className="flex size-6 items-center justify-center text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring" onClick={() => setGeometryTreeOptionsOpen((open) => !open)} title="Geometry tree options" type="button" > <Ellipsis aria-hidden="true" className="size-4" /> </button>`

### `close` — Close or cancel (actions)

Aliases: `X`.
- [src/app/WorkbenchSettingsDialog.tsx:74] imported `X` as `X` (jsx-component); control {"tag":"button","aria-label":"Close settings","className":"mb-4 flex size-8 shrink-0 items-center justify-center border border-border text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring max-[720px]:mb-0"}
  - Context: `<button aria-label="Close settings" className="mb-4 flex size-8 shrink-0 items-center justify-center border border-border text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring max-[720px]:mb-0" onClick={onClose} ref={closeButtonRef} type="button"><X className="size-4" /></button>`
- [src/components/StatusToasts.tsx:64] imported `X` as `X` (jsx-component); control {"tag":"button","className":"`pointer-events-auto grid min-h-9 grid-cols-[16px_minmax(0,1fr)_14px] items-center gap-1.5 border px-2 py-1.5 text-left font-mono text-[10px] leading-4 shadow-lg outline-none backdrop-blur transition hover:brightness-110 ${toneClass( toast.type )}`","title":"Dismiss status message"}
  - Context: `<button className={\`pointer-events-auto grid min-h-9 grid-cols-[16px_minmax(0,1fr)_14px] items-center gap-1.5 border px-2 py-1.5 text-left font-mono text-[10px] leading-4 shadow-lg outline-none backdrop-blur transition hover:brightness-110 ${toneClass( toast.type )}\`} data-status-toast={toast.type} onClick={() => onDismiss(toast.id)} title="Dismiss status message" type="button" > {toastIcon(toast.type)} <span className="min-w-0 truncate">{toast.message}</span> <X className="size-3 opacity-70" /> </button>`
- [src/features/cad/CadFeatureEditor.tsx:98] imported `X` as `X` (jsx-component); control {"tag":"button"}
  - Context: `<button type="button" onClick={onCancel}><X size={13} /> Cancel</button>`
- [src/features/cad/CadFeatureEditor.tsx:139] imported `X` as `X` (jsx-component); control {"tag":"button"}
  - Context: `<button type="button" onClick={onCancel}><X size={13} /> Cancel</button>`
- [src/features/cad/CadLoftSections.tsx:95] imported `X` as `X` (jsx-component); control {"tag":"button","aria-label":"`Remove section ${index + 1}`","title":"Remove section"}
  - Context: `<button type="button" aria-label={\`Remove section ${index + 1}\`} title="Remove section" disabled={sketchIds.length <= MIN_CAD_LOFT_SECTIONS} onClick={() => { focusAfterChange.current = sketchIds[index + 1] ?? sketchIds[index - 1] ?? null; onChange(sketchIds.filter((_, position) => position !== index)); }}><X size={12} /></button>`
- [src/features/cad/CadSketchCanvas.tsx:303] imported `X` as `X` (jsx-component); control {"tag":"button"}
  - Context: `<button disabled={interactionLocked} onClick={() => changePath({ kind: 'cancel' }, true)}><X size={13} /> Cancel drawing</button>`
- [src/features/cad/CadSketchCanvas.tsx:305] imported `X` as `X` (jsx-component); control {"tag":"button"}
  - Context: `<button onClick={() => setPoints([])}><X size={13} /> Cancel drawing</button>`
- [src/features/cad/CadWorkbench.tsx:378] imported `X` as `X` (jsx-component); control {"tag":"button","aria-label":"Dismiss local error"}
  - Context: `<button aria-label="Dismiss local error" onClick={() => setError(null)}><X size={13} /></button>`
- [src/features/cad/CadWorkbench.tsx:386] imported `X` as `X` (jsx-component); control {"tag":"button","aria-label":"`Remove parameter ${name}`"}
  - Context: `<button disabled={locked} aria-label={\`Remove parameter ${name}\`} onClick={() => run(() => props.onEdit({ kind: 'remove-parameter', name }))}><X size={12} /></button>`
- [src/features/dashboard/DxfImportConfirmationDialog.tsx:191] imported `X` as `X` (jsx-component); control {"tag":"button","aria-label":"reimport ? 'Close DXF unit re-import review' : 'Close DXF import review'","className":"flex size-7 shrink-0 items-center justify-center border border-border text-muted-foreground outline-none transition hover:bg-accent hover:text-foreground disabled:opacity-45"}
  - Context: `<button aria-label={reimport ? 'Close DXF unit re-import review' : 'Close DXF import review'} className="flex size-7 shrink-0 items-center justify-center border border-border text-muted-foreground outline-none transition hover:bg-accent hover:text-foreground disabled:opacity-45" disabled={cancellationBlocked} onClick={onCancel} type="button" > <X className="size-4" /> </button>`
- [src/features/dashboard/ProjectActionDialog.tsx:129] imported `X` as `X` (jsx-component); control {"tag":"button","aria-label":"`Close ${kind} dialog`","className":"flex size-7 shrink-0 items-center justify-center border border-border text-muted-foreground outline-none transition hover:bg-accent hover:text-foreground"}
  - Context: `<button aria-label={\`Close ${kind} dialog\`} className="flex size-7 shrink-0 items-center justify-center border border-border text-muted-foreground outline-none transition hover:bg-accent hover:text-foreground" onClick={dismiss} disabled={busy} type="button" > <X className="size-4" /> </button>`
- [src/features/dashboard/ProjectRevisionsDialog.tsx:212] imported `X` as `X` (jsx-component); control {"tag":"Button","aria-label":"Close revisions"}
  - Context: `<Button ref={closeRef} aria-label="Close revisions" disabled={busy} onClick={onClose} size="icon" type="button" variant="ghost"><X /></Button>`
- [src/features/editor/EditorGuideDialog.tsx:71] imported `X` as `X` (jsx-component); control {"tag":"button","aria-label":"copy.closeLabel","className":"flex size-7 shrink-0 items-center justify-center border border-border text-muted-foreground outline-none transition hover:bg-accent hover:text-foreground"}
  - Context: `<button aria-label={copy.closeLabel} className="flex size-7 shrink-0 items-center justify-center border border-border text-muted-foreground outline-none transition hover:bg-accent hover:text-foreground" onClick={onClose} ref={closeRef} type="button" > <X className="size-4" /> </button>`
- [src/features/editor/EditorWorkflowTransitionDialog.tsx:106] imported `X` as `X` (jsx-component); control {"tag":"Button","aria-label":"Dismiss workflow transition"}
  - Context: `<Button aria-label="Dismiss workflow transition" onClick={onDismiss} size="icon" type="button" variant="ghost" > <X /> </Button>`
- [src/features/editor/EditorWorkspacePanels.tsx:189] imported `X` as `X` (jsx-component); control {"tag":"button","aria-label":"`Close ${title}`","className":"flex size-6 items-center justify-center border border-border text-muted-foreground outline-none hover:bg-accent hover:text-foreground"}
  - Context: `<button aria-label={\`Close ${title}\`} className="flex size-6 items-center justify-center border border-border text-muted-foreground outline-none hover:bg-accent hover:text-foreground" onClick={onClose} ref={closeRef} type="button" > <X aria-hidden="true" className="size-3" /> </button>`
- [src/features/editor/EditorWorkspacePanels.tsx:593] imported `X` as `X` (jsx-component); control {"tag":"button","aria-label":"compactDrawerOpen ? `Close ${title} drawer` : `Hide ${title}`","className":"flex size-6 items-center justify-center border border-border text-muted-foreground outline-none transition hover:bg-accent hover:text-foreground","title":"`Hide ${title}`"}
  - Context: `<button aria-label={compactDrawerOpen ? \`Close ${title} drawer\` : \`Hide ${title}\`} className="flex size-6 items-center justify-center border border-border text-muted-foreground outline-none transition hover:bg-accent hover:text-foreground" onClick={compactDrawerOpen ? onCloseCompactDrawer : onHide} onPointerDown={(event) => event.stopPropagation()} ref={compactDrawerCloseRef} title={\`Hide ${title}\`} type="button" > <X className="size-3" /> </button>`
- [src/features/editor/EditorWorkspacePanels.tsx:812] imported `X` as `X` (jsx-component); control {"tag":"button","aria-label":"`Hide ${title}`","className":"flex size-6 items-center justify-center border border-border text-muted-foreground outline-none transition hover:bg-accent hover:text-foreground","title":"`Hide ${title}`"}; variable `dockedPanel`
  - Context: `<button aria-label={\`Hide ${title}\`} className="flex size-6 items-center justify-center border border-border text-muted-foreground outline-none transition hover:bg-accent hover:text-foreground" onClick={onHide} onPointerDown={(event) => event.stopPropagation()} title={\`Hide ${title}\`} type="button" > <X className="size-3" /> </button>`
- [src/features/editor/GCodeInspectionDialog.tsx:43] imported `X` as `X` (jsx-component); control {"tag":"Button","aria-label":"Close G-code inspection"}
  - Context: `<Button ref={closeRef} aria-label="Close G-code inspection" size="icon" variant="ghost" onClick={onClose}><X /></Button>`
- [src/features/onboarding/OnboardingDialog.tsx:50] imported `X` as `X` (jsx-component); control {"tag":"Button","aria-label":"Close onboarding","className":"absolute right-2 top-2 z-10 border-white/20 bg-black/65 text-white shadow-lg hover:bg-black/90"}
  - Context: `<Button aria-label="Close onboarding" className="absolute right-2 top-2 z-10 border-white/20 bg-black/65 text-white shadow-lg hover:bg-black/90" onClick={onDismiss} ref={closeButtonRef} size="icon" type="button" variant="outline" > <X /> </Button>`
- [src/features/simulation/MachineSetupPanel.tsx:104] imported `X` as `X` (jsx-component); control {"tag":"button","aria-label":"Cancel STEP import"}
  - Context: `<button type="button" aria-label="Cancel STEP import" onClick={cancelImport}><X size={13} /></button>`
- [src/features/simulation/MachineSetupPanel.tsx:112] imported `X` as `X` (jsx-component); control {"tag":"button","aria-label":"Remove machine model"}
  - Context: `<button type="button" aria-label="Remove machine model" onClick={() => { cancelImport(); setImportError(''); onMachineChange(null); }}><X size={13} /></button>`
- [src/features/simulation/SimulationPanel.tsx:189] imported `X` as `X` (jsx-component); control {"tag":"button","aria-label":"Close simulation settings"}
  - Context: `<button type="button" aria-label="Close simulation settings" onClick={() => closeSetup(true)}><X size={15} /></button>`

### `confirm` — Apply or confirm (actions)

Aliases: `Check`.
- [src/app/MachinePostSettingsPanel.tsx:140] imported `Check` as `Check` (jsx-component); control {"tag":"summary","className":"flex cursor-pointer list-none items-center gap-1.5 text-foreground [&::-webkit-details-marker]:hidden"}
  - Context: `<summary className="flex cursor-pointer list-none items-center gap-1.5 text-foreground [&::-webkit-details-marker]:hidden"> <ChevronRight className="size-3 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" /> {active && <Check className="size-3 shrink-0" />} <span className="truncate" title={setup.name}>{setup.name}</span> </summary>`
- [src/features/cad/CadFeatureEditor.tsx:98] imported `Check` as `Check` (jsx-component); control {"tag":"button","className":"cad-primary"}
  - Context: `<button type="submit" className="cad-primary" disabled={!isNew && !changed}><Check size={13} /> Apply</button>`
- [src/features/cad/CadFeatureEditor.tsx:139] imported `Check` as `Check` (jsx-component); control {"tag":"button","className":"cad-primary"}
  - Context: `<button type="submit" className="cad-primary" disabled={!changed}><Check size={13} /> Apply</button>`
- [src/features/cad/CadSketchCanvas.tsx:303] imported `Check` as `Check` (jsx-component); control {"tag":"button","aria-label":"sketch.kind === 'curve' ? 'Finish curve' : 'Close profile'","title":"sketch.kind === 'curve' ? 'Validate and save the open curve without a closing edge' : pathNeedsClosingLine ? 'Close the profile by adding a straight line to its start' : 'Validate and save the closed profile'"}
  - Context: `<button aria-label={sketch.kind === 'curve' ? 'Finish curve' : 'Close profile'} title={sketch.kind === 'curve' ? 'Validate and save the open curve without a closing edge' : pathNeedsClosingLine ? 'Close the profile by adding a straight line to its start' : 'Validate and save the closed profile'} disabled={interactionLocked || pathDraft.kind !== 'ready' || !pathDraft.segments.length} onClick={closePath}><Check size={13} />{sketch.kind === 'curve' ? 'Finish curve' : pathNeedsClosingLine ? 'Close with line' : 'Close profile'}</button>`
- [src/features/cad/CadSketchCanvas.tsx:305] imported `Check` as `Check` (jsx-component); control {"tag":"button"}
  - Context: `<button disabled={interactionLocked} onClick={close}><Check size={13} /> Close profile</button>`
- [src/features/simulation/MachineSetupPanel.tsx:124] imported `Check` as `Check` (jsx-component); control {"tag":"button","className":"sim-apply"}
  - Context: `<button className="sim-apply" type="submit"><Check size={13} />Apply alignment</button>`
- [src/features/simulation/SimulationPanel.tsx:196] imported `Check` as `Check` (jsx-component); control {"tag":"button","className":"sim-apply"}
  - Context: `<button className="sim-apply" type="submit"><Check size={13} />Apply stock</button>`

### `add` — Add (actions)

Aliases: `Plus`.
- [src/features/cad/CadLoftSections.tsx:107] imported `Plus` as `Plus` (jsx-component); control {"tag":"button","aria-label":"Add section","title":"Add section"}
  - Context: `<button type="button" aria-label="Add section" title="Add section" disabled={!selectedAddId || sketchIds.length >= MAX_CAD_LOFT_SECTIONS} onClick={() => { if (selectedAddId && sketchIds.length < MAX_CAD_LOFT_SECTIONS && !candidateDisabled(selectedAddId)) { focusAfterChange.current = selectedAddId; onChange([...sketchIds, selectedAddId]); } }}><Plus size={13} /></button>`
- [src/features/cad/CadWorkbench.tsx:382] imported `Plus` as `Plus` (jsx-component); control {"tag":"button","title":"`Create sketch on ${plane}`"}
  - Context: `<button key={plane} disabled={locked} title={\`Create sketch on ${plane}\`} onClick={() => startFeature('sketch', plane)}><Square size={12} /><span>{plane}</span><Plus size={11} /></button>`
- [src/features/cad/CadWorkbench.tsx:386] imported `Plus` as `Plus` (jsx-component); control {"tag":"button","className":"cad-primary"}
  - Context: `<button className="cad-primary" disabled={storageBusy || !parameterName.trim() || !parameterValue.trim()}><Plus size={13} /> Set parameter</button>`

### `remove` — Remove (actions)

Aliases: `Minus`.
No current production component references map to this ID.

### `delete` — Delete (actions)

Aliases: `Trash2`.
- [src/app/MachinePostSettingsPanel.tsx:124] imported `Trash2` as `Trash2` (jsx-component); control {"tag":"Button","aria-label":"`Remove ${machine.name}`"}
  - Context: `<Button aria-label={\`Remove ${machine.name}\`} disabled={disabled} onClick={() => onRemoveMachineDefinition(machine.id)} size="icon" type="button" variant="ghost"><Trash2 /></Button>`
- [src/features/cad/CadWorkbench.tsx:397] imported `Trash2` as `Trash2` (jsx-component); control {"tag":"button","aria-label":"Delete selected feature or profile"}
  - Context: `<button aria-label="Delete selected feature or profile" disabled={locked} onClick={removeSelected}><Trash2 size={13} /></button>`
- [src/features/cad/CadWorkbench.tsx:404] imported `Trash2` as `Trash2` (jsx-component); control {"tag":"button","className":"cad-danger"}
  - Context: `<button className="cad-danger" onClick={() => run(() => { props.onEdit({ kind: 'delete-feature', featureId: deleteFeature.id, cascade: dependentNames.length > 0 }); setDeleteFeature(null); setSelectedId(null); })}><Trash2 size={13} /> Delete{dependentNames.length ? ' with dependents' : ''}</button>`
- [src/features/dashboard/ProjectListPanel.tsx:161] imported `Trash2` as `Trash2` (jsx-component); control {"tag":"Button","aria-label":"`Delete project ${project.id}`","className":"size-7 text-muted-foreground hover:text-destructive","title":"Delete project"}
  - Context: `<Button aria-label={\`Delete project ${project.id}\`} className="size-7 text-muted-foreground hover:text-destructive" disabled={interactionLocked} onClick={() => onDeleteProject(project)} size="icon" title="Delete project" type="button" variant="ghost" > <Trash2 /> </Button>`
- [src/features/dashboard/ProjectRevisionsDialog.tsx:219] imported `Trash2` as `Trash2` (jsx-component); control {"tag":"Button"}
  - Context: `<Button size="sm" variant="outline" type="button" disabled={busy} onClick={() => setSelecting(true)}><Trash2 />Delete…</Button>`
- [src/features/editor/EditorInspectorPanel.tsx:1274] imported `Trash2` as `Trash2` (jsx-component); control {"tag":"button","aria-label":"`Delete measurement point P${index + 1}`","className":"flex size-5 items-center justify-center border border-border text-muted-foreground outline-none hover:bg-destructive/10 hover:text-destructive","title":"Delete point"}
  - Context: `<button aria-label={\`Delete measurement point P${index + 1}\`} className="flex size-5 items-center justify-center border border-border text-muted-foreground outline-none hover:bg-destructive/10 hover:text-destructive" onClick={() => onDeleteMeasurementPoint(point.id)} title="Delete point" type="button" > <Trash2 className="size-3" /> </button>`
- [src/features/editor/EditorProgramLinesPanel.tsx:231] imported `Trash2` as `Trash2` (jsx-component); control {"tag":"button","aria-label":"`Delete group ${group.id}`","className":"flex size-5 items-center justify-center border border-border text-destructive outline-none hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-40"}
  - Context: `<button aria-label={\`Delete group ${group.id}\`} className="flex size-5 items-center justify-center border border-border text-destructive outline-none hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-40" disabled={isSaving} onClick={() => onDeleteGroup(group.id)} type="button" > <Trash2 className="size-3" /> </button>`
- [src/features/editor/EditorProgramLinesPanel.tsx:367] imported `Trash2` as `Trash2` (jsx-component); control {"tag":"button","className":"flex h-5 shrink-0 items-center gap-1 border border-border px-1.5 font-mono text-[10px] text-destructive outline-none transition hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-40"}
  - Context: `<button className="flex h-5 shrink-0 items-center gap-1 border border-border px-1.5 font-mono text-[10px] text-destructive outline-none transition hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-40" disabled={selectedLines.length === 0 || isSaving} onClick={onDeleteSelectedLines} type="button" > <Trash2 className="size-3" /> Delete Selected </button>`

### `save` — Save (files)

Aliases: `Save`.
- [src/features/cad/CadWorkbench.tsx:363] imported `Save` as `Save` (jsx-component); control {"tag":"button"}; variable `header`
  - Context: `<button disabled={locked} onClick={() => run(props.onSave)}><Save size={14} /> {storageBusy ? 'Working…' : 'Save'}</button>`
- [src/features/dashboard/ProjectListPanel.tsx:193] imported `Save` as `Save` (jsx-component); control {"tag":"Button","aria-label":"`Export UPID project ${project.id}`","className":"relative size-7 text-muted-foreground hover:text-foreground","title":"Export UPID"}
  - Context: `<Button aria-expanded={exportMenuProjectId === project.id} aria-controls={exportMenuProjectId === project.id ? menu.menuId : undefined} aria-haspopup="menu" aria-label={\`Export UPID project ${project.id}\`} className="relative size-7 text-muted-foreground hover:text-foreground" disabled={interactionLocked} onClick={() => menu.toggle(project.id)} onKeyDown={(event) => menu.onTriggerKeyDown(event, project.id)} ref={exportMenuProjectId === project.id ? menu.triggerRef : undefined} size="icon" title="Export UPID" type="button" variant="ghost" ><Save className="size-4" /><ChevronDown className="absolute bottom-0 right-0 size-2.5" /></Button>`
- [src/features/editor/EditorHeaderBar.tsx:183] imported `Save` as `Save` (jsx-component); control {"tag":"Button","aria-label":"Save active document","className":"h-7 px-2 text-[11px]","title":"saveDisabledReason ?? 'Save'"}
  - Context: `<Button aria-label="Save active document" className="h-7 px-2 text-[11px]" data-editor-header-command disabled={!hasUnsavedChanges || interactionLocked || Boolean(saveDisabledReason)} onClick={onSave} size="sm" title={saveDisabledReason ?? 'Save'} variant="outline" > <Save /> <span data-editor-header-command-label>{isSaving ? 'Saving...' : 'Save'}</span> </Button>`

### `rename` — Rename or edit (actions)

Aliases: `Pencil`.
- [src/features/dashboard/ProjectListPanel.tsx:133] imported `Pencil` as `Pencil` (jsx-component); control {"tag":"Button","aria-label":"`Rename project ${project.id}`","className":"size-5 shrink-0 text-muted-foreground hover:text-foreground","title":"Rename project"} — high: Rename or edit action.
  - Context: `<Button aria-label={\`Rename project ${project.id}\`} className="size-5 shrink-0 text-muted-foreground hover:text-foreground" disabled={interactionLocked} onClick={() => onRenameProject(project)} size="icon" title="Rename project" type="button" variant="ghost" ><Pencil className="size-3" /></Button>`

### `copy` — Copy (actions)

Aliases: `Copy`.
- [src/features/cad/CadPatternCommand.tsx:44] imported `Copy` as `Copy` (jsx-component); control {"tag":"button","className":"cad-tool","aria-label":"Pattern","title":"Pattern"}
  - Context: `<button ref={trigger} className="cad-tool" aria-label="Pattern" title="Pattern" disabled={disabled} aria-haspopup="menu" aria-expanded={open && !disabled} aria-controls={open && !disabled ? id : undefined} onPointerDown={event => { if (open) event.preventDefault(); }} onClick={() => { if (open) close(true); else { initialFocus.current = 'first'; setOpen(true); } }} onKeyDown={event => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); initialFocus.current = event.key === 'ArrowUp' ? 'last' : 'first'; setOpen(true); } }}><Copy size={15} strokeWidth={1.5} /><span>Pattern</span><ChevronDown size={11} /></button>`
- [src/features/cad/CadPatternCommand.tsx:64] imported `Copy` as `Copy` (jsx-component); control {"tag":"button","role":"menuitem"}
  - Context: `<button role="menuitem" onClick={() => { close(); onChoose('linear-pattern'); }}><Copy size={14} /> Linear pattern</button>`
- [src/features/cad/CadWorkbench.tsx:68] imported `Copy` as `Copy` (object-property-value); variable `featureIcons`; property `'linear-pattern'`
  - Context: `featureIcons: Record<CadFeature['kind'], LucideIcon> = { 'datum-plane': Square, sketch: PencilRuler, curve: Spline, imported: Box, extrude: Box, pocket: Box, revolve: RotateCw, loft: Layers, sweep: Spline, fillet: CircleDot, chamfer: Scissors, shell: Box, boolean: Layers, transform: Move3D, 'linear-pattern': Copy, 'circular-pattern': RotateCw, mirror: Copy, }`
- [src/features/cad/CadWorkbench.tsx:68] imported `Copy` as `Copy` (object-property-value); variable `featureIcons`; property `mirror`
  - Context: `featureIcons: Record<CadFeature['kind'], LucideIcon> = { 'datum-plane': Square, sketch: PencilRuler, curve: Spline, imported: Box, extrude: Box, pocket: Box, revolve: RotateCw, loft: Layers, sweep: Spline, fillet: CircleDot, chamfer: Scissors, shell: Box, boolean: Layers, transform: Move3D, 'linear-pattern': Copy, 'circular-pattern': RotateCw, mirror: Copy, }`
- [src/features/cad/CadWorkbench.tsx:374] imported `Copy` as `Copy` (call-argument)
  - Context: `toolButton('Mirror', Copy, () => startFeature('mirror'), locked || !hasBody)`

### `undo` — Undo (actions)

Aliases: `Undo2`.
- [src/features/cad/CadSketchCanvas.tsx:303] imported `Undo2` as `Undo2` (jsx-component); control {"tag":"button"}
  - Context: `<button disabled={interactionLocked} onClick={() => changePath({ kind: 'undo-last' }, true)}><Undo2 size={13} /> Undo last</button>`
- [src/features/cad/CadWorkbench.tsx:362] imported `Undo2` as `Undo2` (jsx-component); control {"tag":"button","aria-label":"Undo","title":"Undo · Ctrl+Z"}; variable `header`
  - Context: `<button aria-label="Undo" title="Undo · Ctrl+Z" disabled={!canUndo || locked} onClick={() => run(props.onUndo)}><Undo2 size={15} /></button>`
- [src/features/editor/EditorHeaderBar.tsx:157] imported `Undo2` as `Undo2` (jsx-component); control {"tag":"Button","aria-label":"Undo active document change","className":"h-7 px-2 text-[11px]","title":"Undo"}
  - Context: `<Button aria-label="Undo active document change" className="h-7 px-2 text-[11px]" data-editor-header-command disabled={!undoAvailable || interactionLocked} onClick={onUndo} size="sm" title="Undo" variant="outline" > <Undo2 /> <span data-editor-header-command-label>Undo</span> </Button>`

### `redo` — Redo (actions)

Aliases: `Redo2`.
- [src/features/cad/CadWorkbench.tsx:362] imported `Redo2` as `Redo2` (jsx-component); control {"tag":"button","aria-label":"Redo","title":"Redo · Ctrl+Shift+Z"}; variable `header`
  - Context: `<button aria-label="Redo" title="Redo · Ctrl+Shift+Z" disabled={!canRedo || locked} onClick={() => run(props.onRedo)}><Redo2 size={15} /></button>`
- [src/features/editor/EditorHeaderBar.tsx:170] imported `Redo2` as `Redo2` (jsx-component); control {"tag":"Button","aria-label":"Redo active document change","className":"h-7 px-2 text-[11px]","title":"Redo"}
  - Context: `<Button aria-label="Redo active document change" className="h-7 px-2 text-[11px]" data-editor-header-command disabled={!redoAvailable || interactionLocked} onClick={onRedo} size="sm" title="Redo" variant="outline" > <Redo2 /> <span data-editor-header-command-label>Redo</span> </Button>`

### `refresh` — Refresh or rebuild (actions)

Aliases: `RefreshCw`.
- [src/app/WorkbenchSettingsDialog.tsx:103] imported `RefreshCw` as `RefreshCw` (jsx-component); control {"tag":"Button","className":"mt-3"}
  - Context: `<Button className="mt-3" disabled={storageSwitchDisabled} onClick={onConnectWorkbench} type="button" variant="outline"><RefreshCw />{storageActionLabel}</Button>`
- [src/features/editor/EditorProgramLinesPanel.tsx:391] imported `RefreshCw` as `RefreshCw` (jsx-component); control {"tag":"Button","className":"`h-5 px-1.5 text-[10px] ${guideHighlightClass( 'normalize-draft', guideHighlightTarget )}`"}
  - Context: `<Button {...guideTargetProps('normalize-draft', guideHighlightTarget)} className={\`h-5 px-1.5 text-[10px] ${guideHighlightClass( 'normalize-draft', guideHighlightTarget )}\`} disabled={!program || isSaving} onClick={(event) => { event.preventDefault(); event.stopPropagation(); onNormalizeDraft(); }} size="sm" variant="outline" > <RefreshCw /> Normalize Draft </Button>`
- [src/features/editor/EditorWorkflowSetupPanels.tsx:134] imported `RefreshCw` as `RefreshCw` (jsx-component); control {"tag":"button","aria-label":"Reverse path operation","className":"buttonClass"}
  - Context: `<button aria-label="Reverse path operation" className={buttonClass} disabled={!selected || disabled} onClick={() => selected && onReverse(selected.id)} type="button" > <RefreshCw className="size-3" /> Reverse direction </button>`

### `rotate-clockwise` — Rotate clockwise (geometry)

Aliases: `RotateCw`.
- [src/features/cad/CadPatternCommand.tsx:65] imported `RotateCw` as `RotateCw` (jsx-component); control {"tag":"button","role":"menuitem"}
  - Context: `<button role="menuitem" onClick={() => { close(); onChoose('circular-pattern'); }}><RotateCw size={14} /> Circular pattern</button>`
- [src/features/cad/CadWorkbench.tsx:68] imported `RotateCw` as `RotateCw` (object-property-value); variable `featureIcons`; property `revolve`
  - Context: `featureIcons: Record<CadFeature['kind'], LucideIcon> = { 'datum-plane': Square, sketch: PencilRuler, curve: Spline, imported: Box, extrude: Box, pocket: Box, revolve: RotateCw, loft: Layers, sweep: Spline, fillet: CircleDot, chamfer: Scissors, shell: Box, boolean: Layers, transform: Move3D, 'linear-pattern': Copy, 'circular-pattern': RotateCw, mirror: Copy, }`
- [src/features/cad/CadWorkbench.tsx:68] imported `RotateCw` as `RotateCw` (object-property-value); variable `featureIcons`; property `'circular-pattern'`
  - Context: `featureIcons: Record<CadFeature['kind'], LucideIcon> = { 'datum-plane': Square, sketch: PencilRuler, curve: Spline, imported: Box, extrude: Box, pocket: Box, revolve: RotateCw, loft: Layers, sweep: Spline, fillet: CircleDot, chamfer: Scissors, shell: Box, boolean: Layers, transform: Move3D, 'linear-pattern': Copy, 'circular-pattern': RotateCw, mirror: Copy, }`
- [src/features/cad/CadWorkbench.tsx:361] imported `RotateCw` as `RotateCw` (jsx-component); control {"tag":"button"}; variable `header`
  - Context: `<button disabled={locked} onClick={() => run(() => props.onRebuild?.())}><RotateCw size={14} /> Rebuild model</button>`
- [src/features/cad/CadWorkbench.tsx:374] imported `RotateCw` as `RotateCw` (call-argument)
  - Context: `toolButton('Revolve', RotateCw, () => startFeature('revolve'), locked || !hasSketch)`
- [src/features/editor/EditorPathNavigatorPanel.tsx:932] imported `RotateCw` as `RotateCw` (jsx-component); control {"tag":"button","aria-label":"`Rotate ${activePathTransformTarget} 90 degrees clockwise`","className":"iconButtonClass","title":"`Rotate ${activePathTransformTarget} 90 degrees clockwise`"}
  - Context: `<button aria-label={\`Rotate ${activePathTransformTarget} 90 degrees clockwise\`} className={iconButtonClass} disabled={!canOrientActiveTarget} onClick={() => activePathTransformTarget === 'document' ? onRotatePathDocument(-90) : onRotatePathSelection(-90) } title={\`Rotate ${activePathTransformTarget} 90 degrees clockwise\`} type="button" > <RotateCw className="size-3" /> </button>`

### `rotate-counterclockwise` — Rotate counterclockwise (geometry)

Aliases: `RotateCcw`.
- [src/features/editor/EditorPathNavigatorPanel.tsx:920] imported `RotateCcw` as `RotateCcw` (jsx-component); control {"tag":"button","aria-label":"`Rotate ${activePathTransformTarget} 90 degrees counterclockwise`","className":"iconButtonClass","title":"`Rotate ${activePathTransformTarget} 90 degrees counterclockwise`"}
  - Context: `<button aria-label={\`Rotate ${activePathTransformTarget} 90 degrees counterclockwise\`} className={iconButtonClass} disabled={!canOrientActiveTarget} onClick={() => activePathTransformTarget === 'document' ? onRotatePathDocument(90) : onRotatePathSelection(90) } title={\`Rotate ${activePathTransformTarget} 90 degrees counterclockwise\`} type="button" > <RotateCcw className="size-3" /> </button>`
- [src/features/simulation/SimulationPanel.tsx:179] imported `RotateCcw` as `RotateCcw` (jsx-component); control {"tag":"button","aria-label":"Restart simulation"}
  - Context: `<button type="button" aria-label="Restart simulation" onClick={() => { setPlaying(false); setElapsed(0); }}><RotateCcw size={14} /></button>`

### `download` — Download or export (files)

Aliases: `Download`.
- [src/features/cad/CadWorkbench.tsx:361] imported `Download` as `Download` (jsx-component); control {"tag":"button"}; variable `header`
  - Context: `<button disabled={locked || (!canvasReference && (hasActiveBodyFeatures ? !hasSolid || props.buildVersion !== props.documentVersion : references.length === 0))} onClick={() => run(() => props.onCaptureViewport?.())}><Download size={14} /> Capture view PNG</button>`
- [src/features/cad/CadWorkbench.tsx:361] imported `Download` as `Download` (jsx-component); control {"tag":"button"}; variable `header`
  - Context: `<button onClick={() => run(props.onExportDocument)}><Download size={14} /> Download CAD document</button>`
- [src/features/cad/CadWorkbench.tsx:361] imported `Download` as `Download` (jsx-component); control {"tag":"button"}; variable `header`
  - Context: `<button disabled={!hasSolid} onClick={() => run(() => props.onExportSolid('step'))}><Download size={14} /> Export STEP</button>`
- [src/features/cad/CadWorkbench.tsx:361] imported `Download` as `Download` (jsx-component); control {"tag":"button"}; variable `header`
  - Context: `<button disabled={!hasSolid} onClick={() => run(() => props.onExportSolid('stl'))}><Download size={14} /> Export STL</button>`
- [src/features/cad/CadWorkbench.tsx:361] imported `Download` as `Download` (jsx-component); control {"tag":"button"}; variable `header`
  - Context: `<button disabled={!selectedCurve && !selectedSketch?.profiles.length} onClick={() => { const reference = selectedCurve ?? selectedSketch; if (reference) run(() => props.onExportDxf(reference.id)); }}><Download size={14} /> {selectedCurve ? 'Export curve DXF' : 'Export sketch DXF'}</button>`
- [src/features/cad/CadWorkbench.tsx:400] imported `Download` as `Download` (jsx-component); control {"tag":"button"}
  - Context: `<button disabled={locked} onClick={() => run(() => props.onExportDxf(selected.id))}><Download size={13} /> Download DXF</button>`
- [src/features/cad/CadWorkbench.tsx:400] imported `Download` as `Download` (jsx-component); control {"tag":"button"}
  - Context: `<button disabled={locked || !selected.profiles.length} onClick={() => run(() => props.onExportDxf(selected.id))}><Download size={13} /> Download DXF</button>`
- [src/features/editor/EditorInspectorPanel.tsx:1300] imported `Download` as `Download` (jsx-component); control {"tag":"Button","className":"h-6 px-2 text-[10px]"}
  - Context: `<Button className="h-6 px-2 text-[10px]" disabled={measurementPoints.length === 0} onClick={() => onExportMeasurementPoints('csv')} size="sm" type="button" variant="outline" > <Download /> Export CSV </Button>`
- [src/features/editor/GCodeInspectionDialog.tsx:42] imported `Download` as `Download` (jsx-component); control {"tag":"Button"}
  - Context: `<Button size="sm" variant="outline" onClick={async () => { setDownloadError(null); try { await onDownload(); } catch (cause) { setDownloadError(cause instanceof Error ? cause.message : 'Download could not be requested. Retry this exact file.'); } }}><Download />Download exact file</Button>`

### `upload` — Upload or install (files)

Aliases: `Upload`.
- [src/app/MachinePostSettingsPanel.tsx:341] imported `Upload` as `Upload` (jsx-component); control {"tag":"label","className":"`inline-flex h-8 w-fit items-center gap-2 rounded-[2px] border border-border px-3 ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:bg-accent'}`"}
  - Context: `<label className={\`inline-flex h-8 w-fit items-center gap-2 rounded-[2px] border border-border px-3 ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:bg-accent'}\`}><Upload className="size-3.5" />Install machine package<input accept=".wireedm-package,application/zip" aria-label="Machine package file" className="sr-only" disabled={disabled} onChange={(event) => { const file = event.currentTarget.files?.[0]; if (file) void onFile(file); event.currentTarget.value = ''; }} type="file" /></label>`
- [src/features/simulation/MachineSetupPanel.tsx:105] imported `Upload` as `Upload` (jsx-component); control {"tag":"button","className":"sim-import"}
  - Context: `<button className="sim-import" type="button" onClick={() => fileInput.current?.click()}><Upload size={14} />{machine ? 'Replace STEP model' : 'Import STEP model'}<span>≤{MACHINE_IMPORT_LIMITS.fileBytes / (1024 * 1024)} MB</span></button>`

### `file-new` — New document (files)

Aliases: `FilePlus2`.
- [src/features/cad/CadWorkbench.tsx:361] imported `FilePlus2` as `FilePlus2` (jsx-component); control {"tag":"button"}; variable `header`
  - Context: `<button onClick={() => run(props.onNewDocument)}><FilePlus2 size={14} /> New part</button>`
- [src/features/dashboard/StartWorkPanel.tsx:194] imported `FilePlus2` as `FilePlus2` (jsx-component); control {"tag":"Button"}
  - Context: `<Button disabled={!connected || isImporting} onClick={onOpenEditor} type="button" variant="outline" > <FilePlus2 /> Open Editor </Button>`

### `folder-open` — Open folder (files)

Aliases: `FolderOpen`.
- [src/features/cad/CadWorkbench.tsx:361] imported `FolderOpen` as `FolderOpen` (jsx-component); control {"tag":"button"}; variable `header`
  - Context: `<button onClick={() => run(props.onOpenDocument)}><FolderOpen size={14} /> Open saved part</button>`
- [src/features/cad/CadWorkbench.tsx:361] imported `FolderOpen` as `FolderOpen` (jsx-component); control {"tag":"button"}; variable `header`
  - Context: `<button onClick={() => { setFileMenu(false); fileInput.current?.click(); }}><FolderOpen size={14} /> Import file</button>`

### `file-import` — Import file (files)

Aliases: `FileUp`.
- [src/features/dashboard/StartWorkPanel.tsx:121] imported `FileUp` as `FileUp` (jsx-component); control {"tag":"Button","className":"min-w-0 flex-1 rounded-r-none"}
  - Context: `<Button className="min-w-0 flex-1 rounded-r-none" disabled={!connected || isImporting} onClick={() => dxfInputRef.current?.click()} type="button" > <FileUp /> {dxfImporting ? 'Importing Path Project...' : 'Import DXF as Path Project'} </Button>`
- [src/features/editor/EditorHeaderBar.tsx:226] imported `FileUp` as `FileUp` (jsx-component); control {"tag":"Button","aria-label":"isImporting ? 'Importing program' : 'Import Program'","className":"`h-7 px-2 text-[11px] ${guideHighlightClass( 'import-program', guideHighlightTarget )}`","title":"Import Program"}
  - Context: `<Button {...guideTargetProps('import-program', guideHighlightTarget)} aria-label={isImporting ? 'Importing program' : 'Import Program'} className={\`h-7 px-2 text-[11px] ${guideHighlightClass( 'import-program', guideHighlightTarget )}\`} data-editor-header-command disabled={interactionLocked} onClick={() => fileInputRef.current?.click()} size="sm" title="Import Program" variant="default" > <FileUp /> <span data-editor-header-command-label> {isImporting ? 'Importing...' : 'Import Program'} </span> </Button>`
- [src/features/editor/GCodeInspectionInput.tsx:24] imported `FileUp` as `FileUp` (jsx-component); control {"tag":"Button"}
  - Context: `<Button disabled={reading} variant="outline" onClick={() => fileInput.current?.click()}> <FileUp />{reading ? 'Reading file…' : 'Choose G-code file'} </Button>`

### `file-export` — Generate controller file (files)

Aliases: `FileOutput`.
- [src/features/editor/EditorHeaderBar.tsx:197] imported `FileOutput` as `FileOutput` (jsx-component); control {"tag":"Button","aria-label":"exportLabel","className":"h-7 px-2 text-[11px]","title":"exportLabel"}
  - Context: `<Button aria-label={exportLabel} className="h-7 px-2 text-[11px]" data-editor-header-command disabled={!exportAvailable || interactionLocked} onClick={onExport} size="sm" title={exportLabel} variant="outline" > <FileOutput /> <span data-editor-header-command-label>{exportLabel}</span> </Button>`

### `file-inspect` — Inspect file (files)

Aliases: `FileSearch`.
- [src/features/dashboard/StartWorkPanel.tsx:180] imported `FileSearch` as `FileSearch` (jsx-component); control {"tag":"Button"}
  - Context: `<Button disabled={isImporting} onClick={onInspectGCode} type="button" variant="outline"> <FileSearch />Inspect G-code </Button>`
- [src/features/editor/EditorHeaderBar.tsx:145] imported `FileSearch` as `FileSearch` (jsx-component); control {"tag":"Button","aria-label":"Inspect G-code draft","className":"h-7 px-2 text-[11px]"}
  - Context: `<Button aria-label="Inspect G-code draft" className="h-7 px-2 text-[11px]" data-editor-header-command disabled={interactionLocked} onClick={onInspectGCode} size="sm" variant="outline"> <FileSearch /><span data-editor-header-command-label>Inspect</span> </Button>`

### `file-code` — Controller program (files)

Aliases: `FileCode`.
- [src/features/dashboard/StartWorkPanel.tsx:174] imported `FileCode` as `FileCode` (jsx-component); control {"tag":"Button"}
  - Context: `<Button disabled={!connected || isImporting} onClick={() => programInputRef.current?.click()} type="button" variant="outline" > <FileCode /> {programImporting ? 'Opening Machine Program...' : 'Open Machine Program'} </Button>`

### `file-json` — Structured interchange (files)

Aliases: `FileJson2`.
- [src/features/dashboard/StartWorkPanel.tsx:158] imported `FileJson2` as `FileJson2` (jsx-component); control {"tag":"button","aria-label":"Import UPID Path Project","className":"flex h-8 w-full items-center gap-2 px-2 text-left text-[10px] text-popover-foreground outline-none hover:bg-accent focus:bg-accent","role":"menuitem"}
  - Context: `<button aria-label="Import UPID Path Project" className="flex h-8 w-full items-center gap-2 px-2 text-left text-[10px] text-popover-foreground outline-none hover:bg-accent focus:bg-accent" onClick={() => { menu.close(true); upidInputRef.current?.click(); }} role="menuitem" tabIndex={-1} type="button" > <FileJson2 className="size-3.5" /> Import UPID Path Project </button>`

### `file-body` — Solid model file (files)

Aliases: `FileBox`.
No current production component references map to this ID.

### `history` — Revision history (files)

Aliases: `History`.
- [src/features/dashboard/ProjectListPanel.tsx:174] imported `History` as `History` (jsx-component); control {"tag":"Button","aria-label":"`Show revisions for project ${project.id}`","className":"size-7 text-muted-foreground hover:text-foreground","title":"Saved revisions"}
  - Context: `<Button aria-label={\`Show revisions for project ${project.id}\`} className="size-7 text-muted-foreground hover:text-foreground" disabled={interactionLocked} onClick={() => onShowRevisions(project)} size="icon" title="Saved revisions" type="button" variant="ghost" > <History /> </Button>`

### `browser-cache` — Browser cache (storage)

Aliases: `Database`.
- [src/app/AppShell.tsx:233] imported `Database` as `Database` (jsx-component)
  - Context: `return ( <div className="technical-workbench flex h-dvh flex-col overflow-hidden bg-background text-foreground" data-app-shell data-sidebar-collapsed={sidebarCollapsed ? 'true' : 'false'} > <header aria-hidden={compactModalOpen ? true : undefined} className="flex h-10 shrink-0 items-center border-b border-border bg-[#11171b] px-2" data-app-header inert={compactModalOpen ? true : undefined} > {headerContent ?? ( <div className="mr-4 flex min-w-0 items-center gap-2 text-xs font-semibold text-foreground"> <HardDrive className="size-4 text-primary" /> <span className="truncate">Wire EDM Workbench</span> </div> )} <div className="ml-auto flex items-center gap-2" data-app-header-system-controls> <StatusNotificationMenu notifications={statusNotifications} agentContent={agentPanelContent} /> <span aria-label={storageStatusLabel} className={\`inline-flex h-7 items-center gap-2 rounded-[2px] border`
- [src/app/WorkbenchSettingsDialog.tsx:76] imported `Database` as `Database` (jsx-component)
  - Context: `return ( <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" data-workbench-settings-overlay onClick={(event) => { if (event.target === event.currentTarget) onClose(); }} ref={overlayRef}> <div aria-label="Workbench settings" aria-modal="true" className="grid h-[86dvh] w-full max-w-4xl grid-cols-[224px_minmax(0,1fr)] overflow-hidden rounded-[2px] border border-border bg-card shadow-2xl max-[720px]:grid-cols-1 max-[720px]:grid-rows-[auto_minmax(0,1fr)]" onMouseDown={(event) => event.stopPropagation()} ref={dialogRef} role="dialog" tabIndex={-1}> <aside className="min-h-0 border-r border-border bg-background/45 p-3 max-[720px]:grid max-[720px]:grid-cols-[auto_minmax(0,1fr)] max-[720px]:items-center max-[720px]:gap-x-3 max-[720px]:gap-y-2 max-[720px]:border-b max-[720px]:border-r-0"> <button aria-label="Close settings" className="mb-4 flex size-8 shrink-0 items-cente`

### `folder-storage` — Folder storage (storage)

Aliases: `HardDrive`.
- [src/app/AppShell.tsx:214] imported `HardDrive` as `HardDrive` (jsx-component)
  - Context: `return ( <div className="technical-workbench flex h-dvh flex-col overflow-hidden bg-background text-foreground" data-app-shell data-sidebar-collapsed={sidebarCollapsed ? 'true' : 'false'} > <header aria-hidden={compactModalOpen ? true : undefined} className="flex h-10 shrink-0 items-center border-b border-border bg-[#11171b] px-2" data-app-header inert={compactModalOpen ? true : undefined} > {headerContent ?? ( <div className="mr-4 flex min-w-0 items-center gap-2 text-xs font-semibold text-foreground"> <HardDrive className="size-4 text-primary" /> <span className="truncate">Wire EDM Workbench</span> </div> )} <div className="ml-auto flex items-center gap-2" data-app-header-system-controls> <StatusNotificationMenu notifications={statusNotifications} agentContent={agentPanelContent} /> <span aria-label={storageStatusLabel} className={\`inline-flex h-7 items-center gap-2 rounded-[2px] border`

### `settings` — Workbench settings (actions)

Aliases: `Settings`.
- [src/app/AppShell.tsx:244] imported `Settings` as `SettingsIcon` (jsx-component); control {"tag":"Button","aria-label":"Open settings","title":"Settings"}
  - Context: `<Button aria-label="Open settings" onClick={() => { setSettingsSection('storage'); setSettingsOpen(true); }} size="icon" title="Settings" type="button" variant="outline" > <SettingsIcon /> </Button>`

### `adjust` — Adjust parameters (actions)

Aliases: `Settings2`, `SlidersHorizontal`.
- [src/app/WorkbenchSettingsDialog.tsx:77] imported `SlidersHorizontal` as `SlidersHorizontal` (jsx-component)
  - Context: `return ( <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" data-workbench-settings-overlay onClick={(event) => { if (event.target === event.currentTarget) onClose(); }} ref={overlayRef}> <div aria-label="Workbench settings" aria-modal="true" className="grid h-[86dvh] w-full max-w-4xl grid-cols-[224px_minmax(0,1fr)] overflow-hidden rounded-[2px] border border-border bg-card shadow-2xl max-[720px]:grid-cols-1 max-[720px]:grid-rows-[auto_minmax(0,1fr)]" onMouseDown={(event) => event.stopPropagation()} ref={dialogRef} role="dialog" tabIndex={-1}> <aside className="min-h-0 border-r border-border bg-background/45 p-3 max-[720px]:grid max-[720px]:grid-cols-[auto_minmax(0,1fr)] max-[720px]:items-center max-[720px]:gap-x-3 max-[720px]:gap-y-2 max-[720px]:border-b max-[720px]:border-r-0"> <button aria-label="Close settings" className="mb-4 flex size-8 shrink-0 items-cente`
- [src/features/cad/CadWorkbench.tsx:381] imported `Settings2` as `Settings2` (jsx-component); control {"tag":"button","aria-pressed":"tab === 'parameters'"}
  - Context: `<button aria-pressed={tab === 'parameters'} disabled={locked} onClick={() => setTab('parameters')}><Settings2 size={13} /> Parameters</button>`

### `help` — Help (status)

Aliases: `CircleHelp`.
- [src/features/editor/EditorHeaderBar.tsx:242] imported `CircleHelp` as `CircleHelp` (jsx-component); control {"tag":"Button","aria-label":"Open usage guide","className":"size-7 p-0","title":"Controls"}
  - Context: `<Button aria-label="Open usage guide" className="size-7 p-0" data-editor-header-command onClick={onOpenGuide} size="sm" title="Controls" variant="outline" > <CircleHelp /> </Button>`

### `info` — Information (status)

Aliases: `Info`.
- [src/components/StatusToasts.tsx:183] imported `Info` as `Info` (jsx-component)
  - Context: `return <Info className="size-3.5" />;`
- [src/features/editor/EditorPathNavigatorPanel.tsx:529] imported `Info` as `Info` (jsx-component); control {"tag":"button","aria-label":"Contour Tree help","className":"flex size-6 items-center justify-center text-muted-foreground outline-none transition hover:bg-accent hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring","title":"Contour Tree help"}; variable `contourTreeContent`
  - Context: `<button aria-describedby="contour-tree-help-tooltip" aria-label="Contour Tree help" className="flex size-6 items-center justify-center text-muted-foreground outline-none transition hover:bg-accent hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring" title="Contour Tree help" type="button" > <Info aria-hidden="true" className="size-3.5" /> </button>`
- [src/features/simulation/SimulationPanel.tsx:153] imported `Info` as `Info` (jsx-component)
  - Context: `setupButton('info', 'Simulation information', <Info size={15} />)`

### `warning` — Warning (status)

Aliases: `AlertTriangle`.
- [src/components/StatusToasts.tsx:182] imported `AlertTriangle` as `AlertTriangle` (jsx-component)
  - Context: `return <AlertTriangle className="size-3.5" />;`
- [src/features/simulation/SimulationPanel.tsx:151] imported `AlertTriangle` as `AlertTriangle` (jsx-component)
  - Context: `setupButton('checks', 'Simulation checks', <><AlertTriangle size={14} /><span>Checks</span><b>{findingCount}</b></>)`
- [src/features/simulation/SimulationPanel.tsx:156] imported `AlertTriangle` as `AlertTriangle` (jsx-component)
  - Context: `return <section className="sim-workspace" aria-label="Saved process simulation" data-final-part={finalPartOnly}> <div className="sim-main"> <div className="sim-context-bar"> {plan && <div className="sim-presentation-switch" role="group" aria-label="Simulation view"> <button type="button" aria-pressed={!finalPartOnly} onClick={() => setFinalPartOnly(false)}>Process</button> <button type="button" aria-pressed={finalPartOnly} onClick={() => { setPlaying(false); setFinalPartOnly(true); closeSetup(); }}>Final part</button> </div>} {plan && !finalPartOnly && <select className="sim-operation-select" aria-label="Simulation operation" value={activeOperation?.id ?? ''} onChange={event => { const operation = operationStarts.find(item => item.id === event.target.value); if (operation) { setPlaying(false); setElapsed(operation.time); } }}><option value="" disabled>Jump to operation</option>{operation`
- [src/features/simulation/SimulationPanel.tsx:186] imported `AlertTriangle` as `AlertTriangle` (jsx-component)
  - Context: `return <section className="sim-workspace" aria-label="Saved process simulation" data-final-part={finalPartOnly}> <div className="sim-main"> <div className="sim-context-bar"> {plan && <div className="sim-presentation-switch" role="group" aria-label="Simulation view"> <button type="button" aria-pressed={!finalPartOnly} onClick={() => setFinalPartOnly(false)}>Process</button> <button type="button" aria-pressed={finalPartOnly} onClick={() => { setPlaying(false); setFinalPartOnly(true); closeSetup(); }}>Final part</button> </div>} {plan && !finalPartOnly && <select className="sim-operation-select" aria-label="Simulation operation" value={activeOperation?.id ?? ''} onChange={event => { const operation = operationStarts.find(item => item.id === event.target.value); if (operation) { setPlaying(false); setElapsed(operation.time); } }}><option value="" disabled>Jump to operation</option>{operation`
- [src/features/simulation/SimulationPanel.tsx:210] imported `AlertTriangle` as `AlertTriangle` (jsx-component); control {"tag":"button"}
  - Context: `<button key={warning.id} type="button" onClick={() => { setPlaying(false); setFinalPartOnly(false); setElapsed(warning.elapsedSeconds); }}><AlertTriangle size={13} /><span>{warning.message}<small>{timeLabel(warning.elapsedSeconds)} · {warning.envelope}</small></span></button>`
- [src/features/simulation/SimulationPanel.tsx:216] imported `AlertTriangle` as `AlertTriangle` (jsx-component); control {"tag":"button"}
  - Context: `<button key={warning.id} type="button" onClick={() => { setPlaying(false); setFinalPartOnly(false); setElapsed(warning.elapsedSeconds); }}><AlertTriangle size={13} /><span>{warning.message}<small>{timeLabel(warning.elapsedSeconds)} · {warning.approximate ? 'approximate envelope' : 'surface intersection'}</small></span></button>`
- [src/features/simulation/SimulationViewport.tsx:79] imported `AlertTriangle` as `AlertTriangle` (jsx-component)
  - Context: `return <div className="sim-viewport" data-renderer={status}> <div ref={host} className="sim-render-host" /> <div className="sim-view-controls" aria-label="Simulation camera"> <button type="button" title={props.presentation.finalPartOnly ? 'Fit final part' : 'Isometric view · fit stock'} aria-label={props.presentation.finalPartOnly ? 'Fit final part' : 'Fit simulation stock'} onClick={() => withScene(scene => props.presentation.finalPartOnly ? scene.fitPart() : scene.setView('isometric'))}><Maximize size={14} /></button> <button type="button" title="Top view" aria-label="Simulation top view" onClick={() => withScene(scene => scene.setView('top'))}><Scan size={14} /></button> <button type="button" title="Front view" aria-label="Simulation front view" onClick={() => withScene(scene => scene.setView('front'))}><View size={14} /></button> {props.machine && !props.presentation.finalPartOnly &&`

### `success` — Completed successfully (status)

Aliases: `CheckCircle2`.
- [src/components/StatusToasts.tsx:180] imported `CheckCircle2` as `CheckCircle2` (jsx-component)
  - Context: `return <CheckCircle2 className="size-3.5" />;`

### `error` — Error (status)

Aliases: `XCircle`.
- [src/components/StatusToasts.tsx:181] imported `XCircle` as `XCircle` (jsx-component)
  - Context: `return <XCircle className="size-3.5" />;`

### `notifications` — Notifications (status)

Aliases: `Bell`.
- [src/components/StatusToasts.tsx:138] imported `Bell` as `Bell` (jsx-component); control {"tag":"button","aria-label":"Open notifications","className":"flex h-7 items-center gap-1 border border-border bg-background/60 px-2 text-muted-foreground outline-none transition hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring","title":"Notifications"}
  - Context: `<button aria-expanded={open} aria-haspopup="dialog" aria-controls={open ? \`${id}-popover\` : undefined} aria-label="Open notifications" className="flex h-7 items-center gap-1 border border-border bg-background/60 px-2 text-muted-foreground outline-none transition hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring" onClick={() => { if (!open) setTab('notifications'); setOpen(!open); }} ref={triggerRef} title="Notifications" type="button" > <Bell className="size-3.5" /> {notifications.length > 0 && ( <span className="min-w-4 border border-primary/50 bg-primary/20 px-1 text-center text-[10px] text-primary" data-status-notification-count > {countLabel} </span> )} </button>`

### `busy` — Operation in progress (status)

Aliases: `Loader2`, `LoaderCircle`.
- [src/features/cad/CadWorkbench.tsx:391] imported `Loader2` as `Loader2` (jsx-component)
  - Context: `return <main className="cad-workbench" aria-label="Parametric CAD workbench"> {publishHeader ? headerHost && createPortal(header, headerHost) : header} <div className="cad-toolbar" aria-label="CAD tools" inert={deleteFeature ? true : undefined}> <div className="cad-tool-group">{toolButton('Plane', Square, () => startFeature('datum-plane'), locked)}{toolButton('Sketch', PencilRuler, () => startFeature('sketch'), locked)}{toolButton('Curve', Spline, () => startFeature('curve'), locked)}</div> {sketch ? <><div className="cad-tool-group">{toolButton('Select', CornerDownRight, () => setTool('select'), drawingPending || editorPending, tool === 'select')}{toolButton('Rectangle', Square, () => { setTool('rectangle'); setProfileId(null); }, drawingPending || editorPending, tool === 'rectangle')}{toolButton('Circle', Circle, () => { setTool('circle'); setProfileId(null); }, drawingPending || edito`
- [src/features/cad/CadWorkbench.tsx:398] imported `Loader2` as `Loader2` (jsx-component)
  - Context: `return <main className="cad-workbench" aria-label="Parametric CAD workbench"> {publishHeader ? headerHost && createPortal(header, headerHost) : header} <div className="cad-toolbar" aria-label="CAD tools" inert={deleteFeature ? true : undefined}> <div className="cad-tool-group">{toolButton('Plane', Square, () => startFeature('datum-plane'), locked)}{toolButton('Sketch', PencilRuler, () => startFeature('sketch'), locked)}{toolButton('Curve', Spline, () => startFeature('curve'), locked)}</div> {sketch ? <><div className="cad-tool-group">{toolButton('Select', CornerDownRight, () => setTool('select'), drawingPending || editorPending, tool === 'select')}{toolButton('Rectangle', Square, () => { setTool('rectangle'); setProfileId(null); }, drawingPending || editorPending, tool === 'rectangle')}{toolButton('Circle', Circle, () => { setTool('circle'); setProfileId(null); }, drawingPending || edito`
- [src/features/simulation/MachineSetupPanel.tsx:104] imported `LoaderCircle` as `LoaderCircle` (jsx-component)
  - Context: `return <section className="sim-section" aria-label="Machine model setup"> <input ref={fileInput} type="file" accept=".step,.stp" hidden aria-label="Machine STEP file" onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void loadMachine(file); }} /> {importProgress ? <div className="sim-import-progress" role="status"><LoaderCircle className="animate-spin" size={14} /><span>{importProgress}</span><button type="button" aria-label="Cancel STEP import" onClick={cancelImport}><X size={13} /></button></div> : <button className="sim-import" type="button" onClick={() => fileInput.current?.click()}><Upload size={14} />{machine ? 'Replace STEP model' : 'Import STEP model'}<span>≤{MACHINE_IMPORT_LIMITS.fileBytes / (1024 * 1024)} MB</span></button>} {importError && <p className="sim-error" role="alert">{importError}</p>} {machine && <div className="sim-machin`
- [src/features/simulation/SimulationPanel.tsx:157] imported `LoaderCircle` as `LoaderCircle` (jsx-component)
  - Context: `return <section className="sim-workspace" aria-label="Saved process simulation" data-final-part={finalPartOnly}> <div className="sim-main"> <div className="sim-context-bar"> {plan && <div className="sim-presentation-switch" role="group" aria-label="Simulation view"> <button type="button" aria-pressed={!finalPartOnly} onClick={() => setFinalPartOnly(false)}>Process</button> <button type="button" aria-pressed={finalPartOnly} onClick={() => { setPlaying(false); setFinalPartOnly(true); closeSetup(); }}>Final part</button> </div>} {plan && !finalPartOnly && <select className="sim-operation-select" aria-label="Simulation operation" value={activeOperation?.id ?? ''} onChange={event => { const operation = operationStarts.find(item => item.id === event.target.value); if (operation) { setPlaying(false); setElapsed(operation.time); } }}><option value="" disabled>Jump to operation</option>{operation`

### `play` — Play simulation (simulation)

Aliases: `Play`.
- [src/features/simulation/SimulationPanel.tsx:181] imported `Play` as `Play` (jsx-component); control {"tag":"button","className":"sim-play","aria-label":"playing ? 'Pause simulation' : 'Play simulation'"}
  - Context: `<button className="sim-play" type="button" aria-label={playing ? 'Pause simulation' : 'Play simulation'} onClick={() => { if (elapsed >= plan.durationSeconds) setElapsed(0); setPlaying(value => !value); }}>{playing ? <Pause size={16} /> : <Play size={16} />}</button>`

### `pause` — Pause simulation (simulation)

Aliases: `Pause`.
- [src/features/simulation/SimulationPanel.tsx:181] imported `Pause` as `Pause` (jsx-component); control {"tag":"button","className":"sim-play","aria-label":"playing ? 'Pause simulation' : 'Play simulation'"}
  - Context: `<button className="sim-play" type="button" aria-label={playing ? 'Pause simulation' : 'Play simulation'} onClick={() => { if (elapsed >= plan.durationSeconds) setElapsed(0); setPlaying(value => !value); }}>{playing ? <Pause size={16} /> : <Play size={16} />}</button>`

### `step-back` — Previous simulation step (simulation)

Aliases: `SkipBack`.
- [src/features/simulation/SimulationPanel.tsx:180] imported `SkipBack` as `SkipBack` (jsx-component); control {"tag":"button","aria-label":"Previous simulation event"}
  - Context: `<button type="button" aria-label="Previous simulation event" onClick={() => step(-1)}><SkipBack size={14} /></button>`

### `step-forward` — Next simulation step (simulation)

Aliases: `SkipForward`.
- [src/features/simulation/SimulationPanel.tsx:182] imported `SkipForward` as `SkipForward` (jsx-component); control {"tag":"button","aria-label":"Next simulation event"}
  - Context: `<button type="button" aria-label="Next simulation event" onClick={() => step(1)}><SkipForward size={14} /></button>`

### `visible` — Show geometry (view)

Aliases: `Eye`.
- [src/features/simulation/SimulationViewport.tsx:75] imported `Eye` as `Eye` (jsx-component); control {"tag":"button","title":"machineVisible ? 'Hide machine model · collision checks stay active' : 'Show machine model'","aria-label":"machineVisible ? 'Hide machine model' : 'Show machine model'"}
  - Context: `<button type="button" title={machineVisible ? 'Hide machine model · collision checks stay active' : 'Show machine model'} aria-label={machineVisible ? 'Hide machine model' : 'Show machine model'} onClick={() => setMachineVisible(value => !value)}>{machineVisible ? <Eye size={14} /> : <EyeOff size={14} />}</button>`

### `hidden` — Hide geometry (view)

Aliases: `EyeOff`.
- [src/features/simulation/SimulationViewport.tsx:75] imported `EyeOff` as `EyeOff` (jsx-component); control {"tag":"button","title":"machineVisible ? 'Hide machine model · collision checks stay active' : 'Show machine model'","aria-label":"machineVisible ? 'Hide machine model' : 'Show machine model'"}
  - Context: `<button type="button" title={machineVisible ? 'Hide machine model · collision checks stay active' : 'Show machine model'} aria-label={machineVisible ? 'Hide machine model' : 'Show machine model'} onClick={() => setMachineVisible(value => !value)}>{machineVisible ? <Eye size={14} /> : <EyeOff size={14} />}</button>`

### `fit-view` — Fit geometry to view (view)

Aliases: `Maximize`, `Maximize2`.
- [src/features/cad/CadSketchCanvas.tsx:296] imported `Maximize2` as `Maximize2` (jsx-component); control {"tag":"button","aria-label":"sketch.kind === 'curve' ? 'Fit curve' : 'Fit sketch'"}
  - Context: `<button aria-label={sketch.kind === 'curve' ? 'Fit curve' : 'Fit sketch'} disabled={viewLocked} onClick={fit}><Maximize2 size={14} /></button>`
- [src/features/cad/CadViewport.tsx:468] imported `Maximize2` as `Maximize2` (jsx-component); control {"tag":"button","title":"Fit model","aria-label":"Fit model"}
  - Context: `<button title="Fit model" aria-label="Fit model" disabled={interactionLocked || unavailable} onClick={() => controller.current?.fit()}><Maximize2 size={14} /></button>`
- [src/features/editor/EditorPreview.tsx:1001] imported `Maximize2` as `Maximize2` (jsx-component); control {"tag":"Button","aria-label":"Fit preview to screen","title":"Fit to screen"}
  - Context: `<Button aria-label="Fit preview to screen" disabled={zoom === 1 && pan.x === 0 && pan.y === 0} onClick={handleFitPreview} size="icon" title="Fit to screen" type="button" variant="ghost" > <Maximize2 /> </Button>`
- [src/features/simulation/SimulationViewport.tsx:70] imported `Maximize` as `Maximize` (jsx-component); control {"tag":"button","title":"props.presentation.finalPartOnly ? 'Fit final part' : 'Isometric view · fit stock'","aria-label":"props.presentation.finalPartOnly ? 'Fit final part' : 'Fit simulation stock'"}
  - Context: `<button type="button" title={props.presentation.finalPartOnly ? 'Fit final part' : 'Isometric view · fit stock'} aria-label={props.presentation.finalPartOnly ? 'Fit final part' : 'Fit simulation stock'} onClick={() => withScene(scene => props.presentation.finalPartOnly ? scene.fitPart() : scene.setView('isometric'))}><Maximize size={14} /></button>`
- [src/features/simulation/SimulationViewport.tsx:74] imported `ScanLine` as `ScanLine` (jsx-component); control {"tag":"button","title":"Fit machine and stock","aria-label":"Fit machine model"} — medium: Fit machine and stock into the viewport; the call-site differs from the catalog’s section-view label.
  - Context: `<button type="button" title="Fit machine and stock" aria-label="Fit machine model" onClick={() => withScene(scene => scene.fitMachine())}><ScanLine size={14} /></button>`

### `zoom-in` — Zoom in (view)

Aliases: `ZoomIn`.
- [src/features/editor/EditorPreview.tsx:990] imported `ZoomIn` as `ZoomIn` (jsx-component); control {"tag":"Button","aria-label":"Zoom preview in","title":"Zoom in"}
  - Context: `<Button aria-label="Zoom preview in" disabled={zoom >= MAX_PREVIEW_ZOOM} onClick={() => setZoom((current) => clampZoom(current * PREVIEW_ZOOM_STEP))} size="icon" title="Zoom in" type="button" variant="ghost" > <ZoomIn /> </Button>`

### `zoom-out` — Zoom out (view)

Aliases: `ZoomOut`.
- [src/features/editor/EditorPreview.tsx:976] imported `ZoomOut` as `ZoomOut` (jsx-component); control {"tag":"Button","aria-label":"Zoom preview out","title":"Zoom out"}
  - Context: `<Button aria-label="Zoom preview out" disabled={zoom <= MIN_PREVIEW_ZOOM} onClick={() => setZoom((current) => clampZoom(current / PREVIEW_ZOOM_STEP))} size="icon" title="Zoom out" type="button" variant="ghost" > <ZoomOut /> </Button>`

### `select` — Select geometry (geometry)

Aliases: `MousePointer2`.
- [src/features/editor/EditorInspectorPanel.tsx:1122] imported `MousePointer2` as `MousePointer2` (jsx-component); control {"tag":"button","aria-label":"Select geometry on canvas","aria-pressed":"canvasMouseMode === 'select'","className":"`flex h-6 items-center justify-center gap-1 border px-1.5 text-[10px] outline-none transition hover:bg-accent ${ canvasMouseMode === 'select' ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-muted-foreground' }`"}
  - Context: `<button aria-label="Select geometry on canvas" aria-pressed={canvasMouseMode === 'select'} className={\`flex h-6 items-center justify-center gap-1 border px-1.5 text-[10px] outline-none transition hover:bg-accent ${ canvasMouseMode === 'select' ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-muted-foreground' }\`} data-editor-canvas-mouse-mode-select onClick={() => onSetCanvasMouseMode('select')} type="button" > <MousePointer2 className="size-3" /> Select </button>`
- [src/features/editor/EditorPreview.tsx:948] imported `MousePointer2` as `MousePointer2` (jsx-component); control {"tag":"button","aria-label":"Select geometry on canvas","aria-pressed":"canvasMouseMode === 'select'","className":"`flex size-5 items-center justify-center border text-muted-foreground outline-none transition hover:bg-accent ${ canvasMouseMode === 'select' ? 'border-primary bg-primary text-primary-foreground' : 'border-border' }`","title":"Select geometry"}
  - Context: `<button aria-label="Select geometry on canvas" aria-pressed={canvasMouseMode === 'select'} className={\`flex size-5 items-center justify-center border text-muted-foreground outline-none transition hover:bg-accent ${ canvasMouseMode === 'select' ? 'border-primary bg-primary text-primary-foreground' : 'border-border' }\`} data-editor-preview-mouse-mode-select onClick={() => onSetCanvasMouseMode('select')} title="Select geometry" type="button" > <MousePointer2 className="size-3" /> </button>`
- [src/features/editor/EditorWorkflowSetupPanels.tsx:319] imported `MousePointer2` as `MousePointer2` (jsx-component)
  - Context: `return ( <section className="grid gap-2 text-[10px]" data-upid-set-start-workflow> <p className="text-muted-foreground"> Every operation has an automatic contour start. Pick a closed contour to set an exact override. Picking inside a segment splits it at that point; manual leads then need review. </p> <label className="grid gap-1 uppercase text-muted-foreground"> Target contour <select aria-label="Set start operation" className="h-7 border border-border bg-background px-1.5 text-foreground" disabled={!selected || disabled} onChange={(event) => onSelectOperation(event.currentTarget.value)} value={selected?.id ?? ''} > {operations.map((operation, executionIndex) => operation.closed ? ( <option key={operation.id} value={operation.id}> {String(executionIndex + 1).padStart(2, '0')}. {operation.displayName} </option> ) : null)} </select> </label> <label className="grid gap-1 uppercase text-mut`
- [src/features/editor/EditorWorkflowSetupPanels.tsx:333] imported `MousePointer2` as `MousePointer2` (jsx-component); control {"tag":"button","aria-label":"Pick explicit contour start","className":"buttonClass"}
  - Context: `<button aria-label="Pick explicit contour start" className={buttonClass} disabled={!selected || disabled} onClick={() => selected && onPickStart(selected.id)} type="button" > <MousePointer2 className="size-3" /> Pick explicit start </button>`

### `snap` — Snap to geometry (geometry)

Aliases: `Magnet`.
- [src/features/cad/CadSketchCanvas.tsx:296] imported `Magnet` as `Magnet` (jsx-component); control {"tag":"button","aria-label":"Toggle grid snapping","aria-pressed":"snap"}
  - Context: `<button aria-label="Toggle grid snapping" disabled={viewLocked} aria-pressed={snap} onClick={() => setSnap(!snap)}><Magnet size={14} /></button>`
- [src/features/editor/EditorInspectorPanel.tsx:1104] imported `Magnet` as `Magnet` (jsx-component); control {"tag":"button","aria-label":"Toggle preview grid snap","aria-pressed":"gridSnapEnabled","className":"`inline-flex h-6 items-center gap-1 border px-2 font-mono text-[10px] outline-none transition hover:bg-accent ${ gridSnapEnabled ? 'border-primary text-primary' : 'border-border text-muted-foreground' } ${guideHighlightClass('grid-snap', guideHighlightTarget)}`","title":"previewCoordinateUnits ? `Snap cursor and measurement clicks to the 5 ${previewCoordinateUnits} preview grid` : 'Snap cursor and measurement clicks to the 5 coordinate-unit preview grid. Units are undeclared.'"}
  - Context: `<button aria-label="Toggle preview grid snap" aria-pressed={gridSnapEnabled} className={\`inline-flex h-6 items-center gap-1 border px-2 font-mono text-[10px] outline-none transition hover:bg-accent ${ gridSnapEnabled ? 'border-primary text-primary' : 'border-border text-muted-foreground' } ${guideHighlightClass('grid-snap', guideHighlightTarget)}\`} data-editor-grid-snap {...guideTargetProps('grid-snap', guideHighlightTarget)} onClick={onToggleGridSnap} title={previewCoordinateUnits ? \`Snap cursor and measurement clicks to the 5 ${previewCoordinateUnits} preview grid\` : 'Snap cursor and measurement clicks to the 5 coordinate-unit preview grid. Units are undeclared.'} type="button" > <Magnet className="size-3" /> {gridSnapEnabled ? 'ON' : 'OFF'} </button>`
- [src/features/editor/EditorInspectorPanel.tsx:1137] imported `Magnet` as `Magnet` (jsx-component); control {"tag":"button","aria-label":"Place measurement points on canvas","aria-pressed":"canvasMouseMode === 'point'","className":"`flex h-6 items-center justify-center gap-1 border px-1.5 text-[10px] outline-none transition hover:bg-accent ${ canvasMouseMode === 'point' ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-muted-foreground' }`"}
  - Context: `<button aria-label="Place measurement points on canvas" aria-pressed={canvasMouseMode === 'point'} className={\`flex h-6 items-center justify-center gap-1 border px-1.5 text-[10px] outline-none transition hover:bg-accent ${ canvasMouseMode === 'point' ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-muted-foreground' }\`} data-editor-canvas-mouse-mode-point onClick={() => onSetCanvasMouseMode('point')} type="button" > <Magnet className="size-3" /> Point </button>`
- [src/features/editor/EditorInspectorPanel.tsx:1163] imported `Magnet` as `Magnet` (jsx-component); control {"tag":"button","aria-label":"`Magnetize latest point ${mode}`","aria-pressed":"pathConstructionMode === mode","className":"`flex h-6 items-center justify-center gap-1 border px-1.5 text-[10px] outline-none transition hover:bg-accent ${ pathConstructionMode === mode ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-muted-foreground' }`"}
  - Context: `<button aria-label={\`Magnetize latest point ${mode}\`} aria-pressed={pathConstructionMode === mode} className={\`flex h-6 items-center justify-center gap-1 border px-1.5 text-[10px] outline-none transition hover:bg-accent ${ pathConstructionMode === mode ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-muted-foreground' }\`} disabled={isSaving} key={mode} onClick={() => onActivatePathConstructionMode( pathConstructionMode === mode ? null : mode )} type="button" > <Magnet className="size-3" /> {mode === 'perpendicular' ? 'Perpendicular' : 'Tangent'} </button>`
- [src/features/editor/EditorPreview.tsx:963] imported `Magnet` as `Magnet` (jsx-component); control {"tag":"button","aria-label":"Place measurement points on canvas","aria-pressed":"canvasMouseMode === 'point'","className":"`flex size-5 items-center justify-center border text-muted-foreground outline-none transition hover:bg-accent ${ canvasMouseMode === 'point' ? 'border-primary bg-primary text-primary-foreground' : 'border-border' }`","title":"Place measurement points"}
  - Context: `<button aria-label="Place measurement points on canvas" aria-pressed={canvasMouseMode === 'point'} className={\`flex size-5 items-center justify-center border text-muted-foreground outline-none transition hover:bg-accent ${ canvasMouseMode === 'point' ? 'border-primary bg-primary text-primary-foreground' : 'border-border' }\`} data-editor-preview-mouse-mode-point onClick={() => onSetCanvasMouseMode('point')} title="Place measurement points" type="button" > <Magnet className="size-3" /> </button>`

### `grid` — Construction grid (view)

Aliases: `Grid2X2`.
- [src/features/cad/CadSketchCanvas.tsx:296] imported `Grid2X2` as `Grid2X2` (jsx-component); control {"tag":"button","aria-label":"Toggle sketch grid","aria-pressed":"grid"}
  - Context: `<button aria-label="Toggle sketch grid" disabled={viewLocked} aria-pressed={grid} onClick={() => setGrid(!grid)}><Grid2X2 size={14} /></button>`
- [src/features/cad/CadViewport.tsx:469] imported `Grid2X2` as `Grid2X2` (jsx-component); control {"tag":"button","title":"Toggle grid","aria-label":"Toggle grid","aria-pressed":"gridVisible"}
  - Context: `<button title="Toggle grid" aria-label="Toggle grid" disabled={interactionLocked || unavailable} aria-pressed={gridVisible} onClick={() => controller.current?.setGrid(!gridVisible)}><Grid2X2 size={14} /></button>`

### `origin` — Origin or crosshair (geometry)

Aliases: `Crosshair`.
- [src/features/editor/EditorGuideDialog.tsx:133] imported `Crosshair` as `Crosshair` (jsx-component); control {"tag":"Button"}
  - Context: `<Button data-editor-guide-highlight={step.highlightTarget} onClick={() => onHighlight(step.highlightTarget!)} size="sm" type="button" variant="outline" > <Crosshair /> {copy.highlightLabel} </Button>`

### `circle` — Circle profile (geometry)

Aliases: `Circle`.
- [src/features/cad/CadWorkbench.tsx:374] imported `Circle` as `Circle` (call-argument)
  - Context: `toolButton('Circle', Circle, () => { setTool('circle'); setProfileId(null); }, drawingPending || editorPending, tool === 'circle')`
- [src/features/cad/CadWorkbench.tsx:385] imported `Circle` as `Circle` (jsx-component); control {"tag":"button","className":"`cad-tree-row cad-tree-profile ${entry.id === profileId ? 'is-selected' : ''}`","title":"entry.construction ? 'Construction profile' : 'Closed profile'"}
  - Context: `<button key={entry.id} className={\`cad-tree-row cad-tree-profile ${entry.id === profileId ? 'is-selected' : ''}\`} disabled={locked} title={entry.construction ? 'Construction profile' : 'Closed profile'} onClick={() => { editSketch(feature); setProfileId(entry.id); }}>{entry.geometry.kind === 'circle' ? <Circle size={12} /> : <Square size={12} />}<span>{entry.name}</span></button>`

### `circle-center` — Circle center (geometry)

Aliases: `CircleDot`.
- [src/features/cad/CadWorkbench.tsx:68] imported `CircleDot` as `CircleDot` (object-property-value); variable `featureIcons`; property `fillet`
  - Context: `featureIcons: Record<CadFeature['kind'], LucideIcon> = { 'datum-plane': Square, sketch: PencilRuler, curve: Spline, imported: Box, extrude: Box, pocket: Box, revolve: RotateCw, loft: Layers, sweep: Spline, fillet: CircleDot, chamfer: Scissors, shell: Box, boolean: Layers, transform: Move3D, 'linear-pattern': Copy, 'circular-pattern': RotateCw, mirror: Copy, }`
- [src/features/cad/CadWorkbench.tsx:374] imported `CircleDot` as `CircleDot` (call-argument)
  - Context: `toolButton('Fillet', CircleDot, () => startFeature('fillet'), locked || !hasBody)`

### `rectangle` — Rectangle profile (geometry)

Aliases: `Square`.
- [src/features/cad/CadWorkbench.tsx:68] imported `Square` as `Square` (object-property-value); variable `featureIcons`; property `'datum-plane'`
  - Context: `featureIcons: Record<CadFeature['kind'], LucideIcon> = { 'datum-plane': Square, sketch: PencilRuler, curve: Spline, imported: Box, extrude: Box, pocket: Box, revolve: RotateCw, loft: Layers, sweep: Spline, fillet: CircleDot, chamfer: Scissors, shell: Box, boolean: Layers, transform: Move3D, 'linear-pattern': Copy, 'circular-pattern': RotateCw, mirror: Copy, }`
- [src/features/cad/CadWorkbench.tsx:373] imported `Square` as `Square` (call-argument)
  - Context: `toolButton('Plane', Square, () => startFeature('datum-plane'), locked)`
- [src/features/cad/CadWorkbench.tsx:374] imported `Square` as `Square` (call-argument)
  - Context: `toolButton('Rectangle', Square, () => { setTool('rectangle'); setProfileId(null); }, drawingPending || editorPending, tool === 'rectangle')`
- [src/features/cad/CadWorkbench.tsx:374] imported `Square` as `Square` (call-argument)
  - Context: `toolButton('Slot', Square, () => { setTool('slot'); setProfileId(null); }, drawingPending || editorPending, tool === 'slot')`
- [src/features/cad/CadWorkbench.tsx:382] imported `Square` as `Square` (jsx-component); control {"tag":"button","title":"`Create sketch on ${plane}`"}
  - Context: `<button key={plane} disabled={locked} title={\`Create sketch on ${plane}\`} onClick={() => startFeature('sketch', plane)}><Square size={12} /><span>{plane}</span><Plus size={11} /></button>`
- [src/features/cad/CadWorkbench.tsx:385] imported `Square` as `Square` (jsx-component); control {"tag":"button","className":"`cad-tree-row cad-tree-profile ${entry.id === profileId ? 'is-selected' : ''}`","title":"entry.construction ? 'Construction profile' : 'Closed profile'"}
  - Context: `<button key={entry.id} className={\`cad-tree-row cad-tree-profile ${entry.id === profileId ? 'is-selected' : ''}\`} disabled={locked} title={entry.construction ? 'Construction profile' : 'Closed profile'} onClick={() => { editSketch(feature); setProfileId(entry.id); }}>{entry.geometry.kind === 'circle' ? <Circle size={12} /> : <Square size={12} />}<span>{entry.name}</span></button>`

### `curve` — Reference curve (cad)

Aliases: `Spline`.
- [src/features/cad/CadWorkbench.tsx:68] imported `Spline` as `Spline` (object-property-value); variable `featureIcons`; property `curve`
  - Context: `featureIcons: Record<CadFeature['kind'], LucideIcon> = { 'datum-plane': Square, sketch: PencilRuler, curve: Spline, imported: Box, extrude: Box, pocket: Box, revolve: RotateCw, loft: Layers, sweep: Spline, fillet: CircleDot, chamfer: Scissors, shell: Box, boolean: Layers, transform: Move3D, 'linear-pattern': Copy, 'circular-pattern': RotateCw, mirror: Copy, }`
- [src/features/cad/CadWorkbench.tsx:68] imported `Spline` as `Spline` (object-property-value); variable `featureIcons`; property `sweep`
  - Context: `featureIcons: Record<CadFeature['kind'], LucideIcon> = { 'datum-plane': Square, sketch: PencilRuler, curve: Spline, imported: Box, extrude: Box, pocket: Box, revolve: RotateCw, loft: Layers, sweep: Spline, fillet: CircleDot, chamfer: Scissors, shell: Box, boolean: Layers, transform: Move3D, 'linear-pattern': Copy, 'circular-pattern': RotateCw, mirror: Copy, }`
- [src/features/cad/CadWorkbench.tsx:373] imported `Spline` as `Spline` (call-argument)
  - Context: `toolButton('Curve', Spline, () => startFeature('curve'), locked)`
- [src/features/cad/CadWorkbench.tsx:374] imported `Spline` as `Spline` (call-argument)
  - Context: `toolButton('Sweep', Spline, () => startFeature('sweep'), locked || !activeSketches.some(hasMaterial) || !document.features.some(feature => feature.kind === 'curve' && !feature.suppressed), false, 'Sweep a profile along a reference Curve')`
- [src/features/cad/CadWorkbench.tsx:400] imported `Spline` as `Spline` (jsx-component); control {"tag":"button"}
  - Context: `<button disabled={locked || selected.suppressed} onClick={() => editCurve(selected)}><Spline size={13} /> Edit curve</button>`

### `sketch` — Sketch (cad)

Aliases: `PencilRuler`.
- [src/features/cad/CadWorkbench.tsx:68] imported `PencilRuler` as `PencilRuler` (object-property-value); variable `featureIcons`; property `sketch` — high: Sketch/CAD drawing action.
  - Context: `featureIcons: Record<CadFeature['kind'], LucideIcon> = { 'datum-plane': Square, sketch: PencilRuler, curve: Spline, imported: Box, extrude: Box, pocket: Box, revolve: RotateCw, loft: Layers, sweep: Spline, fillet: CircleDot, chamfer: Scissors, shell: Box, boolean: Layers, transform: Move3D, 'linear-pattern': Copy, 'circular-pattern': RotateCw, mirror: Copy, }`
- [src/features/cad/CadWorkbench.tsx:373] imported `PencilRuler` as `PencilRuler` (call-argument) — high: Sketch/CAD drawing action.
  - Context: `toolButton('Sketch', PencilRuler, () => startFeature('sketch'), locked)`
- [src/features/cad/CadWorkbench.tsx:374] imported `PencilRuler` as `PencilRuler` (call-argument) — high: Sketch/CAD drawing action.
  - Context: `toolButton('Polyline', PencilRuler, () => { setTool('polygon'); setProfileId(null); }, drawingPending || editorPending, tool === 'polygon')`
- [src/features/cad/CadWorkbench.tsx:374] imported `PencilRuler` as `PencilRuler` (call-argument) — high: Sketch/CAD drawing action.
  - Context: `toolButton('Path', PencilRuler, () => { setTool('path'); setProfileId(null); }, drawingPending || editorPending, tool === 'path', 'Draw a closed path with lines and three-point arcs')`
- [src/features/cad/CadWorkbench.tsx:400] imported `PencilRuler` as `PencilRuler` (jsx-component); control {"tag":"button"} — high: Sketch/CAD drawing action.
  - Context: `<button disabled={locked} onClick={() => editSketch(selected)}><PencilRuler size={13} /> Edit sketch</button>`

### `cam-editor` — CAM editor (cam)

Aliases: `PenTool`.
- [src/features/editor/EditorPage.tsx:935] imported `PenTool` as `PenTool` (jsx-component); variable `editorHeaderContent`; property `icon`
  - Context: `editorHeaderContent = useMemo( () => ( <EditorHeaderBar documentContext={documentContext} exportAvailable={exportAvailable} exportLabel={ documentContext === 'machine-program' ? 'Export normalized ISO' : null } filePath={program?.filePath} guideHighlightTarget={guideHighlightTarget} hasUnsavedChanges={hasUnsavedChanges} importErrorMessage={importErrorMessage} interactionLocked={isEditorMutationLocked} isImporting={isImporting} isSaving={isSaving} interpreterProfile={documentContext === 'machine-program' ? interpreterProfile : undefined} onBackToDashboard={handleBackToDashboard} onExport={ documentContext === 'machine-program' ? handleExportNormalizedISO : null } onImportProgramFile={handleImportProgramFile} onInterpreterProfileChange={(profile) => { if (draftState.model !== 'gcode-text') return; applyEditorDraftState({ ...draftState, interpreterProfile: profile }); clearTransientLineStat`

### `body` — Solid body (cad)

Aliases: `Box`.
- [src/features/cad/CadWorkbench.tsx:68] imported `Box` as `Box` (object-property-value); variable `featureIcons`; property `imported` — medium: Imported/extruded solid, Pad-Pocket, or shell feature icon.
  - Context: `featureIcons: Record<CadFeature['kind'], LucideIcon> = { 'datum-plane': Square, sketch: PencilRuler, curve: Spline, imported: Box, extrude: Box, pocket: Box, revolve: RotateCw, loft: Layers, sweep: Spline, fillet: CircleDot, chamfer: Scissors, shell: Box, boolean: Layers, transform: Move3D, 'linear-pattern': Copy, 'circular-pattern': RotateCw, mirror: Copy, }`
- [src/features/cad/CadWorkbench.tsx:68] imported `Box` as `Box` (object-property-value); variable `featureIcons`; property `extrude` — medium: Imported/extruded solid, Pad-Pocket, or shell feature icon.
  - Context: `featureIcons: Record<CadFeature['kind'], LucideIcon> = { 'datum-plane': Square, sketch: PencilRuler, curve: Spline, imported: Box, extrude: Box, pocket: Box, revolve: RotateCw, loft: Layers, sweep: Spline, fillet: CircleDot, chamfer: Scissors, shell: Box, boolean: Layers, transform: Move3D, 'linear-pattern': Copy, 'circular-pattern': RotateCw, mirror: Copy, }`
- [src/features/cad/CadWorkbench.tsx:68] imported `Box` as `Box` (object-property-value); variable `featureIcons`; property `pocket` — medium: Imported/extruded solid, Pad-Pocket, or shell feature icon.
  - Context: `featureIcons: Record<CadFeature['kind'], LucideIcon> = { 'datum-plane': Square, sketch: PencilRuler, curve: Spline, imported: Box, extrude: Box, pocket: Box, revolve: RotateCw, loft: Layers, sweep: Spline, fillet: CircleDot, chamfer: Scissors, shell: Box, boolean: Layers, transform: Move3D, 'linear-pattern': Copy, 'circular-pattern': RotateCw, mirror: Copy, }`
- [src/features/cad/CadWorkbench.tsx:68] imported `Box` as `Box` (object-property-value); variable `featureIcons`; property `shell` — medium: Imported/extruded solid, Pad-Pocket, or shell feature icon.
  - Context: `featureIcons: Record<CadFeature['kind'], LucideIcon> = { 'datum-plane': Square, sketch: PencilRuler, curve: Spline, imported: Box, extrude: Box, pocket: Box, revolve: RotateCw, loft: Layers, sweep: Spline, fillet: CircleDot, chamfer: Scissors, shell: Box, boolean: Layers, transform: Move3D, 'linear-pattern': Copy, 'circular-pattern': RotateCw, mirror: Copy, }`
- [src/features/cad/CadWorkbench.tsx:374] imported `Box` as `Box` (call-argument) — medium: Imported/extruded solid, Pad-Pocket, or shell feature icon.
  - Context: `toolButton('Pad / Pocket', Box, () => startFeature('extrude'), locked || !hasSketch)`
- [src/features/cad/CadWorkbench.tsx:374] imported `Box` as `Box` (call-argument) — medium: Imported/extruded solid, Pad-Pocket, or shell feature icon.
  - Context: `toolButton('Shell', Box, () => startFeature('shell'), locked || !topologyReady || !props.onResolveSelection || topologySelection?.picks[0]?.kind !== 'face')`
- [src/features/simulation/SimulationPanel.tsx:149] imported `Box` as `Box` (jsx-component) — medium: Stock settings and dimensions. The same Box glyph represents CAD solid-body operations, the simulation workspace tab, and a loading illustration in other call sites.
  - Context: `setupButton('stock', 'Stock settings', <><Box size={14} /><span>Stock</span><small>{[settings.stock.width, settings.stock.depth, settings.stock.thickness].map(value => Number(value.toFixed(3))).join(' × ')}</small></>)`

### `layers` — Layer stack (view)

Aliases: `Layers`.
- [src/features/cad/CadWorkbench.tsx:68] imported `Layers` as `Layers` (object-property-value); variable `featureIcons`; property `loft`
  - Context: `featureIcons: Record<CadFeature['kind'], LucideIcon> = { 'datum-plane': Square, sketch: PencilRuler, curve: Spline, imported: Box, extrude: Box, pocket: Box, revolve: RotateCw, loft: Layers, sweep: Spline, fillet: CircleDot, chamfer: Scissors, shell: Box, boolean: Layers, transform: Move3D, 'linear-pattern': Copy, 'circular-pattern': RotateCw, mirror: Copy, }`
- [src/features/cad/CadWorkbench.tsx:68] imported `Layers` as `Layers` (object-property-value); variable `featureIcons`; property `boolean`
  - Context: `featureIcons: Record<CadFeature['kind'], LucideIcon> = { 'datum-plane': Square, sketch: PencilRuler, curve: Spline, imported: Box, extrude: Box, pocket: Box, revolve: RotateCw, loft: Layers, sweep: Spline, fillet: CircleDot, chamfer: Scissors, shell: Box, boolean: Layers, transform: Move3D, 'linear-pattern': Copy, 'circular-pattern': RotateCw, mirror: Copy, }`
- [src/features/cad/CadWorkbench.tsx:374] imported `Layers` as `Layers` (call-argument)
  - Context: `toolButton('Loft', Layers, () => startFeature('loft'), locked || document.features.filter(feature => feature.kind === 'sketch' && !feature.suppressed).length < 2, false, 'Loft through ordered sketch sections')`
- [src/features/cad/CadWorkbench.tsx:374] imported `Layers` as `Layers` (call-argument)
  - Context: `toolButton('Boolean', Layers, () => startFeature('boolean'), locked || currentBodyIds.length < 2)`
- [src/features/cad/CadWorkbench.tsx:381] imported `Layers` as `Layers` (jsx-component); control {"tag":"button","aria-pressed":"tab === 'model'"}
  - Context: `<button aria-pressed={tab === 'model'} disabled={locked} onClick={() => setTab('model')}><Layers size={13} /> Model</button>`

### `move` — Move geometry (geometry)

Aliases: `Move`.
- [src/features/editor/EditorPathNavigatorPanel.tsx:886] imported `Move` as `Move` (jsx-component); control {"tag":"button","aria-label":"activePathTransformTarget === 'document' ? 'Apply translation to document geometry' : 'Apply translation to selected path geometry'","className":"`mt-2 w-full ${textButtonClass}`"}
  - Context: `<button aria-label={ activePathTransformTarget === 'document' ? 'Apply translation to document geometry' : 'Apply translation to selected path geometry' } className={\`mt-2 w-full ${textButtonClass}\`} data-upid-transform-apply disabled={!canTranslateActiveTarget} onClick={() => { if (activePathTransformTarget === 'document') { onTranslatePathDocument({ x: translateX, y: translateY }); } else { onTranslatePathSelection({ x: translateX, y: translateY }); } }} type="button" > <Move className="size-3" /> Apply Translation </button>`

### `move-3d` — Transform body (cad)

Aliases: `Move3D`.
- [src/features/cad/CadWorkbench.tsx:68] imported `Move3D` as `Move3D` (object-property-value); variable `featureIcons`; property `transform`
  - Context: `featureIcons: Record<CadFeature['kind'], LucideIcon> = { 'datum-plane': Square, sketch: PencilRuler, curve: Spline, imported: Box, extrude: Box, pocket: Box, revolve: RotateCw, loft: Layers, sweep: Spline, fillet: CircleDot, chamfer: Scissors, shell: Box, boolean: Layers, transform: Move3D, 'linear-pattern': Copy, 'circular-pattern': RotateCw, mirror: Copy, }`
- [src/features/cad/CadWorkbench.tsx:374] imported `Move3D` as `Move3D` (call-argument)
  - Context: `toolButton('Move', Move3D, () => startFeature('transform'), locked || !hasBody)`

### `flip-horizontal` — Mirror horizontally (geometry)

Aliases: `FlipHorizontal`.
- [src/features/editor/EditorPathNavigatorPanel.tsx:968] imported `FlipHorizontal` as `FlipHorizontal` (jsx-component); control {"tag":"button","aria-label":"`Mirror ${activePathTransformTarget} across Y axis`","className":"iconButtonClass","title":"`Mirror ${activePathTransformTarget} across Y axis`"}
  - Context: `<button aria-label={\`Mirror ${activePathTransformTarget} across Y axis\`} className={iconButtonClass} disabled={!canOrientActiveTarget} onClick={() => activePathTransformTarget === 'document' ? onMirrorPathDocument('y') : onMirrorPathSelection('y') } title={\`Mirror ${activePathTransformTarget} across Y axis\`} type="button" > <FlipHorizontal className="size-3" /> </button>`

### `flip-vertical` — Mirror vertically (geometry)

Aliases: `FlipVertical`.
- [src/features/editor/EditorPathNavigatorPanel.tsx:956] imported `FlipVertical` as `FlipVertical` (jsx-component); control {"tag":"button","aria-label":"`Mirror ${activePathTransformTarget} across X axis`","className":"iconButtonClass","title":"`Mirror ${activePathTransformTarget} across X axis`"}
  - Context: `<button aria-label={\`Mirror ${activePathTransformTarget} across X axis\`} className={iconButtonClass} disabled={!canOrientActiveTarget} onClick={() => activePathTransformTarget === 'document' ? onMirrorPathDocument('x') : onMirrorPathSelection('x') } title={\`Mirror ${activePathTransformTarget} across X axis\`} type="button" > <FlipVertical className="size-3" /> </button>`

### `start-point` — Contour start (cam)

Aliases: `Flag`.
- [src/features/editor/EditorPathNavigatorPanel.tsx:2517] imported `Flag` as `Flag` (jsx-component); control {"tag":"button","aria-label":"`Select ${travelRole} for ${pathElement.displayName}`","aria-pressed":"selected","className":"`flex w-full items-center gap-2 border-l border-border/70 px-2 py-1 text-left text-[10px] text-muted-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring ${ selected ? 'bg-sky-500/15 text-sky-100' : hovered ? 'bg-cyan-500/15 text-cyan-100' : 'hover:bg-accent' }`","title":"`${label}: ${formatPoint(lead.from)} → ${formatPoint(lead.to)}`"}
  - Context: `<button aria-label={\`Select ${travelRole} for ${pathElement.displayName}\`} aria-pressed={selected} className={\`flex w-full items-center gap-2 border-l border-border/70 px-2 py-1 text-left text-[10px] text-muted-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring ${ selected ? 'bg-sky-500/15 text-sky-100' : hovered ? 'bg-cyan-500/15 text-cyan-100' : 'hover:bg-accent' }\`} data-upid-operation-id={pathElement.operationId} data-upid-path-element-id={pathElement.id} data-upid-hovered={hovered ? 'true' : undefined} data-upid-selected={selected ? 'true' : undefined} data-upid-travel-role={travelRole} data-upid-tree-row-action={\`select-${travelRole}\`} data-upid-tree-row-kind={travelRole} data-upid-tree-row-level="1" onBlur={() => onHoverPathElement(null)} onClick={() => onSelectPathElement(element)} onFocus={() => onHoverPathElement(element)} onMouseEnter={() => onHoverPathElemen`

### `pin` — Pin line (cam)

Aliases: `Pin`.
- [src/features/editor/EditorProgramLinesPanel.tsx:143] imported `Pin` as `Pin` (jsx-component); control {"tag":"button","aria-label":"`Pin line ${row.num}`","aria-pressed":"isPinned","className":"`flex items-center justify-center border-l border-border text-muted-foreground opacity-0 outline-none transition hover:bg-accent hover:text-red-300 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 focus-visible:ring-1 focus-visible:ring-ring ${ isPinned ? 'text-red-400 opacity-100' : '' }`","title":"Pin canvas highlight"}
  - Context: `<button aria-label={\`Pin line ${row.num}\`} aria-pressed={isPinned} className={\`flex items-center justify-center border-l border-border text-muted-foreground opacity-0 outline-none transition hover:bg-accent hover:text-red-300 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 focus-visible:ring-1 focus-visible:ring-ring ${ isPinned ? 'text-red-400 opacity-100' : '' }\`} data-editor-pin-line={row.num} onClick={(event) => { event.stopPropagation(); onTogglePin(row.num); }} title="Pin canvas highlight" type="button" > <Pin className="size-3" /> </button>`
- [src/features/editor/EditorProgramLinesPanel.tsx:359] imported `Pin` as `Pin` (jsx-component); control {"tag":"button","aria-label":"Clear pinned line highlights","className":"`flex size-5 shrink-0 items-center justify-center border border-border text-red-400 outline-none transition hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-40 ${guideHighlightClass( 'clear-pins', guideHighlightTarget )}`","title":"Clear pins"}
  - Context: `<button aria-label="Clear pinned line highlights" className={\`flex size-5 shrink-0 items-center justify-center border border-border text-red-400 outline-none transition hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-40 ${guideHighlightClass( 'clear-pins', guideHighlightTarget )}\`} {...guideTargetProps('clear-pins', guideHighlightTarget)} disabled={pinnedLines.length === 0} onClick={onClearPins} title="Clear pins" type="button" > <Pin className="size-3" /> </button>`

### `departure` — Depart from contour (cam)

Aliases: `ArrowRightFromLine`.
- [src/features/editor/EditorInspectorPanel.tsx:1289] imported `ArrowRightFromLine` as `ArrowRightFromLine` (jsx-component); control {"tag":"Button","className":"h-6 px-2 text-[10px]"}
  - Context: `<Button className="h-6 px-2 text-[10px]" disabled={!program || measurementPoints.length === 0 || isSaving} onClick={onInsertMeasurementPoints} size="sm" type="button" variant="outline" > <ArrowRightFromLine /> Insert Points </Button>`
- [src/features/editor/EditorProgramLinesPanel.tsx:344] imported `ArrowRightFromLine` as `ArrowRightFromLine` (jsx-component); control {"tag":"button","className":"flex h-5 shrink-0 items-center gap-1 border border-border px-1.5 font-mono text-[10px] text-muted-foreground outline-none transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"}
  - Context: `<button className="flex h-5 shrink-0 items-center gap-1 border border-border px-1.5 font-mono text-[10px] text-muted-foreground outline-none transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40" disabled={selectedLines.length !== 1 || isSaving} onClick={onSetStartHere} type="button" > <ArrowRightFromLine className="size-3" /> Start Here </button>`

### `turn` — Turn direction (geometry)

Aliases: `CornerDownRight`.
- [src/features/cad/CadWorkbench.tsx:374] imported `CornerDownRight` as `CornerDownRight` (call-argument)
  - Context: `toolButton('Select', CornerDownRight, () => setTool('select'), drawingPending || editorPending, tool === 'select')`

### `trim` — Trim geometry (geometry)

Aliases: `Scissors`.
- [src/features/cad/CadWorkbench.tsx:68] imported `Scissors` as `Scissors` (object-property-value); variable `featureIcons`; property `chamfer`
  - Context: `featureIcons: Record<CadFeature['kind'], LucideIcon> = { 'datum-plane': Square, sketch: PencilRuler, curve: Spline, imported: Box, extrude: Box, pocket: Box, revolve: RotateCw, loft: Layers, sweep: Spline, fillet: CircleDot, chamfer: Scissors, shell: Box, boolean: Layers, transform: Move3D, 'linear-pattern': Copy, 'circular-pattern': RotateCw, mirror: Copy, }`
- [src/features/cad/CadWorkbench.tsx:361] imported `Scissors` as `Scissors` (jsx-component); control {"tag":"button","title":"Create CAM geometry from a planar section"}; variable `header`
  - Context: `<button disabled={locked || !sectionBodyId || !hasSolid || props.buildVersion !== props.documentVersion || Boolean(build?.diagnostics.length)} title="Create CAM geometry from a planar section" onClick={() => sectionBodyId && run(() => props.onSectionForCam?.(sectionBodyId))}><Scissors size={14} /> Section for CAM</button>`
- [src/features/cad/CadWorkbench.tsx:374] imported `Scissors` as `Scissors` (call-argument)
  - Context: `toolButton('Chamfer', Scissors, () => startFeature('chamfer'), locked || !hasBody)`

### `scan` — Inspect bounds (view)

Aliases: `Scan`.
No current production component references map to this ID.

### `section-view` — Section view (view)

Aliases: `ScanLine`.
No current production component references map to this ID.

### `view` — View orientation (view)

Aliases: `View`.
- [src/features/cad/CadViewport.tsx:462] imported `Box` as `Box` (jsx-component) — medium: Named view orientation selector; Box glyph serves as a view control here.
  - Context: `return <div className="cad-viewport"> <div className="cad-webgl" ref={host} aria-label="3D model viewport" /> <div className="cad-view-tools" aria-label="Viewport controls"> <Box size={14} /> <select aria-label="Named view" value={viewName} disabled={interactionLocked || unavailable} onChange={(event) => { const name = (['Isometric', 'Top', 'Front', 'Right'] satisfies CadNamedView[]).find((entry) => entry === event.target.value); if (name) controller.current?.setView?.(name); }}>{viewName === 'Custom' && <option value="Custom" disabled>Custom</option>}{(['Isometric', 'Top', 'Front', 'Right'] satisfies CadNamedView[]).map((name) => <option key={name} value={name}>{name}</option>)}</select> <span className="cad-divider" /> <button title="Fit model" aria-label="Fit model" disabled={interactionLocked || unavailable} onClick={() => controller.current?.fit()}><Maximize2 size={14} /></button> <`
- [src/features/simulation/SimulationViewport.tsx:71] imported `Scan` as `Scan` (jsx-component); control {"tag":"button","title":"Top view","aria-label":"Simulation top view"} — medium: Top view orientation control; context differs from the catalog’s bounds-inspection label.
  - Context: `<button type="button" title="Top view" aria-label="Simulation top view" onClick={() => withScene(scene => scene.setView('top'))}><Scan size={14} /></button>`
- [src/features/simulation/SimulationViewport.tsx:72] imported `View` as `View` (jsx-component); control {"tag":"button","title":"Front view","aria-label":"Simulation front view"}
  - Context: `<button type="button" title="Front view" aria-label="Simulation front view" onClick={() => withScene(scene => scene.setView('front'))}><View size={14} /></button>`

### `panel-left-close` — Hide left panel (navigation)

Aliases: `PanelLeftClose`.
- [src/app/AppShell.tsx:293] imported `PanelLeftClose` as `PanelLeftClose` (jsx-component); control {"tag":"button","aria-label":"sidebarCollapsed ? 'Expand workbench sidebar' : 'Collapse workbench sidebar'","className":"flex size-7 items-center justify-center rounded-[2px] border border-border text-muted-foreground outline-none transition hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring","title":"sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'"}
  - Context: `<button aria-label={sidebarCollapsed ? 'Expand workbench sidebar' : 'Collapse workbench sidebar'} className="flex size-7 items-center justify-center rounded-[2px] border border-border text-muted-foreground outline-none transition hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring" onClick={() => { const nextCollapsed = !sidebarCollapsed; if (railContent.onCollapsedChange) { railContent.onCollapsedChange(nextCollapsed); } else { setShellRailCollapsed(nextCollapsed); } }} title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'} type="button" > {sidebarCollapsed ? ( <PanelLeftOpen className="size-3.5" /> ) : ( <PanelLeftClose className="size-3.5" /> )} </button>`

### `panel-left-open` — Show left panel (navigation)

Aliases: `PanelLeftOpen`.
- [src/app/AppShell.tsx:291] imported `PanelLeftOpen` as `PanelLeftOpen` (jsx-component); control {"tag":"button","aria-label":"sidebarCollapsed ? 'Expand workbench sidebar' : 'Collapse workbench sidebar'","className":"flex size-7 items-center justify-center rounded-[2px] border border-border text-muted-foreground outline-none transition hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring","title":"sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'"}
  - Context: `<button aria-label={sidebarCollapsed ? 'Expand workbench sidebar' : 'Collapse workbench sidebar'} className="flex size-7 items-center justify-center rounded-[2px] border border-border text-muted-foreground outline-none transition hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring" onClick={() => { const nextCollapsed = !sidebarCollapsed; if (railContent.onCollapsedChange) { railContent.onCollapsedChange(nextCollapsed); } else { setShellRailCollapsed(nextCollapsed); } }} title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'} type="button" > {sidebarCollapsed ? ( <PanelLeftOpen className="size-3.5" /> ) : ( <PanelLeftClose className="size-3.5" /> )} </button>`

### `panel-right-close` — Hide right panel (navigation)

Aliases: `PanelRightClose`.
- [src/features/editor/EditorPage.tsx:3744] imported `PanelRightClose` as `PanelRightClose` (jsx-component); control {"tag":"button","aria-label":"Collapse Inspector Rail","title":"Focus preview","className":"hidden size-7 shrink-0 items-center justify-center border border-border text-muted-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring lg:flex"}
  - Context: `<button aria-label="Collapse Inspector Rail" title="Focus preview" type="button" className="hidden size-7 shrink-0 items-center justify-center border border-border text-muted-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring lg:flex" onClick={() => setInspectorRailCollapsed(true)}><PanelRightClose className="size-3.5" /></button>`
- [src/features/editor/EditorWorkspacePanels.tsx:374] imported `PanelRightClose` as `PanelRightClose` (jsx-component); control {"tag":"button","aria-label":"`Collapse ${title}`","className":"flex size-6 items-center justify-center border border-border text-muted-foreground outline-none transition hover:bg-accent hover:text-foreground","title":"`Collapse ${title}`"}
  - Context: `<button aria-label={\`Collapse ${title}\`} className="flex size-6 items-center justify-center border border-border text-muted-foreground outline-none transition hover:bg-accent hover:text-foreground" onClick={onToggleCollapsed} title={\`Collapse ${title}\`} type="button" > <PanelRightClose aria-hidden="true" className="size-3" /> </button>`

### `panel-right-open` — Show right panel (navigation)

Aliases: `PanelRightOpen`.
- [src/features/editor/EditorPage.tsx:3728] imported `PanelRightOpen` as `PanelRightOpen` (jsx-component); control {"tag":"button","aria-label":"Expand Inspector Rail","title":"Show code panels","className":"flex size-7 items-center justify-center border border-border text-muted-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"}
  - Context: `<button aria-label="Expand Inspector Rail" title="Show code panels" type="button" className="flex size-7 items-center justify-center border border-border text-muted-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring" onClick={() => setInspectorRailCollapsed(false)}> <PanelRightOpen className="size-3.5" /> </button>`
- [src/features/editor/EditorWorkspacePanels.tsx:289] imported `PanelRightOpen` as `PanelRightOpen` (declaration-or-reference); variable `ExpandIcon`
  - Context: `ExpandIcon = PanelRightOpen`

### `datum-plane` — Datum plane (cad)

Aliases: none.
No current production component references map to this ID.

### `pad` — Pad (cad)

Aliases: none.
No current production component references map to this ID.

### `pocket` — Pocket (cad)

Aliases: none.
No current production component references map to this ID.

### `pad-pocket` — Pad and Pocket command (cad)

Aliases: none.
No current production component references map to this ID.

### `fillet` — Fillet (cad)

Aliases: none.
No current production component references map to this ID.

### `chamfer` — Chamfer (cad)

Aliases: none.
No current production component references map to this ID.

### `shell` — Shell (cad)

Aliases: none.
No current production component references map to this ID.

### `revolve` — Revolve (cad)

Aliases: none.
No current production component references map to this ID.

### `loft` — Loft (cad)

Aliases: none.
No current production component references map to this ID.

### `sweep` — Sweep (cad)

Aliases: none.
No current production component references map to this ID.

### `boolean` — Boolean operation (cad)

Aliases: none.
No current production component references map to this ID.

### `boolean-union` — Boolean union (cad)

Aliases: none.
No current production component references map to this ID.

### `boolean-subtract` — Boolean subtract (cad)

Aliases: none.
No current production component references map to this ID.

### `boolean-intersect` — Boolean intersect (cad)

Aliases: none.
No current production component references map to this ID.

### `linear-pattern` — Linear pattern (cad)

Aliases: none.
No current production component references map to this ID.

### `circular-pattern` — Circular pattern (cad)

Aliases: none.
No current production component references map to this ID.

### `mirror` — Mirror body (cad)

Aliases: none.
No current production component references map to this ID.

### `imported-body` — Imported body (cad)

Aliases: none.
No current production component references map to this ID.

### `slot` — Slot profile (geometry)

Aliases: none.
No current production component references map to this ID.

### `polyline` — Polyline (geometry)

Aliases: none.
No current production component references map to this ID.

### `closed-path` — Closed path (geometry)

Aliases: none.
No current production component references map to this ID.

### `arc` — Three-point arc (geometry)

Aliases: none.
No current production component references map to this ID.

### `line` — Line (geometry)

Aliases: none.
No current production component references map to this ID.

### `construction` — Construction geometry (geometry)

Aliases: none.
No current production component references map to this ID.

### `measure` — Measure (geometry)

Aliases: none.
No current production component references map to this ID.

### `select-face` — Select face (cad)

Aliases: none.
No current production component references map to this ID.

### `select-edge` — Select edge (cad)

Aliases: none.
No current production component references map to this ID.

### `select-body` — Select body (cad)

Aliases: none.
No current production component references map to this ID.

### `camera-orbit` — Orbit view (view)

Aliases: none.
No current production component references map to this ID.

### `camera-pan` — Pan view (view)

Aliases: none.
No current production component references map to this ID.

### `camera-capture` — Capture view (files)

Aliases: none.
No current production component references map to this ID.

### `send-cam` — Send to CAM (cam)

Aliases: none.
No current production component references map to this ID.

### `section-cam` — Section for CAM (cam)

Aliases: none.
No current production component references map to this ID.

### `suppressed` — Suppressed feature (status)

Aliases: none.
No current production component references map to this ID.

### `dirty` — Unsaved changes (status)

Aliases: none.
No current production component references map to this ID.

### `locked` — Locked (status)

Aliases: none.
No current production component references map to this ID.

### `offset` — Contour offset (cam)

Aliases: none.
No current production component references map to this ID.

### `lead-in` — Lead in (cam)

Aliases: none.
No current production component references map to this ID.

### `lead-out` — Lead out (cam)

Aliases: none.
No current production component references map to this ID.

### `wire` — Wire electrode (simulation)

Aliases: none.
No current production component references map to this ID.

### `simulation` — Machine simulation (simulation)

Aliases: none.
- [src/features/editor/EditorPage.tsx:936] imported `Box` as `Box` (jsx-component); variable `editorHeaderContent`; property `icon` — medium: Simulation workspace tab.
  - Context: `editorHeaderContent = useMemo( () => ( <EditorHeaderBar documentContext={documentContext} exportAvailable={exportAvailable} exportLabel={ documentContext === 'machine-program' ? 'Export normalized ISO' : null } filePath={program?.filePath} guideHighlightTarget={guideHighlightTarget} hasUnsavedChanges={hasUnsavedChanges} importErrorMessage={importErrorMessage} interactionLocked={isEditorMutationLocked} isImporting={isImporting} isSaving={isSaving} interpreterProfile={documentContext === 'machine-program' ? interpreterProfile : undefined} onBackToDashboard={handleBackToDashboard} onExport={ documentContext === 'machine-program' ? handleExportNormalizedISO : null } onImportProgramFile={handleImportProgramFile} onInterpreterProfileChange={(profile) => { if (draftState.model !== 'gcode-text') return; applyEditorDraftState({ ...draftState, interpreterProfile: profile }); clearTransientLineStat`
- [src/features/simulation/SimulationViewport.tsx:78] imported `Box` as `Box` (jsx-component) — low: Loading illustration for the 3D simulation workspace; same Box symbol is used for stock and CAD bodies elsewhere.
  - Context: `return <div className="sim-viewport" data-renderer={status}> <div ref={host} className="sim-render-host" /> <div className="sim-view-controls" aria-label="Simulation camera"> <button type="button" title={props.presentation.finalPartOnly ? 'Fit final part' : 'Isometric view · fit stock'} aria-label={props.presentation.finalPartOnly ? 'Fit final part' : 'Fit simulation stock'} onClick={() => withScene(scene => props.presentation.finalPartOnly ? scene.fitPart() : scene.setView('isometric'))}><Maximize size={14} /></button> <button type="button" title="Top view" aria-label="Simulation top view" onClick={() => withScene(scene => scene.setView('top'))}><Scan size={14} /></button> <button type="button" title="Front view" aria-label="Simulation front view" onClick={() => withScene(scene => scene.setView('front'))}><View size={14} /></button> {props.machine && !props.presentation.finalPartOnly &&`

### `machine-setup` — Machine setup (simulation)

Aliases: none.
- [src/features/simulation/SimulationPanel.tsx:150] imported `FileBox` as `FileBox` (jsx-component) — medium: Machine model settings control; the imported symbol is a box-file glyph, while the semantic action is machine setup.
  - Context: `setupButton('machine', 'Machine model settings', <><FileBox size={14} /><span>Machine</span>{machine && <i aria-label="Model loaded" />}</>)`

### `toolpath` — Cutting path (cam)

Aliases: none.
No current production component references map to this ID.

## Dynamic icon slots

- [src/features/cad/CadWorkbench.tsx:385] JSX renderer `Icon` declared from `featureIcons[feature.kind]` (declaration line 383); map entries: `'datum-plane' → rectangle`, `sketch → sketch`, `curve → curve`, `imported → body`, `extrude → body`, `pocket → body`, `revolve → rotate-clockwise`, `loft → layers`, `sweep → curve`, `fillet → circle-center`, `chamfer → trim`, `shell → body`, `boolean → layers`, `transform → move-3d`, `'linear-pattern' → copy`, `'circular-pattern' → rotate-clockwise`, `mirror → copy`.
- [src/features/cad/CadWorkbench.tsx:393] JSX renderer `Icon` declared from `featureIcons[feature.kind]` (declaration line 393); map entries: `'datum-plane' → rectangle`, `sketch → sketch`, `curve → curve`, `imported → body`, `extrude → body`, `pocket → body`, `revolve → rotate-clockwise`, `loft → layers`, `sweep → curve`, `fillet → circle-center`, `chamfer → trim`, `shell → body`, `boolean → layers`, `transform → move-3d`, `'linear-pattern' → copy`, `'circular-pattern' → rotate-clockwise`, `mirror → copy`.

### Uncertain or context-sensitive mappings

- [src/features/cad/CadViewport.tsx:462] `Box` candidates `body`; proposed `view` (medium). Named view orientation selector; Box glyph serves as a view control here. Context: `return <div className="cad-viewport"> <div className="cad-webgl" ref={host} aria-label="3D model viewport" /> <div className="cad-view-tools" aria-label="Viewport controls"> <Box size={14} /> <select aria-label="Named view" value={viewName} disabled={interactionLocked || unavailable} onChange={(event) => { const name = (['Isometric', 'Top', 'Front', 'Right'] satisfies CadNamedView[]).find((entry) => entry === event.target.value); if (name) controller.current?.setView?.(name); }}>{viewName === 'Custom' && <option value="Custom" disabled>Custom</option>}{(['Isometric', 'Top', 'Front', 'Right'] satisfies CadNamedView[]).map((name) => <option key={name} value={name}>{name}</option>)}</select> <span className="cad-divider" /> <button title="Fit model" aria-label="Fit model" disabled={interactionLocked || unavailable} onClick={() => controller.current?.fit()}><Maximize2 size={14} /></button> <`
- [src/features/cad/CadWorkbench.tsx:68] `Box` candidates `body`; proposed `body` (medium). Imported/extruded solid, Pad-Pocket, or shell feature icon. Context: `featureIcons: Record<CadFeature['kind'], LucideIcon> = { 'datum-plane': Square, sketch: PencilRuler, curve: Spline, imported: Box, extrude: Box, pocket: Box, revolve: RotateCw, loft: Layers, sweep: Spline, fillet: CircleDot, chamfer: Scissors, shell: Box, boolean: Layers, transform: Move3D, 'linear-pattern': Copy, 'circular-pattern': RotateCw, mirror: Copy, }`
- [src/features/cad/CadWorkbench.tsx:68] `Box` candidates `body`; proposed `body` (medium). Imported/extruded solid, Pad-Pocket, or shell feature icon. Context: `featureIcons: Record<CadFeature['kind'], LucideIcon> = { 'datum-plane': Square, sketch: PencilRuler, curve: Spline, imported: Box, extrude: Box, pocket: Box, revolve: RotateCw, loft: Layers, sweep: Spline, fillet: CircleDot, chamfer: Scissors, shell: Box, boolean: Layers, transform: Move3D, 'linear-pattern': Copy, 'circular-pattern': RotateCw, mirror: Copy, }`
- [src/features/cad/CadWorkbench.tsx:68] `Box` candidates `body`; proposed `body` (medium). Imported/extruded solid, Pad-Pocket, or shell feature icon. Context: `featureIcons: Record<CadFeature['kind'], LucideIcon> = { 'datum-plane': Square, sketch: PencilRuler, curve: Spline, imported: Box, extrude: Box, pocket: Box, revolve: RotateCw, loft: Layers, sweep: Spline, fillet: CircleDot, chamfer: Scissors, shell: Box, boolean: Layers, transform: Move3D, 'linear-pattern': Copy, 'circular-pattern': RotateCw, mirror: Copy, }`
- [src/features/cad/CadWorkbench.tsx:68] `Box` candidates `body`; proposed `body` (medium). Imported/extruded solid, Pad-Pocket, or shell feature icon. Context: `featureIcons: Record<CadFeature['kind'], LucideIcon> = { 'datum-plane': Square, sketch: PencilRuler, curve: Spline, imported: Box, extrude: Box, pocket: Box, revolve: RotateCw, loft: Layers, sweep: Spline, fillet: CircleDot, chamfer: Scissors, shell: Box, boolean: Layers, transform: Move3D, 'linear-pattern': Copy, 'circular-pattern': RotateCw, mirror: Copy, }`
- [src/features/cad/CadWorkbench.tsx:374] `Box` candidates `body`; proposed `body` (medium). Imported/extruded solid, Pad-Pocket, or shell feature icon. Context: `toolButton('Pad / Pocket', Box, () => startFeature('extrude'), locked || !hasSketch)`
- [src/features/cad/CadWorkbench.tsx:374] `Box` candidates `body`; proposed `body` (medium). Imported/extruded solid, Pad-Pocket, or shell feature icon. Context: `toolButton('Shell', Box, () => startFeature('shell'), locked || !topologyReady || !props.onResolveSelection || topologySelection?.picks[0]?.kind !== 'face')`
- [src/features/editor/EditorPage.tsx:936] `Box` candidates `body`; proposed `simulation` (medium). Simulation workspace tab. Context: `editorHeaderContent = useMemo( () => ( <EditorHeaderBar documentContext={documentContext} exportAvailable={exportAvailable} exportLabel={ documentContext === 'machine-program' ? 'Export normalized ISO' : null } filePath={program?.filePath} guideHighlightTarget={guideHighlightTarget} hasUnsavedChanges={hasUnsavedChanges} importErrorMessage={importErrorMessage} interactionLocked={isEditorMutationLocked} isImporting={isImporting} isSaving={isSaving} interpreterProfile={documentContext === 'machine-program' ? interpreterProfile : undefined} onBackToDashboard={handleBackToDashboard} onExport={ documentContext === 'machine-program' ? handleExportNormalizedISO : null } onImportProgramFile={handleImportProgramFile} onInterpreterProfileChange={(profile) => { if (draftState.model !== 'gcode-text') return; applyEditorDraftState({ ...draftState, interpreterProfile: profile }); clearTransientLineStat`
- [src/features/simulation/SimulationPanel.tsx:149] `Box` candidates `body`; proposed `body` (medium). Stock settings and dimensions. The same Box glyph represents CAD solid-body operations, the simulation workspace tab, and a loading illustration in other call sites. Context: `setupButton('stock', 'Stock settings', <><Box size={14} /><span>Stock</span><small>{[settings.stock.width, settings.stock.depth, settings.stock.thickness].map(value => Number(value.toFixed(3))).join(' × ')}</small></>)`
- [src/features/simulation/SimulationPanel.tsx:150] `FileBox` candidates `file-body`; proposed `machine-setup` (medium). Machine model settings control; the imported symbol is a box-file glyph, while the semantic action is machine setup. Context: `setupButton('machine', 'Machine model settings', <><FileBox size={14} /><span>Machine</span>{machine && <i aria-label="Model loaded" />}</>)`
- [src/features/simulation/SimulationViewport.tsx:71] `Scan` candidates `scan`; proposed `view` (medium). Top view orientation control; context differs from the catalog’s bounds-inspection label. Context: `<button type="button" title="Top view" aria-label="Simulation top view" onClick={() => withScene(scene => scene.setView('top'))}><Scan size={14} /></button>`
- [src/features/simulation/SimulationViewport.tsx:74] `ScanLine` candidates `section-view`; proposed `fit-view` (medium). Fit machine and stock into the viewport; the call-site differs from the catalog’s section-view label. Context: `<button type="button" title="Fit machine and stock" aria-label="Fit machine model" onClick={() => withScene(scene => scene.fitMachine())}><ScanLine size={14} /></button>`
- [src/features/simulation/SimulationViewport.tsx:78] `Box` candidates `body`; proposed `simulation` (low). Loading illustration for the 3D simulation workspace; same Box symbol is used for stock and CAD bodies elsewhere. Context: `return <div className="sim-viewport" data-renderer={status}> <div ref={host} className="sim-render-host" /> <div className="sim-view-controls" aria-label="Simulation camera"> <button type="button" title={props.presentation.finalPartOnly ? 'Fit final part' : 'Isometric view · fit stock'} aria-label={props.presentation.finalPartOnly ? 'Fit final part' : 'Fit simulation stock'} onClick={() => withScene(scene => props.presentation.finalPartOnly ? scene.fitPart() : scene.setView('isometric'))}><Maximize size={14} /></button> <button type="button" title="Top view" aria-label="Simulation top view" onClick={() => withScene(scene => scene.setView('top'))}><Scan size={14} /></button> <button type="button" title="Front view" aria-label="Simulation front view" onClick={() => withScene(scene => scene.setView('front'))}><View size={14} /></button> {props.machine && !props.presentation.finalPartOnly &&`

## Missing and unused aliases

Catalog aliases not imported in this checkout (1): `Minus`.

No unused Lucide component imports.

## Notes

- Unique alias mappings are proposed from the catalog’s explicit alias list; call-site context is retained for review.
- The repeated `Box` symbol is context-dependent. Simulation stock bounds and CAD solid-body operations share the imported Lucide symbol, so each use is reported with its local meaning and lower confidence.
- This scout covers imported Lucide components. It does not claim coverage of hand-authored SVG/CSS pictures, Unicode glyphs, native controls, or non-Lucide graphics.
