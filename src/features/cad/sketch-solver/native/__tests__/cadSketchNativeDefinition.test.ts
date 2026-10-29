// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseCadSketchGraph } from '@/domain/cad/cadSketchGraph';
import type { CadSketchSolveInput } from '../../cadSketchSolverTypes';
import { attemptCadSketchNativeSolve } from '../cadSketchNativeAttempt';
import { cadSketchEquationDefinition } from '../cadSketchEquationModel';
import { compileCadSketchEquations } from '../compileCadSketchEquations';
import { loadCadSketchNativeSolver, type CadSketchNativeSolver } from '../cadSketchNativeSolver';

const wasm = readFileSync(new URL('../../../../../../packages/sketch-solver/wasm/sketch_solver.wasm', import.meta.url));
const solver = await loadCadSketchNativeSolver(wasm);

/** A rectangle with its bottom left corner fixed at `origin`, its sides level and plumb and only its width driven. */
function widthOnly(origin: readonly [number, number]) {
  const corner = (x: number, y: number): [number, number] => [origin[0] + x, origin[1] + y];
  return parseCadSketchGraph({
    points: [{ id: 'p0', position: corner(0, 0) }, { id: 'p1', position: corner(9, 0.5) }, { id: 'p2', position: corner(10.5, 4) }, { id: 'p3', position: corner(-0.5, 3) }],
    entities: [['bottom', 'p0', 'p1'], ['right', 'p1', 'p2'], ['top', 'p2', 'p3'], ['left', 'p3', 'p0']]
      .map(([id, startPointId, endPointId]) => ({ id, kind: 'line', construction: false, startPointId, endPointId })),
    relations: [{ id: 'fix', kind: 'fixed-point', pointId: 'p0', position: corner(0, 0) },
      { id: 'h0', kind: 'horizontal', pointIds: ['p0', 'p1'] }, { id: 'h1', kind: 'horizontal', pointIds: ['p3', 'p2'] },
      { id: 'v0', kind: 'vertical', pointIds: ['p0', 'p3'] }, { id: 'v1', kind: 'vertical', pointIds: ['p1', 'p2'] },
      { id: 'width', kind: 'distance', pointIds: ['p0', 'p1'], value: 10 }]
  });
}

function definitionOf(input: CadSketchSolveInput) {
  const { result } = attemptCadSketchNativeSolve(input, solver);
  if (result.kind !== 'solved') throw new Error(`${result.kind}: ${result.reason}`);
  return result.diagnostics.definition;
}

