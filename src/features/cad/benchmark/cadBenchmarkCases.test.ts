// @vitest-environment node
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import initOpenCascade from 'replicad-opencascadejs';
import { setOC } from 'replicad';
import type { CadSketchFeature } from '@/domain/cad/cadDocument';
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
      for (const expected of step.affectedBodies ? [step, { label: `${step.label} affected bodies`, ...step.affectedBodies }] : [step]) {
        const model = buildCadKernelModel(expected.document);
        try { expect(checkCadBenchmarkStep(model.result, expected)).toEqual([]); } finally { model.dispose(); }
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
    const graph = (source: typeof document, index: number) => (source.features[index] as CadSketchFeature).graph!;
    const moved = graph(prepared.document, 0).points, original = graph(document, 0).points;
    // The released rectangle follows the drag; its neighbours and every other sketch stay exact.
    for (const [index, point] of moved.entries()) {
      if (!point.id.startsWith('s0r0_')) { expect(point).toEqual(original[index]); continue; }
      expect(Number(point.position[0]) - Number(original[index].position[0])).toBeCloseTo(.5, 6);
      expect(Number(point.position[1]) - Number(original[index].position[1])).toBeCloseTo(.25, 6);
    }
    expect(prepared.document.features.slice(1)).toEqual(document.features.slice(1));
  });

  it('summarizes samples with nearest-rank percentiles', () => {
    expect(cadBenchmarkStats([5, 1, 4, 2, 3])).toEqual({ runs: 5, p50: 3, p95: 5, min: 1, max: 5 });
    expect(() => cadBenchmarkStats([])).toThrow();
  });
});
