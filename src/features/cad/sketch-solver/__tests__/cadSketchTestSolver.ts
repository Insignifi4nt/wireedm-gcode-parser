// The application's sketch solver for Node suites: native first, with PlaneGCS loaded on first fallback,
// both from their package files. Suites that test PlaneGCS itself use `createCadSketchSolverRuntime`.
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

export function createCadSketchTestSolver(options: {
  readonly mode?: CadSketchSolverMode;
  readonly loadNative?: () => Promise<CadSketchNativeSolver>;
  readonly onSolve?: (record: CadSketchSolveRecord) => void;
} = {}) {
  return createCadSketchNativeFirstRuntime({ loadNative: loadCadSketchTestNativeSolver, ...options,
    loadPlaneGcs: async () => createCadSketchSolverRuntime(() => initializeCadSketchSolverModule(cadSketchPlaneGcsWasmUrl)) });
}
