import { CAD_SKETCH_NATIVE_PROTOCOL_VERSION, encodeCadSketchEquationModel, type CadSketchEquationModel } from './cadSketchEquationModel';

export interface CadSketchNativeSolution {
  /** `too-large`: a connected group needs more factor memory or work than the solver allows. */
  readonly status: 'converged' | 'not-converged' | 'too-large';
  readonly iterations: number;
  /** Largest equation residual at `values` in millimetres; a direction error moves its longer line's far end. */
  readonly residual: number;
  readonly values: readonly number[];
  readonly diagnosis: CadSketchNativeDiagnosis;
  /**
   * Present exactly when the model has drag targets (temporary value equations). `reached`: within
   * `max(1e-8, 32 epsilon S)` mm of every target, landed exactly when the lasting relations still
   * accept that; `projected`: nothing closer found from the start, the necessary conditions of the
   * nearest reachable values holding up to the solver's resolution, which does not prove them
   * nearest; `stalled`: neither. `targetDistance` is the Euclidean distance from the values to every
   * target, in millimetres.
   */
  readonly drag?: { readonly outcome: CadSketchNativeDragOutcome; readonly targetDistance: number };
}

export type CadSketchNativeDragOutcome = 'reached' | 'projected' | 'stalled';

/**
 * Rank diagnosis at the returned values. `suspected`: a group that did not converge stalled short of
 * a collapsed nearest point and was diagnosed with a looser dependence distance, so its conflicts
 * are suspected rather than certain and freedom is unknown. `no-unknowns`: nothing can move, so only
 * relations that are not met are labelled, as conflicting. `unavailable`: some group was too large,
 * or its rank was too close to call.
 */
export type CadSketchNativeDiagnosis =
  | { readonly kind: 'diagnosed'; readonly degreesOfFreedom: number | null; readonly labels: readonly number[] }
  | { readonly kind: 'suspected' | 'no-unknowns'; readonly labels: readonly number[] }
  | { readonly kind: 'unavailable' };

export interface CadSketchNativeSolver {
  /** Throws once the instance has stopped: after a trap or an invalid result it never runs again. */
  solve(model: CadSketchEquationModel): CadSketchNativeSolution;
  /** Bytes of linear memory the instance holds; it never shrinks. */
  memoryBytes(): number;
}

/** The module speaks another buffer protocol; no instance of it can be used. */
export class CadSketchNativeProtocolError extends Error {}

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
const DIAGNOSES = ['diagnosed', 'unavailable', 'no-unknowns', 'suspected'] as const;
const DRAG_OUTCOMES = ['reached', 'projected', 'stalled'] as const;
const HEADER = 9;

/** Loads the Rust solver from bytes, or from a URL (by default the bundled module asset). */
export async function loadCadSketchNativeSolver(source?: BufferSource | WebAssembly.Module | string | URL, observeMemory?: (memory: WebAssembly.Memory) => void): Promise<CadSketchNativeSolver> {
  // Explicit byte callers, including the Node benchmark, do not need a bundler asset loader.
  source ??= (await import('../../../../../packages/sketch-solver/wasm/sketch_solver.wasm?url')).default;
  const bytes = typeof source === 'string' || source instanceof URL ? await (await fetch(source)).arrayBuffer() : source;
  const instance = bytes instanceof WebAssembly.Module ? await WebAssembly.instantiate(bytes, {}) : (await WebAssembly.instantiate(bytes, {})).instance;
  const exports = instance.exports;
  if (!isExports(exports)) throw new Error('The native sketch solver module has unexpected exports.');
  observeMemory?.(exports.memory);
  let stopped = false;
  return { memoryBytes: () => exports.memory.buffer.byteLength, solve(model) {
    if (stopped) throw new Error('The native sketch solver instance stopped after a failure.');
    const input = encodeCadSketchEquationModel(model);
    try {
      const pointer = exports.buffer_alloc(input.length);
      new Float64Array(exports.memory.buffer, pointer, input.length).set(input);
      const output = exports.solve(pointer, input.length);
      // Memory may have grown during the solve; read through a fresh view.
      const length = new Float64Array(exports.memory.buffer, output, 1)[0];
      const result = new Float64Array(exports.memory.buffer, output, length).slice();
      const [, version, status, iterations, residual, diagnosed, degreesOfFreedom, dragged, targetDistance] = result;
      if (version !== CAD_SKETCH_NATIVE_PROTOCOL_VERSION) throw new CadSketchNativeProtocolError('The native sketch solver replied with another protocol version.');
      if (status === 2) throw new Error('The native sketch solver rejected its input.');
      const values = Array.from(result.subarray(HEADER, HEADER + model.values.length)), labels = Array.from(result.subarray(HEADER + model.values.length));
      const kind = STATUSES[status], diagnosis = DIAGNOSES[diagnosed], drag = DRAG_OUTCOMES[dragged];
      const dragging = model.equations.some(equation => equation.temporary);
      if (kind === undefined || diagnosis === undefined || length !== HEADER + model.values.length + model.equations.length
        || values.some(value => !Number.isFinite(value)) || labels.some(label => label !== 0 && label !== 1 && label !== 2)
        || !(Number.isNaN(degreesOfFreedom) || diagnosis === 'diagnosed' && Number.isSafeInteger(degreesOfFreedom) && degreesOfFreedom >= 0)
        || !(dragging ? drag !== undefined && Number.isFinite(targetDistance) && targetDistance >= 0 : Number.isNaN(dragged) && Number.isNaN(targetDistance)))
        throw new Error('The native sketch solver returned an invalid result.');
      exports.buffer_free(pointer, input.length);
      exports.buffer_free(output, length);
      return { status: kind, iterations, residual, values, diagnosis: diagnosis === 'diagnosed'
        ? { kind: diagnosis, degreesOfFreedom: Number.isNaN(degreesOfFreedom) ? null : degreesOfFreedom, labels }
        : diagnosis === 'unavailable' ? { kind: diagnosis } : { kind: diagnosis, labels },
        ...drag === undefined ? {} : { drag: { outcome: drag, targetDistance } } };
    } catch (error) {
      // A trap anywhere, including allocation or freeing, can leave the allocator inconsistent, and an
      // invalid result means the module cannot be trusted: nothing more is freed and the instance never
      // runs again.
      stopped = true;
      throw error;
    }
  } };
}
