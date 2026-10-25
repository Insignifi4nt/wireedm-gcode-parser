import { CAD_SKETCH_NATIVE_PROTOCOL_VERSION, encodeCadSketchEquationModel, type CadSketchEquationModel } from './cadSketchEquationModel';

export interface CadSketchNativeSolution {
  /** `too-large`: a connected group needs more factor memory or work than the solver allows. */
  readonly status: 'converged' | 'not-converged' | 'too-large';
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

const STATUSES: Readonly<Record<number, CadSketchNativeSolution['status']>> = { 0: 'converged', 1: 'not-converged', 3: 'too-large' };

/** Loads the Rust solver from bytes, or from a URL (by default the bundled module asset). */
export async function loadCadSketchNativeSolver(source?: BufferSource | WebAssembly.Module | string | URL, observeMemory?: (memory: WebAssembly.Memory) => void): Promise<CadSketchNativeSolver> {
  // Explicit byte callers, including the Node benchmark, do not need a bundler asset loader.
  source ??= (await import('../../../../../packages/sketch-solver/wasm/sketch_solver.wasm?url')).default;
  const bytes = typeof source === 'string' || source instanceof URL ? await (await fetch(source)).arrayBuffer() : source;
  const instance = bytes instanceof WebAssembly.Module ? await WebAssembly.instantiate(bytes, {}) : (await WebAssembly.instantiate(bytes, {})).instance;
  const exports = instance.exports;
  if (!isExports(exports)) throw new Error('The native sketch solver module has unexpected exports.');
  observeMemory?.(exports.memory);
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
      const kind = STATUSES[status];
      if (kind === undefined || values.length !== model.values.length || values.some(value => !Number.isFinite(value)))
        throw new Error('The native sketch solver returned an invalid result.');
      return { status: kind, iterations, residual, values };
    } finally {
      exports.buffer_free(pointer, input.length);
      if (output !== undefined) exports.buffer_free(output, new Float64Array(exports.memory.buffer, output, 1)[0]);
    }
  } };
}