describe('native sketch definition', () => {
  it('defines the driven bottom of a rectangle and leaves its height free, alike far from the origin', () => {
    const expected = { definedPointIds: ['p0', 'p1'], underDefinedPointIds: ['p2', 'p3'], definedEntityIds: ['bottom'], underDefinedEntityIds: ['right', 'top', 'left'] };
    for (const origin of [[0, 0], [1e5, 1e5], [-1e5, 3e4]] as const)
      expect(definitionOf({ graph: widthOnly(origin), parameters: {}, analyseDefinition: true })).toEqual(expected);
    const graph = widthOnly([0, 0]), height = { id: 'height', kind: 'distance', pointIds: ['p1', 'p2'], value: 4 } as const;
    expect(definitionOf({ graph: parseCadSketchGraph({ ...graph, relations: [...graph.relations, height] }), parameters: {}, analyseDefinition: true })).toEqual({
      definedPointIds: ['p0', 'p1', 'p2', 'p3'], underDefinedPointIds: [], definedEntityIds: ['bottom', 'right', 'top', 'left'], underDefinedEntityIds: [] });
  });

  it('needs a circle\'s center and radius, and an arc\'s center and both ends', () => {
    const graph = parseCadSketchGraph({
      points: [{ id: 'c', position: [0, 0] }, { id: 's', position: [9, 1] }, { id: 'e', position: [-1, 11] }, { id: 'hub', position: [30, 0] }, { id: 'loose', position: [60, 2] }],
      entities: [{ id: 'arc', kind: 'arc', construction: false, centerPointId: 'c', startPointId: 's', endPointId: 'e', direction: 'ccw' },
        { id: 'unsized', kind: 'circle', construction: false, centerPointId: 'hub', radius: 4 },
        { id: 'sized', kind: 'circle', construction: false, centerPointId: 'loose', radius: 3 }],
      relations: [{ id: 'fix-c', kind: 'fixed-point', pointId: 'c', position: [0, 0] }, { id: 'fix-hub', kind: 'fixed-point', pointId: 'hub', position: [30, 0] },
        { id: 'arc-size', kind: 'radial-size', entityId: 'arc', quantity: 'radius', value: 10 },
        { id: 'sized-size', kind: 'radial-size', entityId: 'sized', quantity: 'diameter', value: 6 }]
    });
    // The arc's ends slide around its fixed center at its radius; the hub circle can grow and the
    // sized one move.
    expect(definitionOf({ graph, parameters: {}, analyseDefinition: true })).toEqual({ definedPointIds: ['c', 'hub'], underDefinedPointIds: ['s', 'e', 'loose'],
      definedEntityIds: [], underDefinedEntityIds: ['arc', 'unsized', 'sized'] });
    const held = parseCadSketchGraph({ ...graph, relations: [...graph.relations, { id: 'level', kind: 'horizontal', pointIds: ['c', 's'] },
      { id: 'plumb', kind: 'vertical', pointIds: ['c', 'e'] }, { id: 'hub-size', kind: 'radial-size', entityId: 'unsized', quantity: 'radius', value: 4 },
      { id: 'fix-loose', kind: 'fixed-point', pointId: 'loose', position: [60, 2] }] });
    expect(definitionOf({ graph: held, parameters: {}, analyseDefinition: true })).toEqual({ definedPointIds: ['c', 's', 'e', 'hub', 'loose'], underDefinedPointIds: [],
      definedEntityIds: ['arc', 'unsized', 'sized'], underDefinedEntityIds: [] });
  });

  it('defines expression coordinates and radii, which never move', () => {
    const graph = parseCadSketchGraph({ points: [{ id: 'e', position: [' w ', 'w / 2'] }, { id: 'q', position: [20, 3] }, { id: 'half', position: ['w', 1] }],
      entities: [{ id: 'hole', kind: 'circle', construction: false, centerPointId: 'e', radius: 'w / 4' },
        { id: 'edge', kind: 'line', construction: false, startPointId: 'e', endPointId: 'q' }], relations: [] });
    // `half` has an expression x and a free y that no relation reads.
    expect(definitionOf({ graph, parameters: { w: 12 }, analyseDefinition: true })).toEqual({ definedPointIds: ['e'], underDefinedPointIds: ['q', 'half'],
      definedEntityIds: ['hole'], underDefinedEntityIds: ['edge'] });
  });

  it('never defines geometry that only a lead within the dependence distance shows moving', () => {
    // `p` sits 5e-11 right of `a`, so the factor drops the tiny lead of `p.x` in their distance.
    // The one free direction then moves `r.x` by about 5e-6 per unit, which only the dropped lead
    // shows: `r` and the line through it are unknown, never defined. It moves `q.y` by only about
    // 5e-11 per unit, within the dependence distance, so `q` is defined.
    const graph = parseCadSketchGraph({
      points: [{ id: 'p', position: [5e-11, 0] }, { id: 'q', position: ['0', 0] }, { id: 'r', position: [1e-5, '-1'] }, { id: 'a', position: ['0', '-1'] }],
      entities: [{ id: 'qr', kind: 'line', construction: false, startPointId: 'q', endPointId: 'r' }],
      relations: [{ id: 'pa', kind: 'distance', pointIds: ['p', 'a'], value: 1 }, { id: 'level', kind: 'horizontal', pointIds: ['p', 'q'] },
        { id: 'arm', kind: 'distance', pointIds: ['q', 'r'], value: 1.00000000005 }]
    });
    expect(definitionOf({ graph, parameters: {}, analyseDefinition: true })).toEqual({ definedPointIds: ['q', 'a'], underDefinedPointIds: ['p'],
      definedEntityIds: [], underDefinedEntityIds: [] });
  });

  it('never defines geometry that rounding in the factor shows moved by less than the dependence distance', () => {
    // Two equal lengths from nearly the same anchors leave one free direction. It moves `p.x` by
    // about 4.4e-10 per unit, beyond the dependence distance, though rounding in the factor shows
    // it below that: `p` and its lines are unknown, never defined.
    const anchor = (id: string, x: number, y: number) => ({ id, position: [String(x), String(y)] as [string, string] });
    const line = (id: string, startPointId: string, endPointId: string) => ({ id, kind: 'line' as const, construction: false, startPointId, endPointId });
    const graph = parseCadSketchGraph({
      points: [{ id: 'p', position: [0, '0'] }, { id: 'q', position: [0, 0] }, anchor('a0', -0.17790289092808964, -0.9840480483184895),
        anchor('b0', 0.4820456924349914, 0.8761460782340292), anchor('a1', -0.17790313831017066, -0.9840480035950443),
        anchor('b1', 0.4820456924349914, 0.8761460782340296)],
      entities: [line('pa0', 'p', 'a0'), line('qb0', 'q', 'b0'), line('pa1', 'p', 'a1'), line('qb1', 'q', 'b1')],
      relations: [{ id: 'first', kind: 'equal-length', lineIds: ['pa0', 'qb0'] }, { id: 'second', kind: 'equal-length', lineIds: ['pa1', 'qb1'] }]
    });
    expect(definitionOf({ graph, parameters: {}, analyseDefinition: true })).toEqual({ definedPointIds: ['a0', 'b0', 'a1', 'b1'], underDefinedPointIds: ['q'],
      definedEntityIds: [], underDefinedEntityIds: ['qb0', 'qb1'] });
  });

  it('maps a parameter not analysed to unknown unless another part is free', () => {
    const graph = widthOnly([0, 0]), model = compileCadSketchEquations({ graph, parameters: {} });
    const codes = model.values.map(() => 2), at = (id: string, axis: 0 | 1) => model.pointParameters.get(id)! + axis;
    codes[at('p2', 1)] = 0; codes[at('p3', 0)] = 0; codes[at('p3', 1)] = 1;
    expect(cadSketchEquationDefinition(graph, model, codes)).toEqual({ definedPointIds: ['p0', 'p1'], underDefinedPointIds: ['p3'],
      definedEntityIds: ['bottom'], underDefinedEntityIds: ['top', 'left'] });
  });

  it('asks native for definition only when the input does, and never for a drag', () => {
    const asked: (boolean | undefined)[] = [];
    const recording: CadSketchNativeSolver = { memoryBytes: () => solver.memoryBytes(), solve(model, options) { asked.push(options?.analyseDefinition); return solver.solve(model, options); } };
    const graph = widthOnly([0, 0]);
    const plain = attemptCadSketchNativeSolve({ graph, parameters: {} }, recording).result;
    expect(plain.kind === 'solved' && 'definition' in plain.diagnostics).toBe(false);
    const dragged = attemptCadSketchNativeSolve({ graph, parameters: {}, drag: { pointId: 'p2', position: [10, 5] }, analyseDefinition: true }, recording).result;
    expect(dragged.kind === 'solved' && 'definition' in dragged.diagnostics).toBe(false);
    attemptCadSketchNativeSolve({ graph, parameters: {}, analyseDefinition: true }, recording);
    expect(asked).toEqual([false, false, true]);
  });
});
