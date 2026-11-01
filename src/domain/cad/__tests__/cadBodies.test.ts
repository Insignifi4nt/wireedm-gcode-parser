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
  type Groups = readonly (readonly string[])[];
  const target = [{ kind: 'target' }] as const, fused = [{ kind: 'target' }, { kind: 'tool' }] as const;
  const copies = (n: number): CadBodySource[] => [{ kind: 'target' }, ...Array.from({ length: n }, (_, index) => ({ kind: 'copy' as const, i: index + 1, j: 0 }))];
  const facts = (solids: number, traced: readonly (readonly Entry[])[], extra: Partial<CadBodyKernelFacts> = {}): CadBodyKernelFacts =>
    ({ solids, removesMaterial: true, sources: target, provenance: vi.fn(() => traced.map(list => list.map(([source, solid, rank]) => ({ source, solid, rank })))), ...extra });
  const previous = (pieces?: readonly string[], ambiguous?: Groups): CadBodyState =>
    ({ key: key('pad'), kind: 'solid', createdBy: 'pad', modifiedBy: ['cut'], ...(pieces ? { pieces: pieces.map(key) } : {}), ...(ambiguous ? { ambiguous: ambiguous.map(group => group.map(key)) } : {}) });
  const parts = (input: { before?: readonly string[]; ambiguous?: Groups; beforeSolids?: number; facts: CadBodyKernelFacts }) =>
    cadBodyParts({ featureId: 'cut', previous: previous(input.before, input.ambiguous), beforeSolids: input.beforeSolids ?? input.before?.length ?? 1, facts: input.facts });
  const changed = (pieces: readonly string[], rest: { ambiguous?: Groups; ambiguousNow?: readonly string[]; inherited?: readonly (readonly [string, string])[]; lost?: readonly string[] } = {}) =>
    ({ pieces, ...(rest.ambiguous ? { ambiguous: rest.ambiguous } : {}), ambiguousNow: rest.ambiguousNow ?? rest.ambiguous?.flat() ?? [], inherited: rest.inherited ?? [], lost: rest.lost ?? [] });
  const whole = { ambiguousNow: [], inherited: [], lost: [] };
  const A = 'pad/split(0)', B = 'pad/split(1)', C = 'pad/split(2)';

  it('numbers the pieces of a first split by the first face each keeps, not by the kernel order', () => {
    expect(parts({ facts: facts(2, [[[0, 0, 9]], [[0, 0, 4]]]) })).toEqual(changed(['pad/split(1)', 'pad/split(0)']));
    expect(parts({ facts: facts(3, [[[0, 0, 2]], [[0, 0, 7]], [[0, 0, 5]]]) }).pieces).toEqual(['pad/split(0)', 'pad/split(2)', 'pad/split(1)']);
  });

  it('numbers pieces that keep no face after the others, and reports two or more of them as ambiguous', () => {
    expect(parts({ facts: facts(3, [[[0, 0, 3]], [], []]) })).toEqual(changed(['pad/split(0)', 'pad/split(1)', 'pad/split(2)'], { ambiguous: [['pad/split(1)', 'pad/split(2)']] }));
    expect(parts({ facts: facts(2, [[[0, 0, 3]], []]) })).toEqual(changed(['pad/split(0)', 'pad/split(1)']));
  });

  it('keeps a body whole until one of its solids may have split, whatever the totals', () => {
    const joined = facts(2, [], { removesMaterial: false, sources: fused });
    expect(parts({ facts: joined })).toEqual(whole);
    expect(joined.provenance).not.toHaveBeenCalled();
    expect(parts({ beforeSolids: 2, facts: facts(2, [[[0, 0, 1]], [[0, 1, 4]]]) })).toEqual(whole);
    // Two solids in and two out: the first split in two and the second went.
    expect(parts({ beforeSolids: 2, facts: facts(2, [[[0, 0, 1]], [[0, 0, 5]]]) })).toEqual(changed(['pad/split(0)', 'pad/split(1)']));
    // A solid keeping no face may be a piece of either solid, so the body may have split although as many solids are left.
    expect(parts({ beforeSolids: 2, facts: facts(2, [[[0, 0, 1]], []]) })).toEqual(changed(['pad/split(0)', 'pad/split(1)']));
  });

  it('never orders pieces by faces of different solids, whose ranks follow the kernel order of those solids', () => {
    // A whole body of two solids, one of them split: which comes first depends on the order the kernel lists the two solids in.
    expect(parts({ beforeSolids: 2, facts: facts(3, [[[0, 0, 1]], [[0, 1, 2]], [[0, 0, 5]]]) }))
      .toEqual(changed(['pad/split(0)', 'pad/split(1)', 'pad/split(2)'], { ambiguous: [['pad/split(0)', 'pad/split(1)', 'pad/split(2)']] }));
    // The same holds for a fused tool of several solids, and for merges that decide by several solids of one source.
    expect(parts({ before: [A], facts: facts(3, [[[0, 0, 1]], [[1, 0, 1]], [[1, 1, 1]]], { removesMaterial: false, sources: fused }) }))
      .toEqual(changed([A, 'cut/split(0)', 'cut/split(1)'], { ambiguous: [['cut/split(0)', 'cut/split(1)']] }));
    expect(parts({ before: [A, B, C, 'pad/split(3)'], facts: facts(2, [[[0, 0, 1], [0, 1, 9]], [[0, 2, 2], [0, 3, 3]]]) }))
      .toEqual(changed(['cut/split(0)', 'cut/split(1)'], { ambiguous: [['cut/split(0)', 'cut/split(1)']], lost: [A, B, C, 'pad/split(3)'] }));
  });

  it('never orders pieces by equal ranks, which the kernel order of the solids breaks', () => {
    expect(parts({ beforeSolids: 2, facts: facts(2, [[[0, 0, 2]], [[0, 0, 2]]]) })).toEqual(changed([A, B], { ambiguous: [[A, B]] }));
    // Only the tied pieces are ambiguous: the piece first by rank keeps its number in either order.
    expect(parts({ facts: facts(3, [[[0, 0, 2]], [[0, 0, 1]], [[0, 0, 2]]]) })).toEqual(changed([B, A, C], { ambiguous: [[B, C]] }));
    expect(parts({ before: [A, B], facts: facts(3, [[[0, 1, 1]], [[0, 0, 3]], [[0, 0, 3]]]) }))
      .toEqual(changed([B, `${A}/split(0)`, `${A}/split(1)`], { ambiguous: [[`${A}/split(0)`, `${A}/split(1)`]] }));
  });

  it('follows each piece by its kept faces, and splits a piece under its own key', () => {
    expect(parts({ before: [A, B], facts: facts(3, [[[0, 1, 5]], [[0, 0, 2]], [[0, 1, 3]]]) }))
      .toEqual(changed(['pad/split(1)/split(1)', A, 'pad/split(1)/split(0)']));
  });

  it('treats a solid keeping no face as possibly split from any key, never as proof that a traced piece continues alone', () => {
    // The piece left keeps faces of A, and B can't be found: the fresh solid may be B, or a piece A split into.
    expect(parts({ before: [A, B], facts: facts(2, [[[0, 0, 1]], []]) })).toEqual(changed([A, 'cut/split(0)'], { ambiguous: [['cut/split(0)', A, B]] }));
    // With one piece before and no material added, a solid keeping no face can only come from that piece.
    expect(parts({ before: [A], facts: facts(2, [[[0, 0, 1]], []]) })).toEqual(changed([`${A}/split(0)`, `${A}/split(1)`]));
    // A fused tool could have made it, so it is fresh even beside one piece, and that piece may have split into it.
    expect(parts({ before: [A], facts: facts(2, [[[0, 0, 1]], []], { removesMaterial: false, sources: fused }) })).toEqual(changed([A, 'cut/split(0)'], { ambiguous: [['cut/split(0)', A]] }));
    // Pieces of a key several solids continue keep their numbers whoever else split from it, so only the fresh solid is uncertain.
    expect(parts({ before: [A, B], facts: facts(4, [[[0, 0, 1]], [[0, 0, 2]], [[0, 1, 1]], []]) }))
      .toEqual(changed([`${A}/split(0)`, `${A}/split(1)`, B, 'cut/split(0)'], { ambiguous: [['cut/split(0)', B]] }));
    expect(parts({ before: [A, B], facts: facts(5, [[[0, 0, 1]], [[0, 0, 2]], [[0, 1, 1]], [[0, 1, 2]], []]) }))
      .toEqual(changed([`${A}/split(0)`, `${A}/split(1)`, `${B}/split(0)`, `${B}/split(1)`, 'cut/split(0)']));
  });

  it('reports pieces a feature removed or merged as lost, and gives a merged solid a fresh key', () => {
    expect(parts({ before: [A, B], facts: facts(1, [[[0, 0, 1]]]) })).toEqual(changed([A], { lost: [B] }));
    // A join bridging both pieces and adding an island: the island is the tool's alone, the bridge merges both pieces.
    expect(parts({ before: [A, B], facts: facts(2, [[[0, 0, 1], [0, 1, 2], [1, 0, 3]], [[1, 0, 1]]], { removesMaterial: false, sources: fused }) }))
      .toEqual(changed(['cut/split(1)', 'cut/split(0)'], { lost: [A, B] }));
    // A tool fused into one piece keeps that piece's key.
    expect(parts({ before: [A, B], facts: facts(2, [[[0, 0, 1], [1, 0, 2]], [[0, 1, 1]]], { removesMaterial: false, sources: fused }) })).toEqual(changed([A, B]));
  });

  it('carries ambiguity to surviving pieces and their descendants, which extend the issue that reported it', () => {
    expect(parts({ before: [A, B], ambiguous: [[A, B]], facts: facts(2, [[[0, 0, 1]], [[0, 1, 1]]]) })).toEqual(changed([A, B], { ambiguous: [[A, B]], ambiguousNow: [] }));
    // The solid split under A's key may be B's in another kernel order, so A stays in the group while B's solid is left unchanged.
    expect(parts({ before: [A, B], ambiguous: [[A, B]], facts: facts(3, [[[0, 0, 1]], [[0, 0, 4]], [[0, 1, 1]]]) }))
      .toEqual(changed([`${A}/split(0)`, `${A}/split(1)`, B], { ambiguous: [[`${A}/split(0)`, `${A}/split(1)`, B, A]], ambiguousNow: [],
        inherited: [[`${A}/split(0)`, A], [`${A}/split(1)`, A]] }));
    // So it does when B's solid is gone: either key may name the solid that split.
    expect(parts({ before: [A, B, C], ambiguous: [[A, B]], facts: facts(3, [[[0, 0, 1]], [[0, 0, 4]], [[0, 2, 1]]]) }))
      .toEqual(changed([`${A}/split(0)`, `${A}/split(1)`, C], { ambiguous: [[`${A}/split(0)`, `${A}/split(1)`, A, B]], ambiguousNow: [],
        inherited: [[`${A}/split(0)`, A], [`${A}/split(1)`, A]] }));
    // Once every piece of the group split, each key named a piece that split, so neither is left.
    expect(parts({ before: [A, B], ambiguous: [[A, B]], facts: facts(4, [[[0, 0, 1]], [[0, 0, 4]], [[0, 1, 1]], [[0, 1, 4]]]) }))
      .toEqual(changed([`${A}/split(0)`, `${A}/split(1)`, `${B}/split(0)`, `${B}/split(1)`], { ambiguous: [[`${A}/split(0)`, `${A}/split(1)`, `${B}/split(0)`, `${B}/split(1)`]],
        ambiguousNow: [], inherited: [[`${A}/split(0)`, A], [`${A}/split(1)`, A], [`${B}/split(0)`, B], [`${B}/split(1)`, B]] }));
  });

  it('never reports an ambiguous piece lost while a solid it could be is left', () => {
    // Which of A and B the cut removed depends on the kernel order that numbered them, so both stay ambiguous with the solid left.
    expect(parts({ before: [A, B], ambiguous: [[A, B]], facts: facts(1, [[[0, 1, 1]]]) })).toEqual(changed([B], { ambiguous: [[B, A]], ambiguousNow: [] }));
    // Merging an ambiguous piece leaves the merged solid ambiguous with the rest; a certain piece merged with it is lost.
    expect(parts({ before: [A, B, C], ambiguous: [[A, B, 'gone/split(0)']], facts: facts(2, [[[0, 0, 1], [0, 2, 1]], [[0, 1, 1]]], { removesMaterial: false, sources: fused }) }))
      .toEqual(changed(['cut/split(0)', B], { ambiguous: [['cut/split(0)', B, A, 'gone/split(0)']], ambiguousNow: [], inherited: [['cut/split(0)', A]], lost: [C] }));
    // Once no solid descends from the group, its keys are lost.
    expect(parts({ before: [A, B, C], ambiguous: [[A, B]], facts: facts(1, [[[0, 2, 1]]]) })).toEqual(changed([C], { lost: [A, B] }));
    // A solid keeping no face may be any of them.
    expect(parts({ before: [A, B], ambiguous: [[A, B]], facts: facts(2, [[], []]) }))
      .toEqual(changed(['cut/split(0)', 'cut/split(1)'], { ambiguous: [['cut/split(0)', 'cut/split(1)', A, B]], ambiguousNow: ['cut/split(0)', 'cut/split(1)'] }));
  });

  it('keys a pattern copy apart from the originals by the copy it keeps faces of, the original itself being inst(0,0)', () => {
    const pattern = (solids: number, traced: readonly (readonly Entry[])[], n = 2) => facts(solids, traced, { removesMaterial: false, sources: copies(n) });
    expect(parts({ facts: pattern(3, [[[0, 0, 1]], [[1, 0, 1]], [[2, 0, 1]]]) })).toEqual(changed(['pad/inst(0,0)', 'pad/inst(1,0)', 'pad/inst(2,0)']));
    // Copies fused into the originals leave the body whole.
    expect(parts({ beforeSolids: 2, facts: pattern(2, [[[0, 0, 1], [1, 0, 1]], [[0, 1, 3], [1, 1, 3]]], 1) })).toEqual(whole);
    // Copies fused into each other, away from the original, merge without a target.
    expect(parts({ facts: pattern(2, [[[0, 0, 1]], [[1, 0, 1], [2, 0, 1]]]) })).toEqual(changed(['pad/inst(0,0)', 'cut/split(0)']));
    const four = pattern(4, [[[0, 0, 1]], [[0, 1, 1]], [[1, 0, 1]], [[1, 1, 1]]], 1);
    expect(parts({ before: [A, B], facts: four })).toEqual(changed([`${A}/inst(0,0)`, `${B}/inst(0,0)`, `${A}/inst(1,0)`, `${B}/inst(1,0)`]));
    // Ambiguous pieces stay ambiguous within each copy, never with another copy's pieces.
    expect(parts({ before: [A, B], ambiguous: [[A, B]], facts: four })).toEqual(changed([`${A}/inst(0,0)`, `${B}/inst(0,0)`, `${A}/inst(1,0)`, `${B}/inst(1,0)`],
      { ambiguous: [[`${A}/inst(0,0)`, `${B}/inst(0,0)`], [`${A}/inst(1,0)`, `${B}/inst(1,0)`]], ambiguousNow: [],
        inherited: [[`${A}/inst(0,0)`, A], [`${B}/inst(0,0)`, B], [`${A}/inst(1,0)`, A], [`${B}/inst(1,0)`, B]] }));
    // The solids of a whole body several solids strong are told apart in each copy only by the kernel's order.
    expect(parts({ beforeSolids: 2, facts: four })).toEqual(changed(['pad/inst(0,0)/split(0)', 'pad/inst(0,0)/split(1)', 'pad/inst(1,0)/split(0)', 'pad/inst(1,0)/split(1)'],
      { ambiguous: [['pad/inst(0,0)/split(0)', 'pad/inst(0,0)/split(1)'], ['pad/inst(1,0)/split(0)', 'pad/inst(1,0)/split(1)']] }));
    // A copy that vanished is never listed.
    expect(parts({ before: ['pad/inst(0,0)', 'pad/inst(1,0)'], facts: facts(1, [[[0, 0, 1]]]) })).toEqual(changed(['pad/inst(0,0)'], { lost: ['pad/inst(1,0)'] }));
  });

  it('carries pieces through a feature that keeps the solid order, and keeps them when one solid is left', () => {
    const moved = facts(2, [], { removesMaterial: false, sameSolidOrder: true });
    expect(parts({ before: [B, A], ambiguous: [[A, B]], facts: moved })).toEqual({ pieces: [B, A], ambiguous: [[A, B]], ambiguousNow: [], inherited: [], lost: [] });
    expect(moved.provenance).not.toHaveBeenCalled();
    expect(parts({ before: [A, B], facts: facts(1, [[[0, 1, 1], [0, 0, 1]]]) })).toEqual(changed(['cut/split(0)'], { lost: [A, B] }));
  });

  it('stops tracking parts past the limits instead of failing the build', () => {
    const many = facts(MAX_CAD_BODY_LIST + 1, []);
    expect(parts({ facts: many })).toEqual({ untracked: true, ambiguousNow: [], inherited: [], lost: [], overflowed: true });
    expect(many.provenance).not.toHaveBeenCalled();
    const long = `pad${'/split(0)'.repeat(Math.floor((MAX_CAD_BODY_KEY_LENGTH - 3) / 9))}`;
    expect(parts({ before: [long], facts: facts(2, [[[0, 0, 1]], [[0, 0, 2]]]) })).toMatchObject({ untracked: true, overflowed: true });
    expect(cadBodyParts({ featureId: 'cut', previous: { ...previous(), untracked: true }, beforeSolids: 9, facts: facts(9, []) })).toEqual({ untracked: true, ambiguousNow: [], inherited: [], lost: [] });
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
    expect(change?.state).toMatchObject({ key: 'box', modifiedBy: ['slot'], pieces: ['box/split(0)', 'box/split(1)'], ambiguous: [['box/split(0)', 'box/split(1)']] });
    expect(lineage.issues()).toEqual([{ code: 'ambiguous-body-parts', featureId: 'slot', body: 'box', pieces: ['box/split(0)', 'box/split(1)'],
      message: '2 pieces of body box can\'t be told apart after slot, so references to them are ambiguous.' }]);
    expect(lineage.issues().every(isCadBodyIssue)).toBe(true);
  });

  it('reports an ambiguity once, extending its issue with the keys that descend from it', () => {
    const features: CadFeature[] = [...box, sketch('slot_sketch', 18, 4), pad('slot', 'slot_sketch', 'cut', 'box'),
      { ...base('row'), kind: 'linear-pattern', sourceId: 'slot', count: 2, spacing: [50, 0, 0] }, sketch('nick_sketch', 60, 2), pad('nick', 'nick_sketch', 'cut', 'row')];
    const parsed = document(features), lineage = createCadBodyLineage();
    const [a, b] = ['box/split(0)', 'box/split(1)'], copy = (part: string, i: number) => `${part}/inst(${i},0)`;
    for (const feature of parsed.features) lineage.apply(feature, parsed, feature.id === 'slot' ? facts(2, [[], []])
      : feature.id === 'row' ? facts(4, [[[0, 0, 1]], [[0, 1, 1]], [[1, 0, 1]], [[1, 1, 1]]], { removesMaterial: false, sources: copies(1) })
        : feature.id === 'nick' ? facts(5, [[[0, 0, 1]], [[0, 1, 1]], [[0, 2, 1]], [[0, 2, 4]], [[0, 3, 1]]]) : facts(1, []));
    const nicked = [`${copy(a, 1)}/split(0)`, `${copy(a, 1)}/split(1)`];
    expect(lineage.issues()).toEqual([{ code: 'ambiguous-body-parts', featureId: 'slot', body: 'box', pieces: [a, b, copy(a, 0), copy(b, 0), copy(a, 1), copy(b, 1), ...nicked],
      message: '8 pieces of body box can\'t be told apart after slot, so references to them are ambiguous.' }]);
    expect(lineage.get(key('box'))?.ambiguous).toEqual([[copy(a, 0), copy(b, 0)], [...nicked, copy(b, 1), copy(a, 1)]]);
  });

  it('extends an issue up to the list limit, and reports the keys past it in an issue of the later feature', () => {
    // A comb cut leaves 1,500 solids keeping no face, and a pattern copies them all: 3,000 inherited keys, more than the cut\'s issue takes.
    const parsed = document([...box, sketch('slot_sketch', 18, 4), pad('slot', 'slot_sketch', 'cut', 'box'),
      { ...base('row'), kind: 'linear-pattern', sourceId: 'slot', count: 2, spacing: [50, 0, 0] }]), lineage = createCadBodyLineage(), teeth = 1500;
    for (const feature of parsed.features) lineage.apply(feature, parsed, feature.id === 'slot' ? facts(teeth, Array.from({ length: teeth }, () => []))
      : feature.id === 'row' ? facts(teeth * 2, Array.from({ length: teeth * 2 }, (_, solid) => [[Math.floor(solid / teeth), solid % teeth, 1]]), { removesMaterial: false, sources: copies(1) })
        : facts(1, []));
    const tooth = (q: number, i: number) => `box/split(${q})/inst(${i},0)`, past = MAX_CAD_BODY_LIST - teeth - teeth;
    const issues = lineage.issues();
    expect(issues.map(issue => [issue.code, issue.featureId, issue.pieces.length]))
      .toEqual([['ambiguous-body-parts', 'slot', MAX_CAD_BODY_LIST], ['ambiguous-body-parts', 'row', teeth * 3 - MAX_CAD_BODY_LIST]]);
    expect(issues[0].pieces.slice(teeth * 2 - 1, teeth * 2 + 1)).toEqual([tooth(teeth - 1, 0), tooth(0, 1)]);
    expect(issues[1].pieces).toEqual(Array.from({ length: teeth - past }, (_, q) => tooth(past + q, 1)));
    expect(issues.every(isCadBodyIssue)).toBe(true);
    // Every ambiguous key is listed by one of them, and each copy\'s teeth stay a group of their own.
    const listed = new Set(issues.flatMap(issue => issue.pieces)), body = lineage.get(key('box'))!;
    expect(body.ambiguous?.map(group => group.length)).toEqual([teeth, teeth]);
    expect(body.ambiguous?.flat().every(part => listed.has(part))).toBe(true);
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

  it('shares modifier histories, making a state only when one is asked for', () => {
    const moves = Array.from({ length: 3000 }, (_, index): CadFeature => ({ ...base(`m${index}`), kind: 'transform', sourceId: index ? `m${index - 1}` : 'box', translation: [1, 0, 0], rotation: [0, 0, 0] }));
    const parsed = document([...box, ...moves]), lineage = cadBodyLineage(parsed.features, parsed);
    expect(lineage.has('m2999')).toBe(true);
    expect(lineage.has('m2998')).toBe(false);
    const [body] = lineage.bodies();
    expect(body.modifiedBy).toHaveLength(3000);
    expect([body.modifiedBy[0], body.modifiedBy[2999]]).toEqual(['m0', 'm2999']);
    expect(lineage.at('m2999')).toBe(body);
  });
});

