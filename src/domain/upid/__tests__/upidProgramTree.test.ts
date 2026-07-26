import { describe, expect, it, vi } from 'vitest';

import {
  initializeProjectCompensationIntents,
  setManualCompensationIntent
} from '@/domain/compensation/intent';
import {
  createCharmillesRobofil100V2CandidateProfile,
  createVerifiedCharmillesRobofil100Profile,
  markMachineProfileUserVerified
} from '@/domain/machine/machineProfiles';
import {
  setClosedOperationStartNearPoint,
  setCircleOperationCenterPierceLeadIn,
  setManualInitialWirePosition,
  setPathOperationManualLeadIn,
  setPathOperationTransitions
} from '@/domain/path-editor/pathDocumentOperations';
import * as machiningParticipation from '@/domain/path-intel/machiningParticipation';
import {
  setMachiningSpanParticipation,
  setPartialContourCompensationSide,
  setPartialContourEntryReview
} from '@/domain/path-intel/machiningParticipation';
import { postUpidForMachine } from '@/domain/post/upidMachinePost';
import { createUpidFromDxfEntities } from '@/domain/upid/upidDocument';
import { createDefaultMachineProfile } from '@/domain/workbench/defaultProject';

import {
  buildUpidProgramTree,
  type UpidProgramTreeNode
} from '../upidProgramTree';

