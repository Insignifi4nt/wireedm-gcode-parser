import { describe, expect, it, vi } from 'vitest';
import type { CadDocument, CadFeature } from '../cadDocument';
import { createCadDocument, parseCadDocument } from '../cadSchema';
import {
  cadBodyKey, cadBodyLineage, cadBodyMetadataOrphans, cadBodyParts, cadSelectedBody, cadVisibleBodyIds, createCadBodyLineage, isCadBodyIssue, isCadBodyKey,
  isCadBodyState, MAX_CAD_BODY_ISSUES, MAX_CAD_BODY_KEY_LENGTH, MAX_CAD_BODY_LIST, parseCadBodyKey, resolveCadBodyMetadata, resolveCadBodyRef,
  type CadBodyKernelFacts, type CadBodyKey, type CadBodySource, type CadBodyState
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

  it('keeps the source key through a pattern, whose copies only the kernel can tell apart', () => {
    const row = lineageOf([...box, { ...base('row'), kind: 'linear-pattern', sourceId: 'box', count: 3, spacing: [50, 0, 0] }]).at('row');
    expect(row).toMatchObject({ key: 'box', modifiedBy: ['row'] });
    expect(row?.pieces).toBeUndefined();
    const ring = lineageOf([...box, { ...base('ring'), kind: 'circular-pattern', sourceId: 'box', count: 2, axis: 'z', center: [0, -30, 0], angle: 360 }]).at('ring');
    expect(ring).toMatchObject({ key: 'box', modifiedBy: ['ring'] });
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

describe('body parts', () => {
  type Entry = readonly [source: number, solid: number, rank: number];
  const target = [{ kind: 'target' }] as const, fused = [{ kind: 'target' }, { kind: 'tool' }] as const;
  const copies = (n: number): CadBodySource[] => [{ kind: 'target' }, ...Array.from({ length: n }, (_, index) => ({ kind: 'copy' as const, i: index + 1, j: 0 }))];
  const facts = (solids: number, traced: readonly (readonly Entry[])[], extra: Partial<CadBodyKernelFacts> = {}): CadBodyKernelFacts =>
    ({ solids, removesMaterial: true, sources: target, provenance: vi.fn(() => traced.map(list => list.map(([source, solid, rank]) => ({ source, solid, rank })))), ...extra });
  const previous = (pieces?: readonly string[], ambiguous?: readonly string[]): CadBodyState =>
    ({ key: key('pad'), kind: 'solid', createdBy: 'pad', modifiedBy: ['cut'], ...(pieces ? { pieces: pieces.map(key) } : {}), ...(ambiguous ? { ambiguous: ambiguous.map(key) } : {}) });
  const parts = (input: { before?: readonly string[]; ambiguous?: readonly string[]; beforeSolids?: number; facts: CadBodyKernelFacts }) =>
    cadBodyParts({ featureId: 'cut', previous: previous(input.before, input.ambiguous), beforeSolids: input.beforeSolids ?? input.before?.length ?? 1, facts: input.facts });
  const changed = (pieces: readonly string[], rest: { ambiguous?: readonly string[]; ambiguousNow?: readonly string[]; lost?: readonly string[] } = {}) =>
    ({ pieces, ...(rest.ambiguous ? { ambiguous: rest.ambiguous } : {}), ambiguousNow: rest.ambiguousNow ?? rest.ambiguous ?? [], lost: rest.lost ?? [] });
  const whole = { ambiguousNow: [], lost: [] };
  const A = 'pad/split(0)', B = 'pad/split(1)';

  it('numbers the pieces of a first split by the first face each keeps, not by the kernel order', () => {
    expect(parts({ facts: facts(2, [[[0, 0, 9]], [[0, 0, 4]]]) })).toEqual(changed(['pad/split(1)', 'pad/split(0)']));
    expect(parts({ facts: facts(3, [[[0, 0, 2]], [[0, 0, 7]], [[0, 0, 5]]]) }).pieces).toEqual(['pad/split(0)', 'pad/split(2)', 'pad/split(1)']);
  });

  it('numbers pieces that keep no face after the others, and reports two or more of them as ambiguous', () => {
    expect(parts({ facts: facts(3, [[[0, 0, 3]], [], []]) })).toEqual(changed(['pad/split(0)', 'pad/split(1)', 'pad/split(2)'], { ambiguous: ['pad/split(1)', 'pad/split(2)'] }));
    expect(parts({ facts: facts(2, [[[0, 0, 3]], []]) })).toEqual(changed(['pad/split(0)', 'pad/split(1)']));
  });

  it('keeps a body whole until one of its solids splits, whatever the totals', () => {
    const joined = facts(2, [], { removesMaterial: false, sources: fused });
    expect(parts({ facts: joined })).toEqual(whole);
    expect(joined.provenance).not.toHaveBeenCalled();
    expect(parts({ beforeSolids: 2, facts: facts(2, [[[0, 0, 1]], [[0, 1, 4]]]) })).toEqual(whole);
    // Two solids in and two out: the first split in two and the second went.
    expect(parts({ beforeSolids: 2, facts: facts(2, [[[0, 0, 1]], [[0, 0, 5]]]) })).toEqual(changed(['pad/split(0)', 'pad/split(1)']));
  });

  it('follows each piece by its kept faces, and splits a piece under its own key', () => {
    expect(parts({ before: [A, B], facts: facts(3, [[[0, 1, 5]], [[0, 0, 2]], [[0, 1, 3]]]) }))
      .toEqual(changed(['pad/split(1)/split(1)', A, 'pad/split(1)/split(0)']));
  });

  it('gives a solid that keeps no face a fresh key, never a piece left over, and reports what it could be', () => {
    expect(parts({ before: [A, B], facts: facts(2, [[[0, 0, 1]], []]) })).toEqual(changed([A, 'cut/split(0)'], { ambiguous: ['cut/split(0)', B] }));
    // With one piece before and no material added, a solid keeping no face can only come from that piece.
    expect(parts({ before: [A], facts: facts(2, [[[0, 0, 1]], []]) })).toEqual(changed([`${A}/split(0)`, `${A}/split(1)`]));
    // A fused tool could have made it, so it is fresh even beside one piece.
    expect(parts({ before: [A], facts: facts(2, [[[0, 0, 1]], []], { removesMaterial: false, sources: fused }) })).toEqual(changed([A, 'cut/split(0)']));
  });

  it('reports pieces a feature removed or merged as lost, and gives a merged solid a fresh key', () => {
    expect(parts({ before: [A, B], facts: facts(1, [[[0, 0, 1]]]) })).toEqual(changed([A], { lost: [B] }));
    // A join bridging both pieces and adding an island: the island is the tool's alone, the bridge merges both pieces.
    expect(parts({ before: [A, B], facts: facts(2, [[[0, 0, 1], [0, 1, 2], [1, 0, 3]], [[1, 0, 1]]], { removesMaterial: false, sources: fused }) }))
      .toEqual(changed(['cut/split(1)', 'cut/split(0)'], { lost: [A, B] }));
    // A tool fused into one piece keeps that piece's key.
    expect(parts({ before: [A, B], facts: facts(2, [[[0, 0, 1], [1, 0, 2]], [[0, 1, 1]]], { removesMaterial: false, sources: fused }) })).toEqual(changed([A, B]));
  });

  it('carries ambiguity to surviving pieces and their descendants', () => {
    expect(parts({ before: [A, B], ambiguous: [A, B], facts: facts(2, [[[0, 0, 1]], [[0, 1, 1]]]) })).toEqual(changed([A, B], { ambiguous: [A, B], ambiguousNow: [] }));
    expect(parts({ before: [A, B], ambiguous: [A, B], facts: facts(3, [[[0, 0, 1]], [[0, 0, 4]], [[0, 1, 1]]]) }))
      .toEqual(changed([`${A}/split(0)`, `${A}/split(1)`, B], { ambiguous: [`${A}/split(0)`, `${A}/split(1)`, B], ambiguousNow: [`${A}/split(0)`, `${A}/split(1)`] }));
    // Merging an ambiguous piece leaves the merged solid ambiguous; a lost one leaves the ambiguity, and earlier unidentified keys, to the rest.
    expect(parts({ before: [A, B, 'pad/split(2)'], ambiguous: [A, B, 'gone/split(0)'], facts: facts(2, [[[0, 0, 1], [0, 2, 1]], [[0, 1, 1]]], { removesMaterial: false, sources: fused }) }))
      .toEqual(changed(['cut/split(0)', B], { ambiguous: ['cut/split(0)', B, 'gone/split(0)'], ambiguousNow: ['cut/split(0)'], lost: [A, 'pad/split(2)'] }));
    expect(parts({ before: [A, B], ambiguous: [A, B], facts: facts(1, [[[0, 1, 1]]]) })).toEqual(changed([B], { ambiguous: [B], ambiguousNow: [], lost: [A] }));
  });

  it('keys a pattern copy apart from the originals by the copy it keeps faces of, the original itself being inst(0,0)', () => {
    const pattern = (solids: number, traced: readonly (readonly Entry[])[], n = 2) => facts(solids, traced, { removesMaterial: false, sources: copies(n) });
    expect(parts({ facts: pattern(3, [[[0, 0, 1]], [[1, 0, 1]], [[2, 0, 1]]]) })).toEqual(changed(['pad/inst(0,0)', 'pad/inst(1,0)', 'pad/inst(2,0)']));
    // Copies fused into the originals leave the body whole.
    expect(parts({ beforeSolids: 2, facts: pattern(2, [[[0, 0, 1], [1, 0, 1]], [[0, 1, 3], [1, 1, 3]]], 1) })).toEqual(whole);
    // Copies fused into each other, away from the original, merge without a target.
    expect(parts({ facts: pattern(2, [[[0, 0, 1]], [[1, 0, 1], [2, 0, 1]]]) })).toEqual(changed(['pad/inst(0,0)', 'cut/split(0)']));
    expect(parts({ before: [A, B], facts: pattern(4, [[[0, 0, 1]], [[0, 1, 1]], [[1, 0, 1]], [[1, 1, 1]]], 1) }))
      .toEqual(changed([`${A}/inst(0,0)`, `${B}/inst(0,0)`, `${A}/inst(1,0)`, `${B}/inst(1,0)`]));
    // A copy that vanished is never listed.
    expect(parts({ before: ['pad/inst(0,0)', 'pad/inst(1,0)'], facts: facts(1, [[[0, 0, 1]]]) })).toEqual(changed(['pad/inst(0,0)'], { lost: ['pad/inst(1,0)'] }));
  });

  it('carries pieces through a feature that keeps the solid order, and keeps them when one solid is left', () => {
    const moved = facts(2, [], { removesMaterial: false, sameSolidOrder: true });
    expect(parts({ before: [B, A], ambiguous: [A], facts: moved })).toEqual({ pieces: [B, A], ambiguous: [A], ambiguousNow: [], lost: [] });
    expect(moved.provenance).not.toHaveBeenCalled();
    expect(parts({ before: [A, B], facts: facts(1, [[[0, 1, 1], [0, 0, 1]]]) })).toEqual(changed(['cut/split(0)'], { lost: [A, B] }));
  });

  it('stops tracking parts past the limits instead of failing the build', () => {
    const many = facts(MAX_CAD_BODY_LIST + 1, []);
    expect(parts({ facts: many })).toEqual({ untracked: true, ambiguousNow: [], lost: [], overflowed: true });
    expect(many.provenance).not.toHaveBeenCalled();
    const long = `pad${'/split(0)'.repeat(Math.floor((MAX_CAD_BODY_KEY_LENGTH - 3) / 9))}`;
    expect(parts({ before: [long], facts: facts(2, [[[0, 0, 1]], [[0, 0, 2]]]) })).toMatchObject({ untracked: true, overflowed: true });
    expect(cadBodyParts({ featureId: 'cut', previous: { ...previous(), untracked: true }, beforeSolids: 9, facts: facts(9, []) })).toEqual({ untracked: true, ambiguousNow: [], lost: [] });
  });

  it('refuses provenance that does not describe every solid', () => {
    expect(() => parts({ facts: facts(2, [[[0, 0, 1]]]) })).toThrow('Each solid of the result needs its sources.');
  });

  it('records issues with bounded messages, and leaves the lineage unchanged when the kernel facts fail', () => {
    const parsed = document([...box, sketch('slot_sketch', 18, 4), pad('slot', 'slot_sketch', 'cut', 'box')]);
    const lineage = createCadBodyLineage();
    const [boxSketch, boxPad, slotSketch, slot] = parsed.features;
    for (const feature of [boxSketch, boxPad, slotSketch]) lineage.apply(feature, parsed, facts(1, []));
    const before = lineage.bodies();
    expect(() => lineage.apply(slot, parsed, { ...facts(2, []), provenance: () => { throw new Error('kernel failed'); } })).toThrow('kernel failed');
    expect(lineage.bodies()).toEqual(before);
    expect(lineage.at('box')?.key).toBe('box');
    const change = lineage.apply(slot, parsed, facts(2, [[], []]));
    expect(change?.state).toMatchObject({ key: 'box', modifiedBy: ['slot'], pieces: ['box/split(0)', 'box/split(1)'], ambiguous: ['box/split(0)', 'box/split(1)'] });
    expect(lineage.issues()).toEqual([{ code: 'ambiguous-body-parts', featureId: 'slot', body: 'box', pieces: ['box/split(0)', 'box/split(1)'],
      message: '2 pieces of body box can\'t be told apart after slot, so references to them are ambiguous.' }]);
    expect(lineage.issues().every(isCadBodyIssue)).toBe(true);
  });

  it('lists at most the issue limit, ending with a summary of the rest', () => {
    const cuts = Array.from({ length: MAX_CAD_BODY_ISSUES + 20 }, (_, index) => pad(`c${index}`, 'slot_sketch', 'cut', index ? `c${index - 1}` : 'box'));
    const parsed = document([...box, sketch('slot_sketch', 18, 4), ...cuts]), lineage = createCadBodyLineage();
    for (const feature of parsed.features) {
      const current = lineage.at(feature.kind === 'extrude' && feature.targetId ? feature.targetId : '');
      // Each cut leaves two solids keeping no face, so each reports new ambiguous pieces.
      lineage.apply(feature, parsed, current ? facts(2, [[], []]) : facts(1, []));
    }
    const issues = lineage.issues();
    expect(issues).toHaveLength(MAX_CAD_BODY_ISSUES);
    expect(issues.every(isCadBodyIssue)).toBe(true);
    expect(issues.at(-1)).toEqual({ code: 'more-body-issues', featureId: `c${MAX_CAD_BODY_ISSUES - 1}`, body: 'box', pieces: [],
      message: `21 more body issues, from feature c${MAX_CAD_BODY_ISSUES - 1} on, are not listed.` });
  });
});

describe('body references, metadata and selection', () => {
  const split: CadBodyState = { key: key('box'), kind: 'solid', createdBy: 'box', modifiedBy: ['slot', 'round'],
    pieces: [key('box/split(0)'), key('round/split(0)')], ambiguous: [key('round/split(0)'), key('box/split(1)')] };
  const lineage = lineageOf([...box, ...peg, { ...base('merge'), kind: 'boolean', targetId: 'box', toolId: 'peg', operation: 'union' }]);
  const holding = (...bodies: CadBodyState[]) => ({ ...lineage, bodies: () => bodies, get: () => undefined }) as typeof lineage;

  it('resolves a stored body reference to a body, a part of one, its candidates, or why it is missing', () => {
    expect(resolveCadBodyRef({ kind: 'body', key: key('box') }, lineage)).toMatchObject({ status: 'resolved', body: { key: 'box' } });
    expect(resolveCadBodyRef({ kind: 'body', key: key('box/inst(7,0)') }, lineage)).toEqual({ status: 'missing' });
    expect(resolveCadBodyRef({ kind: 'body', key: key('peg') }, lineage)).toEqual({ status: 'missing', consumedBy: 'merge' });
    expect(resolveCadBodyRef({ kind: 'body', key: key('box/split(0)') }, holding(split))).toMatchObject({ status: 'resolved', part: 'box/split(0)' });
    expect(resolveCadBodyRef({ kind: 'body', key: key('round/split(0)') }, holding(split))).toMatchObject({ status: 'ambiguous', candidates: ['round/split(0)'] });
    // An earlier piece no build could find among the solids may be any ambiguous one.
    expect(resolveCadBodyRef({ kind: 'body', key: key('box/split(1)') }, holding(split))).toMatchObject({ status: 'ambiguous', candidates: ['round/split(0)'] });
    expect(resolveCadBodyRef({ kind: 'body', key: key('box/split(1)') }, holding({ ...split, pieces: [key('box/split(0)')] }))).toEqual({ status: 'missing' });
    const consumed = { ...lineage, consumed: () => [{ ...split, consumedBy: 'merge' }] } as typeof lineage;
    expect(resolveCadBodyRef({ kind: 'body', key: key('box/split(0)') }, consumed)).toEqual({ status: 'missing', consumedBy: 'merge' });
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
    // Parts are made by the body's creator or a modifier, and never repeat the body's own key.
    expect(isCadBodyState({ ...split, pieces: ['peg/split(0)'] })).toBe(false);
    expect(isCadBodyState({ ...split, ambiguous: ['box'] })).toBe(false);
    expect(isCadBodyState({ ...split, modifiedBy: ['bad id'] })).toBe(false);
    expect(isCadBodyState({ ...split, untracked: true })).toBe(false);
    expect(isCadBodyState({ key: 'box', kind: 'solid', createdBy: 'box', modifiedBy: [], untracked: true })).toBe(true);
    // A history may modify a body any number of times.
    expect(isCadBodyState({ ...split, modifiedBy: Array.from({ length: MAX_CAD_BODY_LIST + 1 }, (_, index) => `f${index}`).concat('slot', 'round') })).toBe(true);
    const issue = { code: 'lost-body-parts', featureId: 'slot', body: 'box', pieces: ['peg/split(0)'], message: 'x' };
    expect(isCadBodyIssue(issue)).toBe(true);
    expect(isCadBodyIssue({ ...issue, code: 'ambiguous-split-order' })).toBe(false);
    expect(isCadBodyIssue({ ...issue, pieces: ['bad key'] })).toBe(false);
    expect(isCadBodyIssue({ ...issue, message: 'x'.repeat(8193) })).toBe(false);
  });
});
