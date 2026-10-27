import type { CadSketchSolveInput, CadSketchSolveResult } from './cadSketchSolverTypes';
import { parseCadSketchSolveInput } from './cadSketchSolverProtocol';
import { cadSketchSolverStageClock, type CadSketchSolverStageObserver } from './cadSketchSolverStages';
import { attemptCadSketchNativeSolve, type CadSketchNativeAttempt, type CadSketchNativeFallbackReason } from './native/cadSketchNativeAttempt';
import { CadSketchNativeProtocolError, type CadSketchNativeSolution, type CadSketchNativeSolver } from './native/cadSketchNativeSolver';

/** `planegcs` and `native-only` exist for comparisons in tests and benchmarks; the app uses `native-first`. */
export type CadSketchSolverMode = 'native-first' | 'planegcs' | 'native-only';

export interface CadSketchSolverBackend {
  solve(input: CadSketchSolveInput): Promise<CadSketchSolveResult>;
}

/** How one solve was answered, for tests and benchmarks only. */
export interface CadSketchSolveRecord {
  readonly answeredBy: 'native' | 'planegcs';
  /** Native's own outcome: an answer, the reason it fell back, or that it could not run. */
  readonly native?: 'answer' | CadSketchNativeFallbackReason | 'load-failed' | 'failed';
  /** PlaneGCS's outcome when it was asked: `solved`, its rejection reason, or `threw`. */
  readonly planeGcs?: 'solved' | Extract<CadSketchSolveResult, { kind: 'rejected' }>['reason'] | 'threw';
  readonly movedGroups?: number;
  readonly keptGroups?: number;
  /** Native's drag outcome and remaining distance to the target, when it ran on a drag. */
  readonly drag?: CadSketchNativeSolution['drag'];
  /** Why the native instance was dropped after this solve; the next solve creates a fresh one. */
  readonly nativeReset?: 'failure' | 'memory';
  readonly nativeMs?: number;
  readonly planeGcsMs?: number;
}

/** A native instance holding more memory than this is replaced after its solve. */
export const CAD_SKETCH_NATIVE_MEMORY_LIMIT_BYTES = 64 * 1024 * 1024;

/**
 * Solves with the native solver first and asks PlaneGCS only when native cannot answer: compilation
 * it refuses, load failure, a failed instance, too large groups, unavailable or suspected
 * diagnosis, conflicts blamed as a stalled sketch's start shows, a group not diagnosed, unknown
 * freedom, no convergence, a stalled drag, a drag diagnosed as conflicting or redundant where it
 * ended, or a solution that moves fixed values or fails the graph checks. A converged sketch whose
 * rank is too close to call, as near a tangency, is answered natively with freedom unknown. PlaneGCS
 * loads on first use. When native has its own result, a rejection, a solution with freedom unknown
 * or the frame where a drag stalled at feasible values, PlaneGCS's answer replaces it only if it
 * solves or names definite conflicts or redundancies; `native-only` returns native's own result.
 */
