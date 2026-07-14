import { machineProfileHasCurrentVerification } from '@/domain/machine/machineProfiles';
import type { PathDiagnostic, PathOperation, PathPlanningDocument } from '@/domain/path-intel/types';
import {
  inspectTemplateModalState,
  validateTemplateModalPolicy
} from '@/domain/post/templateModalPolicy';
import {
  robofilV2PostEnvelopeIsReady,
  verifiedRobofilPostEnvelopeIsReady
} from '@/domain/post/verifiedRobofilPostEnvelope';
import type { MachineProfile } from '@/domain/workbench/types';

import {
  generateLinearCompensationTransition,
  type LinearTransitionBlockedReason,
  type LinearTransitionResult
} from './linearTransitionGeometry';
import {
  resolveControllerCompensation,
  type CompensationResolution
} from './resolveControllerCompensation';
import { validateRobofilV2OperationLead } from './robofilV2LeadValidation';

export interface ValidateCompensatedExportInput {
  document: PathPlanningDocument;
  operation: PathOperation;
  machine: MachineProfile;
}

export type CompensatedExportBlockedReason =
  | 'unsupported-machine-profile'
  | 'invalid-offset-selection'
  | 'unverified-machine-profile'
  | 'units-mode-conflict'
  | 'compensation-resolution-blocked'
  | 'template-modal-conflict'
  | 'unsafe-radial-lead'
  | 'unsafe-controller-compensation-lead-in'
  | 'unsupported-generic-post-envelope'
  | 'unsupported-robofil-post-envelope'
  | 'unsupported-operation-count'
  | 'unsupported-compensation-lifecycle'
  | LinearTransitionBlockedReason;

export type CompensatedExportReadiness =
  | {
      status: 'ready';
      strategy: 'explicit-linear' | 'controller-native';
      resolution: Extract<CompensationResolution, { status: 'ready' }>;
      transition: Extract<LinearTransitionResult, { status: 'ready' }> | null;
      diagnostics: [];
    }
  | {
      status: 'blocked';
      reason: CompensatedExportBlockedReason;
      diagnostics: PathDiagnostic[];
    };

