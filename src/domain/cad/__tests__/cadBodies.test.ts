import { describe, expect, it, vi } from 'vitest';
import type { CadDocument, CadFeature } from '../cadDocument';
import { createCadDocument, parseCadDocument } from '../cadSchema';
import {
  cadBodyKey, cadBodyLineage, cadBodyMetadataOrphans, cadBodyPieces, cadSelectedBody, cadVisibleBodyIds, createCadBodyLineage, isCadBodyIssue, isCadBodyKey,
  isCadBodyState, MAX_CAD_BODY_KEY_LENGTH, parseCadBodyKey, resolveCadBodyMetadata, resolveCadBodyRef, type CadBodyKernelFacts, type CadBodyKey, type CadBodyState
} from '../cadBodies';

const base = (id: string, suppressed = false) => ({ id, name: `${id} feature`, suppressed });
const sketch = (id: string, x = 0, width = 40): CadFeature => ({ ...base(id), kind: 'sketch', plane: 'XY', offset: 0,
  profiles: [{ id: `${id}_profile`, name: 'Profile', construction: false, geometry: { kind: 'rectangle', x, y: 0, width, height: 20, cornerRadius: 0 } }] });
const pad = (id: string, sketchId: string, operation: 'new' | 'join' | 'cut' = 'new', targetId: string | null = null, suppressed = false): CadFeature =>
  ({ ...base(id, suppressed), kind: 'extrude', sketchId, distance: 10, symmetric: false, operation, targetId });
const box = [sketch('box_sketch'), pad('box', 'box_sketch')];
const peg = [sketch('peg_sketch', 60, 10), pad('peg', 'peg_sketch')];
const document = (features: readonly CadFeature[]): CadDocument => parseCadDocument({ ...createCadDocument('Bodies'), features });
const lineageOf = (features: readonly CadFeature[]) => { const parsed = document(features); return cadBodyLineage(parsed.features, parsed); };
const key = (text: string) => text as CadBodyKey;
const summary = (body: CadBodyState | undefined) => body && { key: body.key, createdBy: body.createdBy, modifiedBy: body.modifiedBy, consumedBy: body.consumedBy };

describe('body keys', () => {
  it('writes and reads the creating feature and its occurrences', () => {
    expect(cadBodyKey('pad')).toBe('pad');
    expect(cadBodyKey('flip', [{ kind: 'mirror' }])).toBe('flip/mirror');
    const nested = cadBodyKey('pad', [{ kind: 'inst', i: 2, j: 0 }, { kind: 'split', k: 1 }]);
    expect(nested).toBe('pad/inst(2,0)/split(1)');
    expect(parseCadBodyKey(nested)).toEqual({ featureId: 'pad', occurrences: [{ kind: 'inst', i: 2, j: 0 }, { kind: 'split', k: 1 }] });
    expect(isCadBodyKey('flip/mirror')).toBe(true);
  });

  it.each(['', '-pad', 'pad/', 'pad//mirror', 'pad/split(01)', 'pad/inst(1)', 'pad/split(-1)', 'pad/Mirror', 'pad/split(1) ', 'pad/mirror\n', 'pad/mirrorsplit(1)',
    'a'.repeat(97)])('refuses %j', text => {
    expect(parseCadBodyKey(text)).toBeUndefined();
    expect(isCadBodyKey(text)).toBe(false);
  });

  it('checks a key in one pass exactly as it parses it', () => {
    for (const text of ['pad', 'a'.repeat(96), 'flip/mirror', 'pad/inst(999999,0)/split(12)/mirror', 'pad/split(0)/split(1)', 'pad/inst(1000000,0)', 'pad/split(1)x'])
      expect(isCadBodyKey(text), text).toBe(parseCadBodyKey(text) !== undefined);
  });

  it('refuses text longer than the key limit and values that are not text', () => {
    const long = `pad${'/mirror'.repeat(MAX_CAD_BODY_KEY_LENGTH / 7)}`;
    expect(parseCadBodyKey(long)).toBeUndefined();
    expect(isCadBodyKey(long)).toBe(false);
    expect(parseCadBodyKey(7)).toBeUndefined();
    expect(isCadBodyKey(7)).toBe(false);
  });
});

