// The application's sketch solver for Node suites, native alone by default, from its package file.
// Suites that test the fallback to PlaneGCS pick `native-first`, which loads PlaneGCS on first
// fallback; suites that test PlaneGCS itself use `createCadSketchSolverRuntime`.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { createCadSketchNativeFirstRuntime, type CadSketchSolveRecord, type CadSketchSolverMode } from '../cadSketchNativeFirstRuntime';
import { createCadSketchSolverRuntime } from '../cadSketchSolverRuntime';
import { initializeCadSketchSolverModule } from '../cadSketchSolverModule';
import { loadCadSketchNativeSolver, type CadSketchNativeSolver } from '../native/cadSketchNativeSolver';

const require = createRequire(import.meta.url);
export const cadSketchPlaneGcsWasmUrl = pathToFileURL(require.resolve('@salusoft89/planegcs/dist/planegcs_dist/planegcs.wasm')).href;
let nativeModule: Promise<WebAssembly.Module> | undefined;
export const loadCadSketchTestNativeSolver = async () => loadCadSketchNativeSolver(await (nativeModule ??=
  WebAssembly.compile(readFileSync(new URL('../../../../../packages/sketch-solver/wasm/sketch_solver.wasm', import.meta.url)))));

/**
 * A solve whose native instance failed to load or trapped rejects, so no suite passes on a
 * fallback answer by accident; `allowNativeFailure` lets a suite that tests those paths through.
 */
export function createCadSketchTestSolver({ allowNativeFailure = false, ...options }: {
  readonly mode?: CadSketchSolverMode;
  readonly loadNative?: () => Promise<CadSketchNativeSolver>;
  readonly onSolve?: (record: CadSketchSolveRecord) => void;
  readonly allowNativeFailure?: boolean;
} = {}) {
  return createCadSketchNativeFirstRuntime({ loadNative: loadCadSketchTestNativeSolver, mode: 'native-only', ...options,
    onSolve: record => {
      options.onSolve?.(record);
      if (!allowNativeFailure && (record.native === 'failed' || record.native === 'load-failed' || record.nativeReset === 'failure'))
        throw new Error(`The native sketch solver could not run (${JSON.stringify(record)}).`);
    },
    loadPlaneGcs: async () => createCadSketchSolverRuntime(() => initializeCadSketchSolverModule(cadSketchPlaneGcsWasmUrl)) });
}
