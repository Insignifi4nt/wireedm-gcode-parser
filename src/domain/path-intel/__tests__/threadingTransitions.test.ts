import { describe, expect, it } from 'vitest';

import {
  createCharmillesRobofil100V2CandidateProfile,
  markMachineProfileUserVerified
} from '@/domain/machine/machineProfiles';
import { createUpidFromDxfEntities } from '@/domain/upid/upidDocument';

import { resolveOperationThreadingTransition } from '../threadingTransitions';

describe('operation threading transitions', () => {
  it('defaults a legacy later operation to manual rethreading', () => {
    const document = twoClosedContours();
    const machine = markMachineProfileUserVerified(
      createCharmillesRobofil100V2CandidateProfile()
    );

    expect(resolveOperationThreadingTransition(
      document,
      document.plan.operations[1].id,
      machine
    )).toEqual({
      status: 'ready',
      transition: {
        mode: 'manual',
        wireSeparation: 'already-separated',
        source: 'project-default'
      },
      manualStopCode: 'M00'
    });
  });

  it('resolves a per-operation manual-before-positioning override', () => {
    const document = twoClosedContours();
    document.plan.operations[1].threadingTransition = {
      mode: 'manual',
      wireSeparation: 'manual-before-positioning',
      source: 'operation-override'
    };
    const machine = markMachineProfileUserVerified(
      createCharmillesRobofil100V2CandidateProfile()
    );

    expect(resolveOperationThreadingTransition(
      document,
      document.plan.operations[1].id,
      machine
    )).toMatchObject({
      status: 'ready',
      transition: { wireSeparation: 'manual-before-positioning' }
    });
  });

  it('blocks automatic rethreading when no exact verified command sequence exists', () => {
    const document = twoClosedContours();
    document.plan.operations[1].threadingTransition = {
      mode: 'automatic',
      wireSeparation: 'automatic-before-positioning',
      source: 'operation-override'
    };
    const machine = markMachineProfileUserVerified(
      createCharmillesRobofil100V2CandidateProfile()
    );

    expect(resolveOperationThreadingTransition(
      document,
      document.plan.operations[1].id,
      machine
    )).toMatchObject({ status: 'blocked', reason: 'automatic-threading-unsupported' });
  });

  it('rejects continuous threading across separate closed contours', () => {
    const document = twoClosedContours();
    document.plan.operations[1].threadingTransition = {
      mode: 'continuous',
      wireSeparation: 'already-separated',
      source: 'operation-override'
    };

    expect(resolveOperationThreadingTransition(
      document,
      document.plan.operations[1].id,
      createCharmillesRobofil100V2CandidateProfile()
    )).toMatchObject({ status: 'blocked', reason: 'continuous-threading-invalid' });
  });

  it('rejects continuous threading across distinct partial groups from one source contour', () => {
    const document = twoClosedContours();
    const previous = document.plan.operations[0];
    const operation = document.plan.operations[1];
    previous.closed = false;
    operation.closed = false;
    operation.contourId = previous.contourId;
    previous.machiningIntent = {
      kind: 'partial-contour', sourceOperationId: 'source', spanIds: ['span-a']
    };
    operation.machiningIntent = {
      kind: 'partial-contour', sourceOperationId: 'source', spanIds: ['span-b']
    };
    operation.threadingTransition = {
      mode: 'continuous', wireSeparation: 'already-separated', source: 'operation-override'
    };

    expect(resolveOperationThreadingTransition(
      document,
      operation.id,
      createCharmillesRobofil100V2CandidateProfile()
    )).toMatchObject({ status: 'blocked', reason: 'continuous-threading-invalid' });
  });
});

function twoClosedContours() {
  return createUpidFromDxfEntities([
    { type: 'circle', layer: 'CUT', center: { x: 0, y: 0 }, radius: 5 },
    { type: 'circle', layer: 'CUT', center: { x: 20, y: 0 }, radius: 5 }
  ]);
}
