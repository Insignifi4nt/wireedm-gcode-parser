import { userFacingMessage } from '@/lib/userMessage';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { CadDocument, CadMesh } from '@/domain/cad/cadDocument';
import type { CadTopologyPick, CadTopologyPickSet, CadTopologyResolvePicksRequest, CadTopologyResolvePicksResult } from '@/domain/cad/cadTopology';
import { cadTopologyChainPicks, type CadTopologyChainGesture } from '@/domain/cad/selection/cadTopologySelection';
import type { CadFeatureInputRequest, CadFeatureInputSnapshot } from './cadFeatureInput';
import type { CadTopologyAdjacency, CadTopologyAdjacencyRequest } from '@/domain/cad/cadTopologyAdjacency';
import type { CadFeatureTopologyPickCommand } from './cadFeatureReferencePicking';
import type { CadInspectTopology } from './CadTopologyInspector';
import { mergeTopologySelection, validateTopologySelection, type CadTopologyHit } from './cadTopologyPicking';

export interface CadFeatureInputPicking {
  build(request: CadFeatureInputRequest, version: string, signal: AbortSignal): Promise<CadFeatureInputSnapshot>;
  inspect: (inputToken: string, ...args: Parameters<CadInspectTopology>) => ReturnType<CadInspectTopology>;
  resolve(inputToken: string, request: CadTopologyResolvePicksRequest, version: string, signal: AbortSignal): Promise<CadTopologyResolvePicksResult>;
  /** How the input body's edges and faces meet, for chains; optional so a caller without chains still picks single elements. */
  adjacency?(inputToken: string, request: CadTopologyAdjacencyRequest, version: string, signal: AbortSignal): Promise<CadTopologyAdjacency>;
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
  // Each pick, clear, box and chain request takes the next number; a chain answered after a later one is dropped.
  const request = useRef(0);
  const fail = (cause: unknown) => setState(previous => previous?.command === command ? { ...previous, error: userFacingMessage(cause, 'Unable to select this geometry.') } : previous);
  /** Puts picks on the input body into the selection; a Shell opening is one face, so it always replaces. */
  const take = (bodyId: string, picks: readonly CadTopologyPick[], merge: boolean | 'union') => {
    if (!source) return;
    if (bodyId !== source.bodyId || picks.some(item => item.kind !== mode)) throw new Error(mode === 'face' ? 'Choose one opening face on the input body.' : 'Choose edges on the input body.');
    const incoming: CadTopologyPickSet = { documentVersion: version, buildId: source.result.buildId, bodyId: source.bodyId, picks };
    validateTopologySelection(incoming, { documentVersion: version, buildId: source.result.buildId, meshes: source.result.meshes, ready: true });
    if (mode === 'face' && picks.length !== 1) throw new Error('Choose one opening face on the input body.');
    setState(previous => previous?.command === command ? { ...previous, selection: mergeTopologySelection(previous.selection, incoming, mode === 'face' ? false : merge), error: null } : previous);
  };
  const pick = (hit: CadTopologyHit | null, additive: boolean) => {
    if (!owns() || !source || current?.busy) return;
    request.current++;
    if (!hit) { setState(previous => previous?.command === command ? { ...previous, selection: null, error: null } : previous); return; }
    try { take(hit.bodyId, [hit.pick], additive); } catch (cause) { fail(cause); }
  };
  /** Replaces the picks with these, as a box or Select other chooses them. */
  const set = (bodyId: string, picks: readonly CadTopologyPick[]) => {
    if (!owns() || !source || current?.busy) return;
    request.current++;
    try { take(bodyId, picks, false); } catch (cause) { fail(cause); }
  };
  // The input body's adjacency, read once per input build when a chain first asks for it.
  const adjacencyRead = useRef<{ readonly source: CadFeatureInputSnapshot; readonly promise: Promise<CadTopologyAdjacency> } | null>(null);
  const latestSource = useRef(source); latestSource.current = source;
  /** Selects the loop or tangent chain through an edge from the input body's adjacency; a Shell opening takes the one face picked. */
  const chain = (hit: CadTopologyHit, gesture: CadTopologyChainGesture, additive: boolean, faceKey: string | null) => {
    const owner = job.current;
    if (!owns() || !source || !operations || !owner || current?.busy) return;
    if (mode === 'face' || !operations.adjacency) { pick(hit, additive); return; }
    if (hit.bodyId !== source.bodyId || hit.pick.kind !== mode) { fail(new Error('Choose edges on the input body.')); return; }
    const ticket = ++request.current, stale = () => !owns() || latestSource.current !== source || job.current !== owner || request.current !== ticket;
    const kept = adjacencyRead.current?.source === source ? adjacencyRead.current.promise : null;
    const promise = kept ?? operations.adjacency(source.inputToken, { bodyId: source.bodyId, expectedBuildId: source.result.buildId }, version, owner.abort.signal);
    if (!kept) adjacencyRead.current = { source, promise };
    void promise.then(adjacency => {
      if (stale()) return;
      const found = cadTopologyChainPicks(adjacency, hit.pick, gesture, faceKey);
      if (found) take(source.bodyId, found.keys.map(key => ({ kind: found.kind, key })), additive ? 'union' : false);
    }).catch((cause: unknown) => {
      if (adjacencyRead.current?.promise === promise) adjacencyRead.current = null;
      if (!stale()) fail(cause);
    });
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
    meshes, inspect, pick, set, chain, finish };
}
