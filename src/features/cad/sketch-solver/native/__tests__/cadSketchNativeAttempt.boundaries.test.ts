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

/**
 * A fixed line from (0, 0) to (10·`scale`, 0) joined tangent at its end to a counterclockwise arc of radius 5·`scale`, whose centre
 * starts `off` mm below the line's extension, at x = 15·`scale`. The joint holds the radius at the joint square to the line. From a centre
 * this close to the line, the side the first solve reaches depends on rounding. From these starts it does not solve, so the answer
 * depends only on whether the attempt treats the centre as starting along the line and offers quarter-turn starts, below and then above.
 * Below, the arc would double back and the check rejects it; above, it leaves the line smoothly. The solve count shows the retries.
 */
function tangentJoint(scale: number, off: number) {
  return parseCadSketchGraph({
    points: [{ id: 'a', position: [0, 0] }, { id: 'b', position: [10 * scale, 0] }, { id: 'c', position: [15 * scale, off] }, { id: 'e', position: [15 * scale, 5 * scale] }],
    entities: [{ id: 'base', kind: 'line', construction: false, startPointId: 'a', endPointId: 'b' },
      { id: 'bend', kind: 'arc', construction: false, centerPointId: 'c', startPointId: 'b', endPointId: 'e', direction: 'ccw' }],
    relations: [{ id: 'fix-a', kind: 'fixed-point', pointId: 'a', position: [0, 0] }, { id: 'fix-b', kind: 'fixed-point', pointId: 'b', position: [10 * scale, 0] },
      { id: 'size', kind: 'radial-size', entityId: 'bend', quantity: 'radius', value: 5 * scale },
      { id: 'join', kind: 'tangent-joint', endpoints: [{ entityId: 'base', pointId: 'b' }, { entityId: 'bend', pointId: 'b' }] }]
  });
}
/** How many times the solver ran, and the solved centre or why there is none. */
function solvedCentre(scale: number, off: number) {
  let solves = 0;
  const counted = { ...solver, solve: (...args: Parameters<typeof solver.solve>) => { solves++; return solver.solve(...args); } };
  const { result } = attemptCadSketchNativeSolve({ graph: tangentJoint(scale, off), parameters: {} }, counted);
  return { solves, centre: result.kind === 'solved' ? result.graph.points.find(point => point.id === 'c')?.position : result.kind };
}

describe('solver along-support start, relative to the arm and support lengths', () => {
  // The sine between arm and support is the offset over the 5·scale arm.
  it('turns a centre 2e-12 mm off a 10 mm line, sine 4e-13, a quarter turn each way', () => {
    expect(solvedCentre(1, -2e-12)).toEqual({ solves: 3, centre: [10, 5] });
  });

  it('does not turn a centre 1.5e-11 mm off a 10 mm line, sine 3e-12', () => {
    expect(solvedCentre(1, -1.5e-11)).toEqual({ solves: 1, centre: 'rejected' });
  });

  it('turns a centre 3e-11 mm off a 100 mm line, sine 6e-13, a quarter turn each way', () => {
    expect(solvedCentre(10, -3e-11)).toEqual({ solves: 3, centre: [100, 50] });
  });

  it('does not turn a centre 1.5e-10 mm off a 100 mm line, sine 3e-12', () => {
    expect(solvedCentre(10, -1.5e-10)).toEqual({ solves: 1, centre: 'rejected' });
  });
});
