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
   * nearest; `limited`: stopped short where the drag ended, at the nearest feasible point found
   * that is no more singular than its start, as a landing exactly on a tangency would be; `stalled`:
   * none of these. A stalled drag that is `converged` stopped at the last feasible values it found,
   * stepped back as a limited one so they are no more singular than its start; nothing shows they
   * are as close as the target can be reached. `targetDistance` is the Euclidean distance from the
   * values to every target, in millimetres.
   */
  readonly drag?: { readonly outcome: CadSketchNativeDragOutcome; readonly targetDistance: number };
}

export type CadSketchNativeDragOutcome = 'reached' | 'projected' | 'stalled' | 'limited';

/**
 * Rank diagnosis at the returned values; when groups are diagnosed differently, the sketch takes the
 * most severe kind, in the order diagnosed, uncertain, incomplete, from-start, suspected,
 * no-unknowns, unavailable. `suspected`: a group that did not converge stalled short of a collapsed
 * nearest point and was diagnosed with a looser dependence distance, so its conflicts are suspected
 * rather than certain and freedom is unknown. `from-start`: a group that did not converge is blamed
 * instead for relations that are the same function of the same values up to their value and sign,
 * as repeated dimensions are, held at values that cannot agree, as PlaneGCS saw at its start; they
 * conflict at every point, even where the stall cannot be diagnosed. Angles, whose residuals wrap,
 * are left out, and other conflicts may exist where the solve stopped. `uncertain`: a converged
 * group's rank was too close to call, as near a tangency, so its labels are the dependencies found
 * but more may exist, and freedom is unknown. `incomplete`: a converged group ran out of work, or
 * was too large to factor, before it was diagnosed, so it labels nothing and freedom is unknown;
 * other groups are labelled as usual. `no-unknowns`: nothing can move, so only relations that are
 * not met are labelled, as conflicting. `unavailable`: some group was too large, or one that did not
 * converge could not be diagnosed reliably or within its work.
 */
export type CadSketchNativeDiagnosis =
  | { readonly kind: 'diagnosed'; readonly degreesOfFreedom: number | null; readonly labels: readonly number[] }
  | { readonly kind: 'suspected' | 'from-start' | 'uncertain' | 'incomplete' | 'no-unknowns'; readonly labels: readonly number[] }
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
const DIAGNOSES = ['diagnosed', 'unavailable', 'no-unknowns', 'suspected', 'uncertain', 'from-start', 'incomplete'] as const;
const DRAG_OUTCOMES = ['reached', 'projected', 'stalled', 'limited'] as const;
const HEADER = 9;

/** Loads the Rust solver from bytes, or from a URL (by default the bundled module asset). */
export async function loadCadSketchNativeSolver(source?: BufferSource | WebAssembly.Module | string | URL, observeMemory?: (memory: WebAssembly.Memory) => void): Promise<CadSketchNativeSolver> {
  // Explicit byte callers, including the Node benchmark, do not need a bundler asset loader.
  source ??= (await import('../../../../../packages/sketch-solver/wasm/sketch_solver.wasm?url')).default;
  const bytes = typeof source === 'string' || source instanceof URL ? await (await fetch(source)).arrayBuffer() : source;
  const instance = bytes instanceof WebAssembly.Module ? await WebAssembly.instantiate(bytes, {}) : (await WebAssembly.instantiate(bytes, {})).instance;
  const exports = instance.exports;
  if (!isExports(exports)) throw new CadSketchNativeProtocolError('The native sketch solver module has unexpected exports.');
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
        // Only a group that did not converge is blamed for repeated relations.
        || diagnosis === 'from-start' && kind !== 'not-converged'
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
