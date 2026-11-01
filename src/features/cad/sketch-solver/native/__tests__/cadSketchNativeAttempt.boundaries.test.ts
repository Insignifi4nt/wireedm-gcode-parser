// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseCadSketchGraph } from '@/domain/cad/cadSketchGraph';
import { attemptCadSketchNativeSolve } from '../cadSketchNativeAttempt';
import { loadCadSketchNativeSolver } from '../cadSketchNativeSolver';

const wasm = readFileSync(new URL('../../../../../../packages/sketch-solver/wasm/sketch_solver.wasm', import.meta.url));
const solver = await loadCadSketchNativeSolver(wasm);

/**
 * A point held on a fixed circle of `radius` and level with its centre, starting `above` mm straight
 * above that centre. Level with the centre, the point has no radial direction to move along, so the
 * first solve stalls; only a start the attempt treats as collapsed onto the centre is retried one radius out.
 */
function levelOnCircle(radius: number, above: number) {
  return parseCadSketchGraph({
    points: [{ id: 'c', position: [0, 0] }, { id: 'p', position: [0, above] }],
    entities: [{ id: 'circle', kind: 'circle', construction: false, centerPointId: 'c', radius }],
    relations: [{ id: 'fix', kind: 'fixed-point', pointId: 'c', position: [0, 0] },
      { id: 'size', kind: 'radial-size', entityId: 'circle', quantity: 'radius', value: radius },
      { id: 'level', kind: 'horizontal', pointIds: ['c', 'p'] },
      { id: 'on', kind: 'point-on-curve', pointId: 'p', curveId: 'circle' }]
  });
}
function solvedPoint(radius: number, above: number) {
  const { result } = attemptCadSketchNativeSolve({ graph: levelOnCircle(radius, above), parameters: {} }, solver);
  return result.kind === 'solved' ? result.graph.points.find(point => point.id === 'p')?.position : result.kind;
}

describe('solver collapsed start, relative to the radius', () => {
  it('retries a point 4e-13 mm from the centre of a 1 mm circle one radius out', () => {
    expect(solvedPoint(1, 4e-13)).toEqual([1, 4e-13]);
  });

  it('does not retry a point 3e-12 mm from the centre of a 1 mm circle', () => {
    expect(solvedPoint(1, 3e-12)).toBe('rejected');
  });

  it('retries a point 4e-12 mm from the centre of a 10 mm circle one radius out', () => {
    expect(solvedPoint(10, 4e-12)).toEqual([10, 4e-12]);
  });

  it('does not retry a point 3e-11 mm from the centre of a 10 mm circle', () => {
    expect(solvedPoint(10, 3e-11)).toBe('rejected');
  });
});
