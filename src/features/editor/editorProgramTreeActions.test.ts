import { describe, expect, it } from 'vitest';

import { buildUpidEditorTree } from '@/domain/upid/upidEditorTree';
import { createUpidFromDxfEntities } from '@/domain/upid/upidDocument';
import { setMachiningSpanParticipation } from '@/domain/path-intel/machiningParticipation';

import { resolveEditorProgramTreeAction } from './editorProgramTreeActions';

describe('resolveEditorProgramTreeAction', () => {
  it('opens participation to confirm the effective partial exit', () => {
    const document = createUpidFromDxfEntities([{
      type: 'line', layer: 'CUT', start: { x: 0, y: 0 }, end: { x: 10, y: 0 }
    }]);
    document.setup = { initialWirePosition: { kind: 'manual', point: { x: 0, y: 0 }, review: 'reviewed' } };
    const operation = document.plan.operations[0];
    operation.transitions = { exit: { strategy: 'manual-straight', move: 'cut',
      from: operation.endPoint, to: { x: 12, y: 0 }, review: 'reviewed' } };
    const partial = setMachiningSpanParticipation(document, {
      sourceSegmentId: operation.segmentRefs[0].segmentId, range: { start: 0.6, end: 1 }, participation: 'inactive-reference'
    })!;
    const tree = buildUpidEditorTree(partial);
    if (tree.status === 'ready') throw new Error('Expected partial exit review');
    expect(resolveEditorProgramTreeAction(tree.diagnostics[0])).toEqual({
      commandId: 'machining.participation', exactTarget: null, operationId: operation.id
    });
  });

  it('opens the affected operation entry/exit tool for a stored degenerate lead', () => {
    const document = createUpidFromDxfEntities([{
      type: 'line', layer: 'CUT', start: { x: 0, y: 0 }, end: { x: 10, y: 0 }
    }]);
    document.setup = { initialWirePosition: { kind: 'manual', point: { x: 0, y: 0 }, review: 'reviewed' } };
    const operation = document.plan.operations[0];
    operation.transitions = { exit: { strategy: 'manual-straight', move: 'cut',
      from: operation.endPoint, to: operation.endPoint, review: 'reviewed' } };
    const tree = buildUpidEditorTree(document);
    if (tree.status === 'ready') throw new Error('Expected degenerate lead diagnostic');
    expect(resolveEditorProgramTreeAction(tree.diagnostics[0])).toEqual({
      commandId: 'machining.entry-exit', exactTarget: null, operationId: operation.id
    });
  });

  it('keeps authored operation navigation stable across the neutral tree', () => {
    const document = createUpidFromDxfEntities([{
      type: 'line', layer: 'CUT', start: { x: 0, y: 0 }, end: { x: 10, y: 0 }
    }]);
    const tree = buildUpidEditorTree(document);
    const operation = tree.operations[0];

    expect(resolveEditorProgramTreeAction(operation)).toEqual({
      commandId: 'machining.contour-setup',
      exactTarget: null,
      operationId: document.plan.operations[0].id
    });
    expect(resolveEditorProgramTreeAction(tree.sourceSetup[2]).commandId)
      .toBe('machining.initial-wire');
    expect(resolveEditorProgramTreeAction(tree.sourceSetup[0]).commandId)
      .toBe('view.statistics');
  });

  it('opens initial wire setup from a real missing-position diagnostic', () => {
    const tree = buildUpidEditorTree(createUpidFromDxfEntities([{
      type: 'line', layer: 'CUT', start: { x: 0, y: 0 }, end: { x: 10, y: 0 }
    }]));
    if (tree.status === 'ready') throw new Error('Expected missing initial position');
    expect(resolveEditorProgramTreeAction(tree.diagnostics[0])).toEqual({
      commandId: 'machining.initial-wire', exactTarget: null, operationId: null
    });
  });
});