describe('body lineage', () => {
  it('keeps a body key through fillet, chamfer, shell, transform, pocket and cut', () => {
    const features: CadFeature[] = [...box,
      { ...base('round'), kind: 'fillet', targetId: 'box', radius: 1 },
      { ...base('bevel'), kind: 'chamfer', targetId: 'round', radius: 0.5 },
      { ...base('hollow'), kind: 'shell', targetId: 'bevel', thickness: 1, opening: { kind: 'faces', expectedCount: 1, predicates: [{ kind: 'plane', normal: [0, 0, 1], offset: 10 }] } },
      { ...base('move'), kind: 'transform', sourceId: 'hollow', translation: [5, 0, 0], rotation: [0, 0, 0] },
      sketch('hole_sketch', 10, 4), { ...base('hole'), kind: 'pocket', sketchId: 'hole_sketch', targetId: 'move', extent: { kind: 'through-all', direction: 'both' } },
      sketch('slot_sketch', 20, 2), pad('slot', 'slot_sketch', 'cut', 'hole')];
    const parsed = document(features), lineage = createCadBodyLineage();
    for (const feature of parsed.features) {
      const planned = lineage.keyFor(feature, parsed);
      const change = lineage.apply(feature, parsed);
      expect(change?.state.key).toBe(planned);
      if (change && feature.id !== 'box') expect(change.kept, feature.id).toBe(true);
    }
    expect(lineage.bodies().map(summary)).toEqual([{ key: 'box', createdBy: 'box', modifiedBy: ['round', 'bevel', 'hollow', 'move', 'hole', 'slot'], consumedBy: undefined }]);
    expect(lineage.at('slot')?.key).toBe('box');
    expect(lineage.at('box')).toBeUndefined();
    for (const id of ['box', 'round', 'bevel', 'hollow', 'move', 'hole', 'slot']) expect(lineage.of(id)?.key, id).toBe('box');
    expect(lineage.of('box_sketch')).toBeUndefined();
  });

  it('keeps the target of a boolean and consumes its tool', () => {
    for (const operation of ['union', 'cut', 'intersect'] as const) {
      const lineage = lineageOf([...box, ...peg, { ...base('merge'), kind: 'boolean', targetId: 'box', toolId: 'peg', operation }]);
      expect(lineage.bodies().map(summary)).toEqual([{ key: 'box', createdBy: 'box', modifiedBy: ['merge'], consumedBy: undefined }]);
      expect(lineage.consumed().map(summary)).toEqual([{ key: 'peg', createdBy: 'peg', modifiedBy: [], consumedBy: 'merge' }]);
      expect(lineage.get(key('peg'))).toBeUndefined();
      expect(lineage.of('peg')).toBeUndefined();
      expect(lineage.of('merge')?.key).toBe('box');
    }
  });

  it('gives pattern copies inst(i,j) keys inside the patterned body', () => {
    const row = lineageOf([...box, { ...base('row'), kind: 'linear-pattern', sourceId: 'box', count: 3, spacing: [50, 0, 0] }]).at('row');
    expect(row?.key).toBe('box');
    expect(row?.occurrences).toEqual(['box/inst(0,0)', 'box/inst(1,0)', 'box/inst(2,0)']);
    const ring = lineageOf([...box, { ...base('ring'), kind: 'circular-pattern', sourceId: 'box', count: 2, axis: 'z', center: [0, -30, 0], angle: 360 }]).at('ring');
    expect(ring?.occurrences).toEqual(['box/inst(0,0)', 'box/inst(1,0)']);
    const grid = lineageOf([...box, { ...base('row'), kind: 'linear-pattern', sourceId: 'box', count: 2, spacing: [50, 0, 0] },
      { ...base('column'), kind: 'linear-pattern', sourceId: 'row', count: 2, spacing: [0, 30, 0] }]).at('column');
    expect(grid).toMatchObject({ key: 'box', modifiedBy: ['row', 'column'] });
    expect(grid?.occurrences).toEqual(['box/inst(0,0)/inst(0,0)', 'box/inst(1,0)/inst(0,0)', 'box/inst(0,0)/inst(1,0)', 'box/inst(1,0)/inst(1,0)']);
  });

  it('gives a mirror image a mirror key of its own and leaves its source', () => {
    const lineage = lineageOf([...box, { ...base('flip'), kind: 'mirror', sourceId: 'box', plane: 'YZ' }, { ...base('again'), kind: 'mirror', sourceId: 'flip', plane: 'XZ' }]);
    expect(lineage.bodies().map(summary)).toEqual([
      { key: 'box', createdBy: 'box', modifiedBy: [], consumedBy: undefined },
      { key: 'flip/mirror', createdBy: 'flip', modifiedBy: [], consumedBy: undefined },
      { key: 'again/mirror', createdBy: 'again', modifiedBy: [], consumedBy: undefined }]);
    expect(lineage.of('flip')?.key).toBe('flip/mirror');
  });

  it('gives an imported solid the key of its feature', () => {
    const imported = { ...base('part'), kind: 'imported', source: {} } as unknown as CadFeature;
    const lineage = cadBodyLineage([imported, { ...base('round'), kind: 'fillet', targetId: 'part', radius: 1 }], { parameters: {} });
    expect(lineage.bodies().map(summary)).toEqual([{ key: 'part', createdBy: 'part', modifiedBy: ['round'], consumedBy: undefined }]);
    expect(cadBodyLineage([{ ...imported, suppressed: true }], { parameters: {} }).bodies()).toEqual([]);
  });

  it('passes identity through a suppressed feature as its suppression policy says', () => {
    const fillet = lineageOf([...box, { ...base('round', true), kind: 'fillet', targetId: 'box', radius: 1 }]);
    expect(fillet.bodies().map(summary)).toEqual([{ key: 'box', createdBy: 'box', modifiedBy: [], consumedBy: undefined }]);
    expect(fillet.of('round')?.key).toBe('box');
    expect(fillet.at('round')).toBeUndefined();
    const merge = lineageOf([...box, ...peg, { ...base('merge', true), kind: 'boolean', targetId: 'box', toolId: 'peg', operation: 'union' }]);
    expect(merge.bodies().map(body => body.key)).toEqual(['box', 'peg']);
    expect(merge.of('merge')?.key).toBe('box');
    const mirror = lineageOf([...box, { ...base('flip', true), kind: 'mirror', sourceId: 'box', plane: 'YZ' }]);
    expect(mirror.bodies().map(body => body.key)).toEqual(['box']);
    expect(mirror.of('flip')).toBeUndefined();
    const created = lineageOf([sketch('box_sketch'), pad('box', 'box_sketch', 'new', null, true), ...peg]);
    expect(created.bodies().map(body => body.key)).toEqual(['peg']);
    expect(created.of('box')).toBeUndefined();
  });

  it('changes keys on reorder and delete only where creation changed', () => {
    const round = { ...base('round'), kind: 'fillet', targetId: 'box', radius: 1 } as CadFeature;
    const keys = (features: readonly CadFeature[]) => lineageOf(features).bodies().map(body => body.key).sort();
    expect(keys([...box, ...peg, round])).toEqual(['box', 'peg']);
    expect(keys([...box, round, ...peg])).toEqual(['box', 'peg']);
    expect(keys([...peg, ...box, round])).toEqual(['box', 'peg']);
    expect(keys([...box, ...peg])).toEqual(['box', 'peg']);
    expect(keys([...peg])).toEqual(['peg']);
    expect(lineageOf([...box, round, ...peg]).bodies().map(body => body.key)).toEqual(['box', 'peg']);
    expect(lineageOf([...box, ...peg, round]).bodies().map(body => body.key)).toEqual(['peg', 'box']);
  });

  it('lists the ids of current bodies as the features whose results they are', () => {
    const parsed = document([...box, ...peg, { ...base('round'), kind: 'fillet', targetId: 'box', radius: 1 }]);
    expect(cadVisibleBodyIds(parsed.features, parsed)).toEqual(['peg', 'round']);
    expect(createCadBodyLineage().latest()).toBeUndefined();
    expect(cadBodyLineage(parsed.features, parsed).latest()?.key).toBe('box');
  });
});

