import { describe, expect, it } from 'vitest';

import { initializeProjectCompensationIntents } from '@/domain/compensation/intent';
import { markMachineProfileUserVerified } from '@/domain/machine/machineProfiles';
import { setMachiningSpanParticipation } from '@/domain/path-intel/machiningParticipation';
import { resolveSourceOperationTransitionOwnership } from '@/domain/path-intel/operationTransitionOwnership';
import { createUpidFromDxfEntities } from '@/domain/upid/upidDocument';
import { createDefaultMachineProfile } from '@/domain/workbench/defaultProject';

describe('source operation transition ownership', () => {
  it('treats a partial operation without an explicit controller side as authored', () => {
    const machine = explicitLinearMachine();
    let document = initializeProjectCompensationIntents(
      createUpidFromDxfEntities(rectangleLines()),
      machine
    );
    const sourceOperation = document.plan.operations[0];
    document = setMachiningSpanParticipation(document, {
      sourceSegmentId: sourceOperation.segmentRefs[0].segmentId,
      range: { start: 0, end: 1 },
      participation: 'inactive-reference'
    })!;
    expect(
      resolveSourceOperationTransitionOwnership(document, sourceOperation.id, machine)
    ).toBe('authored');
  });
});

function explicitLinearMachine() {
  const machine = createDefaultMachineProfile();
  machine.compensation = {
    supported: true,
    enabledByDefault: true,
    offsetSelection: { address: 'D', index: 0 },
    activation: 'linear-lead',
    cancellation: 'linear-lead-out',
    lifecycleScope: 'operation',
    preActivationCodes: [],
    validationLeadLengthMm: 2,
    expectedMaximumOffsetMm: 0.25
  };
  machine.templates = { header: 'G90', footer: '' };
  return markMachineProfileUserVerified(machine);
}

function rectangleLines() {
  return [
    line(0, 0, 0, 5),
    line(0, 5, 10, 5),
    line(10, 5, 10, 0),
    line(10, 0, 0, 0)
  ];
}

function line(startX: number, startY: number, endX: number, endY: number) {
  return {
    type: 'line' as const,
    layer: 'CUT',
    start: { x: startX, y: startY },
    end: { x: endX, y: endY }
  };
}
