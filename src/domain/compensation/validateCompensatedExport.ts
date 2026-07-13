import { machineProfileVerificationFingerprint } from '@/domain/machine/machineProfiles';
import type { PathDiagnostic, PathOperation, PathPlanningDocument } from '@/domain/path-intel/types';
import { validateTemplateModalPolicy } from '@/domain/post/templateModalPolicy';
import type { MachineProfile } from '@/domain/workbench/types';

import {
  generateLinearCompensationTransition,
  type LinearTransitionResult
} from './linearTransitionGeometry';
import {
  resolveControllerCompensation,
  type CompensationResolution
} from './resolveControllerCompensation';

export interface ValidateCompensatedExportInput {
  document: PathPlanningDocument;
  operation: PathOperation;
  machine: MachineProfile;
}

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
      reason: string;
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
  const verification = machine.controller.verification;
  if (
    verification.status !== 'user-verified' ||
    verification.verifiedFingerprint !== machineProfileVerificationFingerprint(machine)
  ) {
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
  if (operation.overrides?.leadIn?.source === 'circle-center') {
    return blocked('unsafe-radial-lead', 'A circle-center radial lead is unsafe under controller compensation.');
  }

  if (machine.compensation.activation === 'charmilles-g38') {
    const validNativeLifecycle =
      machine.controller.family === 'charmilles-robofil-classic' &&
      ((machine.compensation.lifecycleScope === 'program' &&
        machine.compensation.cancellation === 'program-end') ||
        (machine.compensation.lifecycleScope === 'operation' &&
          machine.compensation.cancellation === 'charmilles-g39'));
    return validNativeLifecycle
      ? { status: 'ready', strategy: 'controller-native', resolution, transition: null, diagnostics: [] }
      : blocked('unsupported-compensation-lifecycle', 'The native controller transition lifecycle is inconsistent.');
  }

  if (
    machine.compensation.activation !== 'linear-lead' ||
    machine.compensation.cancellation !== 'linear-lead-out' ||
    machine.compensation.lifecycleScope !== 'operation'
  ) {
    return blocked('unsupported-compensation-lifecycle', 'Explicit linear compensation requires operation-scoped linear activation and cancellation.');
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

function blocked(reason: string, message: string, details: Record<string, unknown> = {}) {
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
