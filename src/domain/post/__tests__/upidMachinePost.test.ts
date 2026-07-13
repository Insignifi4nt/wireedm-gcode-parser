import { describe, expect, it } from 'vitest';

import {
  initializeProjectCompensationIntents,
  setManualCompensationIntent
} from '@/domain/compensation/intent';
import { resolveControllerCompensation } from '@/domain/compensation/resolveControllerCompensation';
import {
  createVerifiedCharmillesRobofil100Profile,
  markMachineProfileUserVerified,
  normalizeMachineProfile
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
import * as machinePostModule from '../upidMachinePost';

describe('postUpidForMachine', () => {
  it('posts a smooth generic compensated circle with explicit linear activation and cancellation', () => {
    const machine = verifiedGenericExplicitMachine();
    const document = initializeProjectCompensationIntents(
      createUpidFromDxfEntities([
        { type: 'circle', layer: 'CUT', center: { x: 0, y: 0 }, radius: 5 }
      ]),
      machine
    );

    const posted = postUpidForMachine(document, machine);

    expect(posted.status).toBe('ready');
    expect(posted.body.split('\n')).toEqual([
      'G40',
      'G0 X5.000 Y-2.000',
      'G42 D0 G1 X5.000 Y0.000',
      'G3 X-5.000 Y0.000 I-5.000 J0.000',
      'G3 X5.000 Y0.000 I5.000 J0.000',
      'G40 G1 X5.000 Y2.000'
    ]);
    expect(posted.metrics).toEqual({ rapidCount: 1, cutMoveCount: 4 });
    expect(posted.blocks.map((block) => block.kind)).toEqual([
      'operation-boundary',
      'rapid',
      'lead-in',
      'contour',
      'contour',
      'lead-out'
    ]);
  });

  it('derives the opposite generic compensation side after reversal and formats the selected D index', () => {
    const editable = verifiedGenericExplicitMachine();
    editable.compensation.offsetSelection.index = 7;
    const machine = markMachineProfileUserVerified(editable);
    const forward = initializeProjectCompensationIntents(
      createUpidFromDxfEntities([
        { type: 'circle', layer: 'CUT', center: { x: 0, y: 0 }, radius: 5 }
      ]),
      machine
    );
    const operation = forward.plan.operations[0];
    const reversed = reversePathOperation(forward, operation.id)!;

    const before = postUpidForMachine(forward, machine);
    const after = postUpidForMachine(reversed, machine);

    expect(before.status).toBe('ready');
    expect(after.status).toBe('ready');
    expect(before.body).toContain('G42 D7 G1');
    expect(after.body).toContain('G41 D7 G1');
    expect(reversed.plan.operations[0].compensationIntent).toEqual(operation.compensationIntent);
  });

  it('posts mixed compensated and centreline operations with G40 boundaries and consistent traces', () => {
    const machine = verifiedGenericExplicitMachine();
    const initialized = initializeProjectCompensationIntents(
      createUpidFromDxfEntities([
        { type: 'circle', layer: 'CUT', center: { x: 0, y: 0 }, radius: 5 },
        { type: 'circle', layer: 'CUT', center: { x: 20, y: 0 }, radius: 3 }
      ]),
      machine
    );
    const centrelineId = initialized.plan.operations[1].id;
    const document = setManualCompensationIntent(initialized, centrelineId, 'centerline')!;

    const posted = postUpidForMachine(document, machine);

    expect(posted.status).toBe('ready');
    expect(posted.operations).toHaveLength(2);
    expect(posted.metrics).toEqual({ rapidCount: 2, cutMoveCount: 6 });
    expect(posted.body.match(/^G40$/gm)).toHaveLength(2);
    expect(posted.body.match(/^G0\b/gm)).toHaveLength(2);
    expect(posted.body.match(/G4[12] D0 G1/g)).toHaveLength(1);
    expect(posted.blocks.filter((block) => block.kind === 'operation-boundary')).toHaveLength(2);
    expect(posted.blocks.filter((block) => block.operationId === centrelineId)).toSatisfy(
      (blocks: typeof posted.blocks) => blocks.every(
        (block) => block.compensationBefore === 'G40' && block.compensationAfter === 'G40'
      )
    );
    expect(posted.blocks.map((block) => block.bodyLineIndex)).toEqual(
      posted.body.split('\n').map((_, index) => index)
    );
  });

  it('preserves a centreline radial lead-in inside a mixed explicit-linear document', () => {
    const machine = verifiedGenericExplicitMachine();
    const initialized = initializeProjectCompensationIntents(
      createUpidFromDxfEntities([
        { type: 'circle', layer: 'CUT', center: { x: 0, y: 0 }, radius: 5 },
        { type: 'circle', layer: 'CUT', center: { x: 20, y: 0 }, radius: 3 }
      ]),
      machine
    );
    const centrelineId = initialized.plan.operations[1].id;
    const centreline = setManualCompensationIntent(initialized, centrelineId, 'centerline')!;
    const document = setCircleOperationCenterPierceLeadIn(centreline, centrelineId)!;

    const posted = postUpidForMachine(document, machine);

    expect(posted.status).toBe('ready');
    expect(posted.blocks).toContainEqual(expect.objectContaining({
      kind: 'lead-in',
      operationId: centrelineId,
      compensationBefore: 'G40',
      compensationAfter: 'G40'
    }));
  });

  it('uses an export-local safe-start rotation without mutating the UPID operation refs', () => {
    const machine = verifiedGenericExplicitMachine();
    const document = initializeProjectCompensationIntents(
      createUpidFromDxfEntities(smoothAlternateStartEntities()),
      machine
    );
    const operation = document.plan.operations[0];
    const originalRefs = structuredClone(operation.segmentRefs);

    const posted = postUpidForMachine(document, machine);

    expect(posted.status).toBe('ready');
    const firstContour = posted.blocks.find((block) => block.kind === 'contour');
    expect(firstContour?.segmentId).not.toBe(originalRefs[0].segmentId);
    expect(document.plan.operations[0].segmentRefs).toEqual(originalRefs);
    expect(posted.operations[0].moves.filter((move) => move.segmentId)[0].segmentId)
      .toBe(firstContour?.segmentId);
  });

  it('keeps a sharp square blocked and returns no executable partial generic trace', () => {
    const machine = verifiedGenericExplicitMachine();
    const document = initializeProjectCompensationIntents(
      createUpidFromDxfEntities(clockwiseRectangle(0, 0, 10, 5)),
      machine
    );

    const posted = postUpidForMachine(document, machine);

    expect(posted).toMatchObject({
      status: 'blocked',
      body: '',
      moves: [],
      operations: [],
      blocks: [],
      programOwned: true
    });
    expect(posted.diagnostics).toContainEqual(expect.objectContaining({
      details: expect.objectContaining({ reason: 'no-safe-candidate' })
    }));
  });

  it.each([
    ['post version', (machine: ReturnType<typeof verifiedGenericExplicitMachine>) => {
      machine.controller.postVersion = 2;
    }],
    ['compact formatting', (machine: ReturnType<typeof verifiedGenericExplicitMachine>) => {
      machine.controller.blockFormatting = 'compact';
    }],
    ['structured G92 origin', (machine: ReturnType<typeof verifiedGenericExplicitMachine>) => {
      machine.controller.coordinateSystem = 'wire-position-g92';
    }],
    ['structured program end', (machine: ReturnType<typeof verifiedGenericExplicitMachine>) => {
      machine.controller.programEnd = 'M30';
    }],
    ['unimplemented pre-activation code', (machine: ReturnType<typeof verifiedGenericExplicitMachine>) => {
      machine.compensation.preActivationCodes = ['G60'];
    }],
    ['arc-center mode missing from its managed template', (machine: ReturnType<typeof verifiedGenericExplicitMachine>) => {
      machine.controller.arcCenterMode = 'absolute';
    }]
  ])('fails closed when the generic version-1 post cannot honor %s', (_label, edit) => {
    const editable = verifiedGenericExplicitMachine();
    edit(editable);
    const machine = markMachineProfileUserVerified(editable);
    const document = initializeProjectCompensationIntents(
      createUpidFromDxfEntities([
        { type: 'circle', layer: 'CUT', center: { x: 0, y: 0 }, radius: 5 }
      ]),
      machine
    );

    const posted = postUpidForMachine(document, machine);

    expect(posted).toMatchObject({
      status: 'blocked', body: '', blocks: [], moves: [], operations: []
    });
    expect(posted.diagnostics).toContainEqual(expect.objectContaining({
      details: expect.objectContaining({ reason: 'unsupported-generic-post-envelope' })
    }));
  });

  it('supports generic absolute arc centres when the snapshotted managed header selects G90.1', () => {
    const editable = verifiedGenericExplicitMachine();
    editable.controller.arcCenterMode = 'absolute';
    editable.templates.header = 'G90 G90.1';
    const machine = markMachineProfileUserVerified(editable);
    const document = initializeProjectCompensationIntents(
      createUpidFromDxfEntities([
        { type: 'circle', layer: 'CUT', center: { x: 10, y: 20 }, radius: 5 }
      ]),
      machine
    );

    const posted = postUpidForMachine(document, machine);

    expect(posted.status).toBe('ready');
    expect(posted.body).toContain('I10.000 J20.000');
  });

  it('fails closed when a verified generic template selects incremental XY distance mode', () => {
    const editable = verifiedGenericExplicitMachine();
    editable.templates.header = 'G91';
    const machine = markMachineProfileUserVerified(editable);
    const document = initializeProjectCompensationIntents(
      createUpidFromDxfEntities([
        { type: 'circle', layer: 'CUT', center: { x: 0, y: 0 }, radius: 5 }
      ]),
      machine
    );

    const posted = postUpidForMachine(document, machine);

    expect(posted).toMatchObject({
      status: 'blocked', body: '', blocks: [], moves: [], operations: []
    });
    expect(posted.diagnostics).toContainEqual(expect.objectContaining({
      details: expect.objectContaining({ reason: 'unsupported-generic-post-envelope' })
    }));
  });

  it('audits structured generic modal state and rejects a rapid marked under active compensation', () => {
    const machine = verifiedGenericExplicitMachine();
    const document = initializeProjectCompensationIntents(
      createUpidFromDxfEntities([
        { type: 'circle', layer: 'CUT', center: { x: 0, y: 0 }, radius: 5 }
      ]),
      machine
    );
    const posted = postUpidForMachine(document, machine);
    const audit = (machinePostModule as typeof machinePostModule & {
      auditGenericExplicitLinearPost?: (
        result: typeof posted,
        expected: Array<{ operationId: string; code: 'G41' | 'G42'; dIndex: number }>
      ) => string | null;
    }).auditGenericExplicitLinearPost;
    const expected = [{
      operationId: document.plan.operations[0].id,
      code: 'G42' as const,
      dIndex: 0
    }];

    expect(audit).toBeTypeOf('function');
    expect(audit!(posted, expected)).toBeNull();
    const invalid = structuredClone(posted);
    const rapid = invalid.blocks.find((block) => block.kind === 'rapid')!;
    rapid.compensationBefore = 'G42';
    rapid.compensationAfter = 'G42';
    expect(audit!(invalid, expected)).toContain('rapid');

    const wrongRegister = structuredClone(posted);
    const leadIn = wrongRegister.blocks.find((block) => block.kind === 'lead-in')!;
    leadIn.text = leadIn.text.replace('D0', 'D99');
    wrongRegister.moves.find((move) => move.bodyLineIndex === leadIn.bodyLineIndex)!.text = leadIn.text;
    wrongRegister.body = wrongRegister.body.replace('D0', 'D99');
    wrongRegister.operations[0].moves.find(
      (move) => move.bodyLineIndex === leadIn.bodyLineIndex
    )!.text = leadIn.text;
    expect(audit!(wrongRegister, expected)).toContain('D0');
  });

  it('maps generic structured blocks and operation ranges through composed header lines', () => {
    const editable = verifiedGenericExplicitMachine();
    editable.templates = { header: 'G90\nG21', footer: 'M30' };
    const machine = markMachineProfileUserVerified(editable);
    const document = initializeProjectCompensationIntents(
      createUpidFromDxfEntities([
        { type: 'circle', layer: 'CUT', center: { x: 0, y: 0 }, radius: 5 }
      ]),
      machine
    );

    const exported = composeUpidGCodeExport(document, { machine });

    expect(exported.canDownload).toBe(true);
    expect(exported.programBlocks.map((block) => block.programLineNumber)).toEqual([
      3, 4, 5, 6, 7, 8
    ]);
    expect(exported.programOperations[0]).toMatchObject({
      programLineStart: 3,
      programLineEnd: 8,
      programLineRange: '3-8'
    });
    expect(exported.program.lines.at(-1)).toMatchObject({
      lineNumber: 9, section: 'footer', text: 'M30'
    });
  });

  it('suppresses all executable composition when a generic compensation template conflicts', () => {
    const editable = verifiedGenericExplicitMachine();
    editable.templates.header = 'G90 G41 D0';
    const machine = markMachineProfileUserVerified(editable);
    const document = initializeProjectCompensationIntents(
      createUpidFromDxfEntities([
        { type: 'circle', layer: 'CUT', center: { x: 0, y: 0 }, radius: 5 }
      ]),
      machine
    );

    const exported = composeUpidGCodeExport(document, { machine });

    expect(exported.canDownload).toBe(false);
    expect(exported.post).toMatchObject({
      status: 'blocked', programOwned: true, body: '', blocks: [], moves: [], operations: []
    });
    expect(exported.program.lines).toEqual([]);
    expect(exported.programBlocks).toEqual([]);
    expect(exported.programOperations).toEqual([]);
  });

  it('owns structurally blocked generic compensated composition before validation can leak templates', () => {
    const editable = verifiedGenericExplicitMachine();
    editable.templates = { header: 'G90', footer: 'M30' };
    const machine = markMachineProfileUserVerified(editable);
    const document = initializeProjectCompensationIntents(
      createUpidFromDxfEntities([
        { type: 'circle', layer: 'CUT', center: { x: 0, y: 0 }, radius: 5 }
      ]),
      machine
    );
    document.plan.operations[0].startPoint = { x: 99, y: 99 };

    const exported = composeUpidGCodeExport(document, { machine });

    expect(exported.post).toMatchObject({
      status: 'blocked', programOwned: true, body: '', blocks: [], moves: [], operations: []
    });
    expect(exported.program.lines).toEqual([]);
  });

  it('fails atomically when a later generic compensated operation has no safe transition', () => {
    const machine = verifiedGenericExplicitMachine();
    const document = initializeProjectCompensationIntents(
      createUpidFromDxfEntities([
        { type: 'circle', layer: 'CUT', center: { x: -20, y: 0 }, radius: 3 },
        ...clockwiseRectangle(0, 0, 10, 5)
      ]),
      machine
    );

    const posted = postUpidForMachine(document, machine);

    expect(posted).toMatchObject({
      status: 'blocked', body: '', blocks: [], moves: [], operations: []
    });
  });

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

  it('keeps a manually compensated Robofil job verified when automatic defaulting is disabled', () => {
    const sourceMachine = createVerifiedCharmillesRobofil100Profile();
    const document = compensatedRectangle(sourceMachine, 'G41');
    const changed = structuredClone(sourceMachine);
    changed.compensation.enabledByDefault = false;
    const machine = normalizeMachineProfile(changed);

    const posted = postUpidForMachine(document, machine);

    expect(machine.controller.verification.status).toBe('user-verified');
    expect(posted.status).toBe('ready');
    expect(posted.body).toContain('\nG41 D0\n');
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

  it('keeps pure preview metadata empty when fixed precision blocks real Robofil geometry', () => {
    const machine = createVerifiedCharmillesRobofil100Profile();
    const source = createUpidFromDxfEntities(
      [{ type: 'circle', layer: 'CUT', center: { x: 1, y: 1 }, radius: 0.0004 }],
      { coincidenceEpsilon: 1e-12 }
    );
    source.geometryBasis = 'finished-contour';
    const document = setManualCompensationIntent(
      source,
      source.plan.operations[0].id,
      'inside'
    )!;

    const posted = postUpidForMachine(document, machine);

    expect(posted.status).toBe('blocked');
    expect(posted.diagnostics).toContainEqual(
      expect.objectContaining({
        message: expect.stringContaining('coordinate precision')
      })
    );
    expect(deriveVerifiedRobofilPreviewPostBlocks(document, machine)).toEqual([]);
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

function verifiedGenericExplicitMachine() {
  const machine = createDefaultMachineProfile();
  machine.id = 'verified-generic-explicit';
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
  return markMachineProfileUserVerified(machine, new Date('2026-07-13T00:00:00.000Z'));
}

function smoothAlternateStartEntities() {
  return [
    {
      type: 'arc' as const,
      layer: 'CUT',
      center: { x: 0, y: 0 },
      radius: 5,
      startAngle: 0,
      endAngle: 90,
      clockwise: false,
      start: { x: 5, y: 0 },
      end: { x: 0, y: 5 }
    },
    {
      type: 'arc' as const,
      layer: 'CUT',
      center: { x: 0, y: 0 },
      radius: 5,
      startAngle: 90,
      endAngle: 180,
      clockwise: false,
      start: { x: 0, y: 5 },
      end: { x: -5, y: 0 }
    },
    line(-5, 0, 5, 0)
  ];
}
