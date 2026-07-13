import { describe, expect, it } from 'vitest';

import { initializeProjectCompensationIntents } from '@/domain/compensation/intent';
import { resolveControllerCompensation } from '@/domain/compensation/resolveControllerCompensation';
import {
  createVerifiedCharmillesRobofil100Profile,
  markMachineProfileUserVerified
} from '@/domain/machine/machineProfiles';
import {
  reversePathOperation,
  setCircleOperationCenterPierceLeadIn
} from '@/domain/path-editor/pathDocumentOperations';
import { createDefaultMachineProfile } from '@/domain/workbench/defaultProject';
import {
  composeUpidGCodeExport,
  createUpidFromDxfEntities,
  postUpidToGcode
} from '@/domain/upid/upidDocument';

import {
  deriveVerifiedRobofilPreviewPostBlocks,
  postUpidForMachine
} from '../upidMachinePost';

describe('postUpidForMachine', () => {
  it('posts the verified single-contour Robofil lifecycle as traceable blocks', () => {
    const machine = createVerifiedCharmillesRobofil100Profile(
      'robofil-snapshot',
      new Date('2026-07-13T00:00:00.000Z')
    );
    const document = compensatedRectangle(machine, 'G41');

    const posted = postUpidForMachine(document, machine);

    expect(posted.status).toBe('ready');
    expect(posted.body.split('\n').slice(0, 6)).toEqual([
      'G92 X0 Y0',
      'G60',
      'G38',
      'G41 D0',
      'G90',
      expect.stringMatching(/^G1 X-?\d+\.000 Y-?\d+\.000$/)
    ]);
    expect(posted.body.split('\n').at(-1)).toBe('M02');
    expect(posted.body).not.toMatch(/(?:^|\n)G0\b/);
    expect(posted.body).not.toMatch(/\b(?:G21|G17|G54|G40|M30)\b/);
    expect(posted.body.match(/\bD0\b/g)).toHaveLength(1);
    expect(posted.body).not.toMatch(/\bD0(?:\.|\s*[+-]?\d*\.\d)/);
    expect(posted.blocks.map((block) => block.kind).slice(0, 6)).toEqual([
      'setup',
      'setup',
      'compensation-activation',
      'compensation-activation',
      'setup',
      'contour'
    ]);
    expect(posted.blocks.at(-1)).toMatchObject({
      bodyLineIndex: posted.body.split('\n').length - 1,
      kind: 'program-end',
      text: 'M02'
    });
    expect(posted.metrics.rapidCount).toBe(0);
  });

  it('derives the opposite compensation code after reversing final refs', () => {
    const machine = createVerifiedCharmillesRobofil100Profile();
    const forward = compensatedRectangle(machine, 'G41');
    const operation = forward.plan.operations[0];
    const reversed = reversePathOperation(forward, operation.id)!;

    const before = postUpidForMachine(forward, machine);
    const after = postUpidForMachine(reversed, machine);

    expect(operation.compensationIntent).toEqual({
      mode: 'controller',
      keptMaterial: 'inside',
      source: 'automatic'
    });
    expect(reversed.plan.operations[0].compensationIntent).toEqual(operation.compensationIntent);
    expect(before.body).toContain('\nG41 D0\n');
    expect(after.body).toContain('\nG42 D0\n');
  });

  it('approaches a translated contour linearly from the G92 origin before cutting its first segment', () => {
    const machine = createVerifiedCharmillesRobofil100Profile();
    const document = initializeProjectCompensationIntents(
      createUpidFromDxfEntities(clockwiseRectangle(20, 30, 30, 35)),
      machine
    );
    const operation = document.plan.operations[0];

    const posted = postUpidForMachine(document, machine);
    const approach = posted.moves[0];

    expect(posted.status).toBe('ready');
    expect(posted.body.split('\n').slice(5, 7)).toEqual([
      'G1 X20.000 Y30.000',
      'G1 X20.000 Y35.000'
    ]);
    expect(approach).toMatchObject({
      command: 'G1',
      kind: 'cut',
      reason: 'operation-start-approach',
      segmentId: null,
      startPoint: { x: 0, y: 0 },
      endPoint: { x: 20, y: 30 }
    });
    expect(posted.blocks[5]).toMatchObject({
      kind: 'lead-in',
      text: approach.text,
      operationId: operation.id
    });
    expect(deriveVerifiedRobofilPreviewPostBlocks(document, machine)).toEqual([
      {
        bodyLineIndex: posted.blocks[5].bodyLineIndex,
        kind: posted.blocks[5].kind,
        operationId: posted.blocks[5].operationId,
        startPoint: posted.blocks[5].startPoint,
        endPoint: posted.blocks[5].endPoint
      }
    ]);
    expect(posted.blocks[6]).toMatchObject({
      kind: 'contour',
      segmentId: operation.segmentRefs[0].segmentId
    });
  });

  it('blocks a compensated Robofil circle center-pierce lead-in atomically', () => {
    const machine = createVerifiedCharmillesRobofil100Profile();
    const initialized = initializeProjectCompensationIntents(
      createUpidFromDxfEntities([
        { type: 'circle', layer: 'CUT', center: { x: 30, y: 30 }, radius: 5 }
      ]),
      machine
    );
    const operation = initialized.plan.operations[0];
    const document = setCircleOperationCenterPierceLeadIn(initialized, operation.id)!;

    const posted = postUpidForMachine(document, machine);

    expect(posted).toMatchObject({
      status: 'blocked',
      body: '',
      blocks: [],
      moves: [],
      operations: []
    });
    expect(posted.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: 'error',
        details: expect.objectContaining({ reason: 'unsafe-controller-compensation-lead-in' })
      })
    );
  });

  it('blocks a second compensated operation atomically', () => {
    const machine = createVerifiedCharmillesRobofil100Profile();
    const document = initializeProjectCompensationIntents(
      createUpidFromDxfEntities([
        ...clockwiseRectangle(0, 0, 10, 5),
        ...clockwiseRectangle(20, 0, 30, 5)
      ]),
      machine
    );

    const posted = postUpidForMachine(document, machine);

    expect(posted).toMatchObject({ status: 'blocked', body: '', blocks: [], moves: [] });
    expect(posted.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: 'error',
        details: expect.objectContaining({ reason: 'unsupported-operation-count' })
      })
    );
  });

  it.each(['unverified', 'stale-fingerprint'] as const)(
    'blocks an %s Robofil project snapshot atomically',
    (scenario) => {
      const verified = createVerifiedCharmillesRobofil100Profile();
      const document = compensatedRectangle(verified, 'G41');
      const machine = structuredClone(verified);
      if (scenario === 'unverified') machine.controller.verification = { status: 'unverified' };
      else machine.output.coordinatePrecision = 4;

      const posted = postUpidForMachine(document, machine);

      expect(posted).toMatchObject({ status: 'blocked', body: '', blocks: [], moves: [] });
      expect(posted.diagnostics).toContainEqual(
        expect.objectContaining({
          severity: 'error',
          details: expect.objectContaining({ reason: 'unverified-machine-profile' })
        })
      );
    }
  );

  it('blocks verified Robofil wire-centre output instead of falling through to generic posting', () => {
    const machine = createVerifiedCharmillesRobofil100Profile();
    const document = createUpidFromDxfEntities(clockwiseRectangle(0, 0, 10, 5));

    const posted = postUpidForMachine(document, machine);

    expect(posted).toMatchObject({ status: 'blocked', body: '', blocks: [], moves: [] });
    expect(posted.diagnostics).toContainEqual(
      expect.objectContaining({
        message: expect.stringContaining('wire-centre'),
        details: expect.objectContaining({ reason: 'compensation-resolution-blocked' })
      })
    );
  });

  it('reports unverified Robofil before any missing compensation intent', () => {
    const machine = createVerifiedCharmillesRobofil100Profile();
    machine.controller.verification = { status: 'unverified' };
    const document = createUpidFromDxfEntities(clockwiseRectangle(0, 0, 10, 5));

    const posted = postUpidForMachine(document, machine);

    expect(posted).toMatchObject({ status: 'blocked', body: '', blocks: [], moves: [] });
    expect(posted.diagnostics).toContainEqual(
      expect.objectContaining({
        details: expect.objectContaining({ reason: 'unverified-machine-profile' })
      })
    );
  });

  it('returns an empty body when the final profile-specific audit finds a forbidden word', () => {
    const base = createVerifiedCharmillesRobofil100Profile();
    const machine = markMachineProfileUserVerified({
      ...base,
      compensation: { ...base.compensation, preActivationCodes: ['G60', 'G21'] }
    });
    const document = compensatedRectangle(machine, 'G41');

    const posted = postUpidForMachine(document, machine);

    expect(posted).toMatchObject({ status: 'blocked', body: '', blocks: [], moves: [] });
    expect(posted.diagnostics).toContainEqual(
      expect.objectContaining({ severity: 'error' })
    );
  });

  it.each([
    {
      label: 'G61 pre-activation',
      mutate: (machine: ReturnType<typeof createVerifiedCharmillesRobofil100Profile>) => {
        machine.compensation.preActivationCodes = ['G61'];
      }
    },
    {
      label: 'D1 selection',
      mutate: (machine: ReturnType<typeof createVerifiedCharmillesRobofil100Profile>) => {
        machine.compensation.offsetSelection.index = 1;
      }
    },
    {
      label: 'compact blocks',
      mutate: (machine: ReturnType<typeof createVerifiedCharmillesRobofil100Profile>) => {
        machine.controller.blockFormatting = 'compact';
      }
    },
    {
      label: 'four-decimal output',
      mutate: (machine: ReturnType<typeof createVerifiedCharmillesRobofil100Profile>) => {
        machine.output.coordinatePrecision = 4;
      }
    },
    {
      label: 'LF output',
      mutate: (machine: ReturnType<typeof createVerifiedCharmillesRobofil100Profile>) => {
        machine.output.lineEnding = 'lf';
      }
    },
    {
      label: 'post version 2',
      mutate: (machine: ReturnType<typeof createVerifiedCharmillesRobofil100Profile>) => {
        machine.controller.postVersion = 2;
      }
    }
  ])('blocks reverified $label outside the physically verified envelope', ({ mutate }) => {
    const base = createVerifiedCharmillesRobofil100Profile();
    mutate(base);
    const machine = markMachineProfileUserVerified(base);
    const document = compensatedRectangle(machine, 'G41');

    const posted = postUpidForMachine(document, machine);

    expect(posted).toMatchObject({ status: 'blocked', body: '', blocks: [], moves: [] });
    expect(posted.diagnostics).toContainEqual(
      expect.objectContaining({
        details: expect.objectContaining({ reason: 'unsupported-robofil-post-envelope' })
      })
    );
  });

  it('ignores direct precision overrides for the verified snapshot', () => {
    const machine = createVerifiedCharmillesRobofil100Profile();
    const document = initializeProjectCompensationIntents(
      createUpidFromDxfEntities(clockwiseRectangle(20.1234, 30.5678, 31.2345, 36.7891)),
      machine
    );

    const posted = postUpidForMachine(document, machine, { coordinatePrecision: 1 });

    expect(posted.status).toBe('ready');
    expect(posted.body).toContain('G1 X20.123 Y30.568');
    expect(posted.body).not.toContain('G1 X20.1 Y30.6');
  });

  it('ignores composition precision and line-ending overrides when a snapshot is supplied', () => {
    const machine = createVerifiedCharmillesRobofil100Profile();
    const document = initializeProjectCompensationIntents(
      createUpidFromDxfEntities(clockwiseRectangle(20.1234, 30.5678, 31.2345, 36.7891)),
      machine
    );

    const exported = composeUpidGCodeExport(document, {
      machine,
      coordinatePrecision: 1,
      lineEnding: 'lf'
    });

    expect(exported.canDownload).toBe(true);
    expect(exported.body).toContain('G1 X20.123 Y30.568');
    expect(exported.program.text).not.toMatch(/(?<!\r)\n/);
  });

  it('allows comment-only Robofil templates without confusing nested comments for executable setup', () => {
    const base = createVerifiedCharmillesRobofil100Profile();
    base.templates.header = '(outer (G20 G92 G60) setup note)';
    base.templates.footer = '(outer (G39 M02) end note)';
    const machine = markMachineProfileUserVerified(base);
    const document = compensatedRectangle(machine, 'G41');

    const posted = postUpidForMachine(document, machine);

    expect(posted.status).toBe('ready');
    expect(posted.body).toContain('(outer (G20 G92 G60) setup note)\nG92 X0 Y0');
    expect(posted.body.endsWith('(outer (G39 M02) end note)\nM02')).toBe(true);
  });

  it('keeps generic centreline posting byte-compatible', () => {
    const machine = createDefaultMachineProfile();
    const document = createUpidFromDxfEntities([
      { type: 'circle', layer: 'CUT', center: { x: 30, y: 30 }, radius: 5 }
    ]);

    const legacy = postUpidToGcode(document, {
      coordinatePrecision: machine.output.coordinatePrecision
    });
    const posted = postUpidForMachine(document, machine);

    expect(posted.status).toBe('ready');
    expect(posted.body).toBe(legacy.body);
    expect(posted.moves).toEqual(legacy.moves);
    expect(posted.operations).toEqual(legacy.operations);
  });

  it('keeps a generic centreline center-pierce lead-in and traces its radial cut as lead-in', () => {
    const machine = createDefaultMachineProfile();
    const source = createUpidFromDxfEntities([
      { type: 'circle', layer: 'CUT', center: { x: 30, y: 30 }, radius: 5 }
    ]);
    const operation = source.plan.operations[0];
    const document = setCircleOperationCenterPierceLeadIn(source, operation.id)!;

    const posted = postUpidForMachine(document, machine);

    expect(posted.status).toBe('ready');
    expect(posted.moves.some((move) => move.reason === 'manual-lead-in')).toBe(true);
    expect(
      posted.blocks
        .filter((block) => block.kind === 'rapid' || block.kind === 'lead-in')
        .map(({ kind, operationId, startPoint, endPoint }) => ({
          kind,
          operationId,
          startPoint,
          endPoint
        }))
    ).toEqual([
      {
        kind: 'rapid',
        operationId: operation.id,
        startPoint: null,
        endPoint: { x: 30, y: 30 }
      },
      {
        kind: 'lead-in',
        operationId: operation.id,
        startPoint: { x: 30, y: 30 },
        endPoint: { x: 35, y: 30 }
      }
    ]);
  });

  it('keeps template-managed generic G90.1 arc semantics byte-compatible', () => {
    const machine = createDefaultMachineProfile();
    machine.templates.header = '%\nG90.1';
    machine.templates.footer = 'M30\n%';
    const document = createUpidFromDxfEntities([
      { type: 'circle', layer: 'CUT', center: { x: 30, y: 30 }, radius: 5 }
    ]);

    const legacy = composeUpidGCodeExport(document, {
      header: machine.templates.header,
      footer: machine.templates.footer,
      lineEnding: machine.output.lineEnding,
      coordinatePrecision: machine.output.coordinatePrecision
    });
    const snapshot = composeUpidGCodeExport(document, { machine });

    expect(snapshot.body).toContain('I30.000 J30.000');
    expect(snapshot.body).toBe(legacy.body);
    expect(snapshot.program.text).toBe(legacy.program.text);
  });
});

function compensatedRectangle(
  machine: ReturnType<typeof createVerifiedCharmillesRobofil100Profile>,
  desiredCode: 'G41' | 'G42'
) {
  let document = initializeProjectCompensationIntents(
    createUpidFromDxfEntities(clockwiseRectangle(0, 0, 10, 5)),
    machine
  );
  const operation = document.plan.operations[0];
  const resolution = resolveControllerCompensation({ document, operation });
  if (resolution.status === 'ready' && resolution.code !== desiredCode) {
    document = reversePathOperation(document, operation.id)!;
  }
  return document;
}

function clockwiseRectangle(minX: number, minY: number, maxX: number, maxY: number) {
  return [
    line(minX, minY, minX, maxY),
    line(minX, maxY, maxX, maxY),
    line(maxX, maxY, maxX, minY),
    line(maxX, minY, minX, minY)
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
