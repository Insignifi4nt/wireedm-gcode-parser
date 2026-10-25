// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checkCadSketchGraph, parseCadSketchGraph } from '@/domain/cad/cadSketchGraph';
import { compileCadSketchEquations } from '../compileCadSketchEquations';
import { applyCadSketchEquationSolution, encodeCadSketchEquationModel } from '../cadSketchEquationModel';
import { loadCadSketchNativeSolver } from '../cadSketchNativeSolver';

const wasm = readFileSync(new URL('../../../../../../packages/sketch-solver/wasm/sketch_solver.wasm', import.meta.url));
const solver = await loadCadSketchNativeSolver(wasm);

/** Two independent rectangles, one tiny and one near the size limit, from skewed starts. */
function rectangles() {
  const rectangle = (prefix: string, size: number, offset: number) => ({
    points: [[0, 0], [1.1, 0.1], [0.9, 0.6], [-0.1, 0.4]].map(([x, y], index) => ({ id: `${prefix}${index}`, position: [offset + x * size, offset + y * size] as [number, number] })),
    entities: [0, 1, 2, 3].map(index => ({ id: `${prefix}e${index}`, kind: 'line' as const, construction: false, startPointId: `${prefix}${index}`, endPointId: `${prefix}${(index + 1) % 4}` })),
    relations: [
      { id: `${prefix}h0`, kind: 'horizontal' as const, pointIds: [`${prefix}0`, `${prefix}1`] as [string, string] },
      { id: `${prefix}h1`, kind: 'horizontal' as const, pointIds: [`${prefix}3`, `${prefix}2`] as [string, string] },
      { id: `${prefix}v0`, kind: 'vertical' as const, pointIds: [`${prefix}0`, `${prefix}3`] as [string, string] },
      { id: `${prefix}v1`, kind: 'vertical' as const, pointIds: [`${prefix}1`, `${prefix}2`] as [string, string] },
      { id: `${prefix}w`, kind: 'distance' as const, pointIds: [`${prefix}0`, `${prefix}1`] as [string, string], value: size },
      { id: `${prefix}t`, kind: 'distance' as const, pointIds: [`${prefix}1`, `${prefix}2`] as [string, string], value: size / 2 },
      { id: `${prefix}f`, kind: 'fixed-point' as const, pointId: `${prefix}0`, position: [offset, offset] as [number, number] }
    ]
  });
  const tiny = rectangle('t', 1e-5, 0), huge = rectangle('h', 4e5, 5e5);
  return parseCadSketchGraph({ points: [...tiny.points, ...huge.points], entities: [...tiny.entities, ...huge.entities], relations: [...tiny.relations, ...huge.relations] });
}

describe('native sketch equations', () => {
  it('fixes expression coordinates, expression radii and externally owned geometry with their evaluated values', () => {
    const graph = parseCadSketchGraph({ points: [{ id: 'linked-center', position: [4, 6] }, { id: 'free-center', position: [' w ', 7] }],
      entities: [{ id: 'linked-circle', kind: 'circle', construction: true, centerPointId: 'linked-center', radius: 3 },
        { id: 'free-circle', kind: 'circle', construction: false, centerPointId: 'free-center', radius: 'w / 2' }],
      relations: [{ id: 'link', kind: 'external-reference', entityId: 'linked-circle', sourceSketchId: 'layout', source: { kind: 'circle', entityId: 'source-circle', centerPointId: 'source-center' } }] });
    const model = compileCadSketchEquations({ graph, parameters: { w: 12 } });
    expect(model.values).toEqual([4, 6, 12, 7, 3, 6]);
    expect(model.fixed).toEqual([true, true, true, false, true, true]);
    expect(model.equations).toEqual([]);
  });

  it('rejects drag targets until the native solver owns them', () => {
    expect(() => compileCadSketchEquations({ graph: rectangles(), parameters: {}, drag: { pointId: 't1', position: [1, 1] } })).toThrow(/drag/);
  });

  it('refuses an equation with the wrong number of operands before native code', () => {
    const model = compileCadSketchEquations({ graph: rectangles(), parameters: {} });
    expect(() => encodeCadSketchEquationModel({ ...model, equations: [{ kind: 'distance', operands: [0, 1, 2], value: 1, sourceId: 'x' }] })).toThrow(/4 operands/);
  });
});

describe('native sketch solver module', () => {
  it('solves tiny and large geometry in one sketch to the graph checks', () => {
    const graph = rectangles(), model = compileCadSketchEquations({ graph, parameters: {} });
    const solution = solver.solve(model);
    expect(solution.status).toBe('converged');
    const solved = applyCadSketchEquationSolution(graph, model, solution.values);
    expect(checkCadSketchGraph(solved, {})).toEqual([]);
    expect(solved.points.find(point => point.id === 't2')?.position).toEqual([expect.closeTo(1e-5, 14), expect.closeTo(5e-6, 14)]);
    expect(solved.points.find(point => point.id === 'h2')?.position).toEqual([expect.closeTo(9e5, 6), expect.closeTo(7e5, 6)]);
  });

  it('reports conflicting relations as not converged and keeps every value finite', () => {
    const graph = rectangles(), model = compileCadSketchEquations({ graph: parseCadSketchGraph({ ...graph,
      relations: [...graph.relations, { id: 'clash', kind: 'distance', pointIds: ['t0', 't1'], value: 2e-5 }] }), parameters: {} });
    const solution = solver.solve(model);
    expect(solution.status).toBe('not-converged');
    expect(solution.values.every(Number.isFinite)).toBe(true);
  });

  it('leaves a satisfied sketch untouched and survives many solves in one instance', () => {
    const graph = rectangles(), model = compileCadSketchEquations({ graph, parameters: {} });
    const solved = solver.solve(model), settled = { ...model, values: solved.values };
    for (let index = 0; index < 2000; index += 1) {
      const again = solver.solve(settled);
      expect(again.iterations).toBe(0);
      expect(again.values).toEqual(solved.values);
    }
  });

  it('rejects a module without the solver exports', async () => {
    const empty = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);
    await expect(loadCadSketchNativeSolver(empty)).rejects.toThrow(/unexpected exports/);
  });
});
