import type { WireEdmExecutionPlan } from '@/domain/execution-plan/executionPlan';

import type { WireEdmPostPackage } from './postPackageSchema';

export type PostCapabilityDiagnosticCode =
  | 'POST_CAPABILITY_ARC_DIRECTION_UNSUPPORTED'
  | 'POST_CAPABILITY_COMPENSATION_UNSUPPORTED'
  | 'POST_CAPABILITY_OPERATION_COUNT_UNSUPPORTED'
  | 'POST_CAPABILITY_PROGRAM_STOPS_UNSUPPORTED'
  | 'POST_CAPABILITY_THREADING_UNSUPPORTED'
  | 'POST_CAPABILITY_WIRE_SEPARATION_UNSUPPORTED'
  | 'POST_CAPABILITY_INITIAL_WIRE_POSITION_UNSUPPORTED';

export interface PostCapabilityDiagnostic {
  readonly code: PostCapabilityDiagnosticCode;
  readonly message: string;
}

export function preflightPostCapabilities(
  plan: WireEdmExecutionPlan,
  packageValue: WireEdmPostPackage
): readonly PostCapabilityDiagnostic[] {
  const capabilities = packageValue.manifest.capabilities;
  const diagnostics: PostCapabilityDiagnostic[] = [];
  for (const direction of plan.requirements.circularInterpolation) {
    if (supportsArcDirection(capabilities.circularInterpolation, direction)) continue;
    diagnostics.push({
      code: 'POST_CAPABILITY_ARC_DIRECTION_UNSUPPORTED',
      message: `${packageValue.manifest.name} does not support ${direction} circular interpolation required by the execution plan.`
    });
  }
  if (
    plan.requirements.controllerCompensation &&
    capabilities.controllerCompensation !== 'left-right'
  ) {
    diagnostics.push({
      code: 'POST_CAPABILITY_COMPENSATION_UNSUPPORTED',
      message: `${packageValue.manifest.name} cannot emit the execution plan's controller-compensation intent.`
    });
  }
  if (plan.requirements.operationCount > 1 && capabilities.operations !== 'multiple') {
    diagnostics.push({
      code: 'POST_CAPABILITY_OPERATION_COUNT_UNSUPPORTED',
      message: `${packageValue.manifest.name} supports one operation, but the execution plan contains ${plan.requirements.operationCount}.`
    });
  }
  if (plan.requirements.programStops && !capabilities.programStops) {
    diagnostics.push({
      code: 'POST_CAPABILITY_PROGRAM_STOPS_UNSUPPORTED',
      message: `${packageValue.manifest.name} cannot emit required operator stops.`
    });
  }
  for (const method of plan.requirements.threading) {
    if (supportsThreading(capabilities.threading, method)) continue;
    diagnostics.push({
      code: 'POST_CAPABILITY_THREADING_UNSUPPORTED',
      message: `${packageValue.manifest.name} does not support required ${method} threading.`
    });
  }
  if (plan.requirements.wireSeparation && !capabilities.wireSeparation) {
    diagnostics.push({
      code: 'POST_CAPABILITY_WIRE_SEPARATION_UNSUPPORTED',
      message: `${packageValue.manifest.name} cannot emit required wire separation.`
    });
  }
  if (!capabilities.initialWirePosition) {
    diagnostics.push({
      code: 'POST_CAPABILITY_INITIAL_WIRE_POSITION_UNSUPPORTED',
      message: `${packageValue.manifest.name} does not declare how it consumes the required initial wire position.`
    });
  }
  return diagnostics;
}

function supportsArcDirection(
  capability: WireEdmPostPackage['manifest']['capabilities']['circularInterpolation'],
  direction: 'clockwise' | 'counterclockwise'
) {
  return capability === 'both' ||
    capability === `${direction}-only`;
}

function supportsThreading(
  capability: WireEdmPostPackage['manifest']['capabilities']['threading'],
  method: 'manual' | 'automatic'
) {
  return capability === method || capability === 'manual-and-automatic';
}
