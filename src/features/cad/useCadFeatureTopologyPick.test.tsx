import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createCadDocument } from '@/domain/cad/cadSchema';
import type { CadFeatureInputSnapshot } from './cadFeatureInput';
import type { CadFeatureTopologyPickCommand } from './cadFeatureReferencePicking';
import type { CadTopologyResolvePicksResult } from '@/domain/cad/cadTopology';
import type { CadTopologyAdjacency } from '@/domain/cad/cadTopologyAdjacency';
import { useCadFeatureTopologyPick, type CadFeatureInputPicking } from './useCadFeatureTopologyPick';

let root: Root, host: HTMLDivElement, picker: ReturnType<typeof useCadFeatureTopologyPick>;
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(accept => { resolve = accept; }); return { promise, resolve }; }
async function mount() {
  const document = createCadDocument('Owned input', 'owned-input');
  const source: CadFeatureInputSnapshot = { inputToken: 'input', documentId: document.id, version: 'v1', featureId: 'fillet', bodyId: 'pad', parameterValues: {}, document,
    result: { buildId: 'input-build', diagnostics: [], durationMs: 0, meshes: [{ featureId: 'pad', name: 'Pad', volume: 20,
      positions: [], normals: [], indices: [], edges: [], faceGroups: [{ key: 'top', start: 0, count: 3 }], edgeGroups: [{ key: 'a', start: 0, count: 2 }, { key: 'b', start: 2, count: 2 }], bounds: { min: [0, 0, 0], max: [5, 4, 1] } }] } };
  const command: CadFeatureTopologyPickCommand = { kind: 'pick-topology', owner: 'form', expectedVersion: 'v1', label: 'Edges', purpose: 'fillet', request: { featureId: 'fillet', bodyId: 'pad' }, onSelect: vi.fn(), onCancel: vi.fn() };
  const result: CadTopologyResolvePicksResult = { purpose: 'fillet', bodyId: 'pad', buildId: 'input-build', selection: { expectedCount: 1, queries: [{ kind: 'edges', expectedCount: 1, predicates: [{ kind: 'line-endpoints', start: [0, 0, 0], end: [5, 0, 0] }] }] } };
  const resolution = deferred<CadTopologyResolvePicksResult>();
  // Edges a and b run on in one straight line along the top face.
  const adjacency: CadTopologyAdjacency = { bodyId: 'pad', buildId: 'input-build', edges: ['a', 'b'], edgeVertices: [0, 1, 1, 2], edgeTangents: [1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0],
    edgeFaces: [0, -1, 0, -1], edgeSmooth: [false, false], faces: ['top'], faceLoops: [[[0, 1]]] };
  const operations = { build: vi.fn(async () => source), inspect: vi.fn<CadFeatureInputPicking['inspect']>(), resolve: vi.fn<CadFeatureInputPicking['resolve']>(() => resolution.promise), release: vi.fn(),
    adjacency: vi.fn<NonNullable<CadFeatureInputPicking['adjacency']>>(async () => adjacency) } satisfies CadFeatureInputPicking;
  function Harness({ active, version }: { active: boolean; version: string }) { picker = useCadFeatureTopologyPick(active ? command : null, document, version, operations); return null; }
  const render = async (active = true, version = 'v1') => { await act(async () => root.render(<Harness {...{ active, version }} />)); };
  await render(); return { command, source, result, resolution, operations, render };
}

