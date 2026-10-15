import { Tooltip } from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { AdjustIcon, BooleanIcon, ChamferIcon, CircleIcon, CircularPatternIcon, ClosedPathIcon, CurveIcon, DatumPlaneIcon, ExpandRightIcon, FileBodyIcon, FilletIcon, ImportedBodyIcon, LayersIcon, LinearPatternIcon, LoftIcon, MirrorIcon, Move3dIcon, PadIcon, PluginIcon, PocketIcon, RectangleIcon, RevolveIcon, ShellIcon, SketchIcon, SlotIcon, SweepIcon, WarningIcon, type WorkbenchIconComponent } from '@wire-edm/icons-react';
import type { CadBuildResult, CadCurveFeature, CadDocument, CadFeature, CadPlane, CadSketchFeature, CadSketchProfile } from '@/domain/cad/cadDocument';
import { cadFeatureDependencies } from '@/domain/cad/cadFeatureInputs';
import { featureLabels } from './CadFeatureEditor';
import { CadContextMenu, type CadContextMenuAnchor, type CadContextMenuItem } from './CadContextMenu';
import { CadTreeRename } from './CadTreeRename';
import './cad-feature-tree.css';

const icons: Record<CadFeature['kind'], WorkbenchIconComponent> = {
  'datum-plane': DatumPlaneIcon, sketch: SketchIcon, curve: CurveIcon, imported: ImportedBodyIcon, extrude: PadIcon, pocket: PocketIcon, revolve: RevolveIcon,
  loft: LoftIcon, sweep: SweepIcon, fillet: FilletIcon, chamfer: ChamferIcon, shell: ShellIcon, boolean: BooleanIcon, transform: Move3dIcon,
  'linear-pattern': LinearPatternIcon, 'circular-pattern': CircularPatternIcon, mirror: MirrorIcon,
};
const profileIcons: Record<CadSketchProfile['geometry']['kind'], WorkbenchIconComponent> = {
  rectangle: RectangleIcon, circle: CircleIcon, slot: SlotIcon, polygon: ClosedPathIcon, path: ClosedPathIcon, plugin: PluginIcon,
};
type TreeTarget = { kind: 'feature'; featureId: string } | { kind: 'profile'; featureId: string; profileId: string };
type TreeBranch = 'part' | 'model' | 'reference' | 'parameters';
export interface CadFeatureTreeProps {
  document: CadDocument;
  diagnostics?: CadBuildResult['diagnostics'];
  selectedId: string | null;
  selectedProfileId: string | null;
  locked: boolean;
  /** Reference picker owns row selection; no nested profile or editor actions. */
  selectionOnly?: boolean;
  selectableFeatureIds?: readonly string[];
  /** A sketch-plane request may select principal rows as well as eligible datums. */
  allowPrincipalPlaneSelection?: boolean;
  highlightedFeatureIds?: readonly string[];
  onSelect(id: string): void;
  onEditSketch(feature: CadSketchFeature): void;
  onEditCurve(feature: CadCurveFeature): void;
  onSelectProfile(sketch: CadSketchFeature, profileId: string): void;
  onSuppress?(feature: CadFeature, suppressed: boolean): void;
  onDelete?(feature: CadFeature): void;
  onUpdateProfile?(sketch: CadSketchFeature, profile: CadSketchProfile): void;
  onDeleteProfile?(sketch: CadSketchFeature, profileId: string): void;
  onContextMenuOpenChange?(open: boolean): void;
  onRename?(feature: CadFeature, name: string, profileId?: string): void;
  onRenamePendingChange?(pending: boolean): void;
  cancelSignal?: number;
  onCreateSketch?(plane: CadPlane): void;
  selectedReferencePlane?: CadPlane | null;
  onSelectReferencePlane?(plane: CadPlane): void;
  /** Real parameter operations supplied by the workbench, mounted when expanded. */
  parameterContent?: ReactNode;
}

