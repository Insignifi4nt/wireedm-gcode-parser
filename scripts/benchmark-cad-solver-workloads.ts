import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { cpus, totalmem } from 'node:os';
import { join } from 'node:path';
import packageInfo from '../package.json' with { type: 'json' };
import { cadBenchmarkCpuCalibrationMs } from '../src/features/cad/benchmark/cadBenchmark';
import type { CadBenchmarkSolverId } from '../src/features/cad/benchmark/cadSolverBenchmarkAdapters';
import { createCadSolverWorkloadCases } from '../src/features/cad/benchmark/cadSolverWorkloadCases';
import { measureCadSolverDrag, measureCadSolverDragSweep, measureCadSolverEdits, measureCadSolverWorkload } from '../src/features/cad/benchmark/cadSolverWorkloadBenchmark';
import { createNodeCadBenchmarkSolver, measureCadSolverMemory, measureColdCadBenchmarkSolvers, probeCadSolverWorkloadCapacity } from './benchmark-cad-solver-resources';

export const CAD_SOLVER_SECTIONS = ['workloads', 'edits', 'drag', 'sweep', 'cold', 'memory', 'capacity'] as const;
export type CadSolverSection = typeof CAD_SOLVER_SECTIONS[number];
export interface CadSolverWorkloadOptions {
  readonly runs: number;
  readonly quick: boolean;
  readonly sections: readonly CadSolverSection[];
  /** Workload case ids; every case when empty. */
  readonly cases: readonly string[];
  readonly solvers: readonly CadBenchmarkSolverId[];
  /** Run directory. A part already written there is kept, so the same command resumes after a stop. */
  readonly out: string;
}

const sha256 = async (path: string) => createHash('sha256').update(await readFile(new URL(path, import.meta.url))).digest('hex');
async function provenance() {
  const git = (...args: string[]) => { try { return execFileSync('git', args, { encoding: 'utf8' }).trim(); } catch { return 'unknown'; } };
  return { appVersion: packageInfo.version, commit: git('rev-parse', 'HEAD'), dirty: git('status', '--porcelain', '--untracked-files=no') !== '',
    modules: { native: await sha256('../packages/sketch-solver/wasm/sketch_solver.wasm'), planegcs: await sha256('../node_modules/@salusoft89/planegcs/dist/planegcs_dist/planegcs.wasm') },
    environment: { node: process.version, platform: process.platform, arch: process.arch, cpu: cpus()[0]?.model ?? 'unknown', cores: cpus().length, totalMemoryBytes: totalmem() } };
}

/**
 * Measures the selected sections into `options.out`, one JSON file per part, each with its own
 * provenance and calibration. Workloads are written one case per file, so a burst can stop between
 * cases. Run in short bursts on an idle host, then aggregate.
 */
export async function runCadSolverWorkloads(options: CadSolverWorkloadOptions) {
  await mkdir(join(options.out, 'workloads'), { recursive: true });
  const solvers = async () => Promise.all(options.solvers.map(async id => (await createNodeCadBenchmarkSolver(id)).solver));
  const part = async (name: string, measure: () => Promise<unknown>) => {
    const file = join(options.out, `${name}.json`);
    if (existsSync(file)) { console.log(`${name}: kept from an earlier burst`); return; }
    const started = performance.now(), idleCpuCalibrationMs = cadBenchmarkCpuCalibrationMs(), result = await measure();
    await writeFile(file, `${JSON.stringify({ part: name, createdAt: new Date().toISOString(), runs: options.runs, quick: options.quick, solvers: options.solvers,
      ...await provenance(), idleCpuCalibrationMs, elapsedSeconds: Math.round((performance.now() - started) / 100) / 10, result }, null, 2)}\n`);
    console.log(`${name}: ${Math.round((performance.now() - started) / 100) / 10} s, calibration ${idleCpuCalibrationMs} ms idle`);
  };
  const cases = createCadSolverWorkloadCases().filter(testCase => !options.cases.length || options.cases.includes(testCase.id));
  for (const section of options.sections) {
    if (section === 'workloads') for (const testCase of cases) {
      const index = createCadSolverWorkloadCases().findIndex(item => item.id === testCase.id);
      await part(`workloads/${testCase.id}`, async () => measureCadSolverWorkload(testCase, await solvers(), options.runs, index));
    }
    if (section === 'edits') await part('edits', async () => measureCadSolverEdits(await solvers(), options.runs));
    if (section === 'drag') await part('drag', async () => measureCadSolverDrag(await solvers(), options.runs));
    if (section === 'sweep') await part('sweep', async () => measureCadSolverDragSweep(await solvers()));
    if (section === 'cold') await part('cold', async () => measureColdCadBenchmarkSolvers(options.runs));
    if (section === 'memory') await part('memory', () => measureCadSolverMemory(cases, options.quick ? 100 : 1000, options.solvers));
    if (section === 'capacity') await part('capacity', () => probeCadSolverWorkloadCapacity(options.solvers.filter(id => id !== 'native-first') as ('planegcs' | 'native-only')[]));
  }
  console.log(`Parts are in ${options.out}. Aggregate with: npm run cad:benchmark -- --group solver-workloads --aggregate ${options.out}`);
}

