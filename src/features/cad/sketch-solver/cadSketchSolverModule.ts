import initialize from '@salusoft89/planegcs/dist/planegcs_dist/planegcs.js';
import wasmUrl from '@salusoft89/planegcs/dist/planegcs_dist/planegcs.wasm?url';
import type { ModuleStatic } from '@salusoft89/planegcs/planegcs_dist/planegcs';

export type CadSketchSolverModule = ModuleStatic;
let initialized: Promise<CadSketchSolverModule> | undefined;

/** One module per worker. The browser loads a separate replaceable WASM asset. */
export function initializeCadSketchSolverModule(wasmLocation = wasmUrl): Promise<CadSketchSolverModule> {
  initialized ??= initialize({ locateFile: () => wasmLocation }).catch(error => {
    initialized = undefined;
    throw error;
  });
  return initialized;
}