describe('UPID program tree projection', () => {
  it('projects the same unsafe compensated lead blocker as the authoritative post', () => {
    const machine = createVerifiedCharmillesRobofil100Profile();
    const initialized = initializeProjectCompensationIntents(
      createUpidFromDxfEntities([
        { type: 'circle', layer: 'CUT', center: { x: 30, y: 30 }, radius: 5 }
      ]),
      machine
    );
    const operation = initialized.plan.operations[0];
    const document = setManualInitialWirePosition(
      setCircleOperationCenterPierceLeadIn(initialized, operation.id)!,
      { x: 0, y: 0 }
    )!;

    const posted = postUpidForMachine(document, machine);
    const tree = buildUpidProgramTree(document, machine);
    const cutPath = tree.operations[0].children.find((node) => node.label === 'Cut path');
    const entry = tree.operations[0].children.find(
      (node) => node.label === 'Entry / lead-in'
    );

    expect(posted.diagnostics).toContainEqual(expect.objectContaining({
      details: expect.objectContaining({
        reason: 'unsafe-controller-compensation-lead-in'
      })
    }));
    expect(entry).toMatchObject({
      status: 'blocked',
      statusReason: 'unsafe-controller-compensation-lead-in',
      statusActionTarget: {
        kind: 'entry-exit',
        operationId: operation.id
      }
    });
    expect(cutPath?.status).toBe('ready');
    expect(tree.programStatus).toBe('blocked');
    expect(tree.programStatusActionTarget).toEqual({
      kind: 'entry-exit',
      operationId: operation.id
    });
  });

  it('posts an imported circle-center entry through the generated explicit-linear lead', () => {
    const machine = verifiedGenericExplicitMachine();
    const initialized = initializeProjectCompensationIntents(
      createUpidFromDxfEntities([
        { type: 'circle', layer: 'CUT', center: { x: 0, y: 0 }, radius: 5 }
      ]),
      machine
    );
    const operation = initialized.plan.operations[0];
    const withCircleCenterEntry = setCircleOperationCenterPierceLeadIn(
      initialized,
      operation.id
    )!;
    const document = setManualInitialWirePosition(
      withCircleCenterEntry,
      { x: 0, y: 0 }
    )!;

    const posted = postUpidForMachine(document, machine);
    const tree = buildUpidProgramTree(document, machine);
    const entry = tree.operations[0].children.find(
      (node) => node.label === 'Entry / lead-in'
    );
    const generatedLead = posted.blocks.find((block) => block.kind === 'lead-in');

    expect(posted.status).toBe('ready');
    expect(generatedLead).toMatchObject({
      operationId: operation.id,
      endPoint: operation.startPoint
    });
    expect(generatedLead?.startPoint).not.toEqual({ x: 0, y: 0 });
    expect(entry).toMatchObject({
      status: 'ready',
      statusReason: undefined,
      statusActionTarget: undefined
    });
    expect(tree.programStatus).toBe('ready');
  });

  it('offers Contour start for a sharp manual start and clears the blocker after that workflow changes it', () => {
    const machine = verifiedGenericExplicitMachine();
    const initialized = initializeProjectCompensationIntents(
      createUpidFromDxfEntities(smoothAlternateStartEntities()),
      machine
    );
    const operation = initialized.plan.operations[0];
    const withInitialWire = setManualInitialWirePosition(initialized, { x: 0, y: 0 })!;
    const withSharpManualStart = setClosedOperationStartNearPoint(
      withInitialWire,
      operation.id,
      operation.startPoint
    )!;

    const blockedPost = postUpidForMachine(withSharpManualStart, machine);
    const blockedTree = buildUpidProgramTree(withSharpManualStart, machine);
    const blockedOperation = blockedTree.operations.find(
      (node) => node.operationId === operation.id
    )!;
    const blockedEntry = blockedOperation.children.find(
      (node) => node.label === 'Entry / lead-in'
    );
    const blockedCutPath = blockedOperation.children.find(
      (node) => node.label === 'Cut path'
    );
    const blockedContourStart = blockedCutPath?.children.find(
      (node) => node.label === 'Contour start'
    );

    expect(blockedPost.diagnostics).toContainEqual(expect.objectContaining({
      details: expect.objectContaining({ reason: 'sharp-manual-start' })
    }));
    expect(blockedEntry).toMatchObject({
      status: 'ready',
      statusReason: undefined,
      statusActionTarget: undefined
    });
    expect(blockedContourStart).toMatchObject({
      status: 'blocked',
      statusReason: 'sharp-manual-start',
      statusActionTarget: {
        kind: 'contour-start',
        operationId: operation.id
      }
    });
    expect(blockedCutPath).toMatchObject({
      status: 'blocked',
      statusReason: 'sharp-manual-start',
      statusActionTarget: {
        kind: 'contour-start',
        operationId: operation.id
      }
    });
    expect(blockedTree.programStatusActionTarget).toEqual({
      kind: 'contour-start',
      operationId: operation.id
    });

    const withSmoothManualStart = setClosedOperationStartNearPoint(
      withSharpManualStart,
      operation.id,
      { x: 0, y: 5 }
    )!;
    const readyPost = postUpidForMachine(withSmoothManualStart, machine);
    const readyTree = buildUpidProgramTree(withSmoothManualStart, machine);
    const readyContourStart = readyTree.operations
      .find((node) => node.operationId === operation.id)!
      .children.find((node) => node.label === 'Cut path')
      ?.children.find((node) => node.label === 'Contour start');

    expect(readyPost.status).toBe('ready');
    expect(readyContourStart).toMatchObject({
      status: 'ready',
      statusReason: undefined,
      statusActionTarget: undefined
    });
    expect(readyTree.programStatus).toBe('ready');
  });

  it('offers Contour start for no-safe-candidate and clears it with a smooth split start', () => {
    const machine = verifiedGenericExplicitMachine();
    const initialized = initializeProjectCompensationIntents(
      createUpidFromDxfEntities(sharpArcContourEntities()),
      machine
    );
    const operation = initialized.plan.operations[0];
    const document = setManualInitialWirePosition(initialized, { x: 0, y: 0 })!;

    const posted = postUpidForMachine(document, machine);
    const operationRoot = buildUpidProgramTree(document, machine).operations[0];
    const entry = operationRoot.children.find(
      (node) => node.label === 'Entry / lead-in'
    );
    const contourStart = operationRoot.children
      .find((node) => node.label === 'Cut path')
      ?.children.find((node) => node.label === 'Contour start');

    expect(posted.diagnostics).toContainEqual(expect.objectContaining({
      details: expect.objectContaining({ reason: 'no-safe-candidate' })
    }));
    expect(entry?.status).toBe('ready');
    expect(contourStart).toMatchObject({
      status: 'blocked',
      statusReason: 'no-safe-candidate',
      statusActionTarget: {
        kind: 'contour-start',
        operationId: operation.id
      }
    });

    const withSmoothSplitStart = setClosedOperationStartNearPoint(
      document,
      operation.id,
      { x: 5, y: 0 }
    )!;
    const readyPost = postUpidForMachine(withSmoothSplitStart, machine);
    const readyTree = buildUpidProgramTree(withSmoothSplitStart, machine);

    expect(readyPost.status).toBe('ready');
    expect(readyTree.operations[0].status).toBe('ready');
    expect(readyTree.programStatus).toBe('ready');
  });

  it('offers Machine setup for precision-collapse and clears it with verified output precision', () => {
    const blockedMachine = verifiedGenericExplicitMachine();
    blockedMachine.compensation.validationLeadLengthMm = 0.0004;
    const document = compensatedCircleDocument(blockedMachine);

    const blockedPost = postUpidForMachine(document, blockedMachine);
    const blockedTree = buildUpidProgramTree(document, blockedMachine);
    const machineSetup = blockedTree.sourceSetup.find(
      (node) => node.editTarget?.kind === 'machine-setup'
    );

    expect(blockedPost.diagnostics).toContainEqual(expect.objectContaining({
      details: expect.objectContaining({ reason: 'precision-collapse' })
    }));
    expect(blockedPost.diagnostics.find(
      (diagnostic) => diagnostic.details?.reason === 'precision-collapse'
    )?.details).toEqual({ reason: 'precision-collapse' });
    expect(machineSetup).toMatchObject({
      status: 'blocked',
      statusReason: 'precision-collapse',
      statusActionTarget: { kind: 'machine-setup' }
    });
    expect(blockedTree.sourceSetup.filter(
      (node) => node.statusReason === 'precision-collapse'
    )).toHaveLength(1);
    expect(blockedTree.programStatus).toBe('ready');

    const editedMachine = structuredClone(blockedMachine);
    editedMachine.output.coordinatePrecision = 4;
    const readyMachine = markMachineProfileUserVerified(editedMachine);
    const readyPost = postUpidForMachine(document, readyMachine);
    const readyTree = buildUpidProgramTree(document, readyMachine);

    expect(readyPost.status).toBe('ready');
    expect(readyTree.sourceSetupStatus).toBe('ready');
    expect(readyTree.status).toBe('ready');
  });

  it('offers Machine setup for outside-work-area and clears it with a larger work area', () => {
    const blockedMachine = verifiedGenericExplicitMachine();
    blockedMachine.workArea = { widthMm: 10, lengthMm: 10 };
    const document = compensatedCircleDocument(blockedMachine);

    const blockedPost = postUpidForMachine(document, blockedMachine);
    const blockedTree = buildUpidProgramTree(document, blockedMachine);
    const machineSetup = blockedTree.sourceSetup.find(
      (node) => node.editTarget?.kind === 'machine-setup'
    );

    expect(blockedPost.diagnostics).toContainEqual(expect.objectContaining({
      details: expect.objectContaining({ reason: 'outside-work-area' })
    }));
    expect(machineSetup).toMatchObject({
      status: 'blocked',
      statusReason: 'outside-work-area',
      statusActionTarget: { kind: 'machine-setup' }
    });
    expect(blockedTree.sourceSetup.filter(
      (node) => node.statusReason === 'outside-work-area'
    )).toHaveLength(1);
    expect(blockedTree.programStatus).toBe('ready');

    const readyMachine = structuredClone(blockedMachine);
    readyMachine.workArea = { widthMm: 20, lengthMm: 20 };
    const readyPost = postUpidForMachine(document, readyMachine);
    const readyTree = buildUpidProgramTree(document, readyMachine);

    expect(readyPost.status).toBe('ready');
    expect(readyTree.sourceSetupStatus).toBe('ready');
    expect(readyTree.status).toBe('ready');
  });

  it('owns generated collision at Contour start with or without an explicit start', () => {
    const machine = verifiedGenericExplicitMachine();
    let initialized = initializeProjectCompensationIntents(
      createUpidFromDxfEntities([
        { type: 'circle', layer: 'CUT', center: { x: 0, y: 0 }, radius: 5 },
        line(5.2, -2, 5.2, -0.5)
      ]),
      machine
    );
    const operation = initialized.plan.operations.find((candidate) => candidate.closed)!;
    const obstacle = initialized.plan.operations.find((candidate) => !candidate.closed)!;
    initialized = setMachiningSpanParticipation(initialized, {
      sourceSegmentId: obstacle.segmentRefs[0].segmentId,
      range: { start: 0, end: 1 },
      participation: 'inactive-reference'
    })!;
    const automatic = setManualInitialWirePosition(initialized, { x: 0, y: 0 })!;

    const automaticTree = buildUpidProgramTree(automatic, machine);
    const automaticRoot = automaticTree.operations.find(
      (node) => node.operationId === operation.id
    )!;
    const automaticEntry = automaticRoot.children.find(
      (node) => node.label === 'Entry / lead-in'
    );
    const automaticContourStart = automaticRoot.children
      .find((node) => node.label === 'Cut path')
      ?.children.find((node) => node.label === 'Contour start');

    expect(postUpidForMachine(automatic, machine).diagnostics).toContainEqual(
      expect.objectContaining({
        details: expect.objectContaining({ reason: 'collision' })
      })
    );
    expect(automaticEntry).toMatchObject({
      status: 'ready',
      statusReason: undefined,
      statusActionTarget: undefined
    });
    expect(automaticContourStart).toMatchObject({
      status: 'blocked',
      statusReason: 'collision',
      statusActionTarget: {
        kind: 'contour-start',
        operationId: operation.id
      }
    });

    const relocated = setClosedOperationStartNearPoint(
      automatic,
      operation.id,
      { x: 0, y: 5 }
    )!;
    const relocatedPost = postUpidForMachine(relocated, machine);
    const relocatedTree = buildUpidProgramTree(relocated, machine);
    const relocatedRoot = relocatedTree.operations.find(
      (node) => node.operationId === operation.id
    )!;
    const relocatedContourStart = relocatedRoot.children
      .find((node) => node.label === 'Cut path')
      ?.children.find((node) => node.label === 'Contour start');

    expect(relocatedPost.status).toBe('ready');
    expect(relocatedContourStart).toMatchObject({
      status: 'ready',
      statusReason: undefined,
      statusActionTarget: undefined
    });
    expect(relocatedRoot.statusReason).not.toBe('collision');
    expect(relocatedTree.programStatusReason).not.toBe('collision');

    const manual = setClosedOperationStartNearPoint(
      automatic,
      operation.id,
      operation.startPoint
    )!;
    const manualRoot = buildUpidProgramTree(manual, machine).operations.find(
      (node) => node.operationId === operation.id
    )!;
    const manualEntry = manualRoot.children.find(
      (node) => node.label === 'Entry / lead-in'
    );
    const manualContourStart = manualRoot.children
      .find((node) => node.label === 'Cut path')
      ?.children.find((node) => node.label === 'Contour start');

    expect(postUpidForMachine(manual, machine).diagnostics).toContainEqual(
      expect.objectContaining({
        details: expect.objectContaining({ reason: 'collision' })
      })
    );
    expect(manualEntry?.status).toBe('ready');
    expect(manualContourStart).toMatchObject({
      status: 'blocked',
      statusReason: 'collision',
      statusActionTarget: {
        kind: 'contour-start',
        operationId: operation.id
      }
    });
  });

  it('owns an unverified machine blocker once in Source & Setup', () => {
    const machine = createCharmillesRobofil100V2CandidateProfile();
    const document = initializeProjectCompensationIntents(
      twoRectangleDocument(),
      machine
    );

    const posted = postUpidForMachine(document, machine);
    const tree = buildUpidProgramTree(document, machine);
    const machineSetup = tree.sourceSetup.find(
      (node) => node.editTarget?.kind === 'machine-setup'
    );

    expect(posted.diagnostics).toContainEqual(expect.objectContaining({
      details: expect.objectContaining({ reason: 'unverified-machine-profile' })
    }));
    expect(machineSetup).toMatchObject({
      status: 'blocked',
      statusReason: 'unverified-machine-profile',
      statusActionTarget: { kind: 'machine-setup' }
    });
    expect(tree.sourceSetupStatus).toBe('blocked');
    expect(tree.sourceSetupStatusReason).toBe('unverified-machine-profile');
    expect(tree.sourceSetupStatusActionTarget).toEqual({ kind: 'machine-setup' });
    expect(tree.operations.every((operation) =>
      operation.statusReason !== 'unverified-machine-profile'
    )).toBe(true);
    expect(tree.programStatus).toBe('ready');
    expect(tree.status).toBe('blocked');
  });

  it('does not duplicate an unsupported machine blocker onto compensated Cut Paths', () => {
    const machine = createDefaultMachineProfile();
    let document = createUpidFromDxfEntities(rectangleLines(0, 0, 10, 5));
    document.geometryBasis = 'finished-contour';
    document = setManualCompensationIntent(
      document,
      document.plan.operations[0].id,
      'outside'
    )!;
    document = setManualInitialWirePosition(document, { x: 0, y: 0 })!;
    const operation = document.plan.operations[0];

    const posted = postUpidForMachine(document, machine);
    const tree = buildUpidProgramTree(document, machine);
    const machineSetup = tree.sourceSetup.find(
      (node) => node.editTarget?.kind === 'machine-setup'
    );
    const cutPath = tree.operations[0].children.find(
      (node) => node.label === 'Cut path'
    );

    expect(posted.diagnostics).toContainEqual(expect.objectContaining({
      details: expect.objectContaining({ reason: 'unsupported-machine-profile' })
    }));
    expect(machineSetup).toMatchObject({
      status: 'blocked',
      statusReason: 'unsupported-machine-profile',
      statusActionTarget: { kind: 'machine-setup' }
    });
    expect(tree.sourceSetupStatus).toBe('blocked');
    expect(tree.sourceSetupStatusReason).toBe('unsupported-machine-profile');
    expect(tree.sourceSetupStatusActionTarget).toEqual({ kind: 'machine-setup' });
    expect(cutPath).toMatchObject({
      status: 'ready',
      statusReason: undefined,
      statusActionTarget: undefined
    });
    expect(tree.operations[0].status).toBe('ready');
    expect(tree.programStatus).toBe('ready');
    expect(tree.programStatusReason).toBeUndefined();
    expect(tree.status).toBe('blocked');
    expect(operation.compensationIntent?.mode).toBe('controller');
  });

  it('keeps an operation-specific compensation blocker on its Cut Path', () => {
    const machine = createVerifiedCharmillesRobofil100Profile();
    const document = initializeProjectCompensationIntents(
      createUpidFromDxfEntities(rectangleLines(0, 0, 10, 5)),
      machine
    );
    const operation = document.plan.operations[0];
    document.diagnostics = [{
      id: 'imported-topology-review',
      severity: 'warning',
      code: 'intersecting-topology',
      message: 'Imported topology requires compensation review.',
      relatedSegmentIds: [operation.segmentRefs[0].segmentId]
    }];
    document.setup = {
      initialWirePosition: {
        kind: 'manual',
        point: { x: 0, y: 0 },
        review: 'reviewed'
      }
    };

    const posted = postUpidForMachine(document, machine);
    const tree = buildUpidProgramTree(document, machine);
    const operationRoot = tree.operations[0];
    const entry = operationRoot.children.find((node) => node.label === 'Entry / lead-in');
    const cutPath = operationRoot.children.find((node) => node.label === 'Cut path');

    expect(posted.diagnostics).toContainEqual(expect.objectContaining({
      details: expect.objectContaining({ reason: 'compensation-resolution-blocked' })
    }));
    expect(entry?.status).toBe('ready');
    expect(cutPath).toMatchObject({
      status: 'blocked',
      statusReason: 'compensation-resolution-blocked',
      statusActionTarget: {
        kind: 'operation',
        operationId: operation.id
      }
    });
    expect(tree.sourceSetupStatus).toBe('ready');
    expect(tree.programStatus).toBe('blocked');
    expect(tree.programStatusReason).toBe('compensation-resolution-blocked');
    expect(tree.programStatusActionTarget).toEqual({
      kind: 'operation',
      operationId: operation.id
    });
  });

  it('blocks configured stops when the selected post cannot own them', () => {
    const machine = createDefaultMachineProfile();
    machine.programStops = {
      supported: true,
      code: 'M00',
      allowedPlacements: ['before-entry'],
      allowCompensationActive: false
    };
    const document = createUpidFromDxfEntities([line(0, 0, 10, 0)]);
    const operation = document.plan.operations[0];
    operation.programStops = [stop('must-not-disappear', 'before-entry')];

    const tree = buildUpidProgramTree(document, machine);

    expect(postUpidForMachine(document, machine).diagnostics).toContainEqual(
      expect.objectContaining({
        details: expect.objectContaining({ reason: 'program-stop-post-unsupported' })
      })
    );
    expect(tree.operations[0].children[0]).toMatchObject({
      status: 'blocked',
      statusReason: 'program-stop-post-unsupported'
    });
    expect(tree.programStatusReason).toBe('program-stop-post-unsupported');
  });

  it('validates remaining-distance stops against the derived partial cut path', () => {
    const machine = markMachineProfileUserVerified(
      createCharmillesRobofil100V2CandidateProfile()
    );
    let document = initializeProjectCompensationIntents(
      createUpidFromDxfEntities(rectangleLines(0, 0, 10, 5)),
      machine
    );
    const source = document.plan.operations[0];
    document = setPathOperationManualLeadIn(document, source.id, { x: -2, y: -2 })!;
    document = setPartialContourCompensationSide(document, source.id, 'left')!;
    document = setMachiningSpanParticipation(document, {
      sourceSegmentId: source.segmentRefs[0].segmentId,
      range: { start: 0, end: 1 },
      participation: 'inactive-reference'
    })!;
    document = setPartialContourEntryReview(document, source.id, true)!;
    document = setPathOperationTransitions(document, source.id, {
      ...document.plan.operations[0].transitions,
      exit: { strategy: 'none', review: 'reviewed' }
    })!;
    document = setManualInitialWirePosition(document, { x: -2, y: -2 })!;
    document.plan.operations[0].programStops = [
      stop('too-long-for-partial-path', 'before-operation-end', 25)
    ];

    const posted = postUpidForMachine(document, machine);
    const tree = buildUpidProgramTree(document, machine);
    const cutPath = tree.operations[0].children.find((node) => node.label === 'Cut path');
    const stopNode = cutPath?.children.find(
      (node) => node.editTarget?.kind === 'program-stop'
    );

    expect(posted.diagnostics).toContainEqual(expect.objectContaining({
      details: expect.objectContaining({
        reason: 'program-stop-blocked',
        programStopReason: 'invalid-program-stop'
      })
    }));
    expect(stopNode).toMatchObject({
      status: 'blocked',
      statusReason: 'invalid-program-stop'
    });
    expect(cutPath?.status).toBe('blocked');
  });

  it('makes suppressed operation phases inactive and uses the next effective operation as first', () => {
    const document = twoRectangleDocument();
    const suppressed = document.plan.operations[0];
    const next = document.plan.operations[1];
    next.threadingTransition = {
      mode: 'automatic',
      wireSeparation: 'automatic-before-positioning',
      source: 'operation-override'
    };
    suppressed.programStops = [stop('suppressed-stop', 'before-entry')];
    const edited = suppressed.segmentRefs.reduce((current, ref) => {
      const nextDocument = setMachiningSpanParticipation(current, {
        sourceSegmentId: ref.segmentId,
        range: { start: 0, end: 1 },
        participation: 'inactive-reference'
      });
      expect(nextDocument).not.toBeNull();
      return nextDocument!;
    }, document);

    const tree = buildUpidProgramTree(
      edited,
      createCharmillesRobofil100V2CandidateProfile()
    );
    const suppressedRoot = tree.operations.find((node) => node.operationId === suppressed.id)!;
    const nextRoot = tree.operations.find((node) => node.operationId === next.id)!;
    const executionChildren = suppressedRoot.children.filter(
      (node) => node.editTarget?.kind !== 'diagnostics'
    );

    expect(executionChildren.every((node) =>
      node.status === 'inactive' &&
      node.statusReason === 'operation-suppressed-by-machining-participation'
    )).toBe(true);
    expect(nextRoot.children[0]).toMatchObject({
      label: 'Incoming connection',
      detail: 'Initial wire position',
      status: 'ready'
    });
  });

  it('projects source setup and operations in execution order', () => {
    const document = twoRectangleDocument();
    const first = document.plan.operations[0];
    const second = document.plan.operations[1];
    first.transitions = {
      entry: {
        strategy: 'manual-straight',
        move: 'cut',
        from: { x: 6, y: 6 },
        to: { x: 5, y: 5 },
        review: 'reviewed'
      },
      exit: {
        strategy: 'manual-straight',
        move: 'cut',
        from: { x: 5, y: 5 },
        to: { x: 6, y: 6 },
        review: 'reviewed'
      }
    };
    first.programStops = [
      stop('stop-before-entry', 'before-entry'),
      stop('stop-before-end', 'before-operation-end', 5),
      stop('stop-after-contour', 'after-contour'),
      stop('stop-after-exit', 'after-exit')
    ];
    second.threadingTransition = {
      mode: 'manual',
      wireSeparation: 'manual-before-positioning',
      source: 'operation-override'
    };

    const tree = buildUpidProgramTree(document, createDefaultMachineProfile());

    expect(tree.operations.map((node) => node.label)).toEqual([
      '01 · Hole 1',
      '02 · Exterior 1'
    ]);
    expect(tree.sourceSetup.map((node) => node.editTarget?.kind)).toEqual([
      'path-summary',
      'geometry-setup',
      'machine-setup',
      'initial-wire',
      'threading-default'
    ]);
    expect(tree.operations[0].children.map((node) => node.label)).toEqual([
      'M00 · Before entry',
      'Incoming connection',
      'Entry / lead-in',
      'Cut path',
      'M00 · After contour',
      'Exit / lead-out',
      'M00 · After exit'
    ]);
    expect(
      tree.operations[0].children
        .find((node) => node.label === 'Cut path')
        ?.children.map((node) => node.editTarget)
    ).toContainEqual({
      kind: 'program-stop',
      operationId: first.id,
      stopId: 'stop-before-end'
    });
    expect(tree.operations[1].children[0]).toMatchObject({
      detail: 'Manual rethread',
      editTarget: { kind: 'incoming-connection', operationId: second.id }
    });
  });

  it('derives a ready multi-operation document once', () => {
    const derive = vi.spyOn(machiningParticipation, 'deriveActiveMachiningOperations');
    const document = twoRectangleDocument();

    try {
      const tree = buildUpidProgramTree(
        document,
        createCharmillesRobofil100V2CandidateProfile()
      );

      expect(tree.operations).toHaveLength(2);
      expect(derive).toHaveBeenCalledTimes(1);
    } finally {
      derive.mockRestore();
    }
  });

  it('keeps disabled program stops visible but inactive', () => {
    const document = twoRectangleDocument();
    const operation = document.plan.operations[0];
    operation.programStops = [{
      ...stop('disabled-stop', 'after-contour'),
      enabled: false
    }];

    const tree = buildUpidProgramTree(document, createDefaultMachineProfile());

    expect(tree.operations[0].children).toContainEqual(expect.objectContaining({
      label: 'M00 · After contour',
      status: 'inactive',
      editTarget: { kind: 'program-stop', operationId: operation.id, stopId: 'disabled-stop' }
    }));
  });

  it('blocks enabled stops at the authoritative post-ownership boundary', () => {
    const document = twoRectangleDocument();
    const operation = document.plan.operations[0];
    operation.programStops = [stop('blocked-stop', 'before-entry')];

    const tree = buildUpidProgramTree(document, createDefaultMachineProfile());

    expect(tree.operations[0].children).toContainEqual(expect.objectContaining({
      label: 'M00 · Before entry',
      status: 'blocked',
      statusReason: 'program-stop-post-unsupported'
    }));
    expect(tree.operations[0].status).toBe('blocked');
  });

  it('projects effective partial machining paths back onto their source operation', () => {
    const document = twoRectangleDocument();
    const source = document.plan.operations[0];
    const inactiveSegmentId = source.segmentRefs[0].segmentId;
    const edited = setMachiningSpanParticipation(document, {
      sourceSegmentId: inactiveSegmentId,
      range: { start: 0, end: 1 },
      participation: 'inactive-reference'
    });

    expect(edited).not.toBeNull();
    const tree = buildUpidProgramTree(edited!, createCharmillesRobofil100V2CandidateProfile());
    const sourceRoot = tree.operations.find((node) => node.operationId === source.id);
    const cutPath = sourceRoot?.children.find((node) => node.label === 'Cut path');
    const effectivePath = cutPath?.children.find((node) => node.label === 'Effective machining path');
    const spans = effectivePath?.children.filter((node) => node.kind === 'span') ?? [];

    expect(tree.operations).toHaveLength(document.plan.operations.length);
    expect(effectivePath).toMatchObject({
      detail: '3 segments',
      operationId: source.id,
      editTarget: { kind: 'machining-participation', operationId: source.id }
    });
    expect(spans).toHaveLength(3);
    expect(spans.every((span) =>
      span.operationId === source.id &&
      span.editTarget?.kind === 'machining-participation' &&
      span.editTarget.operationId === source.id
    )).toBe(true);
  });

  it('rolls active-machining derivation failures into affected source operations', () => {
    const document = twoRectangleDocument();
    const source = document.plan.operations[0];
    const firstInactive = setMachiningSpanParticipation(document, {
      sourceSegmentId: source.segmentRefs[0].segmentId,
      range: { start: 0, end: 1 },
      participation: 'inactive-reference'
    });
    const splitIntoMultipleGroups = setMachiningSpanParticipation(firstInactive!, {
      sourceSegmentId: source.segmentRefs[2].segmentId,
      range: { start: 0, end: 1 },
      participation: 'inactive-reference'
    });

    expect(splitIntoMultipleGroups).not.toBeNull();
    const tree = buildUpidProgramTree(
      splitIntoMultipleGroups!,
      createCharmillesRobofil100V2CandidateProfile()
    );
    const sourceRoot = tree.operations.find((node) => node.operationId === source.id);
    const cutPath = sourceRoot?.children.find((node) => node.label === 'Cut path');

    expect(cutPath).toMatchObject({
      status: 'blocked',
      statusReason: 'multiple-active-groups-require-explicit-semantics',
      statusActionTarget: {
        kind: 'machining-participation',
        operationId: source.id
      }
    });
    expect(sourceRoot).toMatchObject({
      status: 'blocked',
      statusReason: 'multiple-active-groups-require-explicit-semantics',
      statusActionTarget: {
        kind: 'machining-participation',
        operationId: source.id
      }
    });
    expect(tree.programStatus).toBe('blocked');
    expect(tree.programStatusReason).toBe(
      'multiple-active-groups-require-explicit-semantics'
    );
    expect(tree.programStatusActionTarget).toEqual({
      kind: 'machining-participation',
      operationId: source.id
    });
  });

  it('keeps an untouched operation truthful when another operation cannot derive', () => {
    const document = twoRectangleDocument();
    const failing = document.plan.operations[0];
    const untouched = document.plan.operations[1];
    const edited = setInactiveSegments(document, failing, [0, 2]);

    const tree = buildUpidProgramTree(edited, createTreeMachine());
    const failingRoot = tree.operations.find((node) => node.operationId === failing.id);
    const untouchedRoot = tree.operations.find((node) => node.operationId === untouched.id);
    const untouchedCutPath = untouchedRoot?.children.find((node) => node.label === 'Cut path');

    expect(failingRoot?.status).toBe('blocked');
    expect(untouchedRoot?.status).toBe('ready');
    expect(untouchedRoot?.statusReason).toBeUndefined();
    expect(untouchedCutPath).toMatchObject({
      detail: '4 segments',
      status: 'ready'
    });
  });

  it('preserves a valid partial path when another operation cannot derive', () => {
    const document = twoRectangleDocument();
    const validPartial = document.plan.operations[0];
    const failing = document.plan.operations[1];
    const partiallyEdited = setInactiveSegments(document, validPartial, [0]);
    const edited = setInactiveSegments(partiallyEdited, failing, [0, 2]);

    const tree = buildUpidProgramTree(edited, createTreeMachine());
    const validRoot = tree.operations.find((node) => node.operationId === validPartial.id);
    const failingRoot = tree.operations.find((node) => node.operationId === failing.id);
    const effectivePath = validRoot?.children
      .find((node) => node.label === 'Cut path')
      ?.children.find((node) => node.label === 'Effective machining path');

    expect(validRoot?.status).toBe('ready');
    expect(effectivePath).toMatchObject({
      detail: '3 segments',
      operationId: validPartial.id,
      status: 'ready'
    });
    expect(failingRoot?.status).toBe('blocked');
  });

  it('preserves an unowned malformed participation failure at program level', () => {
    const document = twoRectangleDocument();
    document.machiningParticipation = {
      spans: [{
        id: 'orphan-span',
        sourceSegmentId: 'missing-segment',
        range: { start: 0, end: 1 },
        participation: 'inactive-reference'
      }]
    };

    const tree = buildUpidProgramTree(document, createCharmillesRobofil100V2CandidateProfile());

    expect(tree.operations.every((operation) => operation.status === 'ready')).toBe(true);
    expect(tree.programStatus).toBe('blocked');
    expect(tree.programStatusReason).toBe('missing-source-segment');
    expect(tree.programStatusActionTarget).toEqual({
      kind: 'machining-participation'
    });
  });

  it('preserves an unowned integrity failure alongside an owned derivation failure', () => {
    const document = twoRectangleDocument();
    const failing = document.plan.operations[0];
    const untouched = document.plan.operations[1];
    const edited = setInactiveSegments(document, failing, [0, 2]);
    edited.machiningParticipation!.spans.push({
      id: 'orphan-span',
      sourceSegmentId: 'missing-segment',
      range: { start: 0, end: 1 },
      participation: 'inactive-reference'
    });

    const tree = buildUpidProgramTree(edited, createTreeMachine());
    const failingRoot = tree.operations.find((node) => node.operationId === failing.id);
    const untouchedRoot = tree.operations.find((node) => node.operationId === untouched.id);

    expect(failingRoot).toMatchObject({
      status: 'blocked',
      children: expect.arrayContaining([
        expect.objectContaining({
          label: 'Cut path',
          statusReason: 'multiple-active-groups-require-explicit-semantics'
        })
      ])
    });
    expect(untouchedRoot?.status).toBe('ready');
    expect(tree.programStatus).toBe('blocked');
    expect(tree.programStatusReason).toBe('missing-source-segment');
  });

  it('keeps a fully suppressed source operation visible but inactive', () => {
    const document = twoRectangleDocument();
    const source = document.plan.operations[0];
    const edited = source.segmentRefs.reduce((current, ref) => {
      const next = setMachiningSpanParticipation(current, {
        sourceSegmentId: ref.segmentId,
        range: { start: 0, end: 1 },
        participation: 'inactive-reference'
      });
      expect(next).not.toBeNull();
      return next!;
    }, document);

    const tree = buildUpidProgramTree(edited, createCharmillesRobofil100V2CandidateProfile());
    const sourceRoot = tree.operations.find((node) => node.operationId === source.id);
    const cutPath = sourceRoot?.children.find((node) => node.label === 'Cut path');

    expect(sourceRoot).toMatchObject({
      status: 'inactive',
      statusReason: 'operation-suppressed-by-machining-participation'
    });
    expect(cutPath).toMatchObject({
      detail: '0 segments',
      status: 'inactive',
      statusReason: 'operation-suppressed-by-machining-participation'
    });
  });

  it('rolls derived partial entry and exit review onto the saved source operation', () => {
    const document = twoRectangleDocument();
    const source = document.plan.operations[0];
    source.transitions = {
      entry: {
        strategy: 'manual-straight',
        move: 'cut',
        from: { x: -2, y: -2 },
        to: source.startPoint,
        review: 'reviewed'
      },
      exit: {
        strategy: 'manual-straight',
        move: 'cut',
        from: source.endPoint,
        to: { x: -2, y: -2 },
        review: 'reviewed'
      }
    };
    const edited = setInactiveSegments(document, source, [0]);

    const tree = buildUpidProgramTree(edited, createTreeMachine());
    const sourceRoot = tree.operations.find((node) => node.operationId === source.id);
    const entry = sourceRoot?.children.find((node) => node.label === 'Entry / lead-in');
    const exit = sourceRoot?.children.find((node) => node.label === 'Exit / lead-out');

    expect(entry).toMatchObject({
      status: 'review-required',
      operationId: source.id,
      editTarget: { kind: 'entry-exit', operationId: source.id }
    });
    expect(exit).toMatchObject({
      status: 'review-required',
      operationId: source.id,
      editTarget: { kind: 'entry-exit', operationId: source.id }
    });
    expect(sourceRoot?.status).toBe('review-required');
    expect(tree.programStatus).toBe('review-required');

    const reviewed = setPartialContourEntryReview(edited, source.id, true);
    expect(reviewed).not.toBeNull();
    const reviewedRoot = buildUpidProgramTree(
      reviewed!,
      createTreeMachine()
    ).operations.find((node) => node.operationId === source.id);

    expect(reviewedRoot?.children.find((node) => node.label === 'Entry / lead-in')?.status)
      .toBe('ready');
    expect(reviewedRoot?.children.find((node) => node.label === 'Exit / lead-out')?.status)
      .toBe('review-required');
  });

  it('uses sorted execution position rather than gapped orderIndex or backing array order', () => {
    const document = twoRectangleDocument();
    const first = document.plan.operations[0];
    const second = document.plan.operations[1];
    first.orderIndex = 5;
    second.orderIndex = 17;
    second.threadingTransition = {
      mode: 'manual',
      wireSeparation: 'manual-before-positioning',
      source: 'operation-override'
    };
    document.plan.operations = [second, first];

    const tree = buildUpidProgramTree(document, createTreeMachine());

    expect(tree.operations.map((node) => node.label)).toEqual([
      '01 · Hole 1',
      '02 · Exterior 1'
    ]);
    expect(tree.operations[0].children[0]).toMatchObject({
      label: 'Incoming connection',
      detail: 'Initial wire position',
      status: 'ready'
    });
    expect(tree.operations[1].children[0]).toMatchObject({
      label: 'Incoming connection',
      detail: 'Manual rethread',
      status: 'ready'
    });
  });

  it('uses deterministic execution positions for duplicate orderIndex values', () => {
    const document = twoRectangleDocument();
    const first = document.plan.operations[0];
    const second = document.plan.operations[1];
    first.orderIndex = 9;
    second.orderIndex = 9;
    document.plan.operations = [second, first];

    const tree = buildUpidProgramTree(document, createTreeMachine());

    expect(tree.operations.map((node) => ({
      label: node.label,
      operationId: node.operationId,
      sequenceEditTarget: node.sequenceEditTarget
    }))).toEqual([
      {
        label: '01 · Hole 1',
        operationId: first.id,
        sequenceEditTarget: { kind: 'cut-sequence', operationId: first.id }
      },
      {
        label: '02 · Exterior 1',
        operationId: second.id,
        sequenceEditTarget: { kind: 'cut-sequence', operationId: second.id }
      }
    ]);
  });

  it('marks entry and exit phases that require review', () => {
    const document = twoRectangleDocument();
    const operation = document.plan.operations[0];
    operation.transitions = {
      entry: { strategy: 'none', review: 'required' },
      exit: { strategy: 'none', review: 'required' }
    };

    const tree = buildUpidProgramTree(document, createDefaultMachineProfile());

    expect(tree.operations[0].children).toContainEqual(expect.objectContaining({
      label: 'Entry / lead-in', status: 'review-required'
    }));
    expect(tree.operations[0].children).toContainEqual(expect.objectContaining({
      label: 'Exit / lead-out', status: 'review-required'
    }));
    expect(tree.operations[0].status).toBe('review-required');
  });

  it('keeps Contour Start informational and non-editable for an open operation', () => {
    const document = twoRectangleDocument();
    const operation = document.plan.operations[1];
    operation.closed = false;

    const tree = buildUpidProgramTree(document, createTreeMachine());
    const contourStart = tree.operations[1].children
      .find((node) => node.label === 'Cut path')
      ?.children.find((node) => node.label === 'Contour start');

    expect(contourStart).toMatchObject({
      detail: 'Closed contours only',
      operationId: operation.id,
      status: 'inactive'
    });
    expect(contourStart?.editTarget).toBeUndefined();
  });

  it('associates related diagnostics with owning operations and reports section statuses', () => {
    const document = twoRectangleDocument();
    const first = document.plan.operations[0];
    const second = document.plan.operations[1];
    document.diagnostics = [
      {
        id: 'first-error',
        severity: 'error',
        code: 'intersecting-topology',
        message: 'Cannot build the first path.',
        relatedSegmentIds: [first.segmentRefs[0].segmentId]
      },
      {
        id: 'second-warning',
        severity: 'warning',
        code: 'open-chain',
        message: 'Review the second path.',
        relatedChainIds: [second.chainId]
      }
    ];

    const tree = buildUpidProgramTree(document, createTreeMachine());
    const firstRoot = tree.operations.find((node) => node.operationId === first.id);
    const secondRoot = tree.operations.find((node) => node.operationId === second.id);

    expect(firstRoot?.children).toContainEqual(expect.objectContaining({
      label: 'Cannot build the first path.',
      status: 'blocked',
      editTarget: { kind: 'diagnostics', diagnosticId: 'first-error' }
    }));
    expect(secondRoot?.children).toContainEqual(expect.objectContaining({
      label: 'Review the second path.',
      status: 'review-required',
      editTarget: { kind: 'diagnostics', diagnosticId: 'second-warning' }
    }));
    expect(firstRoot?.status).toBe('blocked');
    expect(secondRoot?.status).toBe('review-required');
    expect(tree.sourceSetupStatus).toBe('ready');
    expect(tree.programStatus).toBe('blocked');
    expect(tree.status).toBe('blocked');
  });

  it('keeps unowned diagnostics in Source & Setup without changing Program Sequence status', () => {
    const document = twoRectangleDocument();
    document.diagnostics = [{
      id: 'source-warning',
      severity: 'warning',
      code: 'dxf-import-warning',
      message: 'Review source units.'
    }];
    const tree = buildUpidProgramTree(document, createTreeMachine());
    const diagnostics = tree.sourceSetup[0].children;

    expect(diagnostics).toContainEqual(expect.objectContaining({
      label: 'Review source units.',
      status: 'review-required',
      editTarget: { kind: 'diagnostics', diagnosticId: 'source-warning' }
    }));
    expect(tree.sourceSetupStatus).toBe('review-required');
    expect(tree.programStatus).toBe('ready');
    expect(tree.status).toBe('review-required');
  });

  it('keeps Cut path selection-only and exposes Cut Sequence on the operation root', () => {
    const document = twoRectangleDocument();
    const operation = document.plan.operations[0];

    const tree = buildUpidProgramTree(document, createCharmillesRobofil100V2CandidateProfile());
    const operationRoot = tree.operations[0];
    const cutPath = operationRoot.children.find((node) => node.label === 'Cut path');

    expect(operationRoot.sequenceEditTarget).toEqual({
      kind: 'cut-sequence',
      operationId: operation.id
    });
    expect(cutPath?.operationId).toBe(operation.id);
    expect(cutPath?.editTarget).toBeUndefined();
  });

  it('keeps tree keys unique when one imported operation id contains another node suffix', () => {
    const document = twoRectangleDocument();
    const [first, second] = document.plan.operations;
    const firstOriginalId = first.id;
    const secondOriginalId = second.id;
    first.id = 'alpha';
    second.id = 'alpha:entry';
    for (const pathElement of document.pathElements) {
      if (pathElement.operationId === firstOriginalId) pathElement.operationId = first.id;
      if (pathElement.operationId === secondOriginalId) pathElement.operationId = second.id;
    }

    const tree = buildUpidProgramTree(document, createCharmillesRobofil100V2CandidateProfile());
    const nodes = flattenTreeNodes([...tree.sourceSetup, ...tree.operations]);
    const firstRoot = tree.operations.find((node) => node.operationId === first.id)!;
    const firstEntry = firstRoot.children.find((node) => node.label === 'Entry / lead-in')!;
    const secondRoot = tree.operations.find((node) => node.operationId === second.id)!;

    expect(firstEntry.treeKey).not.toBe(secondRoot.treeKey);
    expect(new Set(nodes.map((node) => node.treeKey))).toHaveLength(nodes.length);
    expect(firstEntry.editTarget).toEqual({
      kind: 'entry-exit',
      operationId: 'alpha'
    });
    expect(secondRoot.editTarget).toEqual({
      kind: 'operation',
      operationId: 'alpha:entry'
    });
  });
});

