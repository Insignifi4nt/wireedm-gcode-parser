// The equation baseline: what the sketch compiler gave, and what native answered, for every graph of the relation baseline, every input
// of the frozen solver corpus and every input the solver benchmarks solve. The recorder writes it from the commit before relations
// compiled from their definitions; cadSketchEquationBaseline.test.ts checks today's compiler against it. Both use these helpers, so the
// inputs and records are made the same way. The manifest next to the fixture gives the inputs, normalization and steps.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';
import type { CadSketchGraph } from '@/domain/cad/cadSketchGraph';
import { checkCadSketchGraph } from '@/domain/cad/cadSketchGraph';
import { mapCadSketchRelationScalars } from '@/domain/cad/cadSketchGraphReferences';
import { pageCadSketchConstraints, type CadSketchConstraintInspection } from '../../../cadSketchConstraintInspection';
import { corpusInput, decodeCorpusJson, encodeCorpusJson, readPlaneGcsCorpus } from '../../__tests__/planeGcsCorpus';
import { parseCadSketchSolveInput } from '../../cadSketchSolverProtocol';
import type { CadSketchSolveInput } from '../../cadSketchSolverTypes';
import type { CadSketchEquationModel } from '@/domain/cad/sketch-solver/cadSketchEquationModel';
import { attemptCadSketchNativeSolve } from '../cadSketchNativeAttempt';
import { loadCadSketchNativeSolver, type CadSketchNativeSolution, type CadSketchNativeSolver } from '../cadSketchNativeSolver';

export const EQUATION_BASELINE_FORMAT = 1;
/**
 * The files the baseline reads and writes, from the repository root: by default the working directory, where tests run. The recorder
 * runs bundled into scripts/ and passes its root.
 */
export function equationBaselinePaths(root = pathToFileURL(`${process.cwd()}/`)) {
  return {
    fixture: new URL('src/features/cad/sketch-solver/native/__tests__/fixtures/equation-baseline.json.gz', root),
    manifest: new URL('src/features/cad/sketch-solver/native/__tests__/fixtures/equation-baseline.manifest.json', root),
    relationBaseline: new URL('src/features/cad/sketch-relations/__tests__/fixtures/relation-baseline.json.gz', root),
    corpus: new URL('src/features/cad/sketch-solver/__tests__/fixtures/planegcs-corpus/', root),
    native: new URL('packages/sketch-solver/wasm/sketch_solver.wasm', root)
  };
}
type EquationBaselinePaths = ReturnType<typeof equationBaselinePaths>;

export const sha256 = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex');
/** The first 64 bits of the SHA-256, enough to tell recorded items apart; the manifest keeps the fixture's full hashes. */
export const shortHash = (data: string | Uint8Array) => sha256(data).slice(0, 16);

/** One solve input and where it came from. */
export interface EquationBaselineInput {
  readonly source: string;
  readonly input: CadSketchSolveInput;
}

/** Benchmark inputs as recorded: each graph once, by the hash of its corpus JSON. */
export interface EquationBaselineBenchmarkInputs {
  readonly graphs: Readonly<Record<string, CadSketchGraph>>;
  readonly inputs: readonly { readonly source: string; readonly graph: string; readonly parameters: CadSketchSolveInput['parameters']; readonly drag?: CadSketchSolveInput['drag'] }[];
}

/**
 * The compiled model, or the error compiling threw. `layout` hashes where each point's and circle's parameters sit; `values` hashes the
 * start values; `fixed` lists the fixed parameters. Each equation is [kind, source id, tag, value, temporary (1 or 0), ...operands].
 */
export type EquationBaselineModel = { readonly throws: string } | {
  readonly layout: string;
  readonly values: string;
  readonly fixed: readonly number[];
  readonly equations: readonly (readonly (string | number)[])[];
};

