import wasmUrl from '../../../../../packages/sketch-solver/wasm/sketch_solver.wasm?url';
import { CAD_SKETCH_NATIVE_PROTOCOL_VERSION, encodeCadSketchEquationModel, type CadSketchEquationModel } from './cadSketchEquationModel';

export interface CadSketchNativeSolution {
  readonly status: 'converged' | 'not-converged';
  readonly iterations: number;
  /** Largest equation residual at `values` in millimetres; a direction error moves its longer line's far end. */
  readonly residual: number;
  readonly values: readonly number[];
}

export interface CadSketchNativeSolver {
  solve(model: CadSketchEquationModel): CadSketchNativeSolution;
}

interface Exports {
  readonly memory: WebAssembly.Memory;
  buffer_alloc(length: number): number;
  buffer_free(pointer: number, length: number): void;
  solve(pointer: number, length: number): number;
}

function isExports(value: WebAssembly.Exports): value is WebAssembly.Exports & Exports {
  return value.memory instanceof WebAssembly.Memory && ['buffer_alloc', 'buffer_free', 'solve'].every(name => typeof value[name] === 'function');
}

/** Loads the Rust solver from bytes, or from a URL (by default the bundled module asset). */
export async function loadCadSketchNativeSolver(source: BufferSource | string | URL = wasmUrl): Promise<CadSketchNativeSolver> {
  const bytes = typeof source === 'string' || source instanceof URL ? await (await fetch(source)).arrayBuffer() : source;
  const { instance } = await WebAssembly.instantiate(bytes, {});
  const exports = instance.exports;
  if (!isExports(exports)) throw new Error('The native sketch solver module has unexpected exports.');
  return { solve(model) {
    const input = encodeCadSketchEquationModel(model);
    const pointer = exports.buffer_alloc(input.length);
    let output: number | undefined;
    try {
      new Float64Array(exports.memory.buffer, pointer, input.length).set(input);
      output = exports.solve(pointer, input.length);
      // Memory may have grown during the solve; read through a fresh view.
      const length = new Float64Array(exports.memory.buffer, output, 1)[0];
      const result = new Float64Array(exports.memory.buffer, output, length).slice();
      const [, version, status, iterations, residual] = result, values = Array.from(result.subarray(5));
      if (version !== CAD_SKETCH_NATIVE_PROTOCOL_VERSION) throw new Error('The native sketch solver replied with another protocol version.');
      if (status === 2) throw new Error('The native sketch solver rejected its input.');
      if ((status !== 0 && status !== 1) || values.length !== model.values.length || values.some(value => !Number.isFinite(value)))
        throw new Error('The native sketch solver returned an invalid result.');
      return { status: status === 0 ? 'converged' : 'not-converged', iterations, residual, values };
    } finally {
      exports.buffer_free(pointer, input.length);
      if (output !== undefined) exports.buffer_free(output, new Float64Array(exports.memory.buffer, output, 1)[0]);
    }
  } };
}
