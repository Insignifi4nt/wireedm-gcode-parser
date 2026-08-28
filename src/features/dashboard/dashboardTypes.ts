import type {
  DxfImportPreparationResult,
  DxfImportPreviewResult
} from '@/domain/dxf/prepareDxfProjectImport';
import type { MachineDefinition } from '@/domain/machine-definition/machineDefinition';
import type { PhysicalMachineFitResult } from '@/domain/machine-definition/machineFit';

type SuccessfulPhysicalMachineFit = Extract<PhysicalMachineFitResult, { readonly ok: true }>;

export type EvaluatedPhysicalMachineFitResult =
  | Extract<PhysicalMachineFitResult, { readonly ok: false }>
  | {
      readonly ok: true;
      readonly fit: Exclude<
        SuccessfulPhysicalMachineFit['fit'],
        { readonly status: 'not-evaluated' }
      >;
    };

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
