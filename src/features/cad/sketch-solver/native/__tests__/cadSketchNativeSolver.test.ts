// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checkCadSketchGraph, parseCadSketchGraph } from '@/domain/cad/cadSketchGraph';
import { createCadBenchmarkRectangleGraph } from '../../../benchmark/cadBenchmarkCases';
import { compileCadSketchEquations } from '../compileCadSketchEquations';
import { applyCadSketchEquationSolution, CAD_SKETCH_NATIVE_PROTOCOL_VERSION, cadSketchEquationDiagnostics, encodeCadSketchEquationModel } from '../cadSketchEquationModel';
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
    expect(() => encodeCadSketchEquationModel({ ...model, equations: [{ kind: 'distance', operands: [0, 1, 2], value: 1, sourceId: 'x', tag: 0 }] })).toThrow(/4 operands/);
  });

  it('tags each PlaneGCS constraint once, sharing a tag across the equations of one', () => {
    const graph = parseCadSketchGraph({ points: [{ id: 'p', position: [0, 0] }, { id: 'q', position: [1, 1] }, { id: 'm', position: [0, 1] }],
      entities: [{ id: 'pq', kind: 'line', construction: false, startPointId: 'p', endPointId: 'q' }],
      relations: [{ id: 'mid', kind: 'midpoint', pointId: 'm', lineId: 'pq' }, { id: 'fix', kind: 'fixed-point', pointId: 'p', position: [0, 0] },
        { id: 'flat', kind: 'horizontal', pointIds: ['p', 'q'] }] });
    expect(compileCadSketchEquations({ graph, parameters: {} }).equations.map(({ sourceId, tag }) => [sourceId, tag]))
      .toEqual([['mid', 0], ['mid', 0], ['fix', 1], ['fix', 2], ['flat', 3]]);
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

  it('solves a connected chain beyond the PlaneGCS group limit to the graph checks', () => {
    // 1000 linked rectangles, 8000 unknowns in one group; PlaneGCS rejects this as too large.
    const graph = createCadBenchmarkRectangleGraph(1000, 'r', false, true), model = compileCadSketchEquations({ graph, parameters: {} });
    const solution = solver.solve(model);
    expect(solution.status).toBe('converged');
    expect(checkCadSketchGraph(applyCadSketchEquationSolution(graph, model, solution.values), {})).toEqual([]);
    expect(solution.diagnosis).toEqual({ kind: 'diagnosed', degreesOfFreedom: 0, labels: model.equations.map(() => 0) });
  });

  it('reports freedom and redundant source constraints in compiled order', () => {
    const graph = rectangles(), model = compileCadSketchEquations({ graph: parseCadSketchGraph({ ...graph, points: [...graph.points, { id: 'n', position: [9e5, 5.1e5] }],
      relations: [...graph.relations.filter(relation => relation.id !== 'tt'), { id: 'again', kind: 'distance', pointIds: ['t1', 't0'], value: 1e-5 },
        { id: 'level', kind: 'horizontal', pointIds: ['h1', 'n'] }, { id: 'meet', kind: 'coincident', pointIds: ['n', 'h1'] }] }), parameters: {} });
    const solution = solver.solve(model);
    if (solution.diagnosis.kind !== 'diagnosed') throw new Error(solution.diagnosis.kind);
    // Without its height the tiny rectangle can grow, and its repeated width is redundant. The
    // coincidence places the new point; the horizontal, with fewer equations, repeats its y.
    expect(solution.diagnosis.degreesOfFreedom).toBe(1);
    expect(cadSketchEquationDiagnostics(model, solution.diagnosis.labels)).toEqual({ conflictingIds: [], redundantIds: ['again', 'level'], partiallyRedundantIds: [] });
  });

  it('reports a constraint redundant through some of its equations as partially redundant, as PlaneGCS does', () => {
    // A coincidence after a midpoint: its y repeats the midpoint's, its x places the free point.
    const model = compileCadSketchEquations({ graph: parseCadSketchGraph({
      points: [{ id: 'a', position: ['0', '0'] }, { id: 'b', position: ['4', '2'] }, { id: 'm', position: [1.5, 1.5] }, { id: 'p', position: [7, '1'] }],
      entities: [{ id: 'ab', kind: 'line', construction: false, startPointId: 'a', endPointId: 'b' }],
      relations: [{ id: 'mid', kind: 'midpoint', pointId: 'm', lineId: 'ab' }, { id: 'meet', kind: 'coincident', pointIds: ['p', 'm'] }] }), parameters: {} });
    const solution = solver.solve(model);
    if (solution.diagnosis.kind !== 'diagnosed') throw new Error(solution.diagnosis.kind);
    expect(solution.diagnosis.degreesOfFreedom).toBe(0);
    expect(cadSketchEquationDiagnostics(model, solution.diagnosis.labels)).toEqual({ conflictingIds: [], redundantIds: [], partiallyRedundantIds: ['meet'] });
  });

  it('reports conflicting relations as not converged and keeps every value finite', () => {
    const graph = rectangles(), model = compileCadSketchEquations({ graph: parseCadSketchGraph({ ...graph,
      relations: [...graph.relations, { id: 'clash', kind: 'distance', pointIds: ['t0', 't1'], value: 2e-5 }] }), parameters: {} });
    const solution = solver.solve(model);
    expect(solution.status).toBe('not-converged');
    expect(solution.values.every(Number.isFinite)).toBe(true);
    if (solution.diagnosis.kind !== 'diagnosed') throw new Error(solution.diagnosis.kind);
    expect(solution.diagnosis.degreesOfFreedom).toBeNull();
    expect(cadSketchEquationDiagnostics(model, solution.diagnosis.labels)).toEqual({ conflictingIds: ['tw', 'clash'], redundantIds: [], partiallyRedundantIds: [] });
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

  it('answers counts larger than the buffer with invalid input instead of trapping', async () => {
    const { instance } = await WebAssembly.instantiate(wasm, {});
    const exports = instance.exports as { memory: WebAssembly.Memory; buffer_alloc(length: number): number; buffer_free(pointer: number, length: number): void; solve(pointer: number, length: number): number };
    const version = CAD_SKETCH_NATIVE_PROTOCOL_VERSION;
    for (const buffer of [[version, 2 ** 31, 0], [version, 0, 2 ** 32 - 1], [version, 2 ** 32 - 1, 2 ** 32 - 1, 0, 0]]) {
      const pointer = exports.buffer_alloc(buffer.length);
      new Float64Array(exports.memory.buffer, pointer, buffer.length).set(buffer);
      const output = exports.solve(pointer, buffer.length), reply = new Float64Array(exports.memory.buffer, output, 7).slice();
      expect([...reply.subarray(0, 4)]).toEqual([7, version, 2, 0]);
      exports.buffer_free(pointer, buffer.length); exports.buffer_free(output, 7);
    }
  });

  it('rejects a module without the solver exports', async () => {
    const empty = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);
    await expect(loadCadSketchNativeSolver(empty)).rejects.toThrow(/unexpected exports/);
  });
});
