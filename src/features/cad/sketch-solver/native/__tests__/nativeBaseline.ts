// The native module as an earlier release shipped it, kept so a change to the solver is compared,
// call by call, with the solver it replaces. `packages/sketch-solver/baseline/manifest.json` names it.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { CadSketchEquationModel } from '../cadSketchEquationModel';
import { CadSketchNativeProtocolError, loadCadSketchNativeSolver, type CadSketchNativeSolution, type CadSketchNativeSolver } from '../cadSketchNativeSolver';

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

let compiled: Promise<WebAssembly.Module> | undefined;
export const loadNativeBaselineSolver = async () => loadCadSketchNativeSolver(await (compiled ??= WebAssembly.compile(nativeBaselineBytes())));

/** One answer of a module: its solution, or what it failed with, a protocol error named apart as the runtime treats it apart. */
export type NativeAnswer = { readonly solution: CadSketchNativeSolution } | { readonly error: string };

const failure = (error: unknown): NativeAnswer => ({ error: `${error instanceof CadSketchNativeProtocolError ? 'protocol: ' : ''}${error instanceof Error ? error.message : String(error)}` });

export function answerNatively(solver: CadSketchNativeSolver, model: CadSketchEquationModel): NativeAnswer {
  try { return { solution: solver.solve(model) }; } catch (error) { return failure(error); }
}

/** A solver that passes each model it is asked, with its answer, to `onCall`, then answers or throws as `solver` did. */
export function recordNativeCalls(solver: CadSketchNativeSolver, onCall: (model: CadSketchEquationModel, answer: NativeAnswer) => void): CadSketchNativeSolver {
  return { memoryBytes: () => solver.memoryBytes(), solve(model) {
    let solution: CadSketchNativeSolution;
    try { solution = solver.solve(model); } catch (error) { onCall(model, failure(error)); throw error; }
    onCall(model, { solution });
    return solution;
  } };
}

/**
 * A loader for a runtime that pairs each current instance with a fresh baseline instance, so both
 * are asked the same models in the same order, even when the runtime replaces an instance, and
 * passes each call's two answers to `compare`.
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
