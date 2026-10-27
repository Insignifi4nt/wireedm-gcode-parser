import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { cpus, totalmem } from 'node:os';
import { join } from 'node:path';
import packageInfo from '../package.json' with { type: 'json' };
import { cadBenchmarkCpuCalibrationMs } from '../src/features/cad/benchmark/cadBenchmark';
import { createCadSolverWorkloadCases } from '../src/features/cad/benchmark/cadSolverWorkloadCases';
import { measureCadSolverDrag, measureCadSolverDragSweep, measureCadSolverEdits, measureCadSolverWorkload } from '../src/features/cad/benchmark/cadSolverWorkloadBenchmark';
import { CAD_BENCHMARK_SOLVER_IDS, cadBenchmarkExecArgv, createNodeCadBenchmarkSolver, measureCadSolverMemory, measureColdCadBenchmarkSolvers, probeCadSolverWorkloadCapacity } from './benchmark-cad-solver-resources';

export const CAD_SOLVER_SECTIONS = ['workloads', 'edits', 'drag', 'sweep', 'cold', 'memory', 'capacity'] as const;
export type CadSolverSection = typeof CAD_SOLVER_SECTIONS[number];
export interface CadSolverWorkloadOptions {
  readonly runs: number;
  readonly quick: boolean;
  /** How the script runs: bundled as the application is built, or its source through tsx, which times slower. */
  readonly runner: 'bundled' | 'source';
  readonly sections: readonly CadSolverSection[];
  /** Workload case ids; every case when empty. */
  readonly cases: readonly string[];
  /** Run directory. A part already written there is kept, so the same command resumes after a stop. */
  readonly out: string;
}

const hash = (...chunks: (string | Buffer)[]) => chunks.reduce((digest, chunk) => digest.update(chunk), createHash('sha256')).digest('hex');
const sha256 = async (path: string) => hash(await readFile(new URL(path, import.meta.url)));
/**
 * What a part was measured from and with. Uncommitted changes to tracked files and untracked source
 * files are fingerprinted, so parts measured from different uncommitted code never join one report.
 */
async function runIdentity(options: CadSolverWorkloadOptions) {
  const git = (...args: string[]) => { try { return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 1 << 28 }); } catch { return 'unknown'; } };
  const untracked = git('ls-files', '--others', '--exclude-standard', '--', 'src', 'scripts', 'packages').split(/\r?\n/).filter(Boolean).sort();
  const diff = git('diff', 'HEAD', '--binary');
  const uncommitted = diff.trim() || untracked.length
    ? hash(diff, ...(await Promise.all(untracked.map(async path => [`\0${path}\0`, await readFile(path)]))).flat()) : null;
  return { appVersion: packageInfo.version, commit: git('rev-parse', 'HEAD').trim(), dirty: uncommitted !== null, uncommittedSha256: uncommitted,
    modules: { native: await sha256('../packages/sketch-solver/wasm/sketch_solver.wasm') },
    environment: { node: process.version, v8: process.versions.v8, execArgv: cadBenchmarkExecArgv(), nodeOptions: process.env.NODE_OPTIONS ?? '', platform: process.platform, arch: process.arch, cpu: cpus()[0]?.model ?? 'unknown', cores: cpus().length, totalMemoryBytes: totalmem() },
    runner: options.runner, runs: options.runs, quick: options.quick, solvers: CAD_BENCHMARK_SOLVER_IDS };
}
type RunIdentity = Awaited<ReturnType<typeof runIdentity>>;
const MANIFEST = 'manifest.json';
// Keys of both sides, so a directory written before a field was recorded, such as `runner`, never matches a run that records it.
const identityDifferences = (expected: RunIdentity, actual: Partial<RunIdentity> = {}) => ([...new Set([...Object.keys(expected), ...Object.keys(actual)])] as (keyof RunIdentity)[])
  .filter(key => JSON.stringify(expected[key]) !== JSON.stringify(actual[key]));

