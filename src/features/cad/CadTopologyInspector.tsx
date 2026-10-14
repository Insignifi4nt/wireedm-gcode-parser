import { useEffect, useId, useRef, useState } from 'react';
import type { CadTopologyDescriptor, CadTopologyInspectRequest, CadTopologyInspectResult, CadTopologyPick, CadTopologyPickSet } from '@/domain/cad/cadTopology';
import type { CadPickMode } from './cadTopologyPicking';
import { CadContextHelp } from './CadContextHelp';
import { formatCadLocalizedQuantity } from './cadDisplayQuantity';

export type CadInspectTopology = (request: CadTopologyInspectRequest, expectedVersion: string, signal: AbortSignal) => Promise<CadTopologyInspectResult>;
const number = (value: number) => formatCadLocalizedQuantity(value, 5);
const vector = (point: readonly number[]) => point.map(number).join(', ');

function descriptorName(descriptor: CadTopologyDescriptor): string {
  if (descriptor.kind === 'edge') return descriptor.curveType === 'line' ? 'Straight edge' : descriptor.curveType === 'circle' ? descriptor.closed ? 'Circular edge' : 'Circular arc' : `${descriptor.nativeType} edge`;
  return descriptor.surfaceType === 'plane' ? 'Planar face' : descriptor.surfaceType === 'cylinder' ? 'Cylindrical face' : `${descriptor.nativeType} face`;
}

function TopologyDetails({ descriptor }: { descriptor: CadTopologyDescriptor }) {
  return <><div className="cad-topology-summary"><span>{descriptorName(descriptor)}</span><strong>{descriptor.kind === 'edge' ? <><span className="sr-only">Length </span>{number(descriptor.length)} mm</> : <><span className="sr-only">Area </span>{number(descriptor.area)} mm²</>}</strong></div>
    <details className="cad-topology-measurements" key={descriptor.key}><summary>Measurements</summary><dl className="cad-topology-details">
    <dt>Centroid</dt><dd>{vector(descriptor.centroid)} mm</dd>
    {descriptor.kind === 'edge' && descriptor.curveType !== 'other' && <><dt>Start</dt><dd>{vector(descriptor.start)} mm</dd><dt>End</dt><dd>{vector(descriptor.end)} mm</dd></>}
    {descriptor.kind === 'edge' && descriptor.curveType === 'circle' && <><dt>Radius</dt><dd>{number(descriptor.radius)} mm</dd><dt>Center</dt><dd>{vector(descriptor.center)} mm</dd><dt>Axis</dt><dd>{vector(descriptor.axis)}</dd></>}
    {descriptor.kind === 'face' && descriptor.surfaceType === 'plane' && <><dt>Outward normal</dt><dd>{vector(descriptor.normal)}</dd><dt>Plane offset</dt><dd>{number(descriptor.offset)} mm</dd></>}
    {descriptor.kind === 'face' && descriptor.surfaceType === 'cylinder' && <><dt>Radius</dt><dd>{number(descriptor.radius)} mm</dd><dt>Axis</dt><dd>{vector(descriptor.axis)}</dd></>}
    <dt>Minimum</dt><dd>{vector(descriptor.bounds.min)} mm</dd><dt>Maximum</dt><dd>{vector(descriptor.bounds.max)} mm</dd>
  </dl></details></>;
}

type Inspection = { readonly identity: string; readonly kind: 'loading' }
  | { readonly identity: string; readonly kind: 'error'; readonly message: string }
  | { readonly identity: string; readonly kind: 'ready'; readonly result: CadTopologyInspectResult };

