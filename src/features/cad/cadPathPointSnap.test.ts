import { describe, expect, it } from 'vitest';
import { snapCadPathGraphPoint } from './cadPathPointSnap';

describe('deliberate path endpoint snapping', () => {
  it('selects the uniquely nearest identity among multiple visible candidates independently of source order', () => {
    const points = [{ id: 'farther', position: [3, 0] as const }, { id: 'nearer', position: [2, 0] as const }];
    for (const source of [points, [...points].reverse()]) expect(snapCadPathGraphPoint(source, [0, 0], 1))
      .toEqual({ point: [2, 0], existingPointId: 'nearer' });
  });

  it('uses an inclusive screen-space threshold and retains exact off-grid coordinates without rounding', () => {
    const points = [{ id: 'off-grid', position: [1.25, .75] as const }];
    expect(snapCadPathGraphPoint(points, [4.25, .75], .5)).toEqual({ point: [1.25, .75], existingPointId: 'off-grid' });
    expect(snapCadPathGraphPoint(points, [4.250001, .75], .5)).toBeNull();
    expect(snapCadPathGraphPoint(points, [4.25, .75], .25)).toBeNull();
    expect(snapCadPathGraphPoint(points, [4.25, .75], .25, 12)).toEqual({ point: [1.25, .75], existingPointId: 'off-grid' });
  });

  it('refuses coincident or equidistant identities and snaps again when a distinct candidate becomes uniquely nearer', () => {
    for (const points of [[{ id: 'a', position: [-1, 0] as const }, { id: 'b', position: [1, 0] as const }],
      [{ id: 'a', position: [1, 0] as const }, { id: 'b', position: [1, 0] as const }],
      [{ id: 'a', position: [1, 0] as const }, { id: 'b', position: [1 + Number.EPSILON, 0] as const }]]) {
      for (const source of [points, [...points].reverse()]) {
        expect(snapCadPathGraphPoint(source, [0, 0], 1)).toBeNull();
        expect(snapCadPathGraphPoint([...source, { id: 'unique', position: [.5, 0] }], [0, 0], 1))
          .toEqual({ point: [.5, 0], existingPointId: 'unique' });
      }
    }
  });

  it('computes ambiguity against the actual nearest pair independently of a chain of nearly equal distances', () => {
    const points = [0, 4, 9].map((ulps, index) => ({ id: `point-${index}`, position: [1 + ulps * Number.EPSILON, 0] as const }));
    expect(snapCadPathGraphPoint(points, [0, 0], 1)).toBeNull();
    expect(snapCadPathGraphPoint([...points].reverse(), [0, 0], 1)).toBeNull();
  });

  it('returns a detached immutable pick and leaves source geometry untouched', () => {
    const position: [number, number] = [.123456789012345, 0], points = [{ id: 'exact', position }];
    const pick = snapCadPathGraphPoint(points, [0, 0], 1);
    position[0] = 99;
    expect(pick).toEqual({ point: [.123456789012345, 0], existingPointId: 'exact' });
    expect(Object.isFrozen(pick)).toBe(true); expect(Object.isFrozen(pick?.point)).toBe(true); expect(Object.isFrozen(position)).toBe(false);
  });

  it('does not invent a target when scale, tolerance or cursor is unavailable', () => {
    const points = [{ id: 'point', position: [0, 0] as const }];
    for (const scale of [0, -1, Infinity, NaN]) expect(snapCadPathGraphPoint(points, [0, 0], scale)).toBeNull();
    for (const tolerance of [-1, Infinity, NaN]) expect(snapCadPathGraphPoint(points, [0, 0], 1, tolerance)).toBeNull();
    expect(snapCadPathGraphPoint(points, [NaN, 0], 1)).toBeNull(); expect(snapCadPathGraphPoint([], [0, 0], 1)).toBeNull();
  });
});