export function createCadSketchNativeFirstRuntime(options: {
  readonly loadNative: () => Promise<CadSketchNativeSolver>;
  readonly loadPlaneGcs: () => Promise<CadSketchSolverBackend>;
  readonly mode?: CadSketchSolverMode;
  readonly memoryLimitBytes?: number;
  readonly onSolve?: (record: CadSketchSolveRecord) => void;
  /** Benchmark observer of native stages; PlaneGCS's backend observes its own. */
  readonly onStageTiming?: CadSketchSolverStageObserver;
}): CadSketchSolverBackend {
  const mode = options.mode ?? 'native-first', memoryLimit = options.memoryLimitBytes ?? CAD_SKETCH_NATIVE_MEMORY_LIMIT_BYTES;
  let native: Promise<CadSketchNativeSolver> | undefined, nativeLoadFailed = false, planeGcs: Promise<CadSketchSolverBackend> | undefined;
  let queue: Promise<unknown> = Promise.resolve();
  // One solve at a time, so instance replacement never races a solve.
  const exclusive = <T>(work: () => Promise<T>): Promise<T> => { const run = queue.then(work); queue = run.catch(() => undefined); return run; };
  const nativeSolver = async () => {
    if (nativeLoadFailed) return undefined;
    native ??= options.loadNative();
    try { return await native; } catch { nativeLoadFailed = true; native = undefined; return undefined; }
  };
  const planeGcsBackend = () => planeGcs ??= options.loadPlaneGcs().catch(error => { planeGcs = undefined; throw error; });

  async function run(input: CadSketchSolveInput): Promise<CadSketchSolveResult> {
    const record: { -readonly [Key in keyof CadSketchSolveRecord]: CadSketchSolveRecord[Key] } = { answeredBy: 'planegcs' };
    try {
      let attempt: CadSketchNativeAttempt | undefined;
      if (mode !== 'planegcs') {
        const started = performance.now(), solver = await nativeSolver();
        if (!solver) record.native = 'load-failed';
        else {
          try { attempt = attemptCadSketchNativeSolve(input, solver, options.onStageTiming); } catch (error) {
            record.native = 'failed'; record.nativeReset = 'failure'; native = undefined;
            // Every instance of a module speaking another protocol fails the same way.
            if (error instanceof CadSketchNativeProtocolError) nativeLoadFailed = true;
          }
          if (!record.nativeReset && solver.memoryBytes() > memoryLimit) { record.nativeReset = 'memory'; native = undefined; }
        }
        record.nativeMs = performance.now() - started;
        if (attempt) record.native = attempt.kind === 'answer' ? 'answer' : attempt.reason;
        if (attempt?.drag) record.drag = attempt.drag;
        if (attempt?.kind === 'answer') {
          record.answeredBy = 'native'; record.movedGroups = attempt.movedGroups; record.keptGroups = attempt.keptGroups;
          return attempt.result;
        }
      }
      // Compilation is PlaneGCS's to answer outright while both solvers exist.
      const own = attempt?.kind === 'fallback' && attempt.reason !== 'compile' ? attempt.own : undefined;
      if (mode === 'native-only') {
        record.answeredBy = 'native';
        return (attempt?.kind === 'fallback' ? attempt.own : undefined) ?? { kind: 'rejected', reason: 'failed', message: 'The native sketch solver is unavailable.',
          diagnostics: { status: null, degreesOfFreedom: null, conflictingIds: [], redundantIds: [], partiallyRedundantIds: [], issues: [] } };
      }
      const started = performance.now();
      let result: CadSketchSolveResult;
      try { result = await (await planeGcsBackend()).solve(input); } catch (error) {
        record.planeGcs = 'threw';
        if (own) { record.answeredBy = 'native'; return own; }
        throw error;
      } finally { record.planeGcsMs = performance.now() - started; }
      record.planeGcs = result.kind === 'solved' ? 'solved' : result.reason;
      if (!own || result.kind === 'solved' || result.reason === 'conflicting' || result.reason === 'redundant') return result;
      record.answeredBy = 'native';
      return own;
    } finally { options.onSolve?.(record); }
  }

  return { solve(source) {
    // Parsed before any wait, so later changes to the caller's input reach neither solver.
    let input: CadSketchSolveInput;
    const clock = cadSketchSolverStageClock(options.onStageTiming, 'parseCompile');
    try { input = parseCadSketchSolveInput(source); } catch (error) {
      return Promise.resolve({ kind: 'rejected', reason: 'invalid-input', message: error instanceof Error ? error.message : 'Invalid sketch input.',
        diagnostics: { status: null, degreesOfFreedom: null, conflictingIds: [], redundantIds: [], partiallyRedundantIds: [], issues: [] } });
    } finally { clock.stop(); }
    return exclusive(() => run(input));
  } };
}
