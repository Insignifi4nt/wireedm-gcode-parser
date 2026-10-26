/** Stages of one public sketch solve, observed by benchmarks only. */
export type CadSketchSolverTimingStage = 'parseCompile' | 'nativeCall' | 'mapping' | 'validation';
export type CadSketchSolverStageObserver = (stage: CadSketchSolverTimingStage, elapsedMs: number) => void;

/**
 * Charges elapsed time to the current stage at each change, and `during` charges one call to a stage
 * before resuming the previous one. Without an observer it reads no clock.
 */
export function cadSketchSolverStageClock(observe: CadSketchSolverStageObserver | undefined, stage: CadSketchSolverTimingStage) {
  let started = observe ? performance.now() : 0;
  const charge = () => {
    if (!observe) return;
    const now = performance.now();
    observe(stage, now - started);
    started = now;
  };
  return {
    next(value: CadSketchSolverTimingStage) { charge(); stage = value; },
    during<T>(value: CadSketchSolverTimingStage, work: () => T): T {
      if (!observe) return work();
      const previous = stage;
      charge(); stage = value;
      try { return work(); } finally { charge(); stage = previous; }
    },
    stop: charge
  };
}