/**
 * Native's answer to a compiled model, asked for the definition unless it drags: status, iterations, diagnosis kind, degrees of freedom
 * (null when not reported), the nonzero labels as [equation, label], the definition codes as digits, the drag outcome and distance, and
 * the hash of the solved values. A native error is { throws }.
 */
export type EquationBaselineAnswer = { readonly throws: string } | readonly [string, number, string, number | null, readonly (readonly [number, number])[], string | null,
  readonly [string, number] | null, string];

/**
 * [source, input hash, hash of the stored model, native answer or null when compiling threw, hash of the graph checks' issues, hash of
 * the constraint inspection's relation rows, hash of the native attempt]. The attempt is the solver's own, asked for the definition
 * unless it drags; it compiles and judges as the application does, so it covers retries and acceptance too. Hashes are of corpus JSON.
 */
export type EquationBaselineRecord = readonly [string, string, string, EquationBaselineAnswer | null, string, string, string];

export interface EquationBaseline {
  readonly format: number;
  readonly benchmark: EquationBaselineBenchmarkInputs;
  readonly models: Readonly<Record<string, EquationBaselineModel>>;
  readonly records: readonly EquationBaselineRecord[];
}

const errorText = (error: unknown) => error instanceof Error ? `${(error as { code?: string }).code ?? error.name}: ${error.message}` : String(error);

