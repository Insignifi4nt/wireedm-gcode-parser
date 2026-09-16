import { describe, expect, it } from 'vitest';

import { createUpidFromDxfEntities } from '../upidDocument';
import { reviewCenterline } from '@/__tests__/reviewedUpid';
import {
  buildUpidEditorTree,
  upidEditorOperationTreeKey
} from '../upidEditorTree';

describe('controller-neutral UPID editor tree', () => {
  it('keeps authored operation identity while exposing exact execution source traces', () => {
    const document = createUpidFromDxfEntities([{
      type: 'line',
      layer: 'CUT',
      start: { x: 0, y: 0 },
      end: { x: 10, y: 0 }
    }]);
    document.setup = {
      initialWirePosition: {
        kind: 'manual',
        point: { x: -2, y: 0 },
        review: 'reviewed'
      }
    };
    const operation = document.plan.operations[0];
    operation.programStops = [{
      id: 'retain/part',
      enabled: true,
      placement: { kind: 'before-operation-end', remainingCutLengthMm: 2 },
      reason: 'part-retention'
    }];
    reviewCenterline(document);

    const tree = buildUpidEditorTree(document);

    expect(tree.status).toBe('ready');
    if (tree.status !== 'ready') throw new Error(JSON.stringify(tree.diagnostics));
    const operationNode = tree.operations[0];
    expect(operationNode).toMatchObject({
      kind: 'operation',
      treeKey: upidEditorOperationTreeKey(operation.id),
      operationId: operation.id,
      sourceTrace: [{ kind: 'operation', operationId: operation.id }],
      execution: 'included'
    });
    if (operationNode.execution !== 'included') throw new Error('Expected an included operation.');
    expect(operationNode.executionOperationIds).toEqual([operation.id]);
    expect(operationNode.children.find(({ sourceTrace }) => sourceTrace[0].kind === 'segment'))
      .toMatchObject({
        operationId: operation.id,
        executionOperationId: operation.id,
        sourceTrace: [{
          kind: 'segment',
          operationId: operation.id,
          segmentId: operation.segmentRefs[0].segmentId
        }]
      });
    expect(operationNode.children.find(({ eventKind }) => eventKind === 'program-stop'))
      .toMatchObject({
        operationId: operation.id,
        sourceTrace: [{
          kind: 'program-stop',
          operationId: operation.id,
          stopId: 'retain/part'
        }]
      });
    expect(upidEditorOperationTreeKey('part/op 1')).toBe('operation:part%2Fop%201');
  });

  it('distinguishes unresolved intent from an invalid UPID without inventing execution nodes', () => {
    const unresolvedDocument = createUpidFromDxfEntities([{
      type: 'line',
      layer: 'CUT',
      start: { x: 0, y: 0 },
      end: { x: 10, y: 0 }
    }]);

    const unresolved = buildUpidEditorTree(unresolvedDocument);

    expect(unresolved).toMatchObject({
      status: 'unresolved',
      diagnostics: [{
        diagnostic: { code: 'EXECUTION_PLAN_INITIAL_WIRE_REQUIRED' },
        sourceTrace: [{ kind: 'program' }]
      }],
      operations: [{
        operationId: unresolvedDocument.plan.operations[0].id,
        execution: 'unresolved',
        executionOperationIds: [],
        children: []
      }]
    });

    const invalidDocument = structuredClone(unresolvedDocument);
    invalidDocument.plan.operations.push(structuredClone(invalidDocument.plan.operations[0]));
    const invalid = buildUpidEditorTree(invalidDocument);

    expect(invalid).toMatchObject({
      status: 'invalid',
      diagnostics: [{ diagnostic: { code: 'EXECUTION_PLAN_INVALID_UPID' } }]
    });
    expect(invalid.operations.every(({ execution }) => execution === 'unresolved')).toBe(true);
    expect(new Set(invalid.operations.map(({ treeKey }) => treeKey)).size)
      .toBe(invalid.operations.length);
  });
});
