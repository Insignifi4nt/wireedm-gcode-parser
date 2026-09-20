import { describe, expect, it } from 'vitest';
import { checkMachineWireCollision, checkMachineWireSweep, createMachineCollisionIndex } from '../machineCollision';
import { intersectSegmentTriangle, type Triangle3 } from '../triangleIntersection';
import { triangleModel } from './machineTestModel';

describe('wire to triangle geometry', () => {
  const surface: Triangle3 = [[0, 0, 0], [10, 0, 0], [0, 10, 0]];
  it('finds two-sided crossings and finite endpoints, but rejects an outside crossing', () => {
    expect(intersectSegmentTriangle({ start: [2, 2, -10], end: [2, 2, 10] }, surface)).toEqual({ point: [2, 2, 0], fraction: 0.5 });
    expect(intersectSegmentTriangle({ start: [2, 2, 10], end: [2, 2, -10] }, surface)?.fraction).toBe(0.5);
    expect(intersectSegmentTriangle({ start: [2, 2, 10], end: [2, 2, 0] }, surface)?.fraction).toBe(1);
    expect(intersectSegmentTriangle({ start: [8, 8, -10], end: [8, 8, 10] }, surface)).toBeNull();
    expect(intersectSegmentTriangle({ start: [2, 2, 1], end: [2, 2, 10] }, surface)).toBeNull();
  });
  it('handles coplanar entry, edge overlap, a stationary wire point and degenerate triangles', () => {
    expect(intersectSegmentTriangle({ start: [-1, 2, 0], end: [5, 2, 0] }, surface)?.point).toEqual([0, 2, 0]);
    expect(intersectSegmentTriangle({ start: [-1, 0, 0], end: [5, 0, 0] }, surface)?.point).toEqual([0, 0, 0]);
    expect(intersectSegmentTriangle({ start: [2, 2, 0], end: [2, 2, 0] }, surface)?.fraction).toBe(0);
    expect(intersectSegmentTriangle({ start: [2, 2, 1], end: [2, 2, 1] }, surface)).toBeNull();
    expect(intersectSegmentTriangle({ start: [0, 0, -1], end: [0, 0, 1] }, [[0, 0, 0], [0, 0, 0], [0, 0, 0]])).toBeNull();
  });
});

describe('imported machine surface checks', () => {
  const from = { start: [0, 0, -2] as const, end: [0, 0, 12] as const };
  const to = { start: [10, 0, -2] as const, end: [10, 0, 12] as const };
  it('finds an obstacle between two clear playback samples', () => {
    const index = createMachineCollisionIndex(triangleModel());
    expect(checkMachineWireCollision(index, from).status).toBe('no-intersections');
    expect(checkMachineWireCollision(index, to).status).toBe('no-intersections');
    const swept = checkMachineWireSweep(index, { from, to });
    expect(swept.complete).toBe(true);
    expect(swept.status).toBe('intersections');
    expect(swept.hits[0]).toMatchObject({ triangleIndex: 0, meshName: 'Clamp', travelFraction: 0.5, approximate: false });
  });
  it('handles a triangle contained inside the swept surface with no endpoint hit', () => {
    const index = createMachineCollisionIndex(triangleModel([[3, 0, 3], [4, 0, 3], [3, 0, 4]]));
    expect(checkMachineWireSweep(index, { from, to }).hits[0].travelFraction).toBeCloseTo(0.3);
  });
  it('does not misreport budget exhaustion, cancellation or unsupported tilt as no intersection', () => {
    const index = createMachineCollisionIndex(triangleModel(undefined, 20));
    const limited = checkMachineWireSweep(index, { from, to }, { maxTriangleTests: 1 });
    expect(limited.complete).toBe(false);
    expect(limited.testedTriangles).toBe(1);
    expect(checkMachineWireSweep(index, { from, to }, { signal: AbortSignal.abort() }).status).toBe('incomplete');
    expect(checkMachineWireSweep(index, { from, to: { ...to, end: [11, 0, 12] } }).status).toBe('incomplete');
  });
  it('marks conservative arc-envelope candidates as approximate', () => {
    const index = createMachineCollisionIndex(triangleModel([[5, 0.05, 0], [5, 0.06, 0], [5, 0.05, 10]]));
    expect(checkMachineWireSweep(index, { from, to }).status).toBe('no-intersections');
    const envelope = checkMachineWireSweep(index, { from, to }, { curveDeviationMm: 0.1 });
    expect(envelope.status).toBe('intersections');
    expect(envelope.hits[0].approximate).toBe(true);
  });
  it('prunes distant bounds without consuming triangle budget', () => {
    const index = createMachineCollisionIndex(triangleModel([[100, 0, 0], [100, 10, 0], [100, 0, 10]]));
    expect(checkMachineWireSweep(index, { from, to }, { maxTriangleTests: 1 })).toMatchObject({ complete: true, testedTriangles: 0, status: 'no-intersections' });
  });
});
