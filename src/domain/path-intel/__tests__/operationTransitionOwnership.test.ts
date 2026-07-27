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

  it('isolates partial ownership when another operation has invalid active groups', () => {
    const machine = explicitLinearMachine();
    let document = initializeProjectCompensationIntents(
      createUpidFromDxfEntities([
        ...rectangleLines(0),
        ...rectangleLines(30)
      ]),
      machine
    );
    const [partialOperation, invalidOperation] = document.plan.operations;
    document = markInactive(document, partialOperation.segmentRefs[0].segmentId);
    document = markInactive(document, invalidOperation.segmentRefs[0].segmentId);
    document = markInactive(document, invalidOperation.segmentRefs[2].segmentId);

    expect(
      resolveSourceOperationTransitionOwnership(
        document,
        partialOperation.id,
        machine
      )
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

function rectangleLines(offsetX = 0) {
  return [
    line(offsetX, 0, offsetX, 5),
    line(offsetX, 5, offsetX + 10, 5),
    line(offsetX + 10, 5, offsetX + 10, 0),
    line(offsetX + 10, 0, offsetX, 0)
  ];
}

function markInactive(
  document: ReturnType<typeof createUpidFromDxfEntities>,
  sourceSegmentId: string
) {
  return setMachiningSpanParticipation(document, {
    sourceSegmentId,
    range: { start: 0, end: 1 },
    participation: 'inactive-reference'
  })!;
}

function line(startX: number, startY: number, endX: number, endY: number) {
  return {
    type: 'line' as const,
    layer: 'CUT',
    start: { x: startX, y: startY },
    end: { x: endX, y: endY }
  };
}