function flattenTreeNodes(nodes: readonly UpidProgramTreeNode[]): UpidProgramTreeNode[] {
  return nodes.flatMap((node) => [node, ...flattenTreeNodes(node.children)]);
}

function twoRectangleDocument() {
  const document = createUpidFromDxfEntities([
    ...rectangleLines(0, 0, 20, 20),
    ...rectangleLines(5, 5, 10, 10)
  ]);
  document.setup = {
    initialWirePosition: {
      kind: 'manual',
      point: { x: 0, y: 0 },
      review: 'reviewed'
    }
  };
  return document;
}

function setInactiveSegments(
  document: ReturnType<typeof twoRectangleDocument>,
  operation: ReturnType<typeof twoRectangleDocument>['plan']['operations'][number],
  segmentIndexes: readonly number[]
) {
  return segmentIndexes.reduce((current, index) => {
    const next = setMachiningSpanParticipation(current, {
      sourceSegmentId: operation.segmentRefs[index].segmentId,
      range: { start: 0, end: 1 },
      participation: 'inactive-reference'
    });
    expect(next).not.toBeNull();
    return next!;
  }, document);
}

function rectangleLines(minX: number, minY: number, maxX: number, maxY: number) {
  return [
    { type: 'line' as const, layer: 'CUT', start: { x: minX, y: minY }, end: { x: maxX, y: minY } },
    { type: 'line' as const, layer: 'CUT', start: { x: maxX, y: minY }, end: { x: maxX, y: maxY } },
    { type: 'line' as const, layer: 'CUT', start: { x: maxX, y: maxY }, end: { x: minX, y: maxY } },
    { type: 'line' as const, layer: 'CUT', start: { x: minX, y: maxY }, end: { x: minX, y: minY } }
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

function createTreeMachine() {
  const machine = createDefaultMachineProfile();
  machine.threading.manual.supported = true;
  return machine;
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
  return markMachineProfileUserVerified(
    machine,
    new Date('2026-07-13T00:00:00.000Z')
  );
}

function compensatedCircleDocument(machine: ReturnType<typeof verifiedGenericExplicitMachine>) {
  const initialized = initializeProjectCompensationIntents(
    createUpidFromDxfEntities([
      { type: 'circle', layer: 'CUT', center: { x: 0, y: 0 }, radius: 5 }
    ]),
    machine
  );
  return setManualInitialWirePosition(initialized, { x: 0, y: 0 })!;
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

function sharpArcContourEntities() {
  return [
    {
      type: 'arc' as const,
      layer: 'CUT',
      center: { x: 0, y: 0 },
      radius: 5,
      startAngle: -90,
      endAngle: 90,
      clockwise: false,
      start: { x: 0, y: -5 },
      end: { x: 0, y: 5 }
    },
    line(0, 5, 0, -5)
  ];
}

function stop(
  id: string,
  placement: 'before-entry' | 'after-contour' | 'after-exit'
): { id: string; enabled: boolean; placement: { kind: typeof placement }; reason: 'operator-check' };
function stop(
  id: string,
  placement: 'before-operation-end',
  remainingCutLengthMm: number
): {
  id: string;
  enabled: boolean;
  placement: { kind: 'before-operation-end'; remainingCutLengthMm: number };
  reason: 'operator-check';
};
function stop(
  id: string,
  placement: 'before-entry' | 'before-operation-end' | 'after-contour' | 'after-exit',
  remainingCutLengthMm?: number
) {
  return {
    id,
    enabled: true,
    placement: placement === 'before-operation-end'
      ? { kind: placement, remainingCutLengthMm: remainingCutLengthMm! }
      : { kind: placement },
    reason: 'operator-check' as const
  };
}