it('picks only exact input keys, retains installed meshes, and resolves the explicit set once', async () => {
  const h = await mount(), installed = picker.meshes;
  await act(async () => picker.pick({ bodyId: 'pad', pick: { kind: 'edge', key: 'unknown' } }, false));
  expect(picker.selection).toBeNull(); expect(picker.error).toContain('does not belong');
  await act(async () => picker.pick({ bodyId: 'pad', pick: { kind: 'edge', key: 'a' } }, false));
  await act(async () => picker.pick({ bodyId: 'pad', pick: { kind: 'edge', key: 'b' } }, true));
  await act(async () => picker.pick({ bodyId: 'pad', pick: { kind: 'edge', key: 'a' } }, true));
  expect(picker.meshes).toBe(installed); expect(picker.selection?.picks).toEqual([{ kind: 'edge', key: 'b' }]);
  let pending!: Promise<void>;
  await act(async () => { pending = picker.finish(); void picker.finish(); });
  expect(h.operations.resolve).toHaveBeenCalledOnce(); expect(h.command.onSelect).not.toHaveBeenCalled();
  expect(h.operations.resolve).toHaveBeenCalledWith('input', { bodyId: 'pad', expectedBuildId: 'input-build', purpose: 'fillet', picks: [{ kind: 'edge', key: 'b' }] }, 'v1', expect.any(AbortSignal));
  await act(async () => { h.resolution.resolve(h.result); await pending; });
  expect(h.command.onSelect).toHaveBeenCalledExactlyOnceWith(h.result);
});

it('selects tangent chains and loops from the input adjacency, read once, adding them with Ctrl', async () => {
  const h = await mount(), keys = () => picker.selection?.picks.map(pick => pick.key).sort();
  await act(async () => picker.chain({ bodyId: 'pad', pick: { kind: 'edge', key: 'a' } }, 'tangent', false, null));
  expect(keys()).toEqual(['a', 'b']);
  await act(async () => picker.set('pad', [{ kind: 'edge', key: 'b' }]));
  expect(keys()).toEqual(['b']);
  await act(async () => picker.chain({ bodyId: 'pad', pick: { kind: 'edge', key: 'b' } }, 'loop', true, 'top'));
  expect(keys()).toEqual(['a', 'b']);
  expect(h.operations.adjacency).toHaveBeenCalledExactlyOnceWith('input', { bodyId: 'pad', expectedBuildId: 'input-build' }, 'v1', expect.any(AbortSignal));
  // Faces are not what this input asks for, and a stale picker changes nothing.
  await act(async () => picker.chain({ bodyId: 'pad', pick: { kind: 'face', key: 'top' } }, 'tangent', false, null));
  expect(keys()).toEqual(['a', 'b']); expect(picker.error).toContain('Choose edges');
  const previous = picker; await h.render(true, 'v2');
  await act(async () => previous.chain({ bodyId: 'pad', pick: { kind: 'edge', key: 'a' } }, 'tangent', false, null));
  expect(picker.selection).toBeNull(); expect(h.operations.adjacency).toHaveBeenCalledOnce();
});

it('cancels an in-flight conversion and releases only its input without changing the feature', async () => {
  const h = await mount(); await act(async () => picker.pick({ bodyId: 'pad', pick: { kind: 'edge', key: 'a' } }, false));
  let pending!: Promise<void>; await act(async () => { pending = picker.finish(); });
  const signal = h.operations.resolve.mock.calls[0][3]; await h.render(false);
  expect(signal.aborted).toBe(true); expect(h.operations.release).toHaveBeenCalledExactlyOnceWith('input');
  await act(async () => { h.resolution.resolve(h.result); await pending; });
  expect(h.command.onSelect).not.toHaveBeenCalled(); expect(picker.source).toBeNull(); expect(picker.meshes).toEqual([]);
});

it('immediately hides a stale input and rejects retained point callbacks when its version changes', async () => {
  const h = await mount(), previous = picker;
  await h.render(true, 'v2');
  expect(picker.source).toBeNull(); expect(h.operations.build).toHaveBeenCalledOnce(); expect(h.operations.release).toHaveBeenCalledExactlyOnceWith('input');
  await act(async () => previous.pick({ bodyId: 'pad', pick: { kind: 'edge', key: 'a' } }, false));
  expect(picker.selection).toBeNull(); expect(h.operations.resolve).not.toHaveBeenCalled();
});
