import { describe, expect, it } from 'vitest';

import { buildUpidEditorTree } from '@/domain/upid/upidEditorTree';
import { createUpidFromDxfEntities } from '@/domain/upid/upidDocument';
import { setMachiningSpanParticipation, setPartialContourCompensationSide } from '@/domain/path-intel/machiningParticipation';
import { setManualInitialWirePosition } from '@/domain/path-editor/pathDocumentOperations';
import { reviewCenterline } from '@/__tests__/reviewedUpid';

import { editorExecutionDiagnosticReviewLabel, resolveEditorProgramTreeAction } from './editorProgramTreeActions';

describe('resolveEditorProgramTreeAction', () => {
  it('routes missing partial compensation to the source-preserving side decision that clears the compiler blocker', () => {
    const source = createUpidFromDxfEntities([{
      type: 'circle', layer: 'CUT', center: { x: 0, y: 0 }, radius: 10
    }]);
    const positioned = setManualInitialWirePosition(source, { x: 10, y: 0 });
    if (!positioned) throw new Error('Expected a reviewed initial wire position');
    const partial = setMachiningSpanParticipation(positioned, {
      sourceSegmentId: source.segments[0].id, range: { start: 0.25, end: 0.75 }, participation: 'inactive-reference'
    });
    if (!partial) throw new Error('Expected a partial circle');
    const tree = buildUpidEditorTree(partial);
    if (tree.status === 'ready') throw new Error('Expected an explicit partial compensation decision');
    const diagnostic = tree.diagnostics[0];
    expect(diagnostic.diagnostic.code).toBe('EXECUTION_PLAN_COMPENSATION_UNRESOLVED');
    expect(diagnostic.diagnostic.operationId).not.toBe(diagnostic.operationId);
    expect(resolveEditorProgramTreeAction(diagnostic)).toEqual({
      commandId: 'machining.participation', exactTarget: null, operationId: source.plan.operations[0].id
    });
    expect(editorExecutionDiagnosticReviewLabel(diagnostic)).toBe('Review partial-path compensation');

    const reviewed = setPartialContourCompensationSide(partial, source.plan.operations[0].id, 'right');
    if (!reviewed) throw new Error('Expected an explicit partial-path side');
    expect(buildUpidEditorTree(reviewed).status).toBe('ready');
    expect(reviewed.plan.operations[0].compensationIntent).toEqual(source.plan.operations[0].compensationIntent);
    expect(reviewed.segments).toEqual(source.segments);
  });

  it('keeps a full contour compensation issue in contour setup', () => {
    const source = createUpidFromDxfEntities([{
      type: 'circle', layer: 'CUT', center: { x: 0, y: 0 }, radius: 10
    }]);
    const positioned = setManualInitialWirePosition(source, { x: 10, y: 0 });
    if (!positioned) throw new Error('Expected a reviewed initial wire position');
    const tree = buildUpidEditorTree(positioned);
    if (tree.status === 'ready') throw new Error('Expected a contour compensation decision');
    const diagnostic = tree.diagnostics[0];
    expect(diagnostic.diagnostic.code).toBe('EXECUTION_PLAN_COMPENSATION_UNRESOLVED');
    expect(resolveEditorProgramTreeAction(diagnostic).commandId).toBe('machining.contour-setup');
    expect(editorExecutionDiagnosticReviewLabel(diagnostic)).toBe('Review contour compensation');
  });

  it('opens participation to confirm the effective partial exit', () => {
    const document = createUpidFromDxfEntities([{
      type: 'line', layer: 'CUT', start: { x: 0, y: 0 }, end: { x: 10, y: 0 }
    }]);
    document.setup = { initialWirePosition: { kind: 'manual', point: { x: 0, y: 0 }, review: 'reviewed' } };
    reviewCenterline(document);
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
    reviewCenterline(document);
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