describe('split pieces', () => {
  const facts = (solids: number, origins: readonly ({ solid: number; rank: number } | null)[], extra: Partial<CadBodyKernelFacts> = {}): CadBodyKernelFacts =>
    ({ solids, removesMaterial: true, origins: vi.fn(() => origins), ...extra });
  const previous = (pieces?: readonly string[]): CadBodyState => ({ key: key('pad'), kind: 'solid', createdBy: 'pad', modifiedBy: [], ...(pieces ? { pieces: pieces.map(key) } : {}) });
  const split = (input: { before?: readonly string[]; beforeSolids?: number; facts: CadBodyKernelFacts }) =>
    cadBodyPieces({ key: key('pad'), before: input.before?.map(key), beforeSolids: input.beforeSolids ?? input.before?.length ?? 1, facts: input.facts, previous: previous(input.before) });

  it('numbers the pieces of a first split by the first face each keeps, not by the kernel order', () => {
    expect(split({ facts: facts(2, [{ solid: 0, rank: 9 }, { solid: 0, rank: 4 }]) })).toEqual({ pieces: ['pad/split(1)', 'pad/split(0)'], ambiguous: [] });
    expect(split({ facts: facts(3, [{ solid: 0, rank: 2 }, { solid: 0, rank: 7 }, { solid: 0, rank: 5 }]) }).pieces).toEqual(['pad/split(0)', 'pad/split(2)', 'pad/split(1)']);
  });

  it('reports pieces that keep no face of the body before as ambiguous', () => {
    expect(split({ facts: facts(3, [{ solid: 0, rank: 3 }, null, null]) })).toEqual({ pieces: ['pad/split(0)', 'pad/split(1)', 'pad/split(2)'], ambiguous: ['pad/split(1)', 'pad/split(2)'] });
    expect(split({ facts: facts(2, [{ solid: 0, rank: 3 }, null]) })).toEqual({ pieces: ['pad/split(0)', 'pad/split(1)'], ambiguous: [] });
  });

  it('tracks no pieces for several solids that no material removal split', () => {
    const joined = facts(2, [], { removesMaterial: false });
    expect(split({ facts: joined })).toEqual({ ambiguous: [] });
    expect(joined.origins).not.toHaveBeenCalled();
    expect(split({ beforeSolids: 2, facts: facts(2, []) })).toEqual({ ambiguous: [] });
  });

  it('follows each piece by its kept faces, and splits a piece under its own key', () => {
    expect(split({ before: ['pad/split(0)', 'pad/split(1)'], facts: facts(3, [{ solid: 1, rank: 5 }, { solid: 0, rank: 2 }, { solid: 1, rank: 3 }]) }))
      .toEqual({ pieces: ['pad/split(1)/split(1)', 'pad/split(0)', 'pad/split(1)/split(0)'], ambiguous: [] });
  });

  it('gives a piece that keeps no face the one piece left, or reports the choice when several are', () => {
    expect(split({ before: ['pad/split(0)', 'pad/split(1)'], facts: facts(2, [{ solid: 0, rank: 1 }, null]) })).toEqual({ pieces: ['pad/split(0)', 'pad/split(1)'], ambiguous: [] });
    expect(split({ before: ['pad/split(0)', 'pad/split(1)', 'pad/split(2)'], facts: facts(2, [{ solid: 0, rank: 1 }, null]) }))
      .toEqual({ pieces: ['pad/split(0)', 'pad/split(1)'], ambiguous: ['pad/split(1)'] });
    expect(split({ before: ['pad/split(0)', 'pad/split(1)'], facts: facts(3, [{ solid: 0, rank: 1 }, { solid: 1, rank: 2 }, null], { removesMaterial: false }) }))
      .toEqual({ pieces: ['pad/split(0)', 'pad/split(1)', 'pad/split(2)'], ambiguous: [] });
  });

  it('carries pieces through a feature that keeps the solid order, and drops them once whole', () => {
    const moved = facts(2, [], { removesMaterial: false, sameSolidOrder: true });
    expect(split({ before: ['pad/split(1)', 'pad/split(0)'], facts: moved })).toEqual({ pieces: ['pad/split(1)', 'pad/split(0)'], ambiguous: [] });
    expect(moved.origins).not.toHaveBeenCalled();
    expect(split({ before: ['pad/split(0)', 'pad/split(1)'], facts: facts(1, []) })).toEqual({ ambiguous: [] });
  });

  it('refuses origins that do not describe every solid', () => {
    expect(() => split({ facts: facts(2, [{ solid: 0, rank: 1 }]) })).toThrow('Each solid of the result needs an origin.');
  });

  it('records ambiguity as an issue, and leaves the lineage unchanged when the kernel facts fail', () => {
    const parsed = document([...box, sketch('slot_sketch', 18, 4), pad('slot', 'slot_sketch', 'cut', 'box')]);
    const lineage = createCadBodyLineage();
    const [boxSketch, boxPad, slotSketch, slot] = parsed.features;
    for (const feature of [boxSketch, boxPad, slotSketch]) lineage.apply(feature, parsed, { solids: 1, removesMaterial: false, origins: () => [] });
    const before = lineage.bodies();
    expect(() => lineage.apply(slot, parsed, { solids: 2, removesMaterial: true, origins: () => { throw new Error('kernel failed'); } })).toThrow('kernel failed');
    expect(lineage.bodies()).toEqual(before);
    expect(lineage.at('box')?.key).toBe('box');
    const change = lineage.apply(slot, parsed, { solids: 2, removesMaterial: true, origins: () => [null, null] });
    expect(change?.state).toMatchObject({ key: 'box', modifiedBy: ['slot'], pieces: ['box/split(0)', 'box/split(1)'], ambiguous: ['box/split(0)', 'box/split(1)'] });
    expect(lineage.issues()).toEqual([expect.objectContaining({ code: 'ambiguous-split-order', featureId: 'slot', body: 'box', pieces: ['box/split(0)', 'box/split(1)'] })]);
    expect(lineage.issues().every(isCadBodyIssue)).toBe(true);
  });
});