export function CadTopologyInspector({ bodyId, buildId, documentVersion, pickMode, selection, locked, onInspect, onSelect, onClear }: {
  bodyId: string; buildId: string; documentVersion: string; pickMode: CadPickMode;
  selection: CadTopologyPickSet | null; locked: boolean; onInspect: CadInspectTopology;
  onSelect(pick: CadTopologyPick, additive: boolean): void; onClear(): void;
}) {
  const contentId = useId();
  const [browse, setBrowse] = useState(false);
  const [offset, setOffset] = useState(0);
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const callback = useRef(onInspect); callback.current = onInspect;
  const topology = pickMode === 'face' ? 'face' : 'edge';
  const last = selection?.picks.at(-1);
  const disclosureIdentity = JSON.stringify([bodyId, buildId, documentVersion, pickMode, selection]);
  const automaticallyExpanded = pickMode !== 'body' || Boolean(last);
  const [disclosure, setDisclosure] = useState({ identity: disclosureIdentity, expanded: automaticallyExpanded });
  const expanded = disclosure.identity === disclosureIdentity ? disclosure.expanded : automaticallyExpanded;
  const identity = JSON.stringify([bodyId, buildId, documentVersion, topology, expanded, browse, offset, last?.kind, last?.key]);
  useEffect(() => {
    setDisclosure(current => current.identity === disclosureIdentity ? current : { identity: disclosureIdentity, expanded: automaticallyExpanded });
  }, [disclosureIdentity, automaticallyExpanded]);
  useEffect(() => { setOffset(0); setBrowse(false); }, [bodyId, buildId, documentVersion, pickMode]);
  useEffect(() => {
    if (!expanded || !last && !browse) { setInspection(null); return; }
    const abort = new AbortController();
    setInspection({ identity, kind: 'loading' });
    const request: CadTopologyInspectRequest = { bodyId, expectedBuildId: buildId, selection: browse
      ? { kind: 'page', topology, offset, limit: 8 } : { kind: 'picks', picks: last ? [last] : [] } };
    callback.current(request, documentVersion, abort.signal).then((result) => {
      if (abort.signal.aborted) return;
      if (result.bodyId !== bodyId || result.buildId !== buildId) throw new Error('The solid changed during inspection. Select topology again.');
      setInspection({ identity, kind: 'ready', result });
    }).catch((cause: unknown) => { if (!abort.signal.aborted) setInspection({ identity, kind: 'error', message: cause instanceof Error ? cause.message : 'Unable to inspect this topology.' }); });
    return () => abort.abort();
  }, [identity]);
  const current = inspection?.identity === identity ? inspection : null;
  const selectedDescriptor = !browse && current?.kind === 'ready' ? current.result.descriptors[0] : null;
  return <section className="cad-topology-inspector" aria-label="Exact topology inspector">
    <div className="cad-topology-heading"><button type="button" className="cad-topology-disclosure" aria-label="Inspect topology" aria-expanded={expanded} aria-controls={contentId}
      onClick={() => setDisclosure({ identity: disclosureIdentity, expanded: !expanded })}><span aria-hidden="true">{expanded ? '▾' : '▸'}</span> Inspect topology</button>{selection?.picks.length ? <button disabled={locked} onClick={onClear}>Clear selection</button> : null}</div>
    <div id={contentId} className="cad-topology-content" hidden={!expanded}>{expanded && <>
    <div className="cad-topology-actions"><span>{selection?.picks.length ? `${selection.picks.length} ${selection.picks[0].kind}${selection.picks.length === 1 ? '' : 's'}` : 'Selection'}<CadContextHelp label="Topology selection"><dl><dt>On the model</dt><dd>Pick a face or edge. Ctrl or Command adds to the selection.</dd><dt>Exact list</dt><dd>Browse geometry when a face or edge is difficult to reach.</dd><dt>Changes</dt><dd>Selections belong to the current build. Rebuilding requires a new selection.</dd></dl></CadContextHelp></span><button disabled={locked} aria-pressed={browse} onClick={() => { setBrowse(!browse); setOffset(0); }}>{browse ? 'Show selected' : `Browse ${topology === 'edge' ? 'edge' : 'face'}s`}</button></div>
    {current?.kind === 'loading' && <p role="status" className="cad-inspector-note">Inspecting exact geometry…</p>}
    {current?.kind === 'error' && <p role="alert" className="cad-error">{current.message}</p>}
    {selectedDescriptor && <><TopologyDetails descriptor={selectedDescriptor} />{selectedDescriptor.kind === 'edge' && selectedDescriptor.curveType === 'other' && <div className="cad-topology-eligibility">Inspection only<CadContextHelp label="Edge operation eligibility">Selected fillet and chamfer support straight and circular edges. This curve can be inspected.</CadContextHelp></div>}{selectedDescriptor.kind === 'face' && selectedDescriptor.surfaceType !== 'plane' && <div className="cad-topology-eligibility">Shell opening unavailable<CadContextHelp label="Shell opening eligibility">Choose one planar face for an inward shell opening.</CadContextHelp></div>}</>}
    {browse && current?.kind === 'ready' && <><div className="cad-topology-list" aria-label={`Exact ${topology} list`}>{current.result.descriptors.map((descriptor, index) => <button key={descriptor.key} disabled={locked} aria-pressed={Boolean(selection?.picks.some((pick) => pick.key === descriptor.key && pick.kind === descriptor.kind))} onClick={(event) => onSelect({ kind: descriptor.kind, key: descriptor.key }, event.ctrlKey || event.metaKey)}><span>{offset + index + 1}. {descriptorName(descriptor)}</span><small>{number(descriptor.kind === 'edge' ? descriptor.length : descriptor.area)} {descriptor.kind === 'edge' ? 'mm' : 'mm²'}</small></button>)}</div><div className="cad-topology-pagination"><button disabled={offset === 0 || locked} onClick={() => setOffset(Math.max(0, offset - 8))}>Previous</button><span>{current.result.total} {topology === 'edge' ? 'edges' : 'faces'}</span><button disabled={current.result.nextOffset === null || locked} onClick={() => { if (current.result.nextOffset !== null) setOffset(current.result.nextOffset); }}>Next</button></div></>}
    </>}</div>
  </section>;
}