/** Written to a temporary file and renamed into place, so an interrupted write never leaves a part that looks complete. */
async function writeJson(file: string, value: unknown) {
  await writeFile(`${file}.partial`, `${JSON.stringify(value, null, 2)}\n`);
  await rename(`${file}.partial`, file);
}
async function readJson(file: string) {
  try { return JSON.parse(await readFile(file, 'utf8')) as unknown; } catch { return undefined; }
}

/** Every correctness failure recorded anywhere in a part's result. */
const failuresOf = (value: unknown): string[] => Array.isArray(value) ? value.flatMap(failuresOf)
  : value && typeof value === 'object' ? Object.entries(value).flatMap(([key, item]) => key === 'failures' && Array.isArray(item)
    ? item.filter((failure): failure is string => typeof failure === 'string') : failuresOf(item)) : [];

/**
 * Measures the selected sections into `options.out`, one JSON file per part, each with its own
 * identity and calibration. Workloads are written one case per file, so a burst can stop between
 * cases. The directory's manifest records the code, modules, host and settings; a burst with any
 * other is refused rather than mixed in. Run in short bursts on an idle host, then aggregate.
 * Correctness failures stay in their parts for diagnosis and fail the command.
 */
export async function runCadSolverWorkloads(options: CadSolverWorkloadOptions) {
  await mkdir(join(options.out, 'workloads'), { recursive: true });
  const identity = await runIdentity(options), manifestFile = join(options.out, MANIFEST);
  const manifest = await readJson(manifestFile) as { identity?: RunIdentity } | undefined;
  if (manifest?.identity) {
    const differences = identityDifferences(manifest.identity, identity);
    if (differences.length) throw new Error(`${options.out} was measured with a different ${differences.join(', ')}; resume with the same code, host and settings or use another --out.`);
  } else if (existsSync(manifestFile) || (await readdir(options.out)).some(name => name.endsWith('.json')) || (await readdir(join(options.out, 'workloads'))).length) {
    throw new Error(`${options.out} has parts without a readable ${MANIFEST}; use another --out.`);
  } else await writeJson(manifestFile, { createdAt: new Date().toISOString(), identity });
  const solvers = async () => [(await createNodeCadBenchmarkSolver()).solver];
  let failures = 0;
  /** `scope` names what a part covers beyond the run's identity, such as memory's fixtures; a kept part must cover the same. */
  const part = async (name: string, measure: () => Promise<unknown>, scope?: readonly string[]) => {
    const file = join(options.out, `${name}.json`), kept = existsSync(file) ? await readJson(file) as Part | undefined : undefined;
    if (kept && !identityDifferences(identity, kept.identity).length) {
      if (JSON.stringify(kept.scope) !== JSON.stringify(scope)) throw new Error(`${name} in ${options.out} covers ${kept.scope?.join(', ') ?? 'everything'}, not ${scope?.join(', ') ?? 'everything'}; use the same selection or another --out.`);
      const found = failuresOf(kept.result);
      failures += found.length;
      console.log(`${name}: kept from an earlier burst${found.length ? `, ${found.length} CORRECTNESS FAILURES` : ''}`);
      return;
    }
    if (existsSync(file)) console.log(`${name}: unreadable or from another run, measuring again`);
    const started = performance.now(), idleCpuCalibrationMs = cadBenchmarkCpuCalibrationMs(), result = await measure(), found = failuresOf(result);
    await writeJson(file, { part: name, createdAt: new Date().toISOString(), identity, scope, idleCpuCalibrationMs, elapsedSeconds: Math.round((performance.now() - started) / 100) / 10, result });
    failures += found.length;
    console.log(`${name}: ${Math.round((performance.now() - started) / 100) / 10} s, calibration ${idleCpuCalibrationMs} ms idle${found.length ? `, ${found.length} CORRECTNESS FAILURES` : ''}`);
    for (const failure of found.slice(0, 10)) console.log(`  ${failure}`);
  };
  const cases = createCadSolverWorkloadCases().filter(testCase => !options.cases.length || options.cases.includes(testCase.id));
  for (const section of options.sections) {
    if (section === 'workloads') for (const testCase of cases) await part(`workloads/${testCase.id}`, async () => measureCadSolverWorkload(testCase, await solvers(), options.runs));
    if (section === 'edits') await part('edits', async () => measureCadSolverEdits(await solvers(), options.runs));
    if (section === 'drag') await part('drag', async () => measureCadSolverDrag(await solvers(), options.runs));
    if (section === 'sweep') await part('sweep', async () => measureCadSolverDragSweep(await solvers()));
    if (section === 'cold') await part('cold', async () => measureColdCadBenchmarkSolvers(options.runs));
    if (section === 'memory') await part('memory', () => measureCadSolverMemory(cases, options.quick ? 100 : 1000), cases.map(testCase => testCase.id));
    if (section === 'capacity') await part('capacity', () => probeCadSolverWorkloadCapacity());
  }
  if (failures) { console.log(`${failures} CORRECTNESS FAILURES; the results they belong to are incorrect.`); process.exitCode = 1; }
  console.log(`Parts are in ${options.out}. Aggregate with: npm run cad:benchmark -- --group solver-workloads --aggregate ${options.out}`);
}

