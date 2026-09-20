import { describe, expect, it } from 'vitest';
import { createSimulationPathBuffers, updateActiveSimulationPath } from '../simulationPathBuffers';

const steps = [
  { event: { kind: 'program-start' }, path: [{ x: 0, y: 0 }] },
  { event: { kind: 'motion' }, path: [{ x: 0, y: 0 }, { x: 10, y: 0 }] },
  { event: { kind: 'program-stop' }, path: [{ x: 10, y: 0 }] },
  { event: { kind: 'position' }, path: [{ x: 10, y: 0 }, { x: 20, y: 0 }] },
  { event: { kind: 'motion' }, path: [{ x: 20, y: 0 }, { x: 20, y: 5 }, { x: 25, y: 10 }] }
];

describe('batched simulation path rendering', () => {
  it('separates cut and position lines without connecting independent cutting events', () => {
    const buffers = createSimulationPathBuffers(steps, 21);
    expect([...buffers.cut.positions]).toEqual([0, 0, 21, 10, 0, 21, 20, 0, 21, 20, 5, 21, 20, 5, 21, 25, 10, 21]);
    expect([...buffers.position.positions]).toEqual([10, 0, 21, 20, 0, 21]);
    expect([...buffers.cut.completedVertexCounts]).toEqual([0, 0, 2, 2, 2, 6]);
    expect([...buffers.position.completedVertexCounts]).toEqual([0, 0, 0, 0, 2, 2]);
    // Seeking back only selects an earlier prefix; no buffer needs rebuilding.
    expect(buffers.cut.completedVertexCounts[2]).toBe(2);
  });

  it('reuses the active buffer and keeps the exact curved tip without changing source vertices', () => {
    const buffers = createSimulationPathBuffers(steps, 21);
    const array = buffers.active;
    const first = updateActiveSimulationPath(buffers, 4, 0.2, { x: 19.5, y: 2 });
    expect(first).toMatchObject({ kind: 'cut', vertexCount: 2, updates: [{ start: 0, count: 9 }] });
    expect([...array.slice(3, 5)]).toEqual([19.5, 2]);
    const later = updateActiveSimulationPath(buffers, 4, 0.75, { x: 22, y: 8 });
    expect(later.vertexCount).toBe(3);
    expect([...array.slice(3, 5)]).toEqual([20, 5]);
    expect([...array.slice(6, 8)]).toEqual([22, 8]);
    expect(later.updates.every((range) => range.count === 3)).toBe(true);
    const reversed = updateActiveSimulationPath(buffers, 4, 0.1, { x: 19.8, y: 1 });
    expect(reversed.vertexCount).toBe(2);
    expect([...array.slice(6, 8)]).toEqual([25, 10]);
    expect(buffers.active).toBe(array);
    expect(steps[4].path).toEqual([{ x: 20, y: 0 }, { x: 20, y: 5 }, { x: 25, y: 10 }]);
  });

  it('switches between cut, positioning and stationary events with no stale active vertices', () => {
    const buffers = createSimulationPathBuffers(steps, 21);
    updateActiveSimulationPath(buffers, 4, 0.8, { x: 24, y: 9 });
    expect(updateActiveSimulationPath(buffers, 2, 0.5, { x: 10, y: 0 }).vertexCount).toBe(0);
    expect(updateActiveSimulationPath(buffers, 3, 0.5, { x: 15, y: 0 })).toMatchObject({ kind: 'position', vertexCount: 2 });
    expect([...buffers.active.slice(0, 2)]).toEqual([10, 0]);
    expect([...buffers.active.slice(3, 5)]).toEqual([15, 0]);
    expect(updateActiveSimulationPath(buffers, null, 1, { x: 25, y: 10 }).vertexCount).toBe(0);
  });

  it('has fixed path batches and active capacity for thousands of linear execution events', () => {
    const many = Array.from({ length: 10_000 }, (_, index) => ({ event: { kind: index % 2 ? 'position' : 'motion' },
      path: [{ x: index, y: 0 }, { x: index + 1, y: 0 }] }));
    const buffers = createSimulationPathBuffers(many, 0);
    expect(buffers.cut.positions.length).toBe(30_000);
    expect(buffers.position.positions.length).toBe(30_000);
    expect(buffers.active.length).toBe(6);
    expect(buffers.cut.completedVertexCounts.at(-1)).toBe(10_000);
  });

  it('preserves small path details relative to a local GPU origin without changing world coordinates', () => {
    const origin = { x: 999999, y: 999999, z: 100 };
    const source = [{ event: { kind: 'motion' }, path: [{ x: origin.x, y: origin.y }, { x: origin.x + 0.02, y: origin.y }] }];
    const buffers = createSimulationPathBuffers(source, 110, origin);
    expect(buffers.cut.positions[3]).toBeCloseTo(0.02, 8);
    expect(buffers.cut.positions[2]).toBe(10);
    updateActiveSimulationPath(buffers, 0, 0.5, { x: origin.x + 0.01, y: origin.y });
    expect(buffers.active[3]).toBeCloseTo(0.01, 8);
    expect(buffers.active[5]).toBeCloseTo(10.02, 6);
    expect(source[0].path[1].x).toBe(origin.x + 0.02);
  });
});