// mulberry32, seeded from a hash.
function random(seedHex: string) {
  let state = Number.parseInt(seedHex.slice(0, 8), 16) >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const round3 = (value: number) => Math.round(value * 1000) / 1000;
const IDENTIFIER = /^[A-Za-z_][A-Za-z_0-9]*$/;
// The expression tokenizer's own pattern, so exponents are never read as names.
const TOKENS = /(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|[A-Za-z_][A-Za-z_0-9]*|[^\s]/g;

/** Every parameter name the graph's expressions read: point coordinates, circle radii and relation scalars. */
export function equationBaselineParameterNames(graph: CadSketchGraph): string[] {
  const names = new Set<string>(), read = (scalar: unknown) => { if (typeof scalar === 'string') for (const token of scalar.match(TOKENS) ?? []) if (IDENTIFIER.test(token)) names.add(token); };
  for (const point of graph.points) point.position.forEach(read);
  for (const entity of graph.entities) if (entity.kind === 'circle') read(entity.radius);
  for (const relation of graph.relations) mapCadSketchRelationScalars(relation, scalar => { read(scalar); return scalar; });
  return [...names].sort();
}

/**
 * A relation baseline graph made solvable: each numeric coordinate, stored there as 0, placed in [-100, 100] mm to three decimals, and
 * each parameter its expressions read given a value in [5, 40] to three decimals, both from generators seeded by hashes, so the same
 * graph always gets the same input.
 */
export function placedRelationBaselineInput(graph: CadSketchGraph): CadSketchSolveInput {
  const next = random(sha256(JSON.stringify(graph)));
  const points = graph.points.map(point => ({ ...point, position: point.position.map(value => typeof value === 'number' ? round3(next() * 200 - 100) : value) }));
  const parameters = Object.fromEntries(equationBaselineParameterNames(graph).map(name => [name, round3(5 + 35 * random(sha256(name))())]));
  return parseCadSketchSolveInput({ graph: { ...graph, points }, parameters });
}

/** The graphs of the relation baseline fixture, in its order. */
export function readRelationBaselineGraphs(paths = equationBaselinePaths()): CadSketchGraph[] {
  return (JSON.parse(gunzipSync(readFileSync(paths.relationBaseline)).toString('utf8')) as { records: { graph: CadSketchGraph }[] }).records.map(record => record.graph);
}

/** The inputs of the fixture's records: the relation baseline graphs placed, the corpus inputs, then the recorded benchmark inputs. */
export function equationBaselineInputs(benchmark: EquationBaselineBenchmarkInputs, paths: EquationBaselinePaths = equationBaselinePaths()): EquationBaselineInput[] {
  const inputs: EquationBaselineInput[] = readRelationBaselineGraphs(paths).map((graph, index) => ({ source: `relation-baseline:${index}`, input: placedRelationBaselineInput(graph) }));
  for (const { record, input } of readPlaneGcsCorpus(paths.corpus).records) inputs.push({ source: `corpus:${record.hash.slice(0, 16)}`, input });
  for (const item of benchmark.inputs) {
    const graph = benchmark.graphs[item.graph];
    if (!graph) throw new Error(`The benchmark input ${item.source} has no graph ${item.graph}.`);
    inputs.push({ source: item.source, input: { graph, parameters: item.parameters, ...item.drag ? { drag: item.drag } : {} } });
  }
  return inputs;
}

/** The hash of an input as solved, as the corpus hashes it. */
export const equationBaselineInputHash = (input: CadSketchSolveInput) => corpusInput(input).hash.slice(0, 16);

/** Adds a benchmark input once, by its input hash; its graph once, by the graph hash. */
export function benchmarkInputCollector() {
  const graphs: Record<string, CadSketchGraph> = {}, inputs: EquationBaselineBenchmarkInputs['inputs'][number][] = [], seen = new Set<string>();
  return {
    add(source: string, value: CadSketchSolveInput) {
      const input = parseCadSketchSolveInput(value), { hash, graphHash } = corpusInput(input);
      if (seen.has(hash)) return;
      seen.add(hash);
      graphs[graphHash] ??= input.graph;
      inputs.push({ source, graph: graphHash, parameters: input.parameters, ...input.drag ? { drag: input.drag } : {} });
    },
    result: (): EquationBaselineBenchmarkInputs => ({ graphs, inputs })
  };
}

/** The model as the fixture stores it. */
export function equationBaselineModel(model: CadSketchEquationModel): EquationBaselineModel {
  return {
    layout: shortHash(JSON.stringify([[...model.pointParameters], [...model.radiusParameters]])),
    values: shortHash(new Uint8Array(Float64Array.from(model.values).buffer)),
    fixed: model.fixed.flatMap((fixed, index) => fixed ? [index] : []),
    equations: model.equations.map(equation => [equation.kind, equation.sourceId, equation.tag, equation.value, equation.temporary ? 1 : 0, ...equation.operands])
  };
}

/** Parses and compiles `input`, as the solver does, giving the model or the error, and the stored form with its hash. */
export function compileEquationBaselineModel(compile: (input: CadSketchSolveInput) => CadSketchEquationModel, input: CadSketchSolveInput) {
  let model: CadSketchEquationModel;
  try { model = compile(parseCadSketchSolveInput(input)); } catch (error) { const stored = { throws: errorText(error) }; return { model: null, stored, hash: shortHash(encodeCorpusJson(stored)) }; }
  const stored = equationBaselineModel(model);
  return { model, stored, hash: shortHash(encodeCorpusJson(stored)) };
}

export function equationBaselineAnswer(solution: CadSketchNativeSolution): EquationBaselineAnswer {
  const { diagnosis } = solution, labels = 'labels' in diagnosis ? diagnosis.labels.flatMap((label, index) => label ? [[index, label] as const] : []) : [];
  return [solution.status, solution.iterations, diagnosis.kind, diagnosis.kind === 'diagnosed' ? diagnosis.degreesOfFreedom : null, labels,
    solution.definition ? solution.definition.join('') : null, solution.drag ? [solution.drag.outcome, solution.drag.targetDistance] : null,
    shortHash(new Uint8Array(Float64Array.from(solution.values).buffer))];
}

/** Native's module from the package, and a solver that replaces an instance stopped by an error. */
export async function equationBaselineNative(paths = equationBaselinePaths()) {
  const module = await WebAssembly.compile(readFileSync(paths.native));
  let solver: CadSketchNativeSolver = await loadCadSketchNativeSolver(module);
  const guarded = async <T>(run: (solver: CadSketchNativeSolver) => T): Promise<T | { throws: string }> => {
    try { return run(solver); } catch (error) { solver = await loadCadSketchNativeSolver(module); return { throws: errorText(error) }; }
  };
  return {
    module,
    answer: (model: CadSketchEquationModel, drag: boolean): Promise<EquationBaselineAnswer> =>
      guarded(solver => equationBaselineAnswer(solver.solve(model, { analyseDefinition: !drag }))),
    attempt: (input: CadSketchSolveInput) => guarded(solver => attemptCadSketchNativeSolve(input, solver))
  };
}
type EquationBaselineNative = Awaited<ReturnType<typeof equationBaselineNative>>;

const hashed = (value: unknown) => shortHash(encodeCorpusJson(value));
const outcome = <T>(run: () => T): T | { throws: string } => { try { return run(); } catch (error) { return { throws: errorText(error) }; } };

/** Each relation's row of the constraint inspection, as an agent pages through them; a row whose own page throws is the error it threw. */
export function equationBaselineInspectionRows(input: CadSketchSolveInput) {
  const { graph, parameters } = input;
  const inspection: CadSketchConstraintInspection = { sketchId: 'sketch', pointCount: graph.points.length, entityCount: graph.entities.length,
    relationCount: graph.relations.length, legacyProfileCount: 0, legacyDimensionCount: 0, degreesOfFreedomScope: 'graph', graph, parameters,
    analysis: { kind: 'unavailable', message: 'Not solved.', diagnostics: { status: null, degreesOfFreedom: null, conflictingIds: [], redundantIds: [], partiallyRedundantIds: [], issues: [] } } };
  const rows: unknown[] = [], total = graph.relations.length;
  for (let offset = 0; offset < total;) {
    try {
      const page = pageCadSketchConstraints(inspection, { section: 'relations', offset, limit: total - offset });
      rows.push(...page.items); offset = page.nextOffset ?? total;
    } catch { rows.push(outcome(() => pageCadSketchConstraints(inspection, { section: 'relations', offset, limit: 1 }).items[0])); offset++; }
  }
  return rows;
}

// The checks and rows do not read the drag, so inputs that share a graph object and parameters share them, as drags of one graph do.
const graphRecords = new WeakMap<object, Map<string, readonly [string, string]>>();

/** Everything the baseline records for one input. */
export async function recordEquationBaselineInput(compile: (input: CadSketchSolveInput) => CadSketchEquationModel, native: EquationBaselineNative,
  { source, input }: EquationBaselineInput) {
  const compiled = compileEquationBaselineModel(compile, input), parsed = outcome(() => parseCadSketchSolveInput(input));
  const answer = compiled.model ? await native.answer(compiled.model, input.drag !== undefined) : null;
  const known = graphRecords.get(input.graph) ?? new Map<string, readonly [string, string]>(), scope = encodeCorpusJson(input.parameters);
  graphRecords.set(input.graph, known);
  let graphRecord = known.get(scope);
  if (!graphRecord) {
    const checks = 'throws' in parsed ? parsed : outcome(() => checkCadSketchGraph(parsed.graph, parsed.parameters));
    const rows = 'throws' in parsed ? parsed : equationBaselineInspectionRows(parsed);
    graphRecord = [hashed(checks), hashed(rows)];
    known.set(scope, graphRecord);
  }
  const attempt = 'throws' in parsed ? parsed : await native.attempt(parsed.drag ? parsed : { ...parsed, analyseDefinition: true });
  const record: EquationBaselineRecord = [source, equationBaselineInputHash(input), compiled.hash, answer, ...graphRecord, hashed(attempt)];
  return { compiled, record };
}

export const encodeEquationBaseline = (baseline: EquationBaseline) => encodeCorpusJson(baseline);
export const readEquationBaseline = (file: URL | string = equationBaselinePaths().fixture) =>
  decodeCorpusJson(gunzipSync(readFileSync(file)).toString('utf8')) as EquationBaseline;