interface Part { readonly part: string; readonly identity?: RunIdentity; readonly scope?: readonly string[]; readonly result: unknown }
type Calibrated = { readonly cpuCalibrationMs?: readonly number[]; readonly throttled?: boolean };
const calibrated = (value: unknown): Calibrated[] => Array.isArray(value) ? value.flatMap(calibrated)
  : value && typeof value === 'object' ? [...('cpuCalibrationMs' in value && Array.isArray(value.cpuCalibrationMs) ? [value as Calibrated] : []),
    ...Object.entries(value).filter(([key]) => key !== 'cpuCalibrationMs' && key !== 'frames' && key !== 'samples').flatMap(([, item]) => calibrated(item))] : [];

/**
 * One report from a run directory. Every part must be readable and match the manifest's code,
 * modules, host and settings, as other numbers do not compare. Throttled groups stay in the report
 * and are listed so claims skip them. Correctness failures are listed first and fail the command.
 */
export async function aggregateCadSolverWorkloads(directory: string) {
  const manifest = await readJson(join(directory, MANIFEST)) as { identity?: RunIdentity } | undefined;
  const identity = manifest?.identity;
  if (!identity) throw new Error(`${directory} has no readable ${MANIFEST}; it is not a solver-workloads run directory.`);
  const names = [...(await readdir(directory)).filter(name => name.endsWith('.json') && name !== 'report.json' && name !== MANIFEST),
    ...(existsSync(join(directory, 'workloads')) ? (await readdir(join(directory, 'workloads'))).filter(name => name.endsWith('.json')).map(name => `workloads/${name}`) : [])];
  const parts = await Promise.all(names.map(async name => {
    const part = await readJson(join(directory, name)) as Part | undefined;
    if (!part) throw new Error(`${name} is unreadable; resume the run to measure it again.`);
    const differences = identityDifferences(identity, part.identity);
    if (differences.length) throw new Error(`${name} was measured with a different ${differences.join(', ')} from the run; measure it again from one.`);
    return part;
  }));
  const sections = Object.fromEntries(CAD_SOLVER_SECTIONS.map(section => [section, section === 'workloads'
    ? parts.filter(part => part.part.startsWith('workloads/')).map(part => part.result) : parts.find(part => part.part === section)?.result ?? null])) as Record<CadSolverSection, unknown>;
  const groups = parts.flatMap(part => calibrated(part.result).map(group => ({ part: part.part, ...group })));
  const calibrations = groups.flatMap(group => group.cpuCalibrationMs ?? []);
  const failures = parts.flatMap(part => failuresOf(part.result));
  const report = { createdAt: new Date().toISOString(), group: 'solver-workloads', ...identity, parts: parts.map(part => part.part).sort(),
    missing: CAD_SOLVER_SECTIONS.filter(section => section === 'workloads' ? !(sections.workloads as unknown[]).length : !sections[section]),
    failures, cpuCalibrationMs: { min: Math.min(...calibrations), max: Math.max(...calibrations) }, throttledGroups: groups.filter(group => group.throttled).length, groups: groups.length,
    comparison: { native: 'The app\'s runtime, its only sketch solver since 0.0.757: parse, compile, solve, always diagnose, judge, keep or snap groups, map and validate.',
      stages: 'parseCompile includes parsing and compilation; nativeCall the module call (solve and diagnosis); mapping judging, source ids and geometry; validation the shared graph checks. Public-call totals also include promise, queue and observer overhead.',
      reSolve: 'Already-solved input still passes through the full public call: compile, convergence detection, diagnosis, mapping and validation.' },
    sections };
  await writeJson(join(directory, 'report.json'), report);
  await writeFile(join(directory, 'summary.md'), `${summarize(identity, failures, sections)}\n`);
  console.log(`Report: ${join(directory, 'report.json')} with summary.md. ${report.throttledGroups}/${report.groups} groups throttled; calibration ${report.cpuCalibrationMs.min}-${report.cpuCalibrationMs.max} ms.${report.missing.length ? ` Missing: ${report.missing.join(', ')}.` : ''}`);
  if (failures.length) { console.log(`${failures.length} CORRECTNESS FAILURES; the results they belong to are incorrect.`); process.exitCode = 1; }
  return report;
}

