// Setup for the first pass of `npm run solver:corpus`: records every sketch solve input the CAD suites
// make, through either runtime, with the test that made it, in a shard per worker. The second pass
// (`planeGcsCorpusBuild.corpus.ts`) asks PlaneGCS for each input's outcome.
import { appendFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { expect, vi } from 'vitest';
import type { CadSketchSolveInput } from '../../cadSketchSolverTypes';
import { parseCadSketchSolveInput } from '../../cadSketchSolverProtocol';
import { encodeCorpusJson } from '../../__tests__/planeGcsCorpus';

const shard = join(process.env.PLANEGCS_CORPUS_SHARDS!, `${process.pid}-${process.env.VITEST_POOL_ID ?? '0'}.jsonl`);

function capture(source: CadSketchSolveInput) {
  let input: CadSketchSolveInput;
  // Input either solver rejects before solving has no outcome to compare.
  try { input = parseCadSketchSolveInput(structuredClone(source)); } catch { return; }
  const state = expect.getState(), file = relative(process.cwd(), state.testPath ?? 'unknown').replaceAll('\\', '/');
  appendFileSync(shard, `${encodeCorpusJson({ provenance: `${file} > ${state.currentTestName ?? 'unknown'}`, input })}\n`);
}

vi.mock('@/features/cad/sketch-solver/cadSketchNativeFirstRuntime', async importOriginal => {
  const runtime = await importOriginal<typeof import('../../cadSketchNativeFirstRuntime')>();
  return { ...runtime, createCadSketchNativeFirstRuntime: (options: Parameters<typeof runtime.createCadSketchNativeFirstRuntime>[0]) => {
    const inner = runtime.createCadSketchNativeFirstRuntime(options);
    return { solve(input: CadSketchSolveInput) { capture(input); return inner.solve(input); } };
  } };
});

vi.mock('@/features/cad/sketch-solver/cadSketchSolverRuntime', async importOriginal => {
  const runtime = await importOriginal<typeof import('../../cadSketchSolverRuntime')>();
  return { ...runtime, createCadSketchSolverRuntime: (...args: Parameters<typeof runtime.createCadSketchSolverRuntime>) => {
    const inner = runtime.createCadSketchSolverRuntime(...args);
    return { ...inner, solve(input: CadSketchSolveInput) { capture(input); return inner.solve(input); } };
  } };
});
