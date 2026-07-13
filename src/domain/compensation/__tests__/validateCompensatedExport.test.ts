import { describe, expect, it } from 'vitest';

import { initializeProjectCompensationIntents } from '@/domain/compensation/intent';
import {
  createBlankMachineProfile,
  createVerifiedCharmillesRobofil100Profile,
  markMachineProfileUserVerified
} from '@/domain/machine/machineProfiles';
import { setCircleOperationCenterPierceLeadIn } from '@/domain/path-editor/pathDocumentOperations';
import { createPathPlanningDocumentFromDxfEntities } from '@/domain/path-intel/fromDxfEntities';
import type { MachineProfile } from '@/domain/workbench/types';

import { validateCompensatedExport } from '../validateCompensatedExport';

describe('validateCompensatedExport', () => {
  it('accepts a manually selected operation when verified compensation is not enabled by default', () => {
    const machine = verifiedExplicitMachine();
    const document = finishedCircle();
    const operation = document.plan.operations[0];

    expect(validateCompensatedExport({ document, operation, machine })).toMatchObject({
      status: 'ready',
      strategy: 'explicit-linear',
      transition: { status: 'ready' },
      resolution: { status: 'ready' }
    });
  });

  it('blocks unsupported, unverified, and stale machine snapshots', () => {
    const document = finishedCircle();
    const operation = document.plan.operations[0];
    const unsupported = createBlankMachineProfile();
    const unverified = explicitMachine();
    const stale = verifiedExplicitMachine();
    stale.output.coordinatePrecision = 4;

    expect(validateCompensatedExport({ document, operation, machine: unsupported })).toMatchObject({
      status: 'blocked', reason: 'unsupported-machine-profile'
    });
    expect(validateCompensatedExport({ document, operation, machine: unverified })).toMatchObject({
      status: 'blocked', reason: 'unverified-machine-profile'
    });
    expect(validateCompensatedExport({ document, operation, machine: stale })).toMatchObject({
      status: 'blocked', reason: 'unverified-machine-profile'
    });
  });

  it('blocks invalid D selection and incompatible explicit lifecycle', () => {
    const document = finishedCircle();
    const operation = document.plan.operations[0];
    const invalidD = verifiedExplicitMachine();
    invalidD.compensation.offsetSelection.index = -1;
    const invalidLifecycle = verifiedExplicitMachine((profile) => {
      profile.compensation.cancellation = 'program-end';
    });

    expect(validateCompensatedExport({ document, operation, machine: invalidD })).toMatchObject({
      status: 'blocked', reason: 'invalid-offset-selection'
    });
    expect(validateCompensatedExport({ document, operation, machine: invalidLifecycle })).toMatchObject({
      status: 'blocked', reason: 'unsupported-compensation-lifecycle'
    });
  });

  it('blocks unsafe generic template modal words', () => {
    const document = finishedCircle();
    const operation = document.plan.operations[0];
    const machine = verifiedExplicitMachine((profile) => {
      profile.templates.header = 'G90G41D0';
    });

    expect(validateCompensatedExport({ document, operation, machine })).toMatchObject({
      status: 'blocked', reason: 'template-modal-conflict'
    });
  });

  it('blocks a profile that would emit inch mode for millimetre UPID coordinates', () => {
    const document = finishedCircle();
    const operation = document.plan.operations[0];
    const machine = verifiedExplicitMachine((profile) => {
      profile.controller.unitsCode = 'G20';
    });

    expect(validateCompensatedExport({ document, operation, machine })).toMatchObject({
      status: 'blocked', reason: 'units-mode-conflict'
    });
  });

  it('bypasses explicit leads for the verified native Robofil lifecycle', () => {
    const machine = createVerifiedCharmillesRobofil100Profile();
    const document = initializeProjectCompensationIntents(baseCircle(), machine);
    const operation = document.plan.operations[0];

    expect(validateCompensatedExport({ document, operation, machine })).toMatchObject({
      status: 'ready',
      strategy: 'controller-native',
      transition: null,
      resolution: { status: 'ready' }
    });
  });

  it('requires the exact physically verified Robofil version-1 envelope', () => {
    const sourceMachine = createVerifiedCharmillesRobofil100Profile();
    const document = initializeProjectCompensationIntents(baseCircle(), sourceMachine);
    const operation = document.plan.operations[0];
    const emitsG21 = structuredClone(sourceMachine);
    emitsG21.controller.unitsCode = 'G21';
    const reverifiedG21 = markMachineProfileUserVerified(emitsG21);
    const operationG39 = structuredClone(sourceMachine);
    operationG39.compensation.lifecycleScope = 'operation';
    operationG39.compensation.cancellation = 'charmilles-g39';
    const reverifiedOperationG39 = markMachineProfileUserVerified(operationG39);

    expect(validateCompensatedExport({ document, operation, machine: reverifiedG21 }))
      .toMatchObject({ status: 'blocked', reason: 'unsupported-robofil-post-envelope' });
    expect(validateCompensatedExport({ document, operation, machine: reverifiedOperationG39 }))
      .toMatchObject({ status: 'blocked', reason: 'unsupported-robofil-post-envelope' });
  });

  it('enforces the verified Robofil single-operation program scope', () => {
    const machine = createVerifiedCharmillesRobofil100Profile();
    const document = initializeProjectCompensationIntents(
      createPathPlanningDocumentFromDxfEntities([
        { type: 'circle', layer: 'CUT', center: { x: 0, y: 0 }, radius: 5 },
        { type: 'circle', layer: 'CUT', center: { x: 20, y: 0 }, radius: 3 }
      ]),
      machine
    );

    expect(validateCompensatedExport({
      document,
      operation: document.plan.operations[0],
      machine
    })).toMatchObject({ status: 'blocked', reason: 'unsupported-operation-count' });
  });

  it('rejects a circle-center radial override before either controller lifecycle posts', () => {
    const machine = createVerifiedCharmillesRobofil100Profile();
    const initialized = initializeProjectCompensationIntents(baseCircle(), machine);
    const document = setCircleOperationCenterPierceLeadIn(
      initialized,
      initialized.plan.operations[0].id
    )!;

    expect(validateCompensatedExport({
      document,
      operation: document.plan.operations[0],
      machine
    })).toMatchObject({ status: 'blocked', reason: 'unsafe-radial-lead' });
  });
});

function baseCircle() {
  return createPathPlanningDocumentFromDxfEntities([
    { type: 'circle', layer: 'CUT', center: { x: 0, y: 0 }, radius: 5 }
  ]);
}

function finishedCircle() {
  const document = baseCircle();
  document.geometryBasis = 'finished-contour';
  document.plan.operations[0].compensationIntent = {
    mode: 'controller', keptMaterial: 'inside', source: 'manual'
  };
  return document;
}

function explicitMachine() {
  const machine = createBlankMachineProfile('explicit-linear');
  machine.controller.family = 'generic-iso';
  machine.compensation = {
    supported: true,
    enabledByDefault: false,
    offsetSelection: { address: 'D', index: 0 },
    activation: 'linear-lead',
    cancellation: 'linear-lead-out',
    lifecycleScope: 'operation',
    preActivationCodes: [],
    validationLeadLengthMm: 2,
    expectedMaximumOffsetMm: 0.25
  };
  machine.templates = { header: '', footer: '' };
  machine.output.coordinatePrecision = 3;
  return machine;
}

function verifiedExplicitMachine(edit?: (profile: MachineProfile) => void) {
  const machine = explicitMachine();
  edit?.(machine);
  return markMachineProfileUserVerified(machine, new Date('2026-07-13T00:00:00.000Z'));
}
