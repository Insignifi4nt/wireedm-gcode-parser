import { describe, expect, it } from 'vitest';
import type { CadMesh } from '@/domain/cad/cadDocument';
import { cadBoxSelectedBody, cadBoxSelection, cadProjectedBounds, cadScreenBox } from './cadBoxSelection';

/**
 * A flat plate seen from above: a left face from x 0 to 10 and a right face from 10 to 20, both 10 high, with its six outline edges and the
 * edge between the faces. `dx` moves it along x.
 */
function plate(featureId: string, dx = 0): CadMesh {
  const corners = [[0, 0], [10, 0], [20, 0], [20, 10], [10, 10], [0, 10]].map(([x, y]) => [x + dx, y, 0]);
  const segments = [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 0], [1, 4]];
  return { featureId, name: featureId, positions: corners.flat(), normals: corners.flatMap(() => [0, 0, 1]), indices: [0, 1, 4, 0, 4, 5, 1, 2, 3, 1, 3, 4],
    edges: segments.flatMap(([a, b]) => [...corners[a], ...corners[b]]), faceGroups: [{ start: 0, count: 6, key: 'left' }, { start: 6, count: 6, key: 'right' }],
    edgeGroups: segments.map((_, index) => ({ start: index * 2, count: 2, key: `e${index}` })), volume: 0, bounds: { min: [dx, 0, 0], max: [dx + 20, 10, 0] } };
}
const project = (x: number, y: number) => ({ x, y });

describe('cad box selection', () => {
  it('normalizes drags in any direction', () => {
    expect(cadScreenBox({ x: 80, y: 10 }, { x: 20, y: 60 })).toEqual({ left: 20, top: 10, right: 80, bottom: 60 });
  });

  it('projects every vertex and skips points outside the clip range', () => {
    const project = (x: number, y: number, z: number) => z < 0 ? null : { x: x * 2, y: 100 - y * 2 };
    expect(cadProjectedBounds([0, 0, 0, 10, 5, 1, 50, 50, -1], project)).toEqual({ left: 0, top: 90, right: 20, bottom: 100 });
    expect(cadProjectedBounds([1, 1, -1], project)).toBeNull();
  });

  it('selects only a body that fits wholly inside the box, preferring the largest one', () => {
    const bodies = [
      { featureId: 'small', bounds: { left: 40, top: 40, right: 60, bottom: 60 } },
      { featureId: 'large', bounds: { left: 20, top: 20, right: 120, bottom: 90 } },
      { featureId: 'hidden', bounds: null }
    ];
    expect(cadBoxSelectedBody({ left: 30, top: 30, right: 70, bottom: 70 }, bodies)).toBe('small');
    expect(cadBoxSelectedBody({ left: 19, top: 19, right: 121, bottom: 91 }, bodies)).toBe('large');
    // Crossing the large body's edge leaves only the small body fully enclosed.
    expect(cadBoxSelectedBody({ left: 25, top: 25, right: 100, bottom: 100 }, bodies)).toBe('small');
    expect(cadBoxSelectedBody({ left: 0, top: 0, right: 10, bottom: 10 }, bodies)).toBeNull();
  });

  it('takes what a window holds and what a crossing touches, as the filter allows', () => {
    const bodies = [plate('a'), plate('b', 100)], all = { body: true, edge: true, face: true };
    const select = (rect: { left: number; top: number; right: number; bottom: number }, mode: 'window' | 'crossing', kinds = all) => cadBoxSelection({ rect, mode, bodies, kinds, project });
    const keys = (target: ReturnType<typeof select>) => target?.kind === 'topology' ? target.picks.map(pick => `${pick.kind}:${pick.key}`).sort() : target;
    // Over the left face of the first plate only: a window holds no body, a crossing touches one.
    const left = { left: -1, top: -1, right: 11, bottom: 11 };
    expect(select(left, 'window')).toBeNull();
    expect(select(left, 'crossing')).toEqual({ kind: 'body', featureId: 'a' });
    expect(select({ left: -1, top: -1, right: 21, bottom: 11 }, 'window')).toEqual({ kind: 'body', featureId: 'a' });
    // With bodies filtered out the box takes edges, and with edges filtered out too, faces.
    expect(keys(select(left, 'window', { ...all, body: false }))).toEqual(['edge:e0', 'edge:e4', 'edge:e5', 'edge:e6']);
    expect(keys(select(left, 'crossing', { ...all, body: false }))).toEqual(['edge:e0', 'edge:e1', 'edge:e3', 'edge:e4', 'edge:e5', 'edge:e6']);
    expect(keys(select(left, 'window', { body: false, edge: false, face: true }))).toEqual(['face:left']);
    expect(keys(select({ left: 9, top: 4, right: 12, bottom: 6 }, 'crossing', { body: false, edge: false, face: true }))).toEqual(['face:left', 'face:right']);
    expect(select(left, 'crossing', { body: false, edge: false, face: false })).toBeNull();
    // A crossing inside a face touches it even though no corner or edge lies in the box.
    expect(keys(select({ left: 3, top: 3, right: 6, bottom: 6 }, 'crossing', { body: false, edge: false, face: true }))).toEqual(['face:left']);
    expect(select({ left: 3, top: 3, right: 6, bottom: 6 }, 'window', { body: false, edge: true, face: true })).toBeNull();
    // Edges come from the one body with the most of them in the box.
    const wide = { left: 15, top: -1, right: 121, bottom: 11 };
    expect(select(wide, 'window', { ...all, body: false })).toMatchObject({ kind: 'topology', bodyId: 'b' });
    // A point the view cannot project keeps what holds it from lying wholly inside.
    expect(cadBoxSelection({ rect: { left: -1, top: -1, right: 21, bottom: 11 }, mode: 'window', bodies: [plate('a')], kinds: { body: false, edge: true, face: false },
      project: (x, y) => x === 20 && y === 10 ? null : { x, y } })).toMatchObject({ picks: [{ key: 'e0' }, { key: 'e1' }, { key: 'e4' }, { key: 'e5' }, { key: 'e6' }] });
  });
});
