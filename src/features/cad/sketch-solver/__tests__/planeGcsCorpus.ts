// The frozen PlaneGCS corpus: sketch solve inputs from the test suites with the outcome PlaneGCS 1.3.0
// gave each one alone, captured before PlaneGCS was removed in 0.0.757, so native answers can still be
// compared with it. It no longer grows: inputs of later suites are not in it.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { evaluateCadScalar } from '@/domain/cad/cadExpression';
import { cadSketchGraphWithSolvedValues, type CadSketchGraph } from '@/domain/cad/cadSketchGraph';
import type { CadSketchSolveInput, CadSketchSolveResult } from '../cadSketchSolverTypes';
import type { CadSketchEquationModel } from '@/domain/cad/sketch-solver/cadSketchEquationModel';

export const PLANEGCS_CORPUS_FORMAT = 1;
export const planeGcsCorpusDirectory = new URL('./fixtures/planegcs-corpus/', import.meta.url);

/** PlaneGCS's answer to one input alone, or that it threw. Solved values follow `cadSketchSolvedSlots`. */
export type PlaneGcsCorpusOutcome = { readonly kind: 'threw'; readonly message: string } | {
  readonly kind: CadSketchSolveResult['kind'];
  readonly reason?: Extract<CadSketchSolveResult, { kind: 'rejected' }>['reason'];
  readonly diagnostics: CadSketchSolveResult['diagnostics'];
  readonly values?: readonly number[];
};

export interface PlaneGcsCorpusRecord {
  /** Hash of the encoded input. */
  readonly hash: string;
  /** Test files and names that solved this input, sorted. */
  readonly provenance: readonly string[];
  /** Hash of the input's graph in the graph table. */
  readonly graph: string;
  readonly parameters: CadSketchSolveInput['parameters'];
  readonly drag?: CadSketchSolveInput['drag'];
  /** Hash of the native equation model, which equalled PlaneGCS's compilation restated; null when native refuses the input. */
  readonly model: string | null;
  readonly outcome: PlaneGcsCorpusOutcome;
}

export interface PlaneGcsCorpusManifest {
  readonly format: number;
  readonly records: number;
  readonly graphs: number;
  readonly planeGcs: string;
  readonly nativeModuleSha256: string;
}

const NEGATIVE_ZERO = '$-0';

/**
 * JSON that keeps negative zero, which `JSON.stringify` writes as 0. Key order is kept: parameter
 * order decides value order in the equation model, so an input is stored exactly as it was solved.
 */
export function encodeCorpusJson(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => {
    if (Object.is(item, -0)) return { [NEGATIVE_ZERO]: true };
    if (typeof item === 'number' && !Number.isFinite(item)) throw new Error('The corpus holds finite numbers only.');
    if (item && typeof item === 'object' && !Array.isArray(item) && NEGATIVE_ZERO in item) throw new Error(`The corpus reserves the key ${NEGATIVE_ZERO}.`);
    return item;
  });
}

export function decodeCorpusJson(text: string): unknown {
  return JSON.parse(text, (_key, item: unknown) => item && typeof item === 'object' && !Array.isArray(item) && NEGATIVE_ZERO in item ? -0 : item);
}

export const corpusHash = (text: string) => createHash('sha256').update(text).digest('hex');

/** The input as solved, its hash, and its graph's. */
export function corpusInput(input: CadSketchSolveInput) {
  const solved = { graph: input.graph, parameters: input.parameters, ...input.drag ? { drag: input.drag } : {} };
  const encoded = encodeCorpusJson(solved), graph = encodeCorpusJson(input.graph);
  return { hash: corpusHash(encoded), encoded, graphHash: corpusHash(graph), graph };
}

/** Hash of what native solves: values, which of them are fixed, and equations. */
export function corpusModelHash(model: CadSketchEquationModel): string {
  return corpusHash(encodeCorpusJson({ values: model.values, fixed: model.fixed, equations: model.equations }));
}

/** Reads the frozen corpus with each record's input rebuilt. */
export function readPlaneGcsCorpus(directory = planeGcsCorpusDirectory) {
  const manifest = JSON.parse(readFileSync(new URL('manifest.json', directory), 'utf8')) as PlaneGcsCorpusManifest;
  const graphs = new Map(Object.entries(decodeCorpusJson(gunzipSync(readFileSync(new URL('graphs.json.gz', directory))).toString('utf8')) as Record<string, CadSketchGraph>));
  const records = readFileSync(new URL('records.jsonl', directory), 'utf8').split('\n').filter(Boolean).map(line => {
    const record = decodeCorpusJson(line) as PlaneGcsCorpusRecord, graph = graphs.get(record.graph);
    if (!graph) throw new Error(`Corpus record ${record.hash} has no graph ${record.graph}.`);
    const input: CadSketchSolveInput = { graph, parameters: record.parameters, ...record.drag ? { drag: record.drag } : {} };
    if (corpusInput(input).hash !== record.hash) throw new Error(`Corpus record ${record.hash} does not hash to itself.`);
    return { record, input };
  });
  if (manifest.format !== PLANEGCS_CORPUS_FORMAT || manifest.records !== records.length || manifest.graphs !== graphs.size) throw new Error('The corpus manifest does not match its files.');
  return { manifest, records };
}

/** Distance in mm from the dragged point of `graph` to the drag target. */
export function corpusDragDistance(input: CadSketchSolveInput, graph: CadSketchGraph) {
  const drag = input.drag!, position = graph.points.find(point => point.id === drag.pointId)!.position;
  return Math.hypot(...position.map((value, axis) => evaluateCadScalar(value, input.parameters) - drag.position[axis]));
}

/**
 * How much further than PlaneGCS a native drag may end from its target: roundoff at the scale of the
 * dragged point and target, and at least a micrometre, as both solvers stop at their own tolerances.
 */
export function corpusDragAllowance(input: CadSketchSolveInput, graph: CadSketchGraph) {
  const drag = input.drag!, position = graph.points.find(point => point.id === drag.pointId)!.position;
  const scale = Math.max(1, ...position.map(value => Math.abs(evaluateCadScalar(value, input.parameters))), ...drag.position.map(Math.abs));
  return Math.max(1e-6, 64 * Number.EPSILON * scale);
}

/** PlaneGCS's solved graph for a corpus input. */
export function corpusSolvedGraph(input: CadSketchSolveInput, outcome: PlaneGcsCorpusOutcome): CadSketchGraph | undefined {
  return outcome.kind === 'solved' && outcome.values ? cadSketchGraphWithSolvedValues(input.graph, outcome.values) : undefined;
}

/** PlaneGCS's frozen solution to `input`, which a suite solved while PlaneGCS was bundled. */
export function planeGcsCorpusSolution(input: CadSketchSolveInput): CadSketchGraph {
  const hash = corpusInput(input).hash, found = readPlaneGcsCorpus().records.find(({ record }) => record.hash === hash);
  const graph = found && corpusSolvedGraph(found.input, found.record.outcome);
  if (!graph) throw new Error(`The frozen PlaneGCS corpus has no solution for input ${hash}.`);
  return graph;
}