describe('body references, metadata and selection', () => {
  const split: CadBodyState = { key: key('box'), kind: 'solid', createdBy: 'box', modifiedBy: ['slot'], pieces: [key('box/split(0)'), key('box/split(1)')], ambiguous: [key('box/split(1)')] };
  const lineage = lineageOf([...box, ...peg, { ...base('merge'), kind: 'boolean', targetId: 'box', toolId: 'peg', operation: 'union' },
    { ...base('row'), kind: 'linear-pattern', sourceId: 'merge', count: 2, spacing: [80, 0, 0] }]);

  it('resolves a stored body reference to a body, a part of one, or why it is missing', () => {
    expect(resolveCadBodyRef({ kind: 'body', key: key('box') }, lineage)).toMatchObject({ status: 'resolved', body: { key: 'box' } });
    expect(resolveCadBodyRef({ kind: 'body', key: key('box/inst(1,0)') }, lineage)).toMatchObject({ status: 'resolved', body: { key: 'box' }, part: 'box/inst(1,0)' });
    expect(resolveCadBodyRef({ kind: 'body', key: key('box/inst(7,0)') }, lineage)).toEqual({ status: 'missing' });
    expect(resolveCadBodyRef({ kind: 'body', key: key('peg') }, lineage)).toEqual({ status: 'missing', consumedBy: 'merge' });
    const pieces = { ...lineage, bodies: () => [split], get: () => undefined } as typeof lineage;
    expect(resolveCadBodyRef({ kind: 'body', key: key('box/split(0)') }, pieces)).toMatchObject({ status: 'resolved', part: 'box/split(0)' });
    expect(resolveCadBodyRef({ kind: 'body', key: key('box/split(1)') }, pieces)).toMatchObject({ status: 'ambiguous', candidates: ['box/split(1)'] });
  });

  it('names a body after its creating feature until metadata is stored, and lists orphaned metadata', () => {
    const body = lineage.bodies()[0];
    expect(resolveCadBodyMetadata(body, id => `${id} name`)).toEqual({ name: 'box name', role: 'part' });
    const stored = new Map([[key('box'), { name: 'Stock', role: 'stock' as const, appearance: { color: '#336699' } }], [key('gone'), { name: 'Gone', role: 'part' as const }]]);
    expect(resolveCadBodyMetadata(body, () => undefined, stored)).toEqual({ name: 'Stock', role: 'stock', appearance: { color: '#336699' } });
    expect(cadBodyMetadataOrphans(stored, lineage)).toEqual(['gone']);
  });

  it('selects the body a selected feature leads to, wherever it is in the history, before the latest drawn body', () => {
    const two = lineageOf([...box, { ...base('round'), kind: 'fillet', targetId: 'box', radius: 1 }, ...peg]);
    expect(cadSelectedBody(two, 'box', ['round', 'peg'])?.key).toBe('box');
    expect(cadSelectedBody(two, 'round', ['round', 'peg'])?.key).toBe('box');
    expect(cadSelectedBody(two, 'box_sketch', ['round', 'peg'])?.key).toBe('peg');
    expect(cadSelectedBody(two, null, ['round', 'peg'])?.key).toBe('peg');
    expect(cadSelectedBody(two, 'box', ['peg'])?.key).toBe('peg');
    expect(cadSelectedBody(two, null, ['round', 'peg'], key('peg'))?.key).toBe('box');
    expect(cadSelectedBody(two, 'peg', [])).toBeUndefined();
  });

  it('checks body states and issues received across the worker boundary', () => {
    for (const body of [...lineage.bodies(), ...lineage.consumed(), split]) expect(isCadBodyState(JSON.parse(JSON.stringify(body)))).toBe(true);
    expect(isCadBodyState({ ...split, createdBy: 'other' })).toBe(false);
    expect(isCadBodyState({ ...split, kind: 'mesh' })).toBe(false);
    expect(isCadBodyState({ ...split, pieces: ['peg/split(0)'] })).toBe(false);
    expect(isCadBodyState({ ...split, modifiedBy: ['bad id'] })).toBe(false);
    expect(isCadBodyIssue({ code: 'ambiguous-split-order', featureId: 'slot', body: 'box', pieces: ['peg/split(0)'], message: 'x' })).toBe(false);
  });
});
