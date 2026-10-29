// The native module as an earlier release shipped it, kept so a change to the solver is compared,
// call by call, with the solver it replaces. `packages/sketch-solver/baseline/manifest.json` names it.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { CAD_SKETCH_NATIVE_PROTOCOL_VERSION, encodeCadSketchEquationModel, type CadSketchEquationModel } from '../cadSketchEquationModel';
import { CadSketchNativeProtocolError, decodeCadSketchNativeOutput, type CadSketchNativeSolution, type CadSketchNativeSolver } from '../cadSketchNativeSolver';

export interface NativeBaselineManifest {
  readonly appVersion: string;
  readonly file: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly toolchain: string;
}

const directory = new URL('../../../../../../packages/sketch-solver/baseline/', import.meta.url);
export const nativeBaselineManifest = JSON.parse(readFileSync(new URL('manifest.json', directory), 'utf8')) as NativeBaselineManifest;

/** The baseline module's bytes, refused unless they are the ones its manifest names. */
export function nativeBaselineBytes(manifest = nativeBaselineManifest) {
  const bytes = readFileSync(new URL(manifest.file, directory)), sha256 = createHash('sha256').update(bytes).digest('hex');
  if (bytes.length !== manifest.bytes || sha256 !== manifest.sha256) throw new Error(`The native baseline ${manifest.file} is not the module its manifest names.`);
  return bytes;
}

/** The buffer protocol the baseline module speaks: the current one without its options word, definition block and point to line distance. */
export const NATIVE_BASELINE_PROTOCOL_VERSION = 5;

/**
 * An instance of the baseline `module`, asked and answering as a current instance is, through its
 * own protocol: each model is encoded as now less the options word, and each reply read as now with
 * nothing analysed. It cannot ask which parameters are defined. As a current instance, it stops
 * after a trap or an invalid result. Each call copies its input and reply once more than a current
 * instance does.
 */
export async function loadNativeBaselineInstance(module: WebAssembly.Module): Promise<CadSketchNativeSolver> {
  const exports = (await WebAssembly.instantiate(module, {})).exports as unknown as { readonly memory: WebAssembly.Memory;
    buffer_alloc(length: number): number; buffer_free(pointer: number, length: number): void; solve(pointer: number, length: number): number };
  let stopped = false;
  return { memoryBytes: () => exports.memory.buffer.byteLength, solve(model, options = {}) {
    if (stopped) throw new Error('The native sketch solver instance stopped after a failure.');
    if (options.analyseDefinition) throw new Error('The baseline module cannot ask which parameters are defined.');
    const current = encodeCadSketchEquationModel(model), input = new Float64Array(current.length - 1);
    input.set([NATIVE_BASELINE_PROTOCOL_VERSION, current[1], current[2]]);
    input.set(current.subarray(4), 3);
    try {
      const pointer = exports.buffer_alloc(input.length);
      new Float64Array(exports.memory.buffer, pointer, input.length).set(input);
      const output = exports.solve(pointer, input.length);
      const length = new Float64Array(exports.memory.buffer, output, 1)[0];
      const reply = new Float64Array(exports.memory.buffer, output, length), read = new Float64Array(reply.length + model.values.length);
      read.set(reply);
      read[0] = read.length;
      read[1] = reply[1] === NATIVE_BASELINE_PROTOCOL_VERSION ? CAD_SKETCH_NATIVE_PROTOCOL_VERSION : Number.NaN;
      const solution = decodeCadSketchNativeOutput(model, {}, read);
      exports.buffer_free(pointer, input.length);
      exports.buffer_free(output, length);
      return solution;
    } catch (error) {
      stopped = true;
      throw error;
    }
  } };
}

let compiled: Promise<WebAssembly.Module> | undefined;
export const loadNativeBaselineSolver = async () => loadNativeBaselineInstance(await (compiled ??= WebAssembly.compile(nativeBaselineBytes())));

/** One answer of a module: its solution, or what it failed with, a protocol error named apart as the runtime treats it apart. */
export type NativeAnswer = { readonly solution: CadSketchNativeSolution } | { readonly error: string };

const failure = (error: unknown): NativeAnswer => ({ error: `${error instanceof CadSketchNativeProtocolError ? 'protocol: ' : ''}${error instanceof Error ? error.message : String(error)}` });

export function answerNatively(solver: CadSketchNativeSolver, model: CadSketchEquationModel): NativeAnswer {
  try { return { solution: solver.solve(model) }; } catch (error) { return failure(error); }
}

/** A solver that passes each model it is asked, with its answer, to `onCall`, then answers or throws as `solver` did. */
export function recordNativeCalls(solver: CadSketchNativeSolver, onCall: (model: CadSketchEquationModel, answer: NativeAnswer) => void): CadSketchNativeSolver {
  return { memoryBytes: () => solver.memoryBytes(), solve(model, options) {
    let solution: CadSketchNativeSolution;
    try { solution = solver.solve(model, options); } catch (error) { onCall(model, failure(error)); throw error; }
    onCall(model, { solution });
    return solution;
  } };
}

/**
 * A loader for a runtime that pairs each current instance with a fresh baseline instance, so both
 * are asked the same models in the same order, even when the runtime replaces an instance, and
 * passes each call's two answers to `compare`. The baseline is never asked for definition, which
 * leaves the rest of an answer as it was.
 */
