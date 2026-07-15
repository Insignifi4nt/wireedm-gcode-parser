import { describe, expect, it } from 'vitest';

import {
  createEditorToolSession,
  editorToolSessionReducer,
  type EditorToolSession
} from './editorToolSession';

describe('editor tool session reducer', () => {
  it('steps back through provisional input before cancelling', () => {
    const initial = createEditorToolSession({
      commandId: 'machining.set-start',
      label: 'Set Start',
      historyLabel: 'Set operation start',
      target: { kind: 'operation', id: 'operation-1' },
      steps: ['pick-point', 'review']
    });
    const reviewing = editorToolSessionReducer(initial, {
      type: 'advance',
      provisional: { point: { x: 3, y: 4 } }
    });

    const steppedBack = editorToolSessionReducer(reviewing, { type: 'escape' });
    expect(steppedBack).toMatchObject({ status: 'active', stepIndex: 0, provisional: [] });

    expect(editorToolSessionReducer(steppedBack, { type: 'escape' })).toMatchObject({
      status: 'cancelled'
    });
  });

  it('does not apply before the final step', () => {
    const session = createEditorToolSession({
      commandId: 'machining.set-start',
      label: 'Set Start',
      historyLabel: 'Set operation start',
      target: { kind: 'operation', id: 'operation-1' },
      steps: ['pick-point', 'review']
    });

    expect(editorToolSessionReducer(session, { type: 'apply' })).toBe(session);
  });

  it('emits one labelled commit request when applied from the final step', () => {
    const session = advanceToReview();
    const applied = editorToolSessionReducer(session, { type: 'apply' });

    expect(applied).toMatchObject({
      status: 'applied',
      commit: {
        commandId: 'machining.set-start',
        historyLabel: 'Set operation start',
        target: { kind: 'operation', id: 'operation-1' },
        provisional: [{ point: { x: 3, y: 4 } }]
      }
    });
  });
});

function advanceToReview(): EditorToolSession {
  return editorToolSessionReducer(
    createEditorToolSession({
      commandId: 'machining.set-start',
      label: 'Set Start',
      historyLabel: 'Set operation start',
      target: { kind: 'operation', id: 'operation-1' },
      steps: ['pick-point', 'review']
    }),
    { type: 'advance', provisional: { point: { x: 3, y: 4 } } }
  );
}
