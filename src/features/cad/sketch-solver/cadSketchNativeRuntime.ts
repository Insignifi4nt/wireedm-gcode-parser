import type { CadSketchSolveDiagnostics, CadSketchSolveInput, CadSketchSolveResult } from './cadSketchSolverTypes';
import { parseCadSketchSolveInput } from './cadSketchSolverProtocol';
import { CAD_SKETCH_NATIVE_INCOMPATIBLE, CAD_SKETCH_NATIVE_LOAD_FAILED } from './cadSketchSolverMessages';
import { cadSketchSolverStageClock, type CadSketchSolverStageObserver } from './cadSketchSolverStages';
import { attemptCadSketchNativeSolve, type CadSketchNativeAttempt, type CadSketchNativeReason } from './native/cadSketchNativeAttempt';
import { CadSketchNativeProtocolError, type CadSketchNativeSolution, type CadSketchNativeSolver } from './native/cadSketchNativeSolver';

export interface CadSketchSolverBackend {
  solve(input: CadSketchSolveInput): Promise<CadSketchSolveResult>;
}

/** How one solve was answered, for tests and benchmarks only. */
export interface CadSketchSolveRecord {
  /**
   * `answer`: native's answer at its most certain; a reason: native's own answer to what it cannot
   * be certain of (see `CadSketchNativeReason`); `load-failed`: no instance could be loaded;
   * `incompatible`: the module speaks another protocol; `failed`: the instance trapped or returned
   * an invalid result, also on a fresh instance when a used one failed first.
   */
  readonly native: 'answer' | CadSketchNativeReason | 'load-failed' | 'incompatible' | 'failed';
  /** Load attempts this solve made, when it had to load an instance. */
  readonly loadAttempts?: number;
  readonly movedGroups?: number;
  readonly keptGroups?: number;
  /** Native's drag outcome and remaining distance to the target, when it ran on a drag. */
  readonly drag?: CadSketchNativeSolution['drag'];
  /** Why the native instance was dropped after this solve; the next solve creates a fresh one. */
  readonly nativeReset?: 'failure' | 'memory';
  readonly nativeMs?: number;
}

/** A native instance holding more memory than this is replaced after its solve. */
export const CAD_SKETCH_NATIVE_MEMORY_LIMIT_BYTES = 64 * 1024 * 1024;
/** Waits before the second and third attempt to load an instance within one solve. */
export const CAD_SKETCH_NATIVE_LOAD_RETRY_DELAYS_MS = [250, 1000] as const;
/** After a solve failed to load an instance, later solves within this long fail without loading again. */
export const CAD_SKETCH_NATIVE_LOAD_RETRY_INTERVAL_MS = 1000;
export const CAD_SKETCH_NATIVE_FAILED = 'The sketch solver failed on this sketch.';

const noDiagnostics = (): CadSketchSolveDiagnostics => ({ status: null, degreesOfFreedom: null, conflictingIds: [], redundantIds: [], partiallyRedundantIds: [], issues: [] });
const failed = (message: string): CadSketchSolveResult => ({ kind: 'rejected', reason: 'failed', message, diagnostics: noDiagnostics() });
/** The rejection of a solve that could not load an instance. */
const unloaded = (record: CadSketchSolveRecord) => failed(record.native === 'incompatible' ? CAD_SKETCH_NATIVE_INCOMPATIBLE : CAD_SKETCH_NATIVE_LOAD_FAILED);

/**
 * An instance that cannot speak this app's protocol: another protocol version, or a module whose
 * exports or imports are not the solver's. Every instance of the same module fails the same way.
 */
const incompatible = (error: unknown) => error instanceof CadSketchNativeProtocolError || error instanceof WebAssembly.LinkError;

/**
 * Solves with the native solver, one solve at a time. Every answer is native's own: what it cannot
 * be certain of, as a drag diagnosed where it ended or a stalled sketch blamed as its start shows,
 * it still answers, with the reason recorded. An instance loads on first use; a solve that cannot
 * load one tries three times, waiting 250 ms and then 1 s, and is rejected as failed when all three
 * fail. Solves within a second of that fail at once, so a drag does not wait on every frame, and the
 * next solve after it tries again. A module speaking another protocol is never loaded again: the
 * page must be reloaded. An instance that traps or returns an invalid result is dropped; on an
 * instance that had already solved, the input is solved once more on a fresh one, as an earlier
 * solve may have left it inconsistent. An instance holding more than `memoryLimitBytes` is replaced
 * after its solve.
 */