export function loadPairedWithBaseline(loadCurrent: () => Promise<CadSketchNativeSolver>,
  compare: (model: CadSketchEquationModel, baseline: NativeAnswer, current: NativeAnswer) => void) {
  return async () => {
    const baseline = await loadNativeBaselineSolver();
    return recordNativeCalls(await loadCurrent(), (model, current) => compare(model, answerNatively(baseline, model), current));
  };
}

const same = (a: number | null | undefined, b: number | null | undefined) => Object.is(a, b);
const sameList = (a: readonly number[], b: readonly number[]) => a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
const labelsOf = (solution: CadSketchNativeSolution) => solution.diagnosis.kind === 'unavailable' ? [] : solution.diagnosis.labels;
const freedomOf = (solution: CadSketchNativeSolution) => solution.diagnosis.kind === 'diagnosed' ? solution.diagnosis.degreesOfFreedom : undefined;

/**
 * Every part in which two answers to one model differ, bit for bit: NaN equals NaN, and -0 differs
 * from 0. Values, iterations and residual are numbers the solver computed; the rest is its verdict.
 * Definition, which the baseline cannot analyse, is not compared.
 */
export function nativeAnswerDifferences(baseline: NativeAnswer, current: NativeAnswer): string[] {
  if ('error' in baseline || 'error' in current) return 'error' in baseline && 'error' in current && baseline.error === current.error ? [] : ['error'];
  const a = baseline.solution, b = current.solution, found: string[] = [];
  if (a.status !== b.status) found.push('status');
  if (a.diagnosis.kind !== b.diagnosis.kind) found.push('diagnosis');
  if (!same(freedomOf(a), freedomOf(b))) found.push('freedom');
  if (!sameList(labelsOf(a), labelsOf(b))) found.push('labels');
  if (a.drag?.outcome !== b.drag?.outcome) found.push('drag');
  if (!same(a.drag?.targetDistance, b.drag?.targetDistance)) found.push('target-distance');
  if (!sameList(a.values, b.values)) found.push('values');
  if (!same(a.iterations, b.iterations)) found.push('iterations');
  if (!same(a.residual, b.residual)) found.push('residual');
  return found;
}

/**
 * The unknowns of `model` the solver may solve through classes (from 0.0.760): those of each group,
 * connected through the unknowns its equations share, whose every equation is a difference, a value
 * or a midpoint, and at least one a difference or a value. None while a drag is held.
 */
export function nativeEliminableUnknowns(model: CadSketchEquationModel): ReadonlySet<number> {
  const eliminable = new Set<number>();
  if (model.equations.some(equation => equation.temporary)) return eliminable;
  const parent = model.fixed.map((_, index) => index);
  const root = (p: number): number => { while (parent[p] !== p) p = parent[p] = parent[parent[p]]; return p; };
  for (const equation of model.equations) {
    const unknowns = equation.operands.filter(p => !model.fixed[p]);
    for (const p of unknowns.slice(1)) parent[root(p)] = root(unknowns[0]);
  }
  const simple = new Map<number, boolean>(), linear = new Map<number, boolean>();
  for (const equation of model.equations) {
    const unknown = equation.operands.find(p => !model.fixed[p]);
    if (unknown === undefined) continue;
    const group = root(unknown);
    linear.set(group, (linear.get(group) ?? true) && (equation.kind === 'difference' || equation.kind === 'value' || equation.kind === 'midpoint'));
    if (equation.kind === 'difference' || equation.kind === 'value') simple.set(group, true);
  }
  model.fixed.forEach((fixed, p) => { if (!fixed && linear.get(root(p)) && simple.get(root(p))) eliminable.add(p); });
  return eliminable;
}

/** How far eliminating simple equalities may move a value: this part of its size, and at least of a millimetre. */
export const NATIVE_ELIMINATION_TOLERANCE = 1e-9;

/** The largest move of any value, each over its allowance (see `nativeEliminationDifferences`); zero for the same values. */
export function nativeValueMove(baseline: readonly number[], current: readonly number[]) {
  return baseline.reduce((largest, value, index) => Object.is(value, current[index]) ? largest
    : Math.max(largest, Math.abs(value - current[index]) / (NATIVE_ELIMINATION_TOLERANCE * Math.max(1, Math.abs(value)))), 0);
}

/**
 * The parts in which two answers to one model differ beyond what eliminating simple equalities
 * allows. A group solved through its classes reaches the solution solving it whole does, within
 * the solve's stopping tolerance, so the values of `nativeEliminableUnknowns` may move within
 * `NATIVE_ELIMINATION_TOLERANCE`, and the iterations and largest residual may change. Nothing else
 * may: every other value, status, diagnosis, freedom, labels, drag and any error stay the
 * baseline's, and a model without such a group, or whose every group the baseline took no step
 * in, is answered bit for bit.
 */
export function nativeEliminationDifferences(model: CadSketchEquationModel, baseline: NativeAnswer, current: NativeAnswer): string[] {
  const found = nativeAnswerDifferences(baseline, current);
  if (!found.length || 'error' in baseline || 'error' in current || baseline.solution.iterations === 0) return found;
  const eliminable = nativeEliminableUnknowns(model);
  if (!eliminable.size) return found;
  const allowed = new Set(['iterations', 'residual']);
  const [before, after] = [baseline.solution.values, current.solution.values];
  if (before.length === after.length && before.every((value, p) => Object.is(value, after[p]) || eliminable.has(p) && nativeValueMove([value], [after[p]]) <= 1)) allowed.add('values');
  return found.filter(part => !allowed.has(part));
}