/** Markdown tables of medians, after the run's provenance and any correctness failures, with every throttled or incorrect group marked. */
function summarize(identity: RunIdentity, failures: readonly string[], sections: Record<CadSolverSection, unknown>) {
  type Measured = { solver: string; operation: string; kind: string; totalMs?: { p50: number }; outcomes?: Record<string, number>; answers?: Record<string, number> };
  type Group = { id: string; throttled: boolean; failures: string[]; cpuCalibrationMs: number[]; measurements: Measured[] };
  const ids = (rows: readonly { solver: string }[]) => [...new Set(rows.map(row => row.solver))];
  // Directories from before 0.0.761 record no runner; they ran through tsx.
  const lines: string[] = [`App ${identity.appVersion}, commit ${identity.commit}${identity.dirty ? ` with uncommitted changes ${identity.uncommittedSha256}` : ''}; ${identity.environment.cpu}, ${identity.environment.cores} cores, Node ${identity.environment.node} on ${identity.environment.platform}; ${identity.runner ?? 'source'}, ${identity.runs} runs${identity.quick ? ', quick' : ''}; ${identity.solvers.join(', ')}.`, ''];
  if (failures.length) lines.push(`**${failures.length} correctness failures. Rows marked INVALID gave incorrect results; their timings are not comparable.**`, '', ...failures.map(failure => `- ${failure}`), '');
  const mark = (group: { throttled?: boolean; failures?: readonly string[] }) => `${group.throttled ? ' THROTTLED' : ''}${group.failures?.length ? ' INVALID' : ''}`;
  const operations = [...(sections.workloads as Group[] ?? []), ...(sections.edits as Group[] ?? [])];
  if (operations.length) {
    const solvers = ids(operations.flatMap(group => group.measurements));
    lines.push(`| Workload / operation | ${solvers.map(id => `${id} p50 ms`).join(' | ')} | CPU ms before/after |`, `| --- | ${solvers.map(() => '---:').join(' | ')} | --- |`);
    for (const group of operations) for (const operation of [...new Set(group.measurements.map(row => row.operation))]) {
      const cell = (id: string) => { const row = group.measurements.find(item => item.solver === id && item.operation === operation); return !row || row.kind === 'skipped' ? 'skipped' : `${row.totalMs!.p50} ${Object.keys(row.outcomes!).join(',')}`; };
      lines.push(`| ${group.id} / ${operation} | ${solvers.map(cell).join(' | ')} | ${group.cpuCalibrationMs.join('/')}${mark(group)} |`);
    }
  }
  type DragGroup = { trajectory: string; mode: string; throttled: boolean; failures: string[]; cpuCalibrationMs: number[]; solvers: { solver: string; totalMs: { p50: number; p95: number }; outcomes: Record<string, number>; dragOutcomes: Record<string, number>; largestTargetErrorMm: number | null }[] };
  const drag = sections.drag as DragGroup[] | null;
  if (drag?.length) {
    lines.push('', '| Drag trajectory / mode | Solver | p50/p95 ms | Outcomes | Drag outcomes | Largest target error mm | CPU ms |', '| --- | --- | ---: | --- | --- | ---: | --- |');
    for (const group of drag) for (const row of group.solvers) lines.push(`| ${group.trajectory} / ${group.mode} | ${row.solver} | ${row.totalMs.p50}/${row.totalMs.p95} | ${JSON.stringify(row.outcomes)} | ${JSON.stringify(row.dragOutcomes)} | ${row.largestTargetErrorMm?.toPrecision(4) ?? '-'} | ${group.cpuCalibrationMs.join('/')}${mark(group)} |`);
  }
  type Sweep = { id: string; drags: number; throttled: boolean; failures: string[]; cpuCalibrationMs: number[]; solvers: { solver: string; sumMs: number; totalMs: { p50: number }; answers: Record<string, number> }[] };
  const sweep = sections.sweep as Sweep[] | null;
  if (sweep?.length) {
    lines.push('', '| Sweep | Solver | Drags | Sum ms | p50 ms | Answers | CPU ms |', '| --- | --- | ---: | ---: | ---: | --- | --- |');
    for (const group of sweep) for (const row of group.solvers) lines.push(`| ${group.id} | ${row.solver} | ${group.drags} | ${row.sumMs} | ${row.totalMs.p50} | ${JSON.stringify(row.answers)} | ${group.cpuCalibrationMs.join('/')}${mark(group)} |`);
  }
  type Cold = { cpuCalibrationMs: number[]; throttled: boolean; modules: { module: string; bytes: number; gzipBytes: number; totalMs: number }[]; firstAnswer: { scenario: string; firstAnswerMs: { p50: number }; outcomes: string[]; samples: { failures: string[] }[] }[] };
  const cold = sections.cold as Cold | null;
  if (cold) {
    lines.push('', '| Module | Bytes | Gzip bytes | Read + compile + instantiate ms |', '| --- | ---: | ---: | ---: |', ...cold.modules.map(row => `| ${row.module} | ${row.bytes} | ${row.gzipBytes} | ${row.totalMs.toFixed(2)} |`));
    lines.push('', `Cold processes, CPU ms before/after: ${cold.cpuCalibrationMs.join('/')}${mark(cold)}`, '', '| Cold scenario | First answer p50 ms | Outcome | Checks |', '| --- | ---: | --- | --- |',
      ...cold.firstAnswer.map(row => `| ${row.scenario} | ${row.firstAnswerMs.p50} | ${row.outcomes.join('; ')} | ${row.samples.some(sample => sample.failures.length) ? 'INVALID' : 'passed'} |`));
  }
  type Capacity = { limits: { solver: string; largestConnectedRectanglesUnder1s: number | null; firstRejectedOrAtLeast1s: number | null; boundaryThrottled: boolean }[]; probes: { measurements: { solver: string; failures: string[] }[] }[] };
  const capacity = sections.capacity as Capacity | null;
  if (capacity) lines.push('', '| Capacity | Largest connected rectangles under 1 s | Next |', '| --- | ---: | ---: |',
    ...capacity.limits.map(row => `| ${row.solver} | ${row.largestConnectedRectanglesUnder1s ?? '-'} | ${row.firstRejectedOrAtLeast1s ?? 'not reached'}${mark({ throttled: row.boundaryThrottled, failures: capacity.probes.flatMap(probe => probe.measurements.filter(item => item.solver === row.solver).flatMap(item => item.failures)) })} |`));
  return lines.join('\n');
}
