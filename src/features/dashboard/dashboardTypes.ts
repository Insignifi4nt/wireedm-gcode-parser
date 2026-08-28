import type {
  DxfImportPreparationResult,
  DxfImportPreviewResult
} from '@/domain/dxf/prepareDxfProjectImport';
import type { MachineDefinition } from '@/domain/machine-definition/machineDefinition';
import type { PhysicalMachineFitResult } from '@/domain/machine-definition/machineFit';

export type EvaluatedPhysicalMachineFitResult = Exclude<
  PhysicalMachineFitResult,
  { readonly ok: true; readonly fit: { readonly status: 'not-evaluated' } }
>;

export interface ResolvedPlanningMachineFit {
  readonly machine: Pick<MachineDefinition, 'id' | 'name'>;
  readonly result: EvaluatedPhysicalMachineFitResult;
}

export interface PendingDashboardDxfImport {
  readonly declaredUnitOverrideAcknowledged: boolean;
  readonly planningMachineFit: ResolvedPlanningMachineFit | null;
  readonly preparationResult: DxfImportPreparationResult;
  readonly previewResult: DxfImportPreviewResult | null;
  readonly selectedUnitCandidateId: string | null;
}
