// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import initOpenCascade from 'replicad-opencascadejs';
import { setOC } from 'replicad';
import type { CadDocument, CadFeature, CadMesh } from '../../../domain/cad/cadDocument';
import { createCadDocument, parseCadDocument } from '../../../domain/cad/cadSchema';
import { cadBodyLineage, resolveCadBodyRef, type CadBodyKey, type CadBodyState } from '../../../domain/cad/cadBodies';
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
const sketches = (id: string, geometries: readonly Geometry[]): CadFeature => ({ ...base(id), kind: 'sketch', plane: 'XY', offset: 0,
  profiles: geometries.map((geometry, index) => ({ id: `${id}_profile${index}`, name: `Profile ${index}`, construction: false, geometry })) });
const pad = (id: string, sketchId: string, distance: number, operation: 'new' | 'join' | 'cut' = 'new', targetId: string | null = null): CadFeature =>
  ({ ...base(id), kind: 'extrude', sketchId, distance, symmetric: false, operation, targetId });
const box = [sketch('box_sketch', rect(0, 0, 40, 20)), pad('box', 'box_sketch', 10)];
const peg = [sketch('peg_sketch', rect(30, 5, 20, 10)), pad('peg', 'peg_sketch', 15)];
const slot = (id: string, x: number, targetId: string) => [sketch(`${id}_sketch`, rect(x, -5, 2, 30)), pad(id, `${id}_sketch`, 10, 'cut', targetId)];
const pocket = (id: string, x: number, y: number, targetId: string): CadFeature[] => [sketch(`${id}_sketch`, { kind: 'circle', x, y, radius: 1 }),
  { ...base(id), kind: 'pocket', sketchId: `${id}_sketch`, targetId, extent: { kind: 'through-all', direction: 'both' } }];
/** A rod cleaved through its axis: neither half keeps a face of the rod, so the kernel might list them in another order. */
const rod = (id = 'rod') => [sketch(`${id}_sketch`, { kind: 'circle', x: 0, y: 0, radius: 10 }), pad(id, `${id}_sketch`, 20), sketch('cleave_sketch', rect(-1, -15, 2, 30)), pad('cleave', 'cleave_sketch', 20, 'cut', id)];
const row = (sourceId: string, count: number, spacing: number): CadFeature => ({ ...base('row'), kind: 'linear-pattern', sourceId, count, spacing: [spacing, 0, 0] });
const document = (features: readonly CadFeature[]): CadDocument => parseCadDocument({ ...createCadDocument('Bodies'), features });

