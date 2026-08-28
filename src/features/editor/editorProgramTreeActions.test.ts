import { describe, expect, it } from 'vitest';

import { buildUpidEditorTree } from '@/domain/upid/upidEditorTree';
import { createUpidFromDxfEntities } from '@/domain/upid/upidDocument';

import { resolveEditorProgramTreeAction } from './editorProgramTreeActions';

describe('resolveEditorProgramTreeAction', () => {
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
  });
});
