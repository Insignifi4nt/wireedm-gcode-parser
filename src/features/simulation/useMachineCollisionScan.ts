import { useEffect, useState } from 'react';
import type { SimulationPlan } from '@/domain/simulation';
import type { MachineModel, MachineSimulationScan } from '@/domain/simulation/machine-import';
import type { SceneMachinePlacement } from './SimulationScene';
import { scanMachineCollisionsAsync } from './machineCollisionScanner';

type ScanState = { status: 'idle' } | { status: 'scanning' } | { status: 'ready'; result: MachineSimulationScan }
  | { status: 'error'; message: string };

export function useMachineCollisionScan(plan: SimulationPlan | null, model: MachineModel | null, placement: SceneMachinePlacement): ScanState {
  const [state, setState] = useState<{ plan: SimulationPlan; model: MachineModel; placement: SceneMachinePlacement; scan: ScanState } | null>(null);
  useEffect(() => {
    if (!plan || !model) { setState(null); return; }
    const controller = new AbortController();
    void scanMachineCollisionsAsync(plan, model, { translationMm: [placement.x, placement.y, placement.z], rotationZDegrees: placement.rotation }, controller.signal)
      .then(response => {
        if (!controller.signal.aborted) setState({ plan, model, placement, scan: response.ok
          ? { status: 'ready', result: response.result } : { status: 'error', message: response.message } });
      }).catch(error => {
        if (!controller.signal.aborted) setState({ plan, model, placement,
          scan: { status: 'error', message: error instanceof Error ? error.message : 'Machine surface checking failed.' } });
      });
    return () => controller.abort();
  }, [plan, model, placement]);
  if (!plan || !model) return { status: 'idle' };
  return state?.plan === plan && state.model === model && state.placement === placement ? state.scan : { status: 'scanning' };
}
