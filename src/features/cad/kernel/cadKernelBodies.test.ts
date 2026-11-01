// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import initOpenCascade from 'replicad-opencascadejs';
import { setOC } from 'replicad';
import type { CadDocument, CadFeature, CadMesh } from '../../../domain/cad/cadDocument';
import { createCadDocument, parseCadDocument } from '../../../domain/cad/cadSchema';
import { cadBodyLineage, type CadBodyState } from '../../../domain/cad/cadBodies';
import { buildCadKernelModel, type CadKernelModel } from './cadKernelModel';
import { isCadKernelReply } from './cadKernelProtocol';
import { cadKernelParityModels } from './__tests__/cadKernelParity';

beforeAll(async () => {
  const wasmBinary = await readFile(new URL('../../../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm', import.meta.url));
  setOC(await initOpenCascade({ wasmBinary, print: () => undefined, printErr: () => undefined }));
}, 60_000);

type Geometry = Extract<CadFeature, { kind: 'sketch' }>['profiles'][number]['geometry'];
const base = (id: string, suppressed = false) => ({ id, name: id, suppressed });
const rect = (x: number, y: number, width: number, height: number): Geometry => ({ kind: 'rectangle', x, y, width, height, cornerRadius: 0 });
const sketch = (id: string, geometry: Geometry): CadFeature => ({ ...base(id), kind: 'sketch', plane: 'XY', offset: 0, profiles: [{ id: `${id}_profile`, name: 'Profile', construction: false, geometry }] });
const pad = (id: string, sketchId: string, distance: number, operation: 'new' | 'join' | 'cut' = 'new', targetId: string | null = null): CadFeature =>
  ({ ...base(id), kind: 'extrude', sketchId, distance, symmetric: false, operation, targetId });
const box = [sketch('box_sketch', rect(0, 0, 40, 20)), pad('box', 'box_sketch', 10)];
const peg = [sketch('peg_sketch', rect(30, 5, 20, 10)), pad('peg', 'peg_sketch', 15)];
const slot = (id: string, x: number, targetId: string) => [sketch(`${id}_sketch`, rect(x, -5, 2, 30)), pad(id, `${id}_sketch`, 10, 'cut', targetId)];
const document = (features: readonly CadFeature[]): CadDocument => parseCadDocument({ ...createCadDocument('Bodies'), features });

function built<T>(features: readonly CadFeature[], read: (model: CadKernelModel, parsed: CadDocument) => T): T {
  const parsed = document(features), model = buildCadKernelModel(parsed);
  try { expect(model.result.diagnostics).toEqual([]); return read(model, parsed); } finally { model.dispose(); }
}
const identity = (body: CadBodyState) => ({ key: body.key, kind: body.kind, createdBy: body.createdBy, modifiedBy: body.modifiedBy, consumedBy: body.consumedBy, occurrences: body.occurrences });

/** Each solid's span along X, by the solid numbers `faceSolids` uses. */
function solidSpans(mesh: CadMesh): Map<number, [number, number]> {
  const spans = new Map<number, [number, number]>();
  mesh.faceGroups.forEach((group, index) => {
    const solid = mesh.faceSolids?.[index] ?? 0;
    for (let at = group.start; at < group.start + group.count; at++) {
      const x = mesh.positions[mesh.indices[at] * 3], span = spans.get(solid);
      if (span) { span[0] = Math.min(span[0], x); span[1] = Math.max(span[1], x); } else spans.set(solid, [x, x]);
    }
  });
  return spans;
}
/** The piece key of the solid of the first body that lies around `x`. */
function pieceAt(model: CadKernelModel, x: number): string | undefined {
  const mesh = model.result.meshes[0], body = model.result.bodies?.[0];
  for (const [solid, [min, max]] of solidSpans(mesh)) if (min < x && x < max) return body?.pieces?.[solid];
  return undefined;
}

