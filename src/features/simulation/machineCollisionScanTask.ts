import type { SimulationPlan } from '@/domain/simulation';
import { createMachineCollisionIndex, placeMachineModel, scanSimulationMachineCollisions,
  type MachineModel, type MachinePlacement, type MachineSimulationScan } from '@/domain/simulation/machine-import';

export interface MachineCollisionScanRequest {
  readonly plan: SimulationPlan;
  readonly model: MachineModel;
  readonly placement: MachinePlacement;
}
export type MachineCollisionScanResponse = { readonly ok: true; readonly result: MachineSimulationScan }
  | { readonly ok: false; readonly message: string };

/** Shared worker/non-browser operation; placement and indexing are part of the cancellable task. */
export async function runMachineCollisionScan(
  request: MachineCollisionScanRequest, signal?: AbortSignal
): Promise<MachineCollisionScanResponse> {
  signal?.throwIfAborted();
  const placed = placeMachineModel(request.model, request.placement);
  if (!placed.ok) return { ok: false, message: placed.error.message };
  signal?.throwIfAborted();
  const index = createMachineCollisionIndex(placed.model);
  signal?.throwIfAborted();
  return { ok: true, result: await scanSimulationMachineCollisions(request.plan, index, { signal }) };
}
