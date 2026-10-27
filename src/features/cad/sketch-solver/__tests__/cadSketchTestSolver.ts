// The application's sketch solver for Node suites, from its package file.
import { readFileSync } from 'node:fs';
import { createCadSketchNativeRuntime, type CadSketchSolveRecord } from '../cadSketchNativeRuntime';
import { loadCadSketchNativeSolver, type CadSketchNativeSolver } from '../native/cadSketchNativeSolver';
import { recordUnexpectedNativeFailure } from './cadSketchNativeFailures';

let nativeModule: Promise<WebAssembly.Module> | undefined;
export const loadCadSketchTestNativeSolver = async () => loadCadSketchNativeSolver(await (nativeModule ??=
  WebAssembly.compile(readFileSync(new URL('../../../../../packages/sketch-solver/wasm/sketch_solver.wasm', import.meta.url)))));

/**
 * A solve whose native instance failed to load or trapped rejects, and fails its test after it
 * ends, so a test expecting a rejection cannot pass on it; `allowNativeFailure` lets a suite that
 * tests those paths through.
 */
export function createCadSketchTestSolver({ allowNativeFailure = false, ...options }: {
  readonly loadNative?: () => Promise<CadSketchNativeSolver>;
  readonly onSolve?: (record: CadSketchSolveRecord) => void;
  readonly allowNativeFailure?: boolean;
} = {}) {
  return createCadSketchNativeRuntime({ loadNative: loadCadSketchTestNativeSolver, ...options,
    onSolve: record => {
      options.onSolve?.(record);
      if (allowNativeFailure || !['failed', 'load-failed', 'incompatible'].includes(record.native) && record.nativeReset !== 'failure') return;
      const failure = `The native sketch solver could not run (${JSON.stringify(record)}).`;
      recordUnexpectedNativeFailure(failure);
      throw new Error(failure);
    } });
}