describe('kernel body identity', () => {
  it.each<[string, CadFeature[]]>([
    ['fillet', [{ ...base('round'), kind: 'fillet', targetId: 'box', radius: 1 }]],
    ['chamfer', [{ ...base('bevel'), kind: 'chamfer', targetId: 'box', radius: 1 }]],
    ['shell', [{ ...base('hollow'), kind: 'shell', targetId: 'box', thickness: 1, opening: { kind: 'faces', expectedCount: 1, predicates: [{ kind: 'plane', normal: [0, 0, 1], offset: 10 }] } }]],
    ['transform', [{ ...base('move'), kind: 'transform', sourceId: 'box', translation: [5, 0, 0], rotation: [0, 0, 30] }]],
    ['pocket', [sketch('hole_sketch', { kind: 'circle', x: 10, y: 10, radius: 3 }), { ...base('hole'), kind: 'pocket', sketchId: 'hole_sketch', targetId: 'box', extent: { kind: 'through-all', direction: 'both' } }]],
    ['cut', [sketch('notch_sketch', rect(10, 5, 4, 4)), pad('notch', 'notch_sketch', 10, 'cut', 'box')]],
    ['join', [sketch('lug_sketch', rect(35, 5, 10, 10)), pad('lug', 'lug_sketch', 5, 'join', 'box')]]
  ])('keeps the body key through %s', (_, modifiers) => built([...box, ...modifiers], model => {
    const modifier = modifiers.at(-1)!;
    expect(model.result.meshes.map(mesh => [mesh.featureId, mesh.bodyKey])).toEqual([[modifier.id, 'box']]);
    expect(model.result.bodies?.map(identity)).toEqual([{ key: 'box', kind: 'solid', createdBy: 'box', modifiedBy: [modifier.id], consumedBy: undefined, occurrences: undefined }]);
  }));

  it('keeps the target key of a boolean and drops its consumed tool', () => built([...box, ...peg, { ...base('merge'), kind: 'boolean', targetId: 'box', toolId: 'peg', operation: 'union' }], model => {
    expect(model.result.meshes.map(mesh => [mesh.featureId, mesh.bodyKey])).toEqual([['merge', 'box']]);
    expect(model.result.bodies?.[0]).toMatchObject({ key: 'box', modifiedBy: ['merge'] });
  }));

  it('keys pattern copies and mirror images', () => {
    built([...box, { ...base('row'), kind: 'linear-pattern', sourceId: 'box', count: 3, spacing: [50, 0, 0] }, { ...base('flip'), kind: 'mirror', sourceId: 'row', plane: 'YZ' }], model => {
      expect(model.result.meshes.map(mesh => [mesh.featureId, mesh.bodyKey])).toEqual([['row', 'box'], ['flip', 'flip/mirror']]);
      expect(model.result.bodies?.[0].occurrences).toEqual(['box/inst(0,0)', 'box/inst(1,0)', 'box/inst(2,0)']);
    });
  });

  it('builds the bodies the domain lineage predicts for every parity part', () => {
    for (const { id, document: parsed } of cadKernelParityModels()) {
      const model = buildCadKernelModel(parsed);
      try {
        expect(model.result.diagnostics, id).toEqual([]);
        expect(model.result.bodies?.map(identity), id).toEqual(cadBodyLineage(parsed.features, parsed).bodies().map(identity));
        expect(model.result.meshes.map(mesh => mesh.bodyKey), id).toEqual(model.result.bodies?.map(body => body.key));
        expect(isCadKernelReply({ id: 1, kind: 'built', result: structuredClone(model.result) }), id).toBe(true);
      } finally { model.dispose(); }
    }
  }, 120_000);

  it('rejects build replies whose body states do not describe their meshes', () => built([...box, ...peg], model => {
    const result = structuredClone(model.result);
    expect(isCadKernelReply({ id: 1, kind: 'built', result })).toBe(true);
    expect(isCadKernelReply({ id: 1, kind: 'built', result: { ...result, bodies: [...result.bodies!].reverse() } })).toBe(false);
    expect(isCadKernelReply({ id: 1, kind: 'built', result: { ...result, bodies: result.bodies!.slice(1) } })).toBe(false);
    expect(isCadKernelReply({ id: 1, kind: 'built', result: { ...result, meshes: result.meshes.map(mesh => ({ ...mesh, bodyKey: 'bad key' })) } })).toBe(false);
    expect(isCadKernelReply({ id: 1, kind: 'built', result: { ...result, bodyIssues: [{ code: 'other' }] } })).toBe(false);
  }));
});

describe('kernel split pieces', () => {
  it('numbers the pieces of a split by the faces they keep, the same on every build and wherever the cut falls', () => {
    // The box lists its face at x = 40 before its face at x = 0, so the right piece is split(0) although it is the kernel's second
    // solid, whatever the sizes or centroids of the pieces.
    for (const x of [18, 8, 30]) {
      for (let run = 0; run < 2; run++) built([...box, ...slot('slot', x, 'box')], model => {
        expect(model.result.meshes[0].solidCount).toBe(2);
        expect(model.result.bodies?.[0]).toMatchObject({ key: 'box', modifiedBy: ['slot'] });
        expect(model.result.bodies?.[0].ambiguous).toBeUndefined();
        expect([pieceAt(model, x + 5), pieceAt(model, x / 2)]).toEqual(['box/split(0)', 'box/split(1)']);
        expect(model.result.bodies?.[0].pieces).toEqual(['box/split(1)', 'box/split(0)']);
        expect(model.result.bodyIssues).toEqual([]);
      });
    }
  });

  it('carries pieces through a move, splits a piece under its own key and numbers a new solid after the pieces', () => {
    built([...box, ...slot('slot', 18, 'box'), { ...base('move'), kind: 'transform', sourceId: 'slot', translation: [100, 0, 0], rotation: [0, 0, 0] }], model => {
      expect([pieceAt(model, 125), pieceAt(model, 105)]).toEqual(['box/split(0)', 'box/split(1)']);
    });
    built([...box, ...slot('slot', 18, 'box'), ...slot('again', 30, 'slot')], model => {
      expect([pieceAt(model, 35), pieceAt(model, 25), pieceAt(model, 9)]).toEqual(['box/split(0)/split(0)', 'box/split(0)/split(1)', 'box/split(1)']);
    });
    built([...box, ...slot('slot', 18, 'box'), sketch('lug_sketch', rect(60, 0, 5, 5)), pad('lug', 'lug_sketch', 5, 'join', 'slot')], model => {
      expect([pieceAt(model, 30), pieceAt(model, 9), pieceAt(model, 62)]).toEqual(['box/split(0)', 'box/split(1)', 'box/split(2)']);
      expect(model.result.bodyIssues).toEqual([]);
    });
  });

  it('reports pieces that keep no face of the body before as ambiguous', () => {
    const rod = [sketch('rod_sketch', { kind: 'circle', x: 0, y: 0, radius: 10 }), pad('rod', 'rod_sketch', 20), sketch('cleave_sketch', rect(-1, -15, 2, 30)), pad('cleave', 'cleave_sketch', 20, 'cut', 'rod')];
    built(rod, model => {
      expect(model.result.bodies?.[0]).toMatchObject({ key: 'rod', pieces: ['rod/split(0)', 'rod/split(1)'], ambiguous: ['rod/split(0)', 'rod/split(1)'] });
      expect(model.result.bodyIssues).toEqual([expect.objectContaining({ code: 'ambiguous-split-order', featureId: 'cleave', body: 'rod', pieces: ['rod/split(0)', 'rod/split(1)'] })]);
    });
  });
});
