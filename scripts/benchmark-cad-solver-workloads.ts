import { mkdir, writeFile } from 'node:fs/promises';
import { cpus, totalmem } from 'node:os';
import packageInfo from '../package.json' with { type: 'json' };
import { cadBenchmarkCpuCalibrationMs } from '../src/features/cad/benchmark/cadBenchmark';
import { createCadSolverWorkloadCases } from '../src/features/cad/benchmark/cadSolverWorkloadCases';
import { cadSolverCalibrationDrifted, measureCadSolverDrag, measureCadSolverEdits, measureCadSolverWorkload } from '../src/features/cad/benchmark/cadSolverWorkloadBenchmark';
import { createNodeCadBenchmarkSolver, measureCadSolverMemory, measureColdCadBenchmarkSolvers, probeCadSolverWorkloadCapacity } from './benchmark-cad-solver-resources';

export async function runCadSolverWorkloads(options: { readonly runs: number; readonly quick: boolean }) {
  const started = performance.now(), idleCpuCalibrationMs = cadBenchmarkCpuCalibrationMs();
  const cold = measureColdCadBenchmarkSolvers(), coldCpuCalibrationMs = [idleCpuCalibrationMs, cadBenchmarkCpuCalibrationMs()];
  const freshSolvers = async () => [(await createNodeCadBenchmarkSolver('planegcs')).solver, (await createNodeCadBenchmarkSolver('native')).solver];
  const cases = createCadSolverWorkloadCases(), groups = [];
  const summary: string[] = ['| Workload / operation | PlaneGCS full job p50 ms | Native solve only, no diagnosis p50 ms | CPU ms before/after |', '| --- | ---: | ---: | --- |'];
  const printGroup = (group: Awaited<ReturnType<typeof measureCadSolverWorkload>>) => {
    for (const operation of [...new Set(group.measurements.map(row => row.operation))]) {
      const cell = (id: 'planegcs' | 'native') => {
        const row = group.measurements.find(row => row.solver === id && row.operation === operation)!;
        return row.kind === 'skipped' ? 'skipped' : `${row.totalMs.p50} ${Object.keys(row.outcomes).join(',')}`;
      };
      const line = `| ${group.id} / ${operation} | ${cell('planegcs')} | ${cell('native')} | ${group.cpuCalibrationMs.join('/')} ${group.throttled ? 'THROTTLED' : ''} |`;
      console.log(line); summary.push(line);
    }
  };
  console.log(summary.join('\n'));
  for (const [index, testCase] of cases.entries()) {
    const group = await measureCadSolverWorkload(testCase, await freshSolvers(), options.runs, index);
    groups.push(group); printGroup(group);
  }
  const edits = await measureCadSolverEdits(await freshSolvers(), options.runs);
  for (const group of edits) printGroup(group);
  console.log('Measuring 60-frame connected-die drag trajectories, including reversal and an unreachable target.');
  const drag = await measureCadSolverDrag(await freshSolvers(), options.runs);
  for (const row of drag) console.log(row.kind === 'unsupported' ? `${row.label}: drag unsupported` : `${row.label} drag: ${row.totalMs.p50}/${row.totalMs.p95}/${row.totalMs.p99} ms p50/p95/p99; ${row.totalMs.framesOver8Ms}/${row.totalMs.runs} frames over 8 ms; ${row.accepted} accepted, ${row.projected} projected${row.throttled ? ' THROTTLED' : ''}`);
  console.log(`Measuring fresh-instance workload memory and ${options.quick ? 100 : 1000} repeated solved-die calls per solver.`);
  const memory = await measureCadSolverMemory(cases, options.quick ? 100 : 1000);
  console.log('Probing the largest connected rectangle group with median solve under 1 s.');
  const capacity = await probeCadSolverWorkloadCapacity();
  for (const row of capacity.limits) console.log(`${row.solver}: ${row.largestConnectedRectanglesUnder1s} connected rectangles under 1 s; next ${row.firstRejectedOrAtLeast1s ?? 'not reached'}`
    + (row.boundaryThrottled ? ` THROTTLED boundary; largest unthrottled solved probe ${row.largestUnthrottledSolvedUnder1s}` : ''));
  const failures = [...groups, ...edits].flatMap(group => group.failures).concat(drag.flatMap(row => row.kind === 'measured' ? row.failures : []), memory.workloads.flatMap(row => row.failures), capacity.probes.flatMap(probe => probe.measurements.flatMap(row => row.failures)));
  const calibrations = [...coldCpuCalibrationMs, ...[...groups, ...edits, ...capacity.probes, ...drag.filter(row => row.kind === 'measured')].flatMap(group => group.cpuCalibrationMs ?? [])];
  const report = { createdAt: new Date().toISOString(), appVersion: packageInfo.version, group: 'solver-workloads', ...options,
    environment: { node: process.version, platform: process.platform, arch: process.arch, cpu: cpus()[0]?.model ?? 'unknown', cores: cpus().length, totalMemoryBytes: totalmem() },
    comparison: { planegcs: 'Full job: parse, compile, components, solve, ALWAYS diagnose, map source ids, map geometry, validate.',
      native: 'Solve only, no diagnosis. Same input and geometry acceptance checks; DOF/conflicting/redundant/partially redundant diagnostics unavailable. Drag unsupported. Totals are NOT full-job speedups.',
      stages: 'parseCompile includes parsing, compilation and component preparation; nativeCall includes buffer/wrapper work, solve and PlaneGCS diagnosis; mapping includes source ids and geometry; validation uses the shared acceptance checks. Public-call totals also include promise and observer overhead.',
      reSolve: 'Already-solved input still passes through the full public call. It approximates diagnosis cost, but includes compile, convergence detection, mapping and validation.' },
    cold, workloads: groups, edits, drag, memory, capacity,
    cpuCalibrationMs: { idle: idleCpuCalibrationMs, cold: coldCpuCalibrationMs, coldThrottled: cadSolverCalibrationDrifted(coldCpuCalibrationMs), min: Math.min(...calibrations), max: Math.max(...calibrations) }, failures,
    elapsedSeconds: Math.round((performance.now() - started) / 100) / 10 };
  await mkdir('tmp/cad-benchmark', { recursive: true });
  const file = `tmp/cad-benchmark/${report.createdAt.replace(/[:.]/g, '-')}-solver-workloads.json`;
  await writeFile(file, `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(file.replace('.json', '.md'), `${summary.join('\n')}\n`);
  console.log(`Calibration ${report.cpuCalibrationMs.min}-${report.cpuCalibrationMs.max} ms. Compare only unthrottled groups with similar calibration.`);
  console.log(`${report.elapsedSeconds} s elapsed. ${failures.length} correctness failures. Report: ${file}`);
  if (failures.length) process.exitCode = 1;
  return report;
}