export function createCadSketchNativeRuntime(options: {
  readonly loadNative: () => Promise<CadSketchNativeSolver>;
  readonly memoryLimitBytes?: number;
  readonly onSolve?: (record: CadSketchSolveRecord) => void;
  /** Benchmark observer of native stages. */
  readonly onStageTiming?: CadSketchSolverStageObserver;
  /** Clock and wait for load retries, injected by tests. */
  readonly now?: () => number;
  readonly wait?: (ms: number) => Promise<void>;
}): CadSketchSolverBackend {
  const memoryLimit = options.memoryLimitBytes ?? CAD_SKETCH_NATIVE_MEMORY_LIMIT_BYTES;
  const now = options.now ?? (() => performance.now());
  const wait = options.wait ?? (ms => new Promise<void>(resolve => { setTimeout(resolve, ms); }));
  /** The current instance and whether it has solved before. */
  let native: { readonly solver: CadSketchNativeSolver; used: boolean } | undefined;
  let incompatibleModule = false, loadFailedAt: number | undefined;
  let queue: Promise<unknown> = Promise.resolve();
  // One solve at a time, so instance replacement never races a solve.
  const exclusive = <T>(work: () => Promise<T>): Promise<T> => { const run = queue.then(work); queue = run.catch(() => undefined); return run; };

  /** The current instance, loading one when there is none; undefined when none can be loaded. */
  async function instance(record: Writable<CadSketchSolveRecord>) {
    if (native) return native;
    if (incompatibleModule) { record.native = 'incompatible'; return undefined; }
    if (loadFailedAt !== undefined && now() - loadFailedAt < CAD_SKETCH_NATIVE_LOAD_RETRY_INTERVAL_MS) { record.native = 'load-failed'; record.loadAttempts = 0; return undefined; }
    for (let attempt = 0; attempt <= CAD_SKETCH_NATIVE_LOAD_RETRY_DELAYS_MS.length; attempt++) {
      if (attempt) await wait(CAD_SKETCH_NATIVE_LOAD_RETRY_DELAYS_MS[attempt - 1]);
      record.loadAttempts = attempt + 1;
      try {
        native = { solver: await options.loadNative(), used: false };
        loadFailedAt = undefined;
        return native;
      } catch (error) {
        if (incompatible(error)) { incompatibleModule = true; record.native = 'incompatible'; return undefined; }
      }
    }
    loadFailedAt = now();
    record.native = 'load-failed';
    return undefined;
  }

  /** Native's attempt on the current instance, or undefined when it failed and was dropped. */
  function attempt(input: CadSketchSolveInput, current: NonNullable<typeof native>, record: Writable<CadSketchSolveRecord>) {
    try { return attemptCadSketchNativeSolve(input, current.solver, options.onStageTiming); } catch (error) {
      record.native = 'failed'; record.nativeReset = 'failure'; native = undefined;
      if (incompatible(error)) { incompatibleModule = true; record.native = 'incompatible'; }
      return undefined;
    } finally { current.used = true; }
  }

  async function run(input: CadSketchSolveInput): Promise<CadSketchSolveResult> {
    const record: Writable<CadSketchSolveRecord> = { native: 'failed' };
    const started = now();
    try {
      let current = await instance(record);
      if (!current) return unloaded(record);
      const reused = current.used;
      let result: CadSketchNativeAttempt | undefined = attempt(input, current, record);
      if (!result && reused && record.native === 'failed') {
        current = await instance(record);
        if (!current) return unloaded(record);
        record.native = 'failed';
        result = attempt(input, current, record);
      }
      if (!result) return failed(record.native === 'incompatible' ? CAD_SKETCH_NATIVE_INCOMPATIBLE : CAD_SKETCH_NATIVE_FAILED);
      if (current.solver.memoryBytes() > memoryLimit) { record.nativeReset ??= 'memory'; native = undefined; }
      record.native = result.reason ?? 'answer';
      if (result.drag) record.drag = result.drag;
      if (result.movedGroups !== undefined) { record.movedGroups = result.movedGroups; record.keptGroups = result.keptGroups; }
      return result.result;
    } finally {
      record.nativeMs = now() - started;
      options.onSolve?.(record);
    }
  }

  return { solve(source) {
    // Parsed before any wait, so later changes to the caller's input never reach the solver.
    let input: CadSketchSolveInput;
    const clock = cadSketchSolverStageClock(options.onStageTiming, 'parseCompile');
    try { input = parseCadSketchSolveInput(source); } catch (error) {
      return Promise.resolve({ kind: 'rejected', reason: 'invalid-input', message: error instanceof Error ? error.message : 'Invalid sketch input.', diagnostics: noDiagnostics() });
    } finally { clock.stop(); }
    return exclusive(() => run(input));
  } };
}

type Writable<T> = { -readonly [Key in keyof T]: T[Key] };