function built<T>(features: readonly CadFeature[], read: (model: CadKernelModel, parsed: CadDocument) => T): T {
  const parsed = document(features), model = buildCadKernelModel(parsed);
  try { expect(model.result.diagnostics).toEqual([]); return read(model, parsed); } finally { model.dispose(); }
}
const identity = (body: CadBodyState) => ({ key: body.key, kind: body.kind, createdBy: body.createdBy, modifiedBy: body.modifiedBy, consumedBy: body.consumedBy });
/** How `key` resolves against a build's bodies. */
const resolve = (model: CadKernelModel, key: string) => resolveCadBodyRef({ kind: 'body', key: key as CadBodyKey },
  { get: wanted => model.result.bodies?.find(body => body.key === wanted), bodies: () => model.result.bodies ?? [], consumed: () => [] });

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
    expect(model.result.bodies?.map(identity)).toEqual([{ key: 'box', kind: 'solid', createdBy: 'box', modifiedBy: [modifier.id], consumedBy: undefined }]);
    expect(model.result.bodies?.[0].pieces).toBeUndefined();
  }));

  it('keeps the target key of a boolean and drops its consumed tool', () => built([...box, ...peg, { ...base('merge'), kind: 'boolean', targetId: 'box', toolId: 'peg', operation: 'union' }], model => {
    expect(model.result.meshes.map(mesh => [mesh.featureId, mesh.bodyKey])).toEqual([['merge', 'box']]);
    expect(model.result.bodies?.[0]).toMatchObject({ key: 'box', modifiedBy: ['merge'] });
  }));

  it('keys separate pattern copies by the copy whose faces they keep, and mirror images', () => {
    built([...box, row('box', 3, 50), { ...base('flip'), kind: 'mirror', sourceId: 'row', plane: 'YZ' }], model => {
      expect(model.result.meshes.map(mesh => [mesh.featureId, mesh.bodyKey])).toEqual([['row', 'box'], ['flip', 'flip/mirror']]);
      expect([pieceAt(model, 20), pieceAt(model, 70), pieceAt(model, 120)]).toEqual(['box/inst(0,0)', 'box/inst(1,0)', 'box/inst(2,0)']);
      expect(model.result.bodies?.[1].pieces).toBeUndefined();
      expect(model.result.bodyIssues).toEqual([]);
    });
    // Overlapping copies fuse into one solid: the body stays whole.
    built([...box, row('box', 3, 30)], model => {
      expect(model.result.meshes[0].solidCount).toBe(1);
      expect(model.result.bodies?.[0].pieces).toBeUndefined();
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

  it('rejects a body whose pieces do not key its solids one for one', () => built([...box, ...slot('slot', 18, 'box')], model => {
    const result = structuredClone(model.result), [body] = result.bodies!;
    expect(isCadKernelReply({ id: 1, kind: 'built', result })).toBe(true);
    expect(isCadKernelReply({ id: 1, kind: 'built', result: { ...result, bodies: [{ ...body, pieces: body.pieces!.slice(1) }] } })).toBe(false);
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

  it('carries pieces through a move, splits a piece under its own key and gives a joined island a fresh key', () => {
    built([...box, ...slot('slot', 18, 'box'), { ...base('move'), kind: 'transform', sourceId: 'slot', translation: [100, 0, 0], rotation: [0, 0, 0] }], model => {
      expect([pieceAt(model, 125), pieceAt(model, 105)]).toEqual(['box/split(0)', 'box/split(1)']);
    });
    built([...box, ...slot('slot', 18, 'box'), ...slot('again', 30, 'slot')], model => {
      expect([pieceAt(model, 35), pieceAt(model, 25), pieceAt(model, 9)]).toEqual(['box/split(0)/split(0)', 'box/split(0)/split(1)', 'box/split(1)']);
    });
    built([...box, ...slot('slot', 18, 'box'), sketch('lug_sketch', rect(60, 0, 5, 5)), pad('lug', 'lug_sketch', 5, 'join', 'slot')], model => {
      expect([pieceAt(model, 30), pieceAt(model, 9), pieceAt(model, 62)]).toEqual(['box/split(0)', 'box/split(1)', 'lug/split(0)']);
      expect(model.result.bodyIssues).toEqual([]);
    });
  });

  it('reports pieces that keep no face of the body before as ambiguous', () => {
    built(rod(), model => {
      expect(model.result.bodies?.[0]).toMatchObject({ key: 'rod', pieces: ['rod/split(0)', 'rod/split(1)'], ambiguous: ['rod/split(0)', 'rod/split(1)'] });
      expect(model.result.bodyIssues).toEqual([expect.objectContaining({ code: 'ambiguous-body-parts', featureId: 'cleave', body: 'rod', pieces: ['rod/split(0)', 'rod/split(1)'] })]);
    });
  });
});

describe('kernel body parts are inherited only when continuity is certain', () => {
  it('bounds the reply of a large valid pattern and keeps every key in its pieces', () => {
    const creator = '3f2a9c1e-5b7d-4e8a-9c0f-1a2b3c4d5e6f';
    built([...rod(creator), row('cleave', 100, 25)], model => {
      const body = model.result.bodies![0], expected = [0, 1].flatMap(k => Array.from({ length: 100 }, (_, i) => `${creator}/split(${k})/inst(${i},0)`));
      expect(model.result.meshes[0].solidCount).toBe(200);
      expect(new Set(body.pieces)).toEqual(new Set(expected));
      expect(new Set(body.ambiguous)).toEqual(new Set(expected));
      expect(model.result.bodyIssues!.map(issue => [issue.code, issue.featureId, issue.pieces.length])).toEqual([['ambiguous-body-parts', 'cleave', 2], ['ambiguous-body-parts', 'row', 200]]);
      expect(model.result.bodyIssues![1].message).toBe(`200 pieces of body ${creator} can't be told apart after row, so references to them are ambiguous.`);
      expect(isCadKernelReply({ id: 1, kind: 'built', result: structuredClone(model.result) })).toBe(true);
    });
  }, 120_000);

  it('gives an island a fresh key and reports the pieces a bridge merges as lost', () => {
    // The bridge joins both pieces of the split box into one solid and adds an island at x = 60–65. Neither result solid continues one
    // piece, so neither inherits a piece's key, whichever is left over.
    built([...box, ...slot('slot', 18, 'box'), sketches('bridge_sketch', [rect(10, 5, 20, 10), rect(60, 0, 5, 5)]), pad('bridge', 'bridge_sketch', 10, 'join', 'slot')], model => {
      expect(model.result.meshes[0].solidCount).toBe(2);
      expect([pieceAt(model, 62), pieceAt(model, 30)]).toEqual(['bridge/split(0)', 'bridge/split(1)']);
      expect(model.result.bodies?.[0].ambiguous).toBeUndefined();
      expect(model.result.bodyIssues).toEqual([expect.objectContaining({ code: 'lost-body-parts', featureId: 'bridge', body: 'box', pieces: ['box/split(1)', 'box/split(0)'] })]);
      expect([resolve(model, 'box/split(0)'), resolve(model, 'box/split(1)')]).toEqual([{ status: 'missing' }, { status: 'missing' }]);
    });
  });

  it('carries ambiguity through a later modification of an ambiguous piece', () => {
    built([...rod(), ...pocket('hole', 5, 0, 'cleave')], model => {
      const body = model.result.bodies![0];
      expect(body).toMatchObject({ key: 'rod', modifiedBy: ['cleave', 'hole'], pieces: ['rod/split(0)', 'rod/split(1)'], ambiguous: ['rod/split(0)', 'rod/split(1)'] });
      expect(model.result.bodyIssues!.map(issue => [issue.code, issue.featureId])).toEqual([['ambiguous-body-parts', 'cleave']]);
      expect(resolve(model, 'rod/split(0)')).toMatchObject({ status: 'ambiguous', candidates: ['rod/split(0)', 'rod/split(1)'] });
    });
  });

  it('reports a pattern copy a later cut removes as lost, so references to it resolve as missing', () => {
    built([...box, row('box', 2, 50), sketch('trim_sketch', rect(45, -5, 50, 30)), pad('trim', 'trim_sketch', 30, 'cut', 'row')], model => {
      expect(model.result.meshes[0].solidCount).toBe(1);
      expect(model.result.bodies?.[0]).toMatchObject({ key: 'box', pieces: ['box/inst(0,0)'] });
      expect(model.result.bodyIssues).toEqual([expect.objectContaining({ code: 'lost-body-parts', featureId: 'trim', pieces: ['box/inst(1,0)'] })]);
      expect(resolve(model, 'box/inst(1,0)')).toEqual({ status: 'missing' });
      expect(resolve(model, 'box/inst(0,0)')).toMatchObject({ status: 'resolved', part: 'box/inst(0,0)' });
    });
  });

  it('finds a split and a loss in one cut that leaves as many solids as before', () => {
    built([...box, row('box', 2, 50), sketches('trim_sketch', [rect(18, -5, 2, 30), rect(45, -5, 50, 30)]), pad('trim', 'trim_sketch', 30, 'cut', 'row')], model => {
      expect(model.result.meshes[0].solidCount).toBe(2);
      expect([pieceAt(model, 30), pieceAt(model, 9)]).toEqual(['box/inst(0,0)/split(0)', 'box/inst(0,0)/split(1)']);
      expect(model.result.bodyIssues).toEqual([expect.objectContaining({ code: 'lost-body-parts', featureId: 'trim', pieces: ['box/inst(1,0)'] })]);
      expect(resolve(model, 'box/inst(1,0)')).toEqual({ status: 'missing' });
    });
  });
});

describe('kernel body parts over random histories', () => {
  type Box = readonly [number, number, number, number];
  interface Step { readonly id: string; readonly features: readonly CadFeature[]; readonly spacing?: readonly [number, number] }
  interface Snapshot { readonly pieces?: readonly string[]; readonly ambiguous: readonly string[]; readonly boxes: ReadonlyMap<string, Box>; readonly bounds: Box }

  function random(seed: number) {
    return () => { seed = seed + 0x6d2b79f5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  }
  /** Each solid's box in X and Y, by the solid numbers `faceSolids` uses. */
  function solidBoxes(mesh: CadMesh): Map<number, Box> {
    const boxes = new Map<number, [number, number, number, number]>();
    mesh.faceGroups.forEach((group, index) => {
      const solid = mesh.faceSolids?.[index] ?? 0;
      for (let at = group.start; at < group.start + group.count; at++) {
        const x = mesh.positions[mesh.indices[at] * 3], y = mesh.positions[mesh.indices[at] * 3 + 1], known = boxes.get(solid);
        if (known) { known[0] = Math.min(known[0], x); known[1] = Math.max(known[1], x); known[2] = Math.min(known[2], y); known[3] = Math.max(known[3], y); }
        else boxes.set(solid, [x, x, y, y]);
      }
    });
    return boxes;
  }
  const meets = (a: Box, b: Box) => a[0] <= b[1] + 1e-6 && b[0] <= a[1] + 1e-6 && a[2] <= b[3] + 1e-6 && b[2] <= a[3] + 1e-6;
  const shifted = (box: Box, dx: number, dy: number): Box => [box[0] + dx, box[1] + dx, box[2] + dy, box[3] + dy];

  /** The body every history starts from, keyed `box`: a box, or a disc, whose split pieces keep no face of it. */
  const disc = [sketch('box_sketch', { kind: 'circle', x: 20, y: 10, radius: 12 }), pad('box', 'box_sketch', 10)];

  /** A random pattern, split, cut, join or pocket of the body feature `target`, aimed inside `bounds`. */
  function nextStep(rand: () => number, id: string, target: string, bounds: Box, patterns: number): Step {
    const kinds = patterns < 2 ? ['pattern', 'split', 'cut', 'join', 'pocket'] as const : ['split', 'cut', 'join', 'pocket'] as const;
    const kind = kinds[Math.floor(rand() * kinds.length)], at = (low: number, high: number) => Math.round((low + rand() * (high - low)) * 2) / 2;
    const x = () => at(bounds[0] - 2, bounds[1] + 2), y = () => at(bounds[2] - 2, bounds[3] + 2), size = (low: number, high: number) => at(low, high);
    switch (kind) {
      case 'pattern': {
        const spacing = ([[50, 0], [0, 30], [25, 0], [0, 12]] as const)[Math.floor(rand() * 4)];
        return { id, spacing: [spacing[0], spacing[1]], features: [{ ...base(id), kind: 'linear-pattern', sourceId: target, count: 2, spacing: [spacing[0], spacing[1], 0] }] };
      }
      case 'split': {
        // One to three parallel slots across the body, so that a piece between two slots keeps no face of the body before.
        const across = rand() < 0.5, width = size(1, 3), count = 1 + Math.floor(rand() * 3), slots: Geometry[] = [];
        for (let k = 0, from = across ? x() : y(); k < count; k++, from += width + size(3, 12))
          slots.push(across ? rect(from, bounds[2] - 10, width, bounds[3] - bounds[2] + 20) : rect(bounds[0] - 10, from, bounds[1] - bounds[0] + 20, width));
        return { id, features: [sketches(`${id}_sketch`, slots), pad(id, `${id}_sketch`, 30, 'cut', target)] };
      }
      case 'cut': return { id, features: [sketch(`${id}_sketch`, rect(x(), y(), size(5, 40), size(5, 40))), pad(id, `${id}_sketch`, 30, 'cut', target)] };
      case 'join': {
        const profiles = Array.from({ length: 1 + Math.floor(rand() * 2) }, () => rect(x(), y(), size(3, 30), size(3, 30)));
        return { id, features: [sketches(`${id}_sketch`, profiles), pad(id, `${id}_sketch`, rand() < 0.5 ? 5 : 10, 'join', target)] };
      }
      case 'pocket': return { id, features: pocket(id, x(), y(), target) };
    }
  }

  function snapshot(model: CadKernelModel): Snapshot {
    const body = model.result.bodies![0], mesh = model.result.meshes[0], boxes = new Map<string, Box>(), solids = solidBoxes(mesh);
    const all = [...solids.values()], bounds: Box = [Math.min(...all.map(box => box[0])), Math.max(...all.map(box => box[1])), Math.min(...all.map(box => box[2])), Math.max(...all.map(box => box[3]))];
    if (body.pieces) for (const [solid, box] of solids) boxes.set(body.pieces[solid], box);
    else boxes.set(body.key, bounds);
    return { pieces: body.pieces, ambiguous: body.ambiguous ?? [], boxes, bounds };
  }

  /** Checks one step's body against the one before: unique keys, certain or reported lineage, inherited ambiguity, and reported losses resolving as missing. */
  function check(model: CadKernelModel, step: Step, before: Snapshot, lost: Set<string>, seen: Set<string>, label: string) {
    const after = snapshot(model), issues = model.result.bodyIssues ?? [];
    expect(model.result.bodies?.map(each => each.key), label).toEqual(['box']);
    expect(isCadKernelReply({ id: 1, kind: 'built', result: structuredClone(model.result) }), label).toBe(true);
    const reported = (code: string) => new Set<string>(issues.filter(issue => issue.code === code && issue.body === 'box').flatMap(issue => issue.pieces));
    const ambiguousReported = reported('ambiguous-body-parts'), lostNow: readonly string[] = issues.filter(issue => issue.code === 'lost-body-parts' && issue.featureId === step.id).flatMap(issue => issue.pieces);
    for (const key of lostNow) lost.add(key);
    if (lostNow.length) seen.add('lost');
    if (issues.some(issue => issue.code === 'ambiguous-body-parts' && issue.featureId === step.id)) seen.add('ambiguous');
    if (after.ambiguous.some(key => !after.pieces?.includes(key as CadBodyKey))) seen.add('unidentified');
    if (before.pieces) expect(after.pieces, label).toBeDefined();
    const pieces: readonly string[] = after.pieces ?? [], uncertain = new Set<string>(after.ambiguous);
    expect(new Set([...pieces, 'box']).size, `${label}: repeated key`).toBe(pieces.length + 1);
    for (const key of after.ambiguous) expect(ambiguousReported.has(key), `${label}: ${key} is ambiguous but not reported`).toBe(true);
    const previous = before.pieces ?? ['box'];
    for (const key of pieces) {
      expect(lost.has(key), `${label}: lost ${key} came back`).toBe(false);
      if (key.startsWith(`${step.id}/`)) { expect(key, label).toMatch(new RegExp(`^${step.id}/split\\(\\d+\\)$`)); seen.add('fresh'); continue; }
      const parent = previous.filter(earlier => key === earlier || key.startsWith(`${earlier}/`)).sort((a, b) => b.length - a.length)[0];
      expect(parent, `${label}: ${key} descends from no key before`).toBeDefined();
      const rest = key === parent ? [] : key.slice(parent.length + 1).split('/'), copy = /^inst\((\d+),0\)$/.exec(rest[0] ?? '');
      expect(rest.length <= (copy ? 2 : 1) && rest.slice(copy ? 1 : 0).every(segment => /^split\(\d+\)$/.test(segment)), `${label}: ${key} after ${parent}`).toBe(true);
      if (rest.length) seen.add(copy ? 'copy' : 'split');
      // Ambiguity carries to the pieces that keep or extend an ambiguous key.
      if (before.ambiguous.includes(parent)) { expect(uncertain.has(key), `${label}: ${key} descends from ambiguous ${parent}`).toBe(true); seen.add('inherited'); }
      if (uncertain.has(key)) continue;
      const i = copy ? Number(copy[1]) : 0, [dx, dy] = step.spacing ?? [0, 0];
      expect(meets(after.boxes.get(key)!, shifted(before.boxes.get(parent)!, i * dx, i * dy)), `${label}: ${key} lies away from ${parent}`).toBe(true);
    }
    // No piece before disappears silently: each is continued, reported lost or left unidentified.
    for (const earlier of before.pieces ?? []) {
      const kept = pieces.some(key => key === earlier || key.startsWith(`${earlier}/`));
      expect(kept || lostNow.includes(earlier) || uncertain.has(earlier), `${label}: ${earlier} vanished unreported`).toBe(true);
    }
    for (const key of lost) expect(resolve(model, key), `${label}: lost ${key}`).toEqual({ status: 'missing' });
    return after;
  }

  it('never repeats a key, inherits only certain lineage and reports every loss', () => {
    let steps = 0;
    const seen = new Set<string>();
    for (let seed = 1; seed <= 10; seed++) {
      const rand = random(seed), features: CadFeature[] = [...seed % 2 ? box : disc], lost = new Set<string>();
      let before = built(features, snapshot), target = 'box', patterns = 0, last: CadFeature[] = features;
      for (let n = 0, tries = 0; n < 5 && tries < 12; tries++) {
        const step = nextStep(rand, `s${n}`, target, before.bounds, patterns), candidate = [...features, ...step.features];
        let parsed: CadDocument;
        // Overlapping join profiles are refused before the kernel; such a step is drawn again.
        try { parsed = document(candidate); } catch { continue; }
        const model = buildCadKernelModel(parsed);
        try {
          // A step the kernel refuses, or that removes the whole body, is drawn again.
          if (model.result.diagnostics.length || model.result.meshes.length !== 1) continue;
          const label = `seed ${seed}, step ${n}: ${JSON.stringify(step.features.at(-1))}`;
          before = check(model, step, before, lost, seen, label);
          features.push(...step.features); target = step.id; last = candidate; n++; steps++;
          if (step.spacing) patterns++;
        } finally { model.dispose(); }
      }
      // A rebuild derives the same bodies and issues.
      const first = built(last, model => structuredClone([model.result.bodies, model.result.bodyIssues]));
      expect(built(last, model => structuredClone([model.result.bodies, model.result.bodyIssues])), `seed ${seed}`).toEqual(first);
    }
    // The histories reach every case the rule distinguishes.
    expect(steps).toBeGreaterThanOrEqual(40);
    expect([...seen].sort()).toEqual(['ambiguous', 'copy', 'fresh', 'inherited', 'lost', 'split', 'unidentified']);
  }, 240_000);
});

