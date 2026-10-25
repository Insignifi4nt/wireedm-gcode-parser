// @vitest-environment node
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { checkCadSketchGraph, parseCadSketchGraph } from '@/domain/cad/cadSketchGraph';
import { createCadSketchSolverRuntime } from '../sketch-solver/cadSketchSolverRuntime';
import { initializeCadSketchSolverModule } from '../sketch-solver/cadSketchSolverModule';
import { cadSketchSolutionMatchesInput } from '../sketch-solver/cadSketchSolverProtocol';
import { createCadSolverDieInput, createCadSolverFreeDieInput, createCadSolverWorkloadCases } from './cadSolverWorkloadCases';

const require = createRequire(import.meta.url);
const solver = createCadSketchSolverRuntime(() => initializeCadSketchSolverModule(pathToFileURL(require.resolve('@salusoft89/planegcs/dist/planegcs_dist/planegcs.wasm')).href));

describe('solver workload fixtures against real PlaneGCS', () => {
  it.each(createCadSolverWorkloadCases().map(testCase => [testCase.id, testCase.input] as const))('%s pins acceptance, freedom and source diagnostics', async (_id, input) => {
    expect(parseCadSketchGraph(input.graph)).toEqual(input.graph);
    const before = structuredClone(input), result = await solver.solve(input);
    expect({ kind: result.kind, reason: result.kind === 'rejected' ? result.reason : null, diagnostics: result.diagnostics }).toMatchSnapshot();
    expect(input).toEqual(before);
    if (result.kind === 'solved') {
      expect(cadSketchSolutionMatchesInput(input, result.graph)).toBe(true);
      expect(checkCadSketchGraph(result.graph, input.parameters)).toEqual([]);
    }
  }, 30_000);

  it('has a 30-60 segment die with all requested relation families and a zero-freedom solve', async () => {
    const input = createCadSolverDieInput();
    const segments = input.graph.entities.filter(entity => entity.kind !== 'circle' && !entity.construction);
    expect(segments.length).toBeGreaterThanOrEqual(30); expect(segments.length).toBeLessThanOrEqual(60);
    for (const kind of ['fillet-corner', 'chamfer-corner', 'tangent-joint', 'equal-radius', 'radial-size', 'line-angle', 'symmetric', 'midpoint', 'linear-pattern'])
      expect(input.graph.relations.some(relation => relation.kind === kind)).toBe(true);
    expect(await solver.solve(input)).toMatchObject({ kind: 'solved', diagnostics: { degreesOfFreedom: 0 } });
    const free = createCadSolverFreeDieInput(), freeResult = await solver.solve(free);
    expect(freeResult.kind).toBe('solved'); expect(freeResult.diagnostics.degreesOfFreedom).toBeGreaterThan(0);
    const fullDimensions = input.graph.relations.filter(relation => relation.kind === 'axis-distance').length;
    const freeDimensions = free.graph.relations.filter(relation => relation.kind === 'axis-distance').length;
    expect((fullDimensions - freeDimensions) / fullDimensions).toBeCloseTo(.3, 1);
    expect(free.graph.relations.some(relation => relation.kind === 'external-reference')).toBe(true);
    expect(free.graph.points.find(point => point.id === 'expressionPoint')?.position).toEqual([' datumX ', ' datumY ']);
  });

  it('shuffles authoring order without changing hub intent or solved geometry', async () => {
    const cases = createCadSolverWorkloadCases(), original = cases.find(testCase => testCase.id === 'topology-hub')!.input;
    const shuffled = cases.find(testCase => testCase.id === 'topology-hub-shuffled')!.input;
    expect(shuffled.graph.points).not.toEqual(original.graph.points);
    const ordered = <T extends { readonly id: string }>(items: readonly T[]) => [...items].sort((a, b) => a.id.localeCompare(b.id));
    expect(ordered(shuffled.graph.points)).toEqual(ordered(original.graph.points));
    expect(ordered(shuffled.graph.entities)).toEqual(ordered(original.graph.entities));
    expect(ordered(shuffled.graph.relations)).toEqual(ordered(original.graph.relations));
    const a = await solver.solve(original), b = await solver.solve(shuffled);
    expect(a.kind).toBe('solved'); expect(b.kind).toBe('solved');
    if (a.kind !== 'solved' || b.kind !== 'solved') throw new Error('Hub solve failed.');
    for (const point of a.graph.points) {
      const other = b.graph.points.find(candidate => candidate.id === point.id)!;
      expect(Number(other.position[0])).toBeCloseTo(Number(point.position[0]), 7);
      expect(Number(other.position[1])).toBeCloseTo(Number(point.position[1]), 7);
    }
  });
});