describe('body references, metadata and selection', () => {
  const split: CadBodyState = { key: key('box'), kind: 'solid', createdBy: 'box', modifiedBy: ['slot', 'round'],
    pieces: [key('box/split(0)'), key('round/split(0)')], ambiguous: [[key('round/split(0)'), key('box/split(1)')]] };
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
    // A key kept only in an ambiguous group was consumed with its body.
    expect(resolveCadBodyRef({ kind: 'body', key: key('box/split(1)') }, consumed)).toEqual({ status: 'missing', consumedBy: 'merge' });
  });

  it('resolves a key another kernel order would have given an ambiguous key\'s descendant among that descendant\'s group', () => {
    const [a, b, c] = ['box/split(0)', 'box/split(1)', 'box/split(2)'];
    // The solid b keys split; another order would have given a that solid, and its halves a\'s descendants\' keys.
    const halves: CadBodyState = { key: key('box'), kind: 'solid', createdBy: 'box', modifiedBy: ['slot', 'cut'], pieces: [a, `${b}/split(0)`, `${b}/split(1)`, c].map(key),
      ambiguous: [[a, `${b}/split(0)`, `${b}/split(1)`, b].map(key)] };
    const resolved = (part: string) => resolveCadBodyRef({ kind: 'body', key: key(part) }, holding(halves));
    for (const part of [`${a}/split(0)`, `${a}/split(1)`, `${b}/split(1)`]) expect(resolved(part), part).toMatchObject({ status: 'ambiguous', candidates: [a, `${b}/split(0)`, `${b}/split(1)`] });
    // No order splits that solid into more halves, or splits the certain piece c.
    expect(resolved(`${a}/split(2)`)).toEqual({ status: 'missing' });
    expect(resolved(`${c}/split(0)`)).toEqual({ status: 'missing' });
    expect(resolveCadBodyRef({ kind: 'body', key: key(`${a}/split(1)`) }, { ...lineage, consumed: () => [{ ...halves, consumedBy: 'merge' }] } as typeof lineage))
      .toEqual({ status: 'missing', consumedBy: 'merge' });
  });

  it('resolves an ambiguous key only among the keys it can\'t be told apart from, never another pattern occurrence\'s', () => {
    const part = (k: number, i: number) => key(`box/split(${k})/inst(${i},0)`);
    const copied: CadBodyState = { key: key('box'), kind: 'solid', createdBy: 'box', modifiedBy: ['slot', 'row'], pieces: [part(0, 0), part(1, 0), part(0, 1), part(1, 1)],
      ambiguous: [[part(0, 0), part(1, 0)], [part(0, 1), part(1, 1), key('box/split(2)/inst(1,0)')]] };
    expect(resolveCadBodyRef({ kind: 'body', key: part(0, 0) }, holding(copied))).toMatchObject({ status: 'ambiguous', candidates: [part(0, 0), part(1, 0)] });
    expect(resolveCadBodyRef({ kind: 'body', key: key('box/split(2)/inst(1,0)') }, holding(copied))).toMatchObject({ status: 'ambiguous', candidates: [part(0, 1), part(1, 1)] });
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
    expect(isCadBodyState({ ...split, ambiguous: [['box']] })).toBe(false);
    // Ambiguous keys come in groups, each key once, and a piece is listed once.
    expect(isCadBodyState({ ...split, ambiguous: ['round/split(0)'] })).toBe(false);
    expect(isCadBodyState({ ...split, ambiguous: [[]] })).toBe(false);
    expect(isCadBodyState({ ...split, ambiguous: [['round/split(0)'], ['round/split(0)', 'box/split(1)']] })).toBe(false);
    expect(isCadBodyState({ ...split, pieces: ['box/split(0)', 'box/split(0)'] })).toBe(false);
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
