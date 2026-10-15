// @vitest-environment node
import { readFile } from 'node:fs/promises';
import initOpenCascade from 'replicad-opencascadejs';
import { _3DShape, setOC } from 'replicad';
import { beforeAll, expect, it, vi } from 'vitest';
import type { CadDocument, CadFeature, CadProfile, CadSketchFeature } from '../../../domain/cad/cadDocument';
import { parseCadDocument } from '../../../domain/cad/cadSchema';
import { buildCadKernelModel } from './cadKernelModel';
import { prepareCadSolidImport } from './cadKernelImport';
import { isCadKernelReply } from './cadKernelProtocol';

beforeAll(async () => {
  setOC(await initOpenCascade({ wasmBinary: await readFile(new URL('../../../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm', import.meta.url)),
    print: () => undefined, printErr: () => undefined }));
}, 60_000);

type Family = 'extrude' | 'revolve' | 'loft' | 'sweep' | 'boolean';
type Placement = 'contained' | 'face-contact' | 'edge-contact' | 'point-contact' | 'disjoint';
const base = (id: string) => ({ id, name: id, suppressed: false });
function sketch(id: string, geometry: CadProfile, offset = 0, plane: CadSketchFeature['plane'] = 'XY'): CadSketchFeature {
  return { ...base(id), kind: 'sketch', plane, offset, profiles: [{ id: `${id}_profile`, name: id, construction: false, geometry }] };
}
function fixture(family: Family, placement: Placement): CadDocument {
  const box = (x: number, y: number, size = 4): CadProfile => ({ kind: 'rectangle', x, y, width: size, height: size, cornerRadius: 0 });
  const features: CadFeature[] = [sketch('stock_profile', box(-10, -10, 20), -10),
    { ...base('stock'), kind: 'extrude', sketchId: 'stock_profile', distance: 20, symmetric: false, operation: 'new', targetId: null },
    sketch('other_profile', box(-40, -2), -2),
    { ...base('other'), kind: 'extrude', sketchId: 'other_profile', distance: 4, symmetric: false, operation: 'new', targetId: null }];
  if (family === 'revolve') {
    const centerY = placement === 'edge-contact' || placement === 'point-contact' ? 13 : placement === 'disjoint' ? 20 : 0;
    const station = placement === 'face-contact' || placement === 'point-contact' ? 10 : -2;
    features.push(sketch('tool_profile', { kind: 'rectangle', x: 1, y: station, width: 2, height: 4, cornerRadius: 0 }, -centerY, 'XZ'),
      { ...base('joined'), kind: 'revolve', sketchId: 'tool_profile', angle: 360, axis: 'y', operation: 'join', targetId: 'stock' });
  } else if (family === 'sweep') {
    const y = placement === 'edge-contact' || placement === 'point-contact' ? 12 : placement === 'disjoint' ? 20 : 0;
    const start = placement === 'face-contact' || placement === 'point-contact' ? 10 : -2;
    features.push(sketch('tool_profile', { kind: 'circle', x: y, y: 0, radius: 2 }, start, 'YZ'),
      { ...base('rail'), kind: 'curve', plane: 'XY', offset: 0, segments: [{ kind: 'line', start: [start, y], end: [start + 4, y] }] },
      { ...base('joined'), kind: 'sweep', sketchId: 'tool_profile', curveId: 'rail', operation: 'join', targetId: 'stock' });
  } else {
    const x = placement === 'disjoint' ? 20 : placement !== 'contained' ? 10 : -2;
    const y = placement === 'edge-contact' || placement === 'point-contact' ? 10 : -2;
    const z = placement === 'point-contact' ? 10 : -2;
    features.push(sketch('tool_profile', box(x, y), z));
    if (family === 'loft') features.push(sketch('upper_profile', box(x, y), z + 4),
      { ...base('joined'), kind: 'loft', sketchIds: ['tool_profile', 'upper_profile'], ruled: true, operation: 'join', targetId: 'stock' });
    else if (family === 'extrude') features.push({ ...base('joined'), kind: 'extrude', sketchId: 'tool_profile', distance: 4, symmetric: false, operation: 'join', targetId: 'stock' });
    else features.push({ ...base('tool'), kind: 'extrude', sketchId: 'tool_profile', distance: 4, symmetric: false, operation: 'new', targetId: null },
      { ...base('joined'), kind: 'boolean', operation: 'union', targetId: 'stock', toolId: 'tool' });
  }
  return parseCadDocument({ format: 'wireedm-cad', schemaVersion: 1, id: 'join_counts', name: 'Join counts', units: 'mm', parameters: {}, features });
}

