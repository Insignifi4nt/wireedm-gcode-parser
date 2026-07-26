import { describe, expect, it, vi } from 'vitest';

import { createCharmillesRobofil100V2CandidateProfile } from '@/domain/machine/machineProfiles';
import * as machiningParticipation from '@/domain/path-intel/machiningParticipation';
import {
  setMachiningSpanParticipation,
  setPartialContourEntryReview
} from '@/domain/path-intel/machiningParticipation';
import { createUpidFromDxfEntities } from '@/domain/upid/upidDocument';
import { createDefaultMachineProfile } from '@/domain/workbench/defaultProject';

import {
  buildUpidProgramTree,
  type UpidProgramTreeNode
} from '../upidProgramTree';

describe('UPID program tree projection', () => {
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

  it('blocks enabled stops when the machine policy does not authorize them', () => {
    const document = twoRectangleDocument();
    const operation = document.plan.operations[0];
    operation.programStops = [stop('blocked-stop', 'before-entry')];

    const tree = buildUpidProgramTree(document, createDefaultMachineProfile());

    expect(tree.operations[0].children).toContainEqual(expect.objectContaining({
      label: 'M00 · Before entry',
      status: 'blocked',
      statusReason: 'program-stops-unsupported'
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

    const tree = buildUpidProgramTree(edited, createCharmillesRobofil100V2CandidateProfile());
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

    const tree = buildUpidProgramTree(edited, createCharmillesRobofil100V2CandidateProfile());
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

    const tree = buildUpidProgramTree(edited, createCharmillesRobofil100V2CandidateProfile());
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

    const tree = buildUpidProgramTree(edited, createCharmillesRobofil100V2CandidateProfile());
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
      createCharmillesRobofil100V2CandidateProfile()
    ).operations.find((node) => node.operationId === source.id);

    expect(reviewedRoot?.children.find((node) => node.label === 'Entry / lead-in')?.status)
      .toBe('ready');
    expect(reviewedRoot?.children.find((node) => node.label === 'Exit / lead-out')?.status)
      .toBe('review-required');
  });

  it('uses orderIndex rather than backing array order for initial wire and rethread phases', () => {
    const document = twoRectangleDocument();
    const first = document.plan.operations[0];
    const second = document.plan.operations[1];
    second.threadingTransition = {
      mode: 'manual',
      wireSeparation: 'manual-before-positioning',
      source: 'operation-override'
    };
    document.plan.operations = [second, first];

    const tree = buildUpidProgramTree(document, createCharmillesRobofil100V2CandidateProfile());

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

    const tree = buildUpidProgramTree(document, createCharmillesRobofil100V2CandidateProfile());
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

    const tree = buildUpidProgramTree(document, createCharmillesRobofil100V2CandidateProfile());
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
    const tree = buildUpidProgramTree(document, createCharmillesRobofil100V2CandidateProfile());
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
