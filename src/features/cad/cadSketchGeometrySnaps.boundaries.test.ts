// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { parseCadSketchGraph, type CadSketchGraphEntity } from '@/domain/cad/cadSketchGraph';
import { prepareCadSketchGraphInteraction } from './cadSketchGraphInteraction';
import { prepareCadSketchGeometrySnaps, type CadSketchSnapResult } from './cadSketchGeometrySnaps';
import type { SketchPoint } from './cadSketchInteraction';

// Each case puts two curves at the cursor, away from the sketch axes, and asks only for intersection snaps.
type Entity = CadSketchGraphEntity;
function intersectionSnap(points: readonly { readonly id: string; readonly position: SketchPoint }[], entities: readonly Entity[], cursor: SketchPoint): CadSketchSnapResult {
  const graph = parseCadSketchGraph({ points, entities, relations: [] });
  const prepared = prepareCadSketchGraphInteraction(graph, {});
  const snap = prepareCadSketchGeometrySnaps({ graph, points: prepared.points, segments: prepared.geometry.segments });
  return snap({ cursor, mmPerPixel: [0.01, 0.01], tolerancePx: 6, references: true, kinds: ['intersection'] });
}
const line = (id: string, startPointId: string, endPointId: string): Entity => ({ id, kind: 'line', construction: false, startPointId, endPointId });
function intersectionPoint(result: CadSketchSnapResult): SketchPoint {
  if (result.kind !== 'hit' || result.candidate.target.kind !== 'intersection') throw new Error(`Expected one intersection snap, got ${result.kind}.`);
  return result.candidate.point;
}

describe('intersection snaps on a bounded line span', () => {
  // A 10 mm line ends at x = 10; a cross line at x = 10 + gap meets its support a fraction gap / 10 of its length past that end.
  const crossing = (gap: number) => intersectionSnap([{ id: 'a', position: [0, 5] }, { id: 'b', position: [10, 5] },
    { id: 'c', position: [10 + gap, 4] }, { id: 'd', position: [10 + gap, 6] }], [line('span', 'a', 'b'), line('cross', 'c', 'd')], [10, 5]);

  it('snaps to a crossing 4e-10 of the span past a line end, and offers none 3e-9 of the span past it', () => {
    const inside = intersectionPoint(crossing(4e-9));
    expect(inside[0]).toBeCloseTo(10 + 4e-9, 14); expect(inside[1]).toBe(5);
    expect(crossing(3e-8)).toEqual({ kind: 'none' });
  });
});

describe('intersection snaps on an arc sweep', () => {
  // A counterclockwise quarter arc of radius 5 about (20, 20) ends at (20, 25); a short line at x = 20 - drop crosses its circle about
  // drop / 5 rad past that end. The slack extends an arc past its end only: a crossing before its start wraps to nearly a full turn.
  const crossing = (drop: number) => intersectionSnap([{ id: 'o', position: [20, 20] }, { id: 's', position: [25, 20] }, { id: 't', position: [20, 25] },
    { id: 'p', position: [20 - drop, 22] }, { id: 'q', position: [20 - drop, 28] }],
  [{ id: 'quarter', kind: 'arc', construction: false, centerPointId: 'o', startPointId: 's', endPointId: 't', direction: 'ccw' }, line('chord', 'p', 'q')], [20, 25]);

  it('snaps to a crossing 4e-10 rad past an arc end, and offers none 3e-9 rad past it', () => {
    const inside = intersectionPoint(crossing(2e-9));
    expect(inside[0]).toBeCloseTo(20 - 2e-9, 14); expect(inside[1]).toBeCloseTo(25, 12);
    expect(crossing(1.5e-8)).toEqual({ kind: 'none' });
  });
});

describe('intersection snaps between nearly parallel lines', () => {
  // Two 10 mm lines cross at (10, 10); the second rises `slope` per unit length, the sine of the angle between them.
  const crossing = (slope: number) => intersectionSnap([{ id: 'a', position: [5, 10] }, { id: 'b', position: [15, 10] },
    { id: 'c', position: [5, 10 - 5 * slope] }, { id: 'd', position: [15, 10 + 5 * slope] }], [line('level', 'a', 'b'), line('tilted', 'c', 'd')], [10, 10]);

  it('offers no crossing for lines 4e-13 rad apart, and snaps where lines 3e-12 rad apart cross', () => {
    expect(crossing(4e-13)).toEqual({ kind: 'none' });
    const outside = intersectionPoint(crossing(3e-12));
    expect(outside[0]).toBeCloseTo(10, 2); expect(outside[1]).toBeCloseTo(10, 12);
  });
});

describe('intersection snaps where a line touches a circle', () => {
  // A level line `gap` above a unit circle about (5, 5) misses it by about 2 gap of the squared radius.
  const touching = (gap: number) => intersectionSnap([{ id: 'c', position: [5, 5] }, { id: 'a', position: [3, 6 + gap] }, { id: 'b', position: [7, 6 + gap] }],
    [{ id: 'unit', kind: 'circle', construction: false, centerPointId: 'c', radius: 1 }, line('level', 'a', 'b')], [5, 6]);

  it('offers no intersection snap for a line 2e-12 outside a unit circle, and the tangent point for one 2e-13 outside', () => {
    expect(touching(2e-12)).toEqual({ kind: 'none' });
    const inside = intersectionPoint(touching(2e-13));
    expect(inside[0]).toBe(5); expect(inside[1]).toBeCloseTo(6 + 2e-13, 14);
  });
});
