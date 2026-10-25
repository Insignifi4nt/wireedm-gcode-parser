// Setup for the `native-differential` project: every PlaneGCS solve in the selected suites is
// repeated by the native solver. Mismatches are collected and fail the suite after its tests,
// so suites that expect rejections cannot swallow them.
import { readFileSync } from 'node:fs';
import { afterAll, expect, vi } from 'vitest';
import { checkCadSketchGraph } from '@/domain/cad/cadSketchGraph';
import type { CadSketchSolveInput, CadSketchSolveResult } from '../../cadSketchSolverTypes';
import { cadSketchSolutionMatchesInput, parseCadSketchSolveInput } from '../../cadSketchSolverProtocol';
import { compileCadSketchEquations } from '../compileCadSketchEquations';
import { applyCadSketchEquationSolution, type CadSketchEquationModel } from '../cadSketchEquationModel';
import { loadCadSketchNativeSolver, type CadSketchNativeSolver } from '../cadSketchNativeSolver';
import { planeGcsEquations, planeGcsValues } from './planeGcsEquations';

const wasm = readFileSync(new URL('../../../../../../packages/sketch-solver/wasm/sketch_solver.wasm', import.meta.url));
const tally = { compared: 0, wellConstrained: 0, skippedDrag: 0 }, mismatches: string[] = [];
let solver: Promise<CadSketchNativeSolver> | undefined;

async function compare(input: CadSketchSolveInput, result: CadSketchSolveResult | undefined, runtime: typeof import('../../cadSketchSolverRuntime')) {
  if (input.drag) { tally.skippedDrag += 1; return; }
  const label = (message: string) => `${expect.getState().currentTestName ?? 'unknown test'}: ${message}`;
  let planeGcs: ReturnType<typeof runtime.compileCadSketchPlaneGcs> | undefined, parsed: CadSketchSolveInput | undefined;
  try { parsed = parseCadSketchSolveInput(input); planeGcs = runtime.compileCadSketchPlaneGcs(parsed); } catch { /* compared below */ }
  let model: CadSketchEquationModel | undefined;
  try { if (parsed) model = compileCadSketchEquations(parsed); } catch (error) { if (planeGcs) mismatches.push(label(`native compilation failed: ${String(error)}`)); }
  if (!planeGcs || !parsed || !model) {
    if (model) mismatches.push(label('native compilation accepted input that PlaneGCS rejects'));
    return;
  }
  tally.compared += 1;
  const restated = planeGcsEquations(planeGcs, model);
  if (JSON.stringify(restated) !== JSON.stringify(model.equations)) mismatches.push(label(`equations differ:\n${JSON.stringify(restated)}\n${JSON.stringify(model.equations)}`));
  if (JSON.stringify(planeGcsValues(planeGcs, model)) !== JSON.stringify(model.values)) mismatches.push(label('parameter values differ'));
  if (result?.kind !== 'solved') return;
  const native = (await (solver ??= loadCadSketchNativeSolver(wasm))).solve(model);
  if (native.status !== 'converged') { mismatches.push(label(`native solve did not converge (residual ${native.residual})`)); return; }
  const graph = applyCadSketchEquationSolution(parsed.graph, model, native.values);
  if (!cadSketchSolutionMatchesInput(parsed, graph)) mismatches.push(label('native solution changed fixed source geometry'));
  const issues = checkCadSketchGraph(graph, parsed.parameters);
  if (issues.length) mismatches.push(label(`native solution fails graph checks: ${JSON.stringify(issues)}`));
  if (result.diagnostics.degreesOfFreedom !== 0) return;
  tally.wellConstrained += 1;
  graph.points.forEach((point, index) => point.position.forEach((value, axis) => {
    const expected = result.graph.points[index].position[axis];
    if (typeof value === 'number' && typeof expected === 'number' && Math.abs(value - expected) > 1e-8 * Math.max(1, Math.abs(expected)))
      mismatches.push(label(`point ${point.id} axis ${axis}: native ${value}, PlaneGCS ${expected}`));
  }));
  graph.entities.forEach((entity, index) => {
    const expected = result.graph.entities[index];
    if (entity.kind === 'circle' && expected.kind === 'circle' && typeof entity.radius === 'number' && typeof expected.radius === 'number'
      && Math.abs(entity.radius - expected.radius) > 1e-8 * Math.max(1, Math.abs(expected.radius)))
      mismatches.push(label(`circle ${entity.id} radius: native ${entity.radius}, PlaneGCS ${expected.radius}`));
  });
}

vi.mock('../../cadSketchSolverRuntime', async importOriginal => {
  const runtime = await importOriginal<typeof import('../../cadSketchSolverRuntime')>();
  return { ...runtime, createCadSketchSolverRuntime: (...args: Parameters<typeof runtime.createCadSketchSolverRuntime>) => {
    const inner = runtime.createCadSketchSolverRuntime(...args);
    return { async solve(input: CadSketchSolveInput) {
      // Suites may mutate their input after the call to prove it was captured.
      const captured = structuredClone(input), result = await inner.solve(input);
      await compare(captured, result, runtime);
      return result;
    } };
  } };
});

afterAll(() => {
  if (process.env.NATIVE_DIFFERENTIAL_TALLY) console.log(`native differential: ${JSON.stringify(tally)}`);
  expect(mismatches).toEqual([]);
});
