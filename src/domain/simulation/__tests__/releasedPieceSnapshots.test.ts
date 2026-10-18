import { describe, expect, it } from 'vitest';
import { createReleasedPieceSnapshotSampler, releasedPieceSnapshots } from '../releasedPieces';
import { resolveSimulationSettings } from '../simulation';
import type { SimulationPiece } from '../types';

const settings = resolveSimulationSettings({
  stock: { originX: -10, originY: -10, width: 30, depth: 30, bottomZ: 0, thickness: 5 },
  wireDiameter: 0.25, cutSpeedMmPerSecond: 10, rapidSpeedMmPerSecond: 20,
  retention: 'fall', supportFloorZ: -20, wasteHandling: 'keep'
});
if (!settings) throw new Error('Expected valid settings');

function piece(id: string, releaseSeconds: number, parentPieceId: string | null = null): SimulationPiece {
  return { id, operationId: id, polygon: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }],
    releaseSeconds, releaseEventId: `release:${id}`, parentPieceId, role: 'unclassified', removalSeconds: null };
}

describe('released material snapshot preparation', () => {
  it('preserves nested openings, removal boundaries and reverse seeks with an unreleased immediate parent', () => {
    const pieces = [piece('outer', 1), piece('middle', 10, 'outer'), { ...piece('inner', 2, 'middle'), removalSeconds: 5 }];
    const original = structuredClone(pieces);
    const sample = createReleasedPieceSnapshotSampler(pieces, settings);
    const beforeRemoval = sample(4);
    expect(beforeRemoval.stockHoles).toEqual([pieces[0].polygon]);
    expect(beforeRemoval.pieces.map(({ id }) => id)).toEqual(['outer', 'inner']);
    expect(beforeRemoval.pieces[0].holes).toEqual([pieces[2].polygon]);
    expect(beforeRemoval.pieces.map(({ bottomZ }) => bottomZ)).toEqual([-20, -20]);
    expect(sample(5)).toMatchObject({ removedPieceIds: ['inner'], pieces: [{ id: 'outer' }] });
    expect(sample(4)).toEqual(beforeRemoval);
    expect(sample(10).pieces.map(({ id }) => id)).toEqual(['outer', 'middle']);
    for (const time of [0, 1, 2, 4, 5, 10, Infinity, 4]) expect(sample(time)).toEqual(releasedPieceSnapshots(pieces, settings, time));
    expect(pieces).toEqual(original);
  });

  it('keeps last matching parent IDs and tolerates a missing parent while preserving source order', () => {
    const pieces = [piece('parent', 1), piece('child', 2, 'parent'), piece('parent', 10), piece('orphan', 3, 'missing')];
    const atRelease = releasedPieceSnapshots(pieces, settings, 2);
    expect(atRelease.pieces.map(({ id }) => id)).toEqual(['parent', 'child']);
    expect(atRelease.pieces[1].bottomZ).toBe(0);
    expect(releasedPieceSnapshots(pieces, settings, 3).pieces.map(({ id }) => id)).toEqual(['parent', 'child', 'orphan']);
  });

  it('observes mutable replacements and mutable metadata inside a frozen array, with independent settings', () => {
    const pieces = [piece('outer', 1), piece('inner', 2, 'outer')];
    expect(releasedPieceSnapshots(pieces, settings, 2).pieces[1].bottomZ).toBe(-20);
    pieces[0] = { ...pieces[0], releaseSeconds: 10 };
    expect(releasedPieceSnapshots(pieces, settings, 2).pieces).toMatchObject([{ id: 'inner', bottomZ: 0 }]);
    const shallowFrozen = Object.freeze(pieces);
    releasedPieceSnapshots(shallowFrozen, settings, 2);
    Object.assign(pieces[0], { releaseSeconds: 1 });
    expect(releasedPieceSnapshots(shallowFrozen, settings, 2).pieces[1].bottomZ).toBe(-20);
    Object.assign(pieces[1], { parentPieceId: 'missing' });
    expect(releasedPieceSnapshots(shallowFrozen, settings, 2).pieces[1].bottomZ).toBe(0);
    Object.assign(pieces[1], { parentPieceId: 'outer' });
    Object.freeze(pieces[0]);
    Object.freeze(pieces[1]);
    expect(releasedPieceSnapshots(shallowFrozen, { ...settings, retention: 'retain' }, 2).pieces
      .map(({ bottomZ }) => bottomZ)).toEqual([0, 0]);
    expect(releasedPieceSnapshots(shallowFrozen, settings, 2).pieces.map(({ bottomZ }) => bottomZ)).toEqual([-20, -20]);
  });

  it.each([false, true])('reuses stable ancestor preparation across many seeks with bounded metadata reads (frozen %s)', frozen => {
    const count = 128;
    let releaseReads = 0;
    const pieces = Array.from({ length: count }, (_, index) => {
      const current = piece(`piece-${index}`, index, index ? `piece-${index - 1}` : null);
      Object.defineProperty(current, 'releaseSeconds', { get: () => { releaseReads++; return index; } });
      return frozen ? Object.freeze(current) : current;
    });
    if (frozen) Object.freeze(pieces);
    releasedPieceSnapshots(pieces, settings, count);
    releaseReads = 0;
    for (const time of [count, count / 2, count / 4, count, count - 1, 0]) {
      const snapshot = releasedPieceSnapshots(pieces, settings, time);
      expect(snapshot.pieces).toHaveLength(Math.min(count, Math.floor(time) + 1));
      expect(snapshot.pieces[0].bottomZ).toBe(time === 0 ? 0 : -20);
    }
    expect(releaseReads).toBeLessThan(count * 15);
  });
});
