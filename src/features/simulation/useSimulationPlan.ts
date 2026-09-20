import { useEffect, useState } from 'react';
import type { PathPlanningDocument } from '@/domain/path-intel/types';
import type { SimulationCompileResult, SimulationSettings } from '@/domain/simulation';
import { compileSimulationAsync } from './simulationCompiler';

export function useSimulationPlan(document: PathPlanningDocument, settings: SimulationSettings) {
  const [state, setState] = useState<{ document: PathPlanningDocument; settings: SimulationSettings; result: SimulationCompileResult } | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); setState(null);
    void compileSimulationAsync(document, settings, controller.signal).then(result => {
      if (!controller.signal.aborted) setState({ document, settings, result });
    }).catch(() => {
      if (!controller.signal.aborted) setState({ document, settings, result: { ok: false, diagnostics: [{
        code: 'SIMULATION_COMPILE_FAILED', severity: 'error', operationId: null,
        message: 'Simulation preparation failed. Try again or review the saved process.'
      }] } });
    });
    return () => controller.abort();
  }, [document, settings, attempt]);
  return { result: state?.document === document && state?.settings === settings ? state.result : null,
    retry: () => setAttempt(value => value + 1) };
}