it.each(['extrude', 'revolve', 'loft', 'sweep', 'boolean'] as const)('%s Join reports actual validated solids across containment and contact without extra material probes', async family => {
  for (const placement of ['contained', 'face-contact', 'edge-contact', 'point-contact', 'disjoint'] as const) {
    const document = fixture(family, placement), original = JSON.stringify(document);
    // A metadata improvement must not introduce an extra Common/Cut into a successful Join.
    const common = vi.spyOn(_3DShape.prototype, 'intersect').mockImplementation(() => { throw new Error('Unexpected material Common probe'); });
    const cut = vi.spyOn(_3DShape.prototype, 'cut').mockImplementation(() => { throw new Error('Unexpected material Cut probe'); });
    let model;
    try { model = buildCadKernelModel(document); } finally { common.mockRestore(); cut.mockRestore(); }
    try {
      const count = placement === 'contained' || placement === 'face-contact' ? 1 : 2;
      const toolVolume = family === 'revolve' ? 32 * Math.PI : family === 'sweep' ? 16 * Math.PI : 64;
      const volume = 8000 + (placement === 'contained' ? 0 : toolVolume);
      expect(model.result.diagnostics, `${family} ${placement}`).toEqual([]);
      expect(isCadKernelReply({ id: 1, kind: 'built', result: model.result })).toBe(true);
      expect(model.result.meshes.map(mesh => mesh.featureId)).toEqual(['other', 'joined']);
      expect(model.result.meshes[0]).toMatchObject({ solidCount: 1 });
      expect(model.result.meshes[0].volume).toBeCloseTo(64, 6);
      expect(model.result.meshes[1], `${family} ${placement}`).toMatchObject({ solidCount: count });
      expect(model.result.meshes[1].volume).toBeCloseTo(volume, 6);
      expect(JSON.stringify(document)).toBe(original);
      // STEP is independently enumerated after reimport, including the unrelated body.
      if (placement === 'face-contact' || placement === 'disjoint') {
        const imported = prepareCadSolidImport({ format: 'step', fileName: 'join.step', encoding: 'utf8', data: await model.export('step').text() });
        expect(imported.solidCount).toBe(count + 1);
        expect(imported.volume).toBeCloseTo(volume + 64, 6);
      }
    } finally { model.dispose(); }
  }
});

it('retains the preceding compound count when a later Cut erases all material and blocks export', () => {
  const original = fixture('extrude', 'disjoint');
  const document = parseCadDocument({ ...original, features: [...original.features,
    sketch('erase_profile', { kind: 'rectangle', x: -11, y: -11, width: 40, height: 30, cornerRadius: 0 }, -11),
    { ...base('erase'), kind: 'extrude', sketchId: 'erase_profile', distance: 100, symmetric: false, operation: 'cut', targetId: 'joined' },
  ] });
  const bytes = JSON.stringify(document), model = buildCadKernelModel(document);
  try {
    expect(model.result.diagnostics).toEqual([expect.objectContaining({ featureId: 'erase', code: 'cut-erased' }),
      expect.objectContaining({ featureId: 'erase', code: 'rebuild-stopped' })]);
    expect(model.result.meshes.map(mesh => mesh.featureId)).toEqual(['other', 'joined']);
    expect(model.result.meshes[1].solidCount).toBe(2); expect(model.result.meshes[1].volume).toBeCloseTo(8064, 6);
    expect(isCadKernelReply({ id: 1, kind: 'built', result: model.result })).toBe(true);
    expect(() => model.export('step')).toThrow('Fix the feature diagnostics');
    expect(JSON.stringify(document)).toBe(bytes);
  } finally { model.dispose(); }
});