export function validateCompensatedExport({
  document,
  operation,
  machine
}: ValidateCompensatedExportInput): CompensatedExportReadiness {
  if (!machine.compensation.supported) {
    return blocked('unsupported-machine-profile', 'The selected machine profile does not support controller compensation.');
  }
  const dIndex = machine.compensation.offsetSelection.index;
  if (
    machine.compensation.offsetSelection.address !== 'D' ||
    !Number.isSafeInteger(dIndex) ||
    dIndex < 0
  ) {
    return blocked('invalid-offset-selection', 'Controller compensation requires a valid non-negative D-table index.');
  }
  if (!machineProfileHasCurrentVerification(machine)) {
    return blocked('unverified-machine-profile', 'Controller compensation requires a current user-verified machine snapshot.');
  }
  if (machine.controller.unitsCode === 'G20') {
    return blocked('units-mode-conflict', 'G20 cannot be emitted while UPID coordinates are posted in millimetres.');
  }
  const resolution = resolveControllerCompensation({ document, operation });
  if (resolution.status === 'blocked') {
    return blocked(
      'compensation-resolution-blocked',
      `Controller compensation could not be resolved: ${resolution.reason}.`,
      { compensationReason: resolution.reason }
    );
  }
  const templatePolicy = validateTemplateModalPolicy({
    machine,
    header: machine.templates.header,
    footer: machine.templates.footer
  });
  if (!templatePolicy.valid) {
    return blocked(
      'template-modal-conflict',
      templatePolicy.diagnostics.map((diagnostic) => diagnostic.message).join(' '),
      { templateDiagnostics: templatePolicy.diagnostics }
    );
  }
  if (machine.compensation.activation === 'charmilles-g38') {
    if (robofilV2PostEnvelopeIsReady(machine)) {
      if (!document.plan.operations.some((candidate) => candidate.id === operation.id)) {
        return blocked(
          'unsupported-operation-count',
          'The selected operation is not part of the operation-scoped Robofil v2 plan.'
        );
      }
      const leadValidation = validateRobofilV2OperationLead(
        document,
        operation,
        machine.output.coordinatePrecision
      );
      if (!leadValidation.valid) {
        return blocked('unsafe-controller-compensation-lead-in', leadValidation.message);
      }
      return {
        status: 'ready',
        strategy: 'controller-native',
        resolution,
        transition: null,
        diagnostics: []
      };
    }
    if (!verifiedRobofilPostEnvelopeIsReady(machine)) {
      return blocked(
        'unsupported-robofil-post-envelope',
        'This native transition is outside the supported Robofil post envelope.'
      );
    }
    if (operation.overrides?.leadIn?.source === 'circle-center') {
      return blocked('unsafe-radial-lead', 'A circle-center radial lead is unsafe under controller compensation.');
    }
    if (
      document.plan.operations.length !== 1 ||
      document.plan.operations[0]?.id !== operation.id
    ) {
      return blocked(
        'unsupported-operation-count',
        'The verified program-scoped Robofil lifecycle supports exactly one compensated operation.'
      );
    }
    return {
      status: 'ready',
      strategy: 'controller-native',
      resolution,
      transition: null,
      diagnostics: []
    };
  }

  if (operation.overrides?.leadIn?.source === 'circle-center') {
    return blocked('unsafe-radial-lead', 'A circle-center radial lead is unsafe under controller compensation.');
  }

  if (
    machine.compensation.activation !== 'linear-lead' ||
    machine.compensation.cancellation !== 'linear-lead-out' ||
    machine.compensation.lifecycleScope !== 'operation'
  ) {
    return blocked('unsupported-compensation-lifecycle', 'Explicit linear compensation requires operation-scoped linear activation and cancellation.');
  }
  if (!matchesGenericExplicitLinearEnvelope(machine)) {
    return blocked(
      'unsupported-generic-post-envelope',
      'This generic snapshot is outside the supported explicit-linear post-version-1 envelope.'
    );
  }

  const transition = generateLinearCompensationTransition({
    document,
    operation,
    leadLengthMm: machine.compensation.validationLeadLengthMm,
    expectedMaximumOffsetMm: machine.compensation.expectedMaximumOffsetMm,
    coordinatePrecision: machine.output.coordinatePrecision,
    workArea: machine.workArea
  });
  if (transition.status === 'blocked') {
    return blocked(transition.reason, `Controller compensation transition is unsafe: ${transition.reason}.`);
  }
  return {
    status: 'ready',
    strategy: 'explicit-linear',
    resolution,
    transition,
    diagnostics: []
  };
}

function matchesGenericExplicitLinearEnvelope(machine: MachineProfile) {
  const templateModalState = inspectTemplateModalState(machine.templates.header);
  return (
    (machine.controller.family === 'generic-iso' || machine.controller.family === 'custom') &&
    machine.controller.postVersion === 1 &&
    machine.controller.blockFormatting === 'spaced' &&
    machine.controller.coordinateSystem === 'template-managed' &&
    machine.controller.unitsCode === 'omit' &&
    machine.controller.planeCode === 'omit' &&
    machine.controller.workOffsetCode === 'template-managed' &&
    machine.controller.programEnd === 'template-managed' &&
    machine.compensation.preActivationCodes.length === 0 &&
    templateModalState.hasExplicitXyMode &&
    templateModalState.xyMode === 'absolute' &&
    templateModalState.ijMode ===
      (machine.controller.arcCenterMode === 'absolute' ? 'absolute' : 'incremental')
  );
}

function blocked(
  reason: CompensatedExportBlockedReason,
  message: string,
  details: Record<string, unknown> = {}
): Extract<CompensatedExportReadiness, { status: 'blocked' }> {
  return {
    status: 'blocked' as const,
    reason,
    diagnostics: [
      {
        id: 'diag_compensated_export_0001',
        severity: 'error' as const,
        code: 'post-invalid-input' as const,
        message,
        details: { reason, ...details }
      }
    ]
  };
}