/** One ordered model history, with links taken from the same reference model as rebuild. */
export function CadFeatureTree({ document, diagnostics = [], selectedId, selectedProfileId, locked, selectionOnly = false, highlightedFeatureIds = [], onSelect, onEditSketch, onEditCurve, onSelectProfile,
  selectableFeatureIds, allowPrincipalPlaneSelection = false, onSuppress, onDelete, onUpdateProfile, onDeleteProfile, onContextMenuOpenChange, onRename, onRenamePendingChange, cancelSignal = 0, onCreateSketch, selectedReferencePlane, onSelectReferencePlane, parameterContent }: CadFeatureTreeProps) {
  const treeId = useId();
  const tree = useRef<HTMLOListElement>(null), returnFocus = useRef<{ documentId: string; target: TreeTarget } | null>(null);
  const pendingCallback = useRef(onRenamePendingChange); pendingCallback.current = onRenamePendingChange;
  const [treeView, setTreeView] = useState<{ selectedId: string | null; expanded: ReadonlySet<string>; branches: ReadonlySet<TreeBranch> }>(() => ({
    selectedId, expanded: new Set(selectedId ? [selectedId] : []), branches: new Set(['part', 'model']),
  }));
  // Reveal selection before sibling views read the tree for their initial Fit.
  // Remember the selection so ordinary rerenders preserve manual collapse.
  if (treeView.selectedId !== selectedId) setTreeView({
    selectedId,
    expanded: selectedId && !treeView.expanded.has(selectedId) ? new Set([...treeView.expanded, selectedId]) : treeView.expanded,
    branches: selectedId && (!treeView.branches.has('part') || !treeView.branches.has('model')) ? new Set([...treeView.branches, 'part', 'model']) : treeView.branches,
  });
  const { expanded, branches } = treeView;
  const [rename, setRename] = useState<{ document: CadDocument; cancelSignal: number; target: TreeTarget } | null>(null);
  const renameCurrent = !locked && !selectionOnly && rename?.document === document && rename.cancelSignal === cancelSignal ? rename : null;
  const [menu, setMenu] = useState<{ document: CadDocument; featureId: string; profileId?: string; anchor: CadContextMenuAnchor } | null>(null);
  const menuCurrent = !locked && !selectionOnly && !renameCurrent && menu?.document === document ? menu : null;
  const selectable = useMemo(() => selectionOnly && selectableFeatureIds ? new Set(selectableFeatureIds) : null, [selectionOnly, selectableFeatureIds]);
  const selectionDisabled = (id: string) => locked || Boolean(renameCurrent) || selectable !== null && !selectable.has(id);
  useLayoutEffect(() => { onContextMenuOpenChange?.(Boolean(menuCurrent)); return () => onContextMenuOpenChange?.(false); }, [Boolean(menuCurrent), onContextMenuOpenChange]);
  useEffect(() => { setMenu(null); }, [document, locked, selectionOnly, cancelSignal]);
  useEffect(() => { setRename(null); }, [document, locked, selectionOnly, cancelSignal]);
  useEffect(() => () => pendingCallback.current?.(false), []);
  useLayoutEffect(() => {
    onRenamePendingChange?.(Boolean(renameCurrent));
    if (renameCurrent || !returnFocus.current) return;
    const saved = returnFocus.current; returnFocus.current = null;
    if (saved.documentId !== document.id) return;
    const target = saved.target;
    const node = [...tree.current?.querySelectorAll<HTMLElement>('[data-cad-feature-id]') ?? []].find(node => node.dataset.cadFeatureId === target.featureId);
    const row = target.kind === 'feature' ? node?.querySelector<HTMLButtonElement>('.cad-feature-history-row > .cad-tree-row')
      : [...node?.querySelectorAll<HTMLButtonElement>('[data-cad-profile-id]') ?? []].find(row => row.dataset.cadProfileId === target.profileId);
    row?.focus({ preventScroll: true });
  }, [Boolean(renameCurrent), onRenamePendingChange, document.id]);
  const relationships = useMemo(() => {
    const byId = new Map(document.features.map(feature => [feature.id, feature]));
    const downstream = new Map<string, CadFeature[]>();
    for (const feature of document.features) for (const id of new Set(cadFeatureDependencies(feature))) {
      const usages = downstream.get(id) ?? []; usages.push(feature); downstream.set(id, usages);
    }
    return { byId, downstream };
  }, [document.features]);
  const toggle = (id: string) => setTreeView(previous => {
    const expanded = new Set(previous.expanded); if (expanded.has(id)) expanded.delete(id); else expanded.add(id); return { ...previous, expanded };
  });
  const toggleBranch = (branch: TreeBranch) => setTreeView(previous => {
    const branches = new Set(previous.branches); if (branches.has(branch)) branches.delete(branch); else branches.add(branch); return { ...previous, branches };
  });
  const beginRename = (target: TreeTarget) => {
    if (locked || selectionOnly || renameCurrent || !onRename) return;
    returnFocus.current = { documentId: document.id, target };
    setMenu(null); setRename({ document, cancelSignal, target });
  };
  const renameEditor = (feature: CadFeature, profile?: CadSketchProfile) => <CadTreeRename kind={profile ? 'profile' : 'feature'} initialName={profile?.name ?? feature.name}
    onCancel={() => setRename(null)} onAccept={name => {
      if (!renameCurrent || !onRename) return;
      if (name !== (profile?.name ?? feature.name)) onRename(feature, name, profile?.id);
      setRename(null);
    }} />;
  const openMenu = (event: MouseEvent<HTMLButtonElement> | KeyboardEvent<HTMLButtonElement>, featureId: string, profileId?: string) => {
    if ('key' in event && event.key === 'F2' && onRename) {
      event.preventDefault(); event.stopPropagation();
      beginRename(profileId === undefined ? { kind: 'feature', featureId } : { kind: 'profile', featureId, profileId }); return;
    }
    if ('key' in event && event.key !== 'ContextMenu' && !(event.key === 'F10' && event.shiftKey)) return;
    event.preventDefault(); event.stopPropagation();
    if (locked || selectionOnly || renameCurrent) return;
    event.currentTarget.focus();
    const bounds = event.currentTarget.getBoundingClientRect();
    const anchor = 'clientX' in event && (event.clientX || event.clientY) ? { x: event.clientX, y: event.clientY } : { x: bounds.left, y: bounds.bottom };
    setMenu({ document, featureId, profileId, anchor });
  };
  const menuFeature = menuCurrent ? relationships.byId.get(menuCurrent.featureId) : undefined;
  const menuProfile = menuFeature?.kind === 'sketch' ? menuFeature.profiles.find(profile => profile.id === menuCurrent?.profileId) : undefined;
  const menuItems: CadContextMenuItem[] = [];
  if (menuFeature) {
    if (menuProfile && menuFeature.kind === 'sketch') {
      const sketch = menuFeature, profile = menuProfile;
      menuItems.push({ label: 'Configure profile', onSelect: () => onSelectProfile(sketch, profile.id) },
        { label: 'Edit sketch', onSelect: () => onEditSketch(sketch) });
      if (onRename) menuItems.push({ label: 'Rename profile', onSelect: () => beginRename({ kind: 'profile', featureId: sketch.id, profileId: profile.id }) });
      if (onUpdateProfile) menuItems.push({ label: profile.construction ? 'Use as geometry' : 'Use as construction', onSelect: () => onUpdateProfile(sketch, { ...profile, construction: !profile.construction }) });
      if (onDeleteProfile) menuItems.push({ kind: 'separator' }, { label: 'Delete profile', danger: true, onSelect: () => onDeleteProfile(sketch, profile.id) });
    } else {
      const feature = menuFeature;
      menuItems.push(feature.kind === 'sketch' ? { label: 'Edit sketch', onSelect: () => onEditSketch(feature) }
        : feature.kind === 'curve' ? { label: 'Edit curve', onSelect: () => onEditCurve(feature) }
          : { label: 'Configure feature', onSelect: () => onSelect(feature.id) });
      if (onRename) menuItems.push({ label: 'Rename feature', onSelect: () => beginRename({ kind: 'feature', featureId: feature.id }) });
      const inputs = cadFeatureDependencies(feature).flatMap(id => { const source = relationships.byId.get(id); return source ? [source] : []; });
      if (inputs.length || relationships.downstream.get(feature.id)?.length || feature.kind === 'sketch' && feature.profiles.length) {
        menuItems.push({ label: expanded.has(feature.id) ? 'Collapse details' : 'Expand details', onSelect: () => toggle(feature.id) });
      }
      if (inputs.length) menuItems.push({ kind: 'separator' }, ...inputs.map(source => ({ label: `Select input · ${source.name}`, onSelect: () => onSelect(source.id) })));
      if (onSuppress) menuItems.push({ kind: 'separator' }, { label: feature.suppressed ? 'Resume feature' : 'Suppress feature', onSelect: () => onSuppress(feature, !feature.suppressed) });
      if (onDelete) menuItems.push({ label: 'Delete feature', danger: true, onSelect: () => onDelete(feature) });
    }
  }
  const dependency = (feature: CadFeature, direction: 'input' | 'usage') => <Button type="button" key={feature.id} className={`cad-feature-reference${feature.suppressed ? ' is-suppressed' : ''}`}
    disabled={selectionDisabled(feature.id)} aria-label={`Select ${direction === 'input' ? 'input' : 'dependent feature'} ${feature.name}`} title={`${featureLabels[feature.kind]} · ${feature.name}${feature.suppressed ? ' · suppressed' : ''}`} onClick={() => onSelect(feature.id)}>
    <span>{feature.name}</span>{feature.suppressed && <small>off</small>}
  </Button>;
  return <><div className="cad-specification-tree" aria-label="Part specification tree">
    <Button type="button" className="cad-tree-document" disabled={locked || Boolean(renameCurrent)} aria-label={`${branches.has('part') ? 'Collapse' : 'Expand'} part ${document.name}`}
      aria-expanded={branches.has('part')} aria-controls={branches.has('part') ? `${treeId}-part` : undefined} onClick={() => toggleBranch('part')}>
      <ExpandRightIcon size={12} className="cad-tree-hierarchy-toggle" /><FileBodyIcon size={15} /><span>{document.name}</span>
    </Button>
    {branches.has('part') && <div id={`${treeId}-part`} className="cad-tree-document-children">
      <Button type="button" className="cad-tree-branch" disabled={locked || Boolean(renameCurrent)} aria-label={`${branches.has('reference') ? 'Collapse' : 'Expand'} Reference`}
        aria-expanded={branches.has('reference')} aria-controls={branches.has('reference') ? `${treeId}-reference` : undefined} onClick={() => toggleBranch('reference')}>
        <ExpandRightIcon size={12} className="cad-tree-hierarchy-toggle" /><DatumPlaneIcon size={13} /><span>Reference</span>
      </Button>
      {branches.has('reference') && <ul id={`${treeId}-reference`} className="cad-reference-plane-list" aria-label="Reference planes">
        {(['XY', 'XZ', 'YZ'] satisfies CadPlane[]).map(plane => <li key={plane}><Button type="button" className={`cad-tree-row${selectedReferencePlane === plane ? ' is-selected' : ''}`} aria-label={`Select ${plane} plane`} aria-pressed={selectedReferencePlane === plane}
          disabled={locked || selectionOnly && !allowPrincipalPlaneSelection || Boolean(renameCurrent) || !onSelectReferencePlane} onClick={() => onSelectReferencePlane?.(plane)}><DatumPlaneIcon size={12} /><span>{plane} plane</span></Button>{onCreateSketch && <Button type="button" disabled={locked || selectionOnly || Boolean(renameCurrent)}
          aria-label={`Create sketch on ${plane} plane`} title={`Create sketch on ${plane} plane`} onClick={() => onCreateSketch(plane)}><SketchIcon size={12} /></Button>}</li>)}
      </ul>}
      {parameterContent !== undefined && parameterContent !== null && parameterContent !== false && <>
        <Button type="button" className="cad-tree-branch" disabled={locked || Boolean(renameCurrent)} aria-label={`${branches.has('parameters') ? 'Collapse' : 'Expand'} Parameters`}
          aria-expanded={branches.has('parameters')} aria-controls={branches.has('parameters') ? `${treeId}-parameters` : undefined} onClick={() => toggleBranch('parameters')}>
          <ExpandRightIcon size={12} className="cad-tree-hierarchy-toggle" /><AdjustIcon size={13} /><span>Parameters</span>
        </Button>
        {branches.has('parameters') && <div id={`${treeId}-parameters`} className="cad-tree-parameters">{parameterContent}</div>}
      </>}
      <Button type="button" className="cad-tree-branch" disabled={locked || Boolean(renameCurrent)} aria-label={`${branches.has('model') ? 'Collapse' : 'Expand'} Model`}
        aria-expanded={branches.has('model')} aria-controls={branches.has('model') ? `${treeId}-model` : undefined} onClick={() => toggleBranch('model')}>
        <ExpandRightIcon size={12} className="cad-tree-hierarchy-toggle" /><LayersIcon size={13} /><span>Model</span><small aria-label={`${document.features.length} features`}>{document.features.length}</small>
      </Button>
      {branches.has('model') && <ol ref={tree} id={`${treeId}-model`} className="cad-feature-list cad-feature-history" aria-label="Feature history and dependencies">
    {document.features.map((feature, index) => {
      const Icon = icons[feature.kind], selected = selectedId === feature.id;
      const inputs = [...new Set(cadFeatureDependencies(feature))], usages = relationships.downstream.get(feature.id) ?? [];
      const profiles = feature.kind === 'sketch' ? feature.profiles : [];
      const profileSelected = selected && profiles.some(profile => profile.id === selectedProfileId);
      const expandable = inputs.length > 0 || usages.length > 0 || profiles.length > 0;
      const open = expanded.has(feature.id), detailsId = `${treeId}-${index}`;
      const diagnostic = diagnostics.find(diagnostic => diagnostic.featureId === feature.id);
      return <li key={feature.id} className={`cad-feature-node${highlightedFeatureIds.includes(feature.id) ? ' is-parameter-related' : ''}`} data-cad-feature-id={feature.id} data-cad-history-position={index + 1}>
        <div className="cad-feature-history-row">
          {expandable ? <Button type="button" className="cad-feature-disclosure" disabled={locked || Boolean(renameCurrent)} aria-label={`${open ? 'Collapse' : 'Expand'} ${feature.name}`} aria-expanded={open} aria-controls={open ? detailsId : undefined} onClick={() => toggle(feature.id)}><ExpandRightIcon size={12} /></Button>
            : <span className="cad-feature-disclosure-placeholder" aria-hidden="true" />}
          {renameCurrent?.target.kind === 'feature' && renameCurrent.target.featureId === feature.id ? renameEditor(feature) : <Button type="button" className={`cad-tree-row${profileSelected ? ' is-context' : selected ? ' is-selected' : ''}${feature.suppressed ? ' is-suppressed' : ''}${diagnostic ? ' has-error' : ''}`} disabled={selectionDisabled(feature.id)}
            aria-label={`Select ${feature.name} in history`} aria-pressed={selected && !profileSelected} title={`${featureLabels[feature.kind]} · ${feature.name}${diagnostic ? ` · ${diagnostic.message}` : ''}`}
            onContextMenu={event => openMenu(event, feature.id)} onKeyDown={event => openMenu(event, feature.id)}
            onClick={() => onSelect(feature.id)} onDoubleClick={() => { if (selectionOnly) return; if (feature.kind === 'sketch') onEditSketch(feature); else if (feature.kind === 'curve') onEditCurve(feature); }}>
            <Icon size={14} /><span className="cad-feature-name">{feature.name}</span>
            {diagnostic && <span className="cad-tree-error" aria-label={diagnostic.message}><WarningIcon size={12} /></span>}{feature.suppressed && <span className="cad-tree-muted">off</span>}
          </Button>}
        </div>
        {expandable && open && <div id={detailsId} className="cad-feature-details">
          {feature.kind === 'sketch' && feature.profiles.map(profile => {
            const ProfileIcon = profileIcons[profile.geometry.kind];
            return renameCurrent?.target.kind === 'profile' && renameCurrent.target.featureId === feature.id && renameCurrent.target.profileId === profile.id ? <div key={profile.id}>{renameEditor(feature, profile)}</div> : <Button type="button" key={profile.id} data-cad-profile-id={profile.id} className={`cad-tree-row cad-tree-profile${selected && selectedProfileId === profile.id ? ' is-selected' : ''}`} disabled={locked || selectionOnly || Boolean(renameCurrent)}
            aria-label={`${profile.name} profile`} aria-pressed={selected && selectedProfileId === profile.id} title={`${profile.construction ? 'Construction profile' : 'Closed profile'} · ${profile.name}`} onClick={() => onSelectProfile(feature, profile.id)}
            onContextMenu={event => openMenu(event, feature.id, profile.id)} onKeyDown={event => openMenu(event, feature.id, profile.id)}>
            <ProfileIcon size={11} /><span>{profile.name}</span>{profile.construction && <small>ref</small>}
          </Button>;
          })}
          {inputs.length > 0 && <div className="cad-feature-relations"><span className="cad-feature-relation-label">Inputs</span><div>{inputs.map(id => {
            const source = relationships.byId.get(id);
            return source ? dependency(source, 'input') : <Tooltip content={`Missing feature ${id}`} key={id}><span key={id} className="cad-feature-missing-reference" >{id} (missing)</span></Tooltip>;
          })}</div></div>}
          {usages.length > 0 && <div className="cad-feature-relations"><span className="cad-feature-relation-label">Used by</span><div>{usages.map(feature => dependency(feature, 'usage'))}</div></div>}
        </div>}
      </li>;
    })}
    {!document.features.length && <li className="cad-tree-empty">No features yet.<br />Create a sketch to begin.</li>}
      </ol>}
    </div>}
  </div>{menuCurrent && menuFeature && <CadContextMenu anchor={menuCurrent.anchor} title={menuProfile?.name ?? menuFeature.name} items={menuItems} onClose={() => setMenu(null)} />}</>;
}