interface Part { readonly part: string; readonly commit: string; readonly dirty: boolean; readonly modules: object; readonly result: unknown }
type Calibrated = { readonly cpuCalibrationMs?: readonly number[]; readonly throttled?: boolean };
const calibrated = (value: unknown): Calibrated[] => Array.isArray(value) ? value.flatMap(calibrated)
  : value && typeof value === 'object' ? [...('cpuCalibrationMs' in value && Array.isArray(value.cpuCalibrationMs) ? [value as Calibrated] : []),
    ...Object.entries(value).filter(([key]) => key !== 'cpuCalibrationMs' && key !== 'frames' && key !== 'samples').flatMap(([, item]) => calibrated(item))] : [];

/**
 * One report from a run directory. Parts from different commits or modules are refused, as their
 * numbers do not compare; throttled groups stay in the report and are listed so claims skip them.
 */
export async function aggregateCadSolverWorkloads(directory: string) {
  const names = [...(await readdir(directory)).filter(name => name.endsWith('.json') && name !== 'report.json'),
    ...(existsSync(join(directory, 'workloads')) ? (await readdir(join(directory, 'workloads'))).map(name => `workloads/${name}`) : [])];
  const parts: Part[] = await Promise.all(names.map(async name => JSON.parse(await readFile(join(directory, name), 'utf8'))));
  const identity = new Set(parts.map(part => JSON.stringify([part.commit, part.dirty, part.modules])));
  if (identity.size > 1) throw new Error(`Parts come from ${identity.size} different commits or modules; measure them again from one.`);
  const sections = Object.fromEntries(CAD_SOLVER_SECTIONS.map(section => [section, section === 'workloads'
    ? parts.filter(part => part.part.startsWith('workloads/')).map(part => part.result) : parts.find(part => part.part === section)?.result ?? null])) as Record<CadSolverSection, unknown>;
  const groups = parts.flatMap(part => calibrated(part.result).map(group => ({ part: part.part, ...group })));
  const calibrations = groups.flatMap(group => group.cpuCalibrationMs ?? []);
  const report = { createdAt: new Date().toISOString(), group: 'solver-workloads', parts: parts.map(part => part.part).sort(),
    missing: CAD_SOLVER_SECTIONS.filter(section => section === 'workloads' ? !(sections.workloads as unknown[]).length : !sections[section]), ...parts[0] && { commit: parts[0].commit, dirty: parts[0].dirty, modules: parts[0].modules },
    cpuCalibrationMs: { min: Math.min(...calibrations), max: Math.max(...calibrations) }, throttledGroups: groups.filter(group => group.throttled).length, groups: groups.length,
    comparison: { planegcs: 'PlaneGCS alone, as the app solved before 0.0.746: parse, compile, components, solve, always diagnose, map source ids and geometry, validate.',
      'native-only': 'The app\'s runtime without PlaneGCS: parse, compile, solve, always diagnose, judge, keep or snap groups, map and validate. Native\'s own rejection stands where native-first would ask PlaneGCS.',
      'native-first': 'The app\'s runtime as shipped: native-only, then PlaneGCS for what native cannot answer, loaded on first use. Stages of both add up.',
      stages: 'parseCompile includes parsing and compilation; nativeCall the module call (solve and diagnosis); mapping judging, source ids and geometry; validation the shared graph checks. Public-call totals also include promise, queue and observer overhead.',
      reSolve: 'Already-solved input still passes through the full public call: compile, convergence detection, diagnosis, mapping and validation.' },
    sections };
  await writeFile(join(directory, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(join(directory, 'summary.md'), `${summarize(sections)}\n`);
  console.log(`Report: ${join(directory, 'report.json')} with summary.md. ${report.throttledGroups}/${report.groups} groups throttled; calibration ${report.cpuCalibrationMs.min}-${report.cpuCalibrationMs.max} ms.${report.missing.length ? ` Missing: ${report.missing.join(', ')}.` : ''}`);
  return report;
}

/** Markdown tables of medians, with every throttled group marked. */
function summarize(sections: Record<CadSolverSection, unknown>) {
  type Measured = { solver: string; operation: string; kind: string; totalMs?: { p50: number }; outcomes?: Record<string, number>; answers?: Record<string, number> };
  type Group = { id: string; throttled: boolean; cpuCalibrationMs: number[]; measurements: Measured[] };
  const ids = (rows: readonly { solver: string }[]) => [...new Set(rows.map(row => row.solver))];
  const lines: string[] = [];
  const operations = [...(sections.workloads as Group[] ?? []), ...(sections.edits as Group[] ?? [])];
  if (operations.length) {
    const solvers = ids(operations.flatMap(group => group.measurements));
    lines.push(`| Workload / operation | ${solvers.map(id => `${id} p50 ms`).join(' | ')} | CPU ms before/after |`, `| --- | ${solvers.map(() => '---:').join(' | ')} | --- |`);
    for (const group of operations) for (const operation of [...new Set(group.measurements.map(row => row.operation))]) {
      const cell = (id: string) => { const row = group.measurements.find(item => item.solver === id && item.operation === operation); return !row || row.kind === 'skipped' ? 'skipped' : `${row.totalMs!.p50} ${Object.keys(row.outcomes!).join(',')}`; };
      lines.push(`| ${group.id} / ${operation} | ${solvers.map(cell).join(' | ')} | ${group.cpuCalibrationMs.join('/')}${group.throttled ? ' THROTTLED' : ''} |`);
    }
  }
  type DragGroup = { trajectory: string; mode: string; throttled: boolean; cpuCalibrationMs: number[]; solvers: { solver: string; totalMs: { p50: number; p95: number }; outcomes: Record<string, number>; dragOutcomes: Record<string, number>; largestTargetErrorMm: number | null }[] };
  const drag = sections.drag as DragGroup[] | null;
  if (drag?.length) {
    lines.push('', '| Drag trajectory / mode | Solver | p50/p95 ms | Outcomes | Drag outcomes | Largest target error mm | CPU ms |', '| --- | --- | ---: | --- | --- | ---: | --- |');
    for (const group of drag) for (const row of group.solvers) lines.push(`| ${group.trajectory} / ${group.mode} | ${row.solver} | ${row.totalMs.p50}/${row.totalMs.p95} | ${JSON.stringify(row.outcomes)} | ${JSON.stringify(row.dragOutcomes)} | ${row.largestTargetErrorMm?.toPrecision(4) ?? '-'} | ${group.cpuCalibrationMs.join('/')}${group.throttled ? ' THROTTLED' : ''} |`);
  }
  type Sweep = { id: string; drags: number; throttled: boolean; cpuCalibrationMs: number[]; solvers: { solver: string; sumMs: number; totalMs: { p50: number }; answers: Record<string, number>; worseThanFirst: unknown[] }[] };
  const sweep = sections.sweep as Sweep[] | null;
  if (sweep?.length) {
    lines.push('', '| Sweep | Solver | Drags | Sum ms | p50 ms | Answers | Worse than first | CPU ms |', '| --- | --- | ---: | ---: | ---: | --- | ---: | --- |');
    for (const group of sweep) for (const row of group.solvers) lines.push(`| ${group.id} | ${row.solver} | ${group.drags} | ${row.sumMs} | ${row.totalMs.p50} | ${JSON.stringify(row.answers)} | ${row.worseThanFirst.length} | ${group.cpuCalibrationMs.join('/')}${group.throttled ? ' THROTTLED' : ''} |`);
  }
  type Cold = { modules: { module: string; bytes: number; gzipBytes: number; totalMs: number }[]; firstAnswer: { scenario: string; firstAnswerMs: { p50: number }; outcomes: string[] }[] };
  const cold = sections.cold as Cold | null;
  if (cold) {
    lines.push('', '| Module | Bytes | Gzip bytes | Read + compile + instantiate ms |', '| --- | ---: | ---: | ---: |', ...cold.modules.map(row => `| ${row.module} | ${row.bytes} | ${row.gzipBytes} | ${row.totalMs.toFixed(2)} |`));
    lines.push('', '| Cold scenario | First answer p50 ms | Outcome |', '| --- | ---: | --- |', ...cold.firstAnswer.map(row => `| ${row.scenario} | ${row.firstAnswerMs.p50} | ${row.outcomes.join('; ')} |`));
  }
  type Capacity = { limits: { solver: string; largestConnectedRectanglesUnder1s: number | null; firstRejectedOrAtLeast1s: number | null; boundaryThrottled: boolean }[] };
  const capacity = sections.capacity as Capacity | null;
  if (capacity) lines.push('', '| Capacity | Largest connected rectangles under 1 s | Next |', '| --- | ---: | ---: |',
    ...capacity.limits.map(row => `| ${row.solver} | ${row.largestConnectedRectanglesUnder1s ?? '-'} | ${row.firstRejectedOrAtLeast1s ?? 'not reached'}${row.boundaryThrottled ? ' THROTTLED' : ''} |`));
  return lines.join('\n');
}
