import { writeFile } from 'node:fs/promises';
import { createCadBenchmarkRectangleGraph } from '../src/features/cad/benchmark/cadBenchmarkCases';
import { cadSolverOutcome, checkCadSolverBenchmarkResult } from '../src/features/cad/benchmark/cadSolverWorkloadBenchmark';
import { createNodeCadBenchmarkSolver } from './benchmark-cad-solver-resources';

// The smallest connected rectangle chain the native solver refuses as too large, which the capacity
// section's one-second search (capped at 4096) does not reach: doubling from 4096, then bisection,
// one public solve per size in a fresh instance through the production runtime. PlaneGCS refuses 89.
// Usage: tsx --tsconfig tsconfig.app.json scripts/benchmark-cad-native-too-large.ts [--out file.json]
const args = process.argv.slice(2), out = args.includes('--out') ? args[args.indexOf('--out') + 1] : undefined;
const probes = new Map<number, { rectangles: number; parameters: number; outcome: string; failures: string[]; elapsedMs: number; nativeMs?: number }>();
async function probe(rectangles: number) {
  if (!probes.has(rectangles)) {
    const input = { graph: createCadBenchmarkRectangleGraph(rectangles, 'r', false, true), parameters: {} }, instance = await createNodeCadBenchmarkSolver('native-only');
    const started = performance.now(), result = await instance.solver.solve(input), elapsedMs = performance.now() - started;
    const row = { rectangles, parameters: rectangles * 8, outcome: cadSolverOutcome(result), failures: checkCadSolverBenchmarkResult(input, result), elapsedMs,
      nativeMs: instance.solver.takeRecord()?.nativeMs };
    console.log(JSON.stringify(row));
    probes.set(rectangles, row);
  }
  return probes.get(rectangles)!;
}
const tooLarge = (rectangles: number) => probe(rectangles).then(row => row.outcome === 'rejected:too-large');
let low = 4096, high = 8192;
if (await tooLarge(low)) throw new Error('4096 connected rectangles are already too large; start lower.');
while (!await tooLarge(high)) { low = high; high *= 2; if (high > 1 << 20) throw new Error('No refusal up to a million rectangles.'); }
while (high - low > 1) { const mid = Math.floor((low + high) / 2); if (await tooLarge(mid)) high = mid; else low = mid; }
const report = { family: 'connected rectangle chain (createCadBenchmarkRectangleGraph(n, "r", false, true)), 8 unknowns and 8 equations per rectangle',
  largestSolved: low, smallestTooLarge: high, probes: [...probes.values()].sort((a, b) => a.rectangles - b.rectangles) };
console.log(JSON.stringify({ largestSolved: low, smallestTooLarge: high }));
if (out) await writeFile(out, `${JSON.stringify(report, null, 2)}\n`);
