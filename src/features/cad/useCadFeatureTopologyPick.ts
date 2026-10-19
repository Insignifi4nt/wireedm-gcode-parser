import { userFacingMessage } from '@/lib/userMessage';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { CadDocument, CadMesh } from '@/domain/cad/cadDocument';
import type { CadTopologyPickSet, CadTopologyResolvePicksRequest, CadTopologyResolvePicksResult } from '@/domain/cad/cadTopology';
import type { CadFeatureInputRequest, CadFeatureInputSnapshot } from './cadFeatureInput';
import type { CadFeatureTopologyPickCommand } from './cadFeatureReferencePicking';
import type { CadInspectTopology } from './CadTopologyInspector';
import { mergeTopologySelection, validateTopologySelection, type CadTopologyHit } from './cadTopologyPicking';

export interface CadFeatureInputPicking {
  build(request: CadFeatureInputRequest, version: string, signal: AbortSignal): Promise<CadFeatureInputSnapshot>;
  inspect: (inputToken: string, ...args: Parameters<CadInspectTopology>) => ReturnType<CadInspectTopology>;
  resolve(inputToken: string, request: CadTopologyResolvePicksRequest, version: string, signal: AbortSignal): Promise<CadTopologyResolvePicksResult>;
  release(inputToken: string): void;
}
interface PickState {
  readonly command: CadFeatureTopologyPickCommand;
  readonly source: CadFeatureInputSnapshot | null;
  readonly selection: CadTopologyPickSet | null;
  readonly busy: boolean;
  readonly error: string | null;
}
const noMeshes: readonly CadMesh[] = Object.freeze([]);

/** The feature form owns the draft; this stage owns only its temporary input build and picks. */
export function useCadFeatureTopologyPick(command: CadFeatureTopologyPickCommand | null, document: CadDocument, version: string, operations?: CadFeatureInputPicking) {
  const [state, setState] = useState<PickState | null>(null);
  const environment = useRef({ command, document, version, operations }); environment.current = { command, document, version, operations };
  const job = useRef<{ readonly command: CadFeatureTopologyPickCommand; readonly document: CadDocument; readonly version: string; readonly abort: AbortController; resolving: boolean } | null>(null);
  useEffect(() => {
    if (!command || !operations || command.expectedVersion !== version) { setState(null); return; }
    const owner = { command, document, version, abort: new AbortController(), resolving: false }; job.current = owner;
    let token: string | null = null;
    const current = () => !owner.abort.signal.aborted && environment.current.command === command && environment.current.document === document && environment.current.version === version;
    setState({ command, source: null, selection: null, busy: true, error: null });
    void operations.build(command.request, version, owner.abort.signal).then(source => {
      token = source.inputToken;
      if (!current()) { operations.release(token); return; }
      if (source.documentId !== document.id || source.version !== version || source.featureId !== command.request.featureId || source.bodyId !== command.request.bodyId
        || source.result.diagnostics.length || !source.result.meshes.some(mesh => mesh.featureId === source.bodyId)) throw new Error('The feature input changed. Cancel and choose its geometry again.');
      setState({ command, source, selection: null, busy: false, error: null });
    }).catch((cause: unknown) => { if (current()) setState({ command, source: null, selection: null, busy: false, error: userFacingMessage(cause, 'Unable to show the feature input.') }); });
    return () => { owner.abort.abort(); if (job.current === owner) job.current = null; if (token) operations.release(token); };
  }, [command, document, version, Boolean(operations)]);
  const current = state?.command === command && job.current?.document === document && job.current.version === version && command?.expectedVersion === version ? state : null;
  const source = current?.source ?? null;
  const mode: 'face' | 'edge' = command?.purpose === 'shell' ? 'face' : 'edge';
  const owns = () => Boolean(command && source && operations && job.current?.command === command && job.current.document === document && job.current.version === version && !job.current.abort.signal.aborted
    && environment.current.command === command && environment.current.document === document && environment.current.version === version);
  const inspect: CadInspectTopology = async (request, expectedVersion, signal) => {
    if (!owns() || !source || !operations) throw new Error('The feature input changed. Choose its geometry again.');
    return operations.inspect(source.inputToken, request, expectedVersion, signal);
  };
  const pick = (hit: CadTopologyHit | null, additive: boolean) => {
    if (!owns() || !source || current?.busy) return;
    if (!hit) { setState(previous => previous?.command === command ? { ...previous, selection: null, error: null } : previous); return; }
    try {
      if (hit.bodyId !== source.bodyId || hit.pick.kind !== mode) throw new Error(mode === 'face' ? 'Choose one opening face on the input body.' : 'Choose edges on the input body.');
      const incoming: CadTopologyPickSet = { documentVersion: version, buildId: source.result.buildId, bodyId: source.bodyId, picks: [hit.pick] };
      validateTopologySelection(incoming, { documentVersion: version, buildId: source.result.buildId, meshes: source.result.meshes, ready: true });
      setState(previous => previous?.command === command ? { ...previous, selection: mergeTopologySelection(previous.selection, incoming, additive), error: null } : previous);
    } catch (cause) { setState(previous => previous?.command === command ? { ...previous, error: userFacingMessage(cause, 'Unable to select this geometry.') } : previous); }
  };
  const finish = async () => {
    const selection = current?.selection, owner = job.current;
    if (!owns() || !source || !command || !operations || !owner || owner.resolving || current?.busy || !selection?.picks.length) return;
    owner.resolving = true;
    setState(previous => previous?.command === command ? { ...previous, busy: true, error: null } : previous);
    try {
      const result = await operations.resolve(source.inputToken, { bodyId: source.bodyId, expectedBuildId: source.result.buildId, purpose: command.purpose, picks: selection.picks }, version, owner.abort.signal);
      if (!owns()) return;
      if (result.bodyId !== source.bodyId || result.buildId !== source.result.buildId || result.purpose !== command.purpose) throw new Error('The topology result does not belong to this feature input.');
      command.onSelect(result);
    } catch (cause) { if (owns()) setState(previous => previous?.command === command ? { ...previous, busy: false, error: userFacingMessage(cause, 'Unable to use this selection.') } : previous); }
    finally { owner.resolving = false; }
  };
  const meshes = useMemo(() => source?.result.meshes.filter(mesh => mesh.featureId === source.bodyId) ?? noMeshes, [source]);
  return { source, mode, selection: current?.selection ?? null, busy: current?.busy ?? true, error: current?.error ?? null,
    meshes, inspect, pick, finish };
}
