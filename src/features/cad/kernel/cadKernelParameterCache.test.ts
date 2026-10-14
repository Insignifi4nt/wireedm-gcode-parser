// @vitest-environment node
import { beforeAll, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import initOpenCascade from 'replicad-opencascadejs';
import { setOC } from 'replicad';
import type { CadDocument, CadProfile } from '../../../domain/cad/cadDocument';
import { CAD_GEAR_V3_PLUGIN, CAD_STAR_PLUGIN, createCadPluginProfile, inspectCadPluginProfile } from '../../../domain/cad/plugins/cadPlugins';
import { createCadKernelRuntime } from './cadKernelRuntime';
import { buildCadKernelModel } from './cadKernelModel';
import { prepareCadSolidImport } from './cadKernelImport';

beforeAll(async () => {
  const wasmBinary = await readFile(new URL('../../../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm', import.meta.url));
  setOC(await initOpenCascade({ wasmBinary, print: () => undefined, printErr: () => undefined }));
}, 60_000);
const rectangle: CadProfile = { kind: 'rectangle', x: 0, y: 0, width: 'width', height: 'height', cornerRadius: 0 };
function document(geometry: CadProfile = rectangle, parameters: CadDocument['parameters'] = { width: 20, height: 10, unused: 1 }, bore = false): CadDocument {
  return { format: 'wireedm-cad', schemaVersion: 1, id: 'parameter_cache', name: 'Parameter cache', units: 'mm', parameters, features: [
    { id: 'sketch', name: 'Outline', kind: 'sketch', suppressed: false, plane: 'XY', offset: 0, profiles: [
      { id: 'outline', name: 'Outline', construction: false, geometry },
      ...(bore ? [{ id: 'bore', name: 'Bore', construction: false, geometry: { kind: 'circle' as const, x: 0, y: 0, radius: 6 } }] : [])
    ] },
    { id: 'pad', name: 'Pad', kind: 'extrude', suppressed: false, sketchId: 'sketch', distance: 5, symmetric: false, operation: 'new', targetId: null }
  ] };
}
async function build(runtime: ReturnType<typeof createCadKernelRuntime>, document: CadDocument, id: number) {
  const reply = await runtime.evaluate({ id, kind: 'build', document });
  if (reply.kind !== 'built') throw new Error(JSON.stringify(reply)); expect(reply.result.diagnostics).toEqual([]); return reply.result;
}
const inspection = (buildId: string) => ({ bodyId: 'pad', expectedBuildId: buildId, selection: { kind: 'page', topology: 'edge', offset: 0, limit: 12 } });

it('reuses exact stock for unused values and reordered declarations, while active values rebuild and full ownership stays current', async () => {
  const runtime = createCadKernelRuntime(async () => undefined), original = document(), originalBytes = JSON.stringify(original);
  try {
    const first = await build(runtime, original, 1), changed = { ...original, parameters: { width: 20, height: 10, unused: 2 } };
    expect(await runtime.evaluate({ id: 2, kind: 'inspect-topology', document: changed, inspection: inspection(first.buildId) })).toMatchObject({ kind: 'error', code: 'STALE_BUILD' });
    const reused = await build(runtime, changed, 3); expect(reused.buildId).toBe(first.buildId); expect(reused === first).toBe(true); expect(reused.meshes === first.meshes).toBe(true);
    const reordered = { ...original, parameters: { unused: 2, height: 10, width: 20 } };
    expect(await build(runtime, reordered, 4) === first).toBe(true);
    expect(await runtime.evaluate({ id: 5, kind: 'inspect-topology', document: changed, inspection: inspection(first.buildId) })).toMatchObject({ kind: 'error', code: 'STALE_BUILD' });
    expect(await runtime.evaluate({ id: 6, kind: 'inspect-topology', document: reordered, inspection: inspection(first.buildId) })).toMatchObject({ kind: 'topology-inspected', result: { total: 12 } });
    const exported = await runtime.evaluate({ id: 7, kind: 'export', document: reordered, format: 'step' });
    if (exported.kind !== 'exported') throw new Error('Expected unchanged stock export');
    expect(prepareCadSolidImport({ format: 'step', encoding: 'utf8', fileName: 'stock.step', data: await exported.blob.text() }).volume).toBeCloseTo(1000, 7);
    const resized = await build(runtime, { ...reordered, parameters: { ...reordered.parameters, width: 30 } }, 8);
    expect(resized.buildId).not.toBe(first.buildId); expect(resized.meshes[0].volume).toBeCloseTo(1500, 7);
    expect(JSON.stringify(original)).toBe(originalBytes);
  } finally { runtime.dispose(); }
});

it('reuses a local-module gear after an unrelated module edit and rebuilds a genuinely linked module', async () => {
  const runtime = createCadKernelRuntime(async () => undefined), gear = createCadPluginProfile(CAD_GEAR_V3_PLUGIN);
  const original = document(gear, { module: 99 }, true), bytes = JSON.stringify(original), packageBytes = JSON.stringify(gear.package);
  try {
    const first = await build(runtime, original, 1), unrelated = { ...original, parameters: { module: 100 } };
    const reused = await build(runtime, unrelated, 2); expect(reused.buildId).toBe(first.buildId); expect(reused === first).toBe(true); expect(reused.meshes[0].positions === first.meshes[0].positions).toBe(true);
    expect(reused.meshes[0].bounds.max[0]).toBeCloseTo(30, 7);
    expect(await runtime.evaluate({ id: 3, kind: 'section', document: unrelated, section: { bodyId: 'pad', plane: 'XY', offset: 2.5 } }))
      .toMatchObject({ kind: 'sectioned', result: { contourCount: 2 } });
    const exported = await runtime.evaluate({ id: 4, kind: 'export', document: unrelated, format: 'step' });
    if (exported.kind !== 'exported') throw new Error('Expected unchanged gear export');
    const step = await exported.blob.text(); expect(step).toContain('ISO-10303-21'); expect(step).toContain("'Pad'");
    expect(step.match(/MANIFOLD_SOLID_BREP\(/g)).toHaveLength(1);
    expect(await build(runtime, unrelated, 40) === first).toBe(true);
    const linked = document({ ...gear, inputs: { ...gear.inputs, module: 'module' } }, { module: 3 }, true);
    const linkedFirst = await build(runtime, linked, 5), changed = await build(runtime, { ...linked, parameters: { module: 4 } }, 6);
    expect(changed.buildId).not.toBe(linkedFirst.buildId); expect(changed.meshes[0].bounds.max[0]).toBeCloseTo(40, 7);
    expect(changed.meshes[0].volume).toBeGreaterThan(linkedFirst.meshes[0].volume);
    expect(JSON.stringify(original)).toBe(bytes); expect(JSON.stringify(gear.package)).toBe(packageBytes);
  } finally { runtime.dispose(); }
}, 60_000);

it('reuses a dormant built-in driver only while valid and inactive, including a shared active use', async () => {
  const runtime = createCadKernelRuntime(async () => undefined), gear = createCadPluginProfile(CAD_GEAR_V3_PLUGIN);
  const original = document({ ...gear, inputs: { ...gear.inputs, cutterTipRadius: 'savedTip' } }, { savedTip: .3 }, true), bytes = JSON.stringify(original);
  try {
    const first = await build(runtime, original, 1), changed = { ...original, parameters: { savedTip: .6 } };
    const reused = await build(runtime, changed, 2); expect(reused.buildId).toBe(first.buildId); expect(reused === first).toBe(true);
    expect(await runtime.evaluate({ id: 3, kind: 'build', document: { ...changed, parameters: { savedTip: 60 } } })).toMatchObject({ kind: 'error', code: 'invalid-plugin-inputs', message: expect.stringContaining('Cutter tip radius') });
    expect(await runtime.evaluate({ id: 4, kind: 'inspect-topology', document: changed, inspection: inspection(first.buildId) })).toMatchObject({ kind: 'topology-inspected' });
    expect(await runtime.evaluate({ id: 5, kind: 'inspect-topology', document: original, inspection: inspection(first.buildId) })).toMatchObject({ kind: 'error', code: 'STALE_BUILD' });
    const shared: CadDocument = { ...changed, features: changed.features.map(feature => feature.kind === 'extrude' ? { ...feature, distance: 'savedTip' } : feature) };
    const sharedFirst = await build(runtime, shared, 6), sharedChanged = await build(runtime, { ...shared, parameters: { savedTip: .5 } }, 7);
    expect(sharedChanged.buildId).not.toBe(sharedFirst.buildId); expect(sharedChanged.meshes[0].bounds.max[2]).toBeCloseTo(.5, 8);
    expect(sharedChanged.meshes[0].volume).toBeCloseTo(sharedFirst.meshes[0].volume * .5 / .6, 7);
    expect(JSON.stringify(original)).toBe(bytes);
  } finally { runtime.dispose(); }
}, 60_000);

it('retains the geometry dependency of a generic recipe input whose editing is disabled', async () => {
  const runtime = createCadKernelRuntime(async () => undefined), plugin = { ...CAD_STAR_PLUGIN, id: 'user.locked-star', apiVersion: 2 as const, rules: {
    derived: [], constraints: [], fields: CAD_STAR_PLUGIN.inputs.map(input => ({ name: input.name, group: 'main' as const, minimum: input.minimum, maximum: input.maximum,
      ...(input.name === 'outerRadius' ? { enabledWhen: { left: 'lobes', operator: 'eq' as const, right: 3 } } : {}) })) } };
  const geometry = createCadPluginProfile(plugin); geometry.inputs.outerRadius = 'radius';
  const original = document(geometry, { radius: 30 }), bytes = JSON.stringify(original);
  try {
    expect(inspectCadPluginProfile(geometry, original.parameters).fields.find(field => field.name === 'outerRadius')?.enabled).toBe(false);
    const first = await build(runtime, original, 1), changed = await build(runtime, { ...original, parameters: { radius: 31 } }, 2);
    expect(changed.buildId).not.toBe(first.buildId); expect(changed.meshes[0].bounds.max[0]).toBeCloseTo(31, 7);
    expect(changed.meshes[0].volume).toBeCloseTo(8 * 31 * 20 * Math.sin(Math.PI / 8) * 5, 7);
    expect(JSON.stringify(original)).toBe(bytes);
  } finally { runtime.dispose(); }
});

it('uses current named query values on reused material and retains accepted ownership when a query fails', async () => {
  const runtime = createCadKernelRuntime(async () => undefined), original = document(rectangle, { width: 20, height: 10, cutHeight: 2 }), bytes = JSON.stringify(original);
  try {
    const first = await build(runtime, original, 1), current = { ...original, parameters: { ...original.parameters, cutHeight: 4 } };
    expect(await runtime.evaluate({ id: 2, kind: 'section', document: current, section: { bodyId: 'pad', plane: 'XY', offset: 'cutHeight' } }))
      .toMatchObject({ kind: 'sectioned', result: { offset: 4, contourCount: 1 } });
    expect(await build(runtime, current, 3) === first).toBe(true);
    expect(await runtime.evaluate({ id: 4, kind: 'inspect-topology', document: original, inspection: inspection(first.buildId) })).toMatchObject({ kind: 'error', code: 'STALE_BUILD' });
    const topology = await runtime.evaluate({ id: 5, kind: 'inspect-topology', document: current, inspection: inspection(first.buildId) });
    if (topology.kind !== 'topology-inspected') throw new Error('Expected current picks');
    const edge = topology.result.descriptors.find(descriptor => descriptor.kind === 'edge' && descriptor.curveType === 'line' && Math.abs(descriptor.length - 20) < 1e-8);
    if (!edge) throw new Error('Expected width edge');
    expect(await runtime.evaluate({ id: 6, kind: 'resolve-topology-picks', document: current, selection: { bodyId: 'pad', expectedBuildId: first.buildId, purpose: 'chamfer', picks: [{ kind: 'edge', key: edge.key }] } })).toMatchObject({ kind: 'topology-resolved' });
    const invalid = { ...current, parameters: { ...current.parameters, cutHeight: 9 } };
    expect(await runtime.evaluate({ id: 7, kind: 'section', document: invalid, section: { bodyId: 'pad', plane: 'XY', offset: 'cutHeight' } })).toMatchObject({ kind: 'error', code: 'empty-section' });
    expect(await runtime.evaluate({ id: 8, kind: 'inspect-topology', document: current, inspection: inspection(first.buildId) })).toEqual({ ...topology, id: 8 });
    expect(await runtime.evaluate({ id: 9, kind: 'section', document: current, section: { bodyId: 'pad', plane: 'XY', offset: 'missing' } })).toMatchObject({ kind: 'error', code: 'unknown-parameter' });
    expect(await build(runtime, current, 10) === first).toBe(true);
    const exported = await runtime.evaluate({ id: 11, kind: 'export', document: current, format: 'step' });
    if (exported.kind !== 'exported') throw new Error('Expected retained stock');
    expect(prepareCadSolidImport({ format: 'step', encoding: 'utf8', fileName: 'retained.step', data: await exported.blob.text() }).volume).toBeCloseTo(1000, 7);
    expect(JSON.stringify(original)).toBe(bytes);
  } finally { runtime.dispose(); }
});

it('keeps direct model query defaults while permitting an explicit immutable current parameter environment', () => {
  const input = document(rectangle, { width: 20, height: 10, cutHeight: 2 }), bytes = JSON.stringify(input), model = buildCadKernelModel(input);
  try {
    const request = { bodyId: 'pad', plane: 'XY' as const, offset: 'cutHeight' }, current = { ...input.parameters, cutHeight: 4 };
    expect(model.section(request).offset).toBe(2);
    expect(model.section(request, current).offset).toBe(4);
    expect(model.section(request).offset).toBe(2); expect(model.result.meshes[0].volume).toBeCloseTo(1000, 7);
    expect(JSON.stringify(input)).toBe(bytes);
  } finally { model.dispose(); }
});
