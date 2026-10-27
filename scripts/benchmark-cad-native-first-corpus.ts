import { writeFile } from 'node:fs/promises';
import { cadSketchSolvedValues } from '../src/domain/cad/cadSketchGraph';
import { createNodeCadBenchmarkSolver } from './benchmark-cad-solver-resources';
import { readPlaneGcsCorpus } from '../src/features/cad/sketch-solver/__tests__/planeGcsCorpus';
import type { CadSketchSolveResult } from '../src/features/cad/sketch-solver/cadSketchSolverTypes';

// Answers every frozen corpus input with the app's runtime as shipped (native first, PlaneGCS for
// what native cannot answer) and with native alone, the runtime once PlaneGCS is removed. Every
// input whose two answers differ is one where removing PlaneGCS changes what the app answers.
// Usage: tsx --tsconfig tsconfig.app.json scripts/benchmark-cad-native-first-corpus.ts [--out file.json]
const args = process.argv.slice(2), out = args.includes('--out') ? args[args.indexOf('--out') + 1] : undefined;
const [first, alone] = await Promise.all([createNodeCadBenchmarkSolver('native-first'), createNodeCadBenchmarkSolver('native-only')]);

const answer = (result: CadSketchSolveResult) => ({ kind: result.kind, reason: result.kind === 'rejected' ? result.reason : undefined,
  message: result.kind === 'rejected' ? result.message : undefined, diagnostics: result.diagnostics,
  values: result.kind === 'solved' ? cadSketchSolvedValues(result.graph) : undefined });
const short = (result: CadSketchSolveResult) => `${result.kind === 'solved' ? 'solved' : result.reason} ${result.diagnostics.status} dof=${result.diagnostics.degreesOfFreedom ?? '?'}`;

const { records } = readPlaneGcsCorpus();
const tally = { records: records.length, answeredByNative: 0, answeredByPlaneGcs: 0, fallbacks: {} as Record<string, number>, identical: 0, differ: 0 };
const differences: unknown[] = [], fallbacks: unknown[] = [];
for (const { record, input } of records) {
  const shipped = await first.solver.solve(input), shippedRecord = first.solver.takeRecord();
  const native = await alone.solver.solve(input), nativeRecord = alone.solver.takeRecord();
  if (shippedRecord?.answeredBy === 'planegcs') tally.answeredByPlaneGcs += 1; else tally.answeredByNative += 1;
  const reason = shippedRecord?.native ?? 'unrecorded';
  if (reason !== 'answer') {
    tally.fallbacks[reason] = (tally.fallbacks[reason] ?? 0) + 1;
    fallbacks.push({ hash: record.hash, provenance: record.provenance[0], native: reason, answeredBy: shippedRecord?.answeredBy,
      shipped: short(shipped), nativeAlone: short(native) });
  }
  if (JSON.stringify(answer(shipped)) === JSON.stringify(answer(native))) { tally.identical += 1; continue; }
  tally.differ += 1;
  differences.push({ hash: record.hash, provenance: record.provenance, shippedRecord, nativeRecord, shipped: answer(shipped), nativeAlone: answer(native) });
}
const report = { tally, fallbacks, differences };
console.log(JSON.stringify(tally));
for (const item of fallbacks) console.log(JSON.stringify(item));
if (out) await writeFile(out, `${JSON.stringify(report, null, 2)}\n`);
