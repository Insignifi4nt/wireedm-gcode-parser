import type { MachineProfile } from '@/domain/workbench/types';

import { distance } from './segments';

import type {
  OperationThreadingTransition,
  PathPlanningDocument
} from './types';

export type OperationThreadingResolution =
  | {
      status: 'ready';
      transition: OperationThreadingTransition;
      manualStopCode?: 'M00';
      automaticBeforePositioningCodes?: string[];
      automaticAfterPositioningCodes?: string[];
    }
  | {
      status: 'blocked';
      reason:
        | 'operation-not-found'
        | 'initial-operation-has-no-rethread'
        | 'continuous-threading-invalid'
        | 'manual-threading-unsupported'
        | 'invalid-wire-separation'
        | 'automatic-threading-unsupported';
      message: string;
    };

const LEGACY_MANUAL_DEFAULT: OperationThreadingTransition = {
  mode: 'manual',
  wireSeparation: 'already-separated',
  source: 'project-default'
};

export function resolveOperationThreadingTransition(
  document: PathPlanningDocument,
  operationId: string,
  machine: MachineProfile
): OperationThreadingResolution {
  const operationIndex = document.plan.operations.findIndex(
    (operation) => operation.id === operationId
  );
  if (operationIndex < 0) {
    return blocked('operation-not-found', `Operation ${operationId} does not exist.`);
  }
  if (operationIndex === 0) {
    return blocked(
      'initial-operation-has-no-rethread',
      'The first operation uses Initial Wire Position setup, not a rethread transition.'
    );
  }

  const operation = document.plan.operations[operationIndex];
  const previous = document.plan.operations[operationIndex - 1];
  const transition = operation.threadingTransition
    ? { ...operation.threadingTransition, source: 'operation-override' as const }
    : document.setup?.threadingDefault
      ? { ...document.setup.threadingDefault, source: 'project-default' as const }
      : { ...LEGACY_MANUAL_DEFAULT };

  if (transition.mode === 'continuous') {
    const previousExit = previous.transitions?.exit?.to ?? previous.endPoint;
    const nextEntry = operation.transitions?.entry?.from ??
      operation.overrides?.leadIn?.from ?? operation.startPoint;
    const tolerance = Math.max(0, document.options.coincidenceEpsilon);
    if (
      previous.closed ||
      operation.closed ||
      previous.contourId !== operation.contourId ||
      previous.machiningIntent?.kind === 'partial-contour' ||
      operation.machiningIntent?.kind === 'partial-contour' ||
      distance(previousExit, nextEntry) > tolerance
    ) {
      return blocked(
        'continuous-threading-invalid',
        'Continuous threading requires one contiguous open path with no positioning gap or partial-span boundary.'
      );
    }
    if (transition.wireSeparation !== 'already-separated') {
      return blocked(
        'invalid-wire-separation',
        'Continuous threading cannot request a wire-separation action.'
      );
    }
    return { status: 'ready', transition };
  }

  if (transition.mode === 'manual') {
    if (
      transition.wireSeparation !== 'already-separated' &&
      transition.wireSeparation !== 'manual-before-positioning'
    ) {
      return blocked(
        'invalid-wire-separation',
        'Manual rethreading requires already-separated wire or a manual pre-position separation.'
      );
    }
    if (!machine.threading.manual.supported) {
      return blocked(
        'manual-threading-unsupported',
        'The selected machine profile does not authorize manual rethread program stops.'
      );
    }
    return {
      status: 'ready',
      transition,
      manualStopCode: machine.threading.manual.stopCode
    };
  }

  if (transition.wireSeparation !== 'automatic-before-positioning') {
    return blocked(
      'invalid-wire-separation',
      'Automatic rethreading requires an automatic-before-positioning sequence.'
    );
  }
  const automatic = machine.threading.automatic;
  if (
    !automatic.supported ||
    automatic.beforePositioningCodes.length === 0 ||
    automatic.afterPositioningCodes.length === 0
  ) {
    return blocked(
      'automatic-threading-unsupported',
      'The selected verified machine profile has no exact automatic rethread command sequence.'
    );
  }
  return {
    status: 'ready',
    transition,
    automaticBeforePositioningCodes: [...automatic.beforePositioningCodes],
    automaticAfterPositioningCodes: [...automatic.afterPositioningCodes]
  };
}

function blocked(
  reason: Extract<OperationThreadingResolution, { status: 'blocked' }>['reason'],
  message: string
): OperationThreadingResolution {
  return { status: 'blocked', reason, message };
}
