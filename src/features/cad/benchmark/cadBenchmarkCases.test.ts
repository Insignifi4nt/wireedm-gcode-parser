// @vitest-environment node
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import initOpenCascade from 'replicad-opencascadejs';
import { setOC } from 'replicad';
import { buildCadKernelModel } from '../kernel/cadKernelModel';
import { prepareCadEdits } from '../cadEditPreparation';
import { createCadSketchSolverRuntime } from '../sketch-solver/cadSketchSolverRuntime';
import { initializeCadSketchSolverModule } from '../sketch-solver/cadSketchSolverModule';
import { cadBenchmarkStats, checkCadBenchmarkStep } from './cadBenchmark';
import { createCadBenchmarkDragPreview, createCadBenchmarkRectangleGraph, createCadKernelBenchmarkCases } from './cadBenchmarkCases';

const require = createRequire(import.meta.url);
const solver = createCadSketchSolverRuntime(() => initializeCadSketchSolverModule(pathToFileURL(require.resolve('@salusoft89/planegcs/dist/planegcs_dist/planegcs.wasm')).href));

beforeAll(async () => {
  const wasmBinary = await readFile(new URL('../../../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm', import.meta.url));
  setOC(await initOpenCascade({ wasmBinary, print: () => undefined, printErr: () => undefined }));
}, 60_000);

// Benchmark timings are only comparable while every case still builds its analytic geometry.
describe('CAD benchmark cases', () => {
  it.each(createCadKernelBenchmarkCases().map(testCase => [testCase.id, testCase] as const))('%s builds its analytic expectations at every step', (_id, testCase) => {
    for (const step of testCase.steps) {
      for (const document of step.dirtySubset ? [step.document, step.dirtySubset] : [step.document]) {
        const model = buildCadKernelModel(document);
        try {
          if (document === step.document) expect(checkCadBenchmarkStep(model.result, step)).toEqual([]);
          else expect(model.result.diagnostics).toEqual([]);
        } finally { model.dispose(); }
      }
    }
  }, 60_000);

  it('reports a wrong volume, a missing body and a diagnostic as failures', () => {
    const step = createCadKernelBenchmarkCases()[0].steps[0];
    const model = buildCadKernelModel(step.document);
    try {
      const [mesh] = model.result.meshes;
      expect(checkCadBenchmarkStep({ ...model.result, meshes: [{ ...mesh, volume: mesh.volume * 1.001 }] }, step)).toEqual([expect.stringContaining('volume')]);
      expect(checkCadBenchmarkStep({ ...model.result, meshes: [], diagnostics: [{ code: 'kernel-operation-failed', message: 'Failed.' }] }, step))
        .toEqual(['build: diagnostic kernel-operation-failed Failed.', 'build: expected 1 bodies, built 0', 'build: missing body cut']);
    } finally { model.dispose(); }
  });

  it('solves rectangle workloads to zero freedom and prepares a drag preview across independent sketches', async () => {
    const solved = await solver.solve({ graph: createCadBenchmarkRectangleGraph(10), parameters: {} });
    expect(solved).toMatchObject({ kind: 'solved', diagnostics: { degreesOfFreedom: 0 } });
    const { document, edit } = createCadBenchmarkDragPreview(3, 2);
    const prepared = await prepareCadEdits(document, [edit], solver);
    // The fully constrained corner returns to its corner; every other sketch stays exact.
    expect(prepared.document).toEqual(document);
  });

  it('summarizes samples with nearest-rank percentiles', () => {
    expect(cadBenchmarkStats([5, 1, 4, 2, 3])).toEqual({ runs: 5, p50: 3, p95: 5, min: 1, max: 5 });
    expect(() => cadBenchmarkStats([])).toThrow();
  });
});
