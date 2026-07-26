import { describe, expect, it } from 'vitest';

import { createCharmillesRobofil100V2CandidateProfile } from '@/domain/machine/machineProfiles';
import { createUpidFromDxfEntities } from '@/domain/upid/upidDocument';
import { createDefaultMachineProfile } from '@/domain/workbench/defaultProject';

import { buildUpidProgramTree } from '../upidProgramTree';

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

  it('links partial machining spans back to their source operation', () => {
    const document = twoRectangleDocument();
    const source = document.plan.operations[0];
    const derived = document.plan.operations[1];
    derived.machiningIntent = {
      kind: 'partial-contour',
      sourceOperationId: source.id,
      spanIds: ['span-a', 'span-b']
    };

    const tree = buildUpidProgramTree(document, createDefaultMachineProfile());
    const cutPath = tree.operations[1].children.find((node) => node.label === 'Cut path');

    expect(cutPath?.children).toContainEqual(expect.objectContaining({
      kind: 'span',
      editTarget: {
        kind: 'machining-participation',
        operationId: source.id,
        spanId: 'span-a'
      }
    }));
    expect(cutPath?.children).toContainEqual(expect.objectContaining({
      kind: 'span',
      editTarget: {
        kind: 'machining-participation',
        operationId: source.id,
        spanId: 'span-b'
      }
    }));
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

  it('rolls diagnostic warning and error severity into the tree status', () => {
    const document = twoRectangleDocument();
    document.diagnostics = [{
      id: 'warning',
      severity: 'warning',
      code: 'open-chain',
      message: 'Review the open chain.'
    }];

    expect(buildUpidProgramTree(document, createCharmillesRobofil100V2CandidateProfile()).status)
      .toBe('review-required');

    document.diagnostics = [{
      ...document.diagnostics[0],
      id: 'error',
      severity: 'error',
      message: 'Cannot build this path.'
    }];

    const tree = buildUpidProgramTree(document, createCharmillesRobofil100V2CandidateProfile());
    const diagnostics = tree.sourceSetup[0].children;

    expect(diagnostics).toContainEqual(expect.objectContaining({
      label: 'Cannot build this path.',
      status: 'blocked',
      editTarget: { kind: 'diagnostics', diagnosticId: 'error' }
    }));
    expect(tree.status).toBe('blocked');
  });
});

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
