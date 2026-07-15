import { describe, expect, it } from 'vitest';

import {
  createEditorWorkflowSession,
  dismissEditorWorkflowTransition,
  markEditorWorkflowDirty,
  requestEditorWorkflowTransition,
  resolveEditorWorkflowTransition
} from './editorWorkflowSession';

const openingSnapshot = { documentRevision: 4, selectedOperationId: 'operation-1' };

function createSession() {
  return createEditorWorkflowSession({
    commandId: 'geometry.transform',
    historyLabel: 'Transform geometry',
    kind: 'mutating',
    label: 'Transform',
    openingSnapshot,
    panelId: 'path-transform',
    saveAvailability: { enabled: true }
  });
}

describe('editor workflow session', () => {
  it('rejects mutating sessions without a nonempty history label', () => {
    const base = {
      commandId: 'geometry.transform',
      kind: 'mutating' as const,
      label: 'Transform',
      openingSnapshot,
      panelId: 'path-transform',
      saveAvailability: { enabled: true } as const
    };

    expect(() => createEditorWorkflowSession({
      ...base,
      historyLabel: null
    } as never)).toThrow(/history label/i);
    expect(() => createEditorWorkflowSession({
      ...base,
      historyLabel: '   '
    })).toThrow(/history label/i);
  });

  it('rejects history labels and dirty state for view sessions', () => {
    expect(() => createEditorWorkflowSession({
      commandId: 'view.statistics',
      historyLabel: 'Open statistics',
      kind: 'view',
      label: 'Statistics',
      openingSnapshot,
      panelId: 'statistics',
      saveAvailability: { enabled: true }
    } as never)).toThrow(/view workflow.*history label/i);

    const viewSession = createEditorWorkflowSession({
      commandId: 'view.statistics',
      historyLabel: null,
      kind: 'view',
      label: 'Statistics',
      openingSnapshot,
      panelId: 'statistics',
      saveAvailability: { enabled: true }
    });

    expect(() => markEditorWorkflowDirty(viewSession as never)).toThrow(/view workflow.*dirty/i);
    expect(requestEditorWorkflowTransition(viewSession, { kind: 'close' })).toMatchObject({
      kind: 'resolved',
      resolution: 'clean'
    });
  });

  it('resolves a clean close request immediately', () => {
    const session = createSession();

    expect(requestEditorWorkflowTransition(session, { kind: 'close' })).toEqual({
      kind: 'resolved',
      request: { kind: 'close' },
      resolution: 'clean',
      session
    });
  });

  it('holds a close request while the workflow is dirty', () => {
    const session = markEditorWorkflowDirty(createSession());

    expect(requestEditorWorkflowTransition(session, { kind: 'close' })).toEqual({
      kind: 'held',
      request: { kind: 'close' },
      session
    });
  });

  it('holds a switch request while the workflow is dirty', () => {
    const session = markEditorWorkflowDirty(createSession());

    expect(requestEditorWorkflowTransition(session, {
      commandId: 'machining.entry-exit',
      kind: 'open'
    })).toEqual({
      kind: 'held',
      request: { commandId: 'machining.entry-exit', kind: 'open' },
      session
    });
  });

  it('resolves a held request with Save', () => {
    const session = markEditorWorkflowDirty(createSession());
    const held = requestEditorWorkflowTransition(session, {
      commandId: 'machining.entry-exit',
      kind: 'open'
    });

    expect(resolveEditorWorkflowTransition(held, 'save')).toEqual({
      kind: 'resolved',
      request: { commandId: 'machining.entry-exit', kind: 'open' },
      resolution: 'save',
      session
    });
  });

  it('resolves a held request with Discard', () => {
    const session = markEditorWorkflowDirty(createSession());
    const held = requestEditorWorkflowTransition(session, { kind: 'close' });

    expect(resolveEditorWorkflowTransition(held, 'discard')).toEqual({
      kind: 'resolved',
      request: { kind: 'close' },
      resolution: 'discard',
      session
    });
  });

  it('retains a disabled Save reason and does not resolve Save', () => {
    const session = markEditorWorkflowDirty(createSession(), {
      enabled: false,
      reason: 'Choose an entry point before saving.'
    });
    const held = requestEditorWorkflowTransition(session, { kind: 'close' });

    expect(session.saveAvailability).toEqual({
      enabled: false,
      reason: 'Choose an entry point before saving.'
    });
    expect(resolveEditorWorkflowTransition(held, 'save')).toBe(held);
  });

  it('dismisses a held request without changing the workflow session', () => {
    const session = markEditorWorkflowDirty(createSession());
    const held = requestEditorWorkflowTransition(session, {
      commandId: 'machining.entry-exit',
      kind: 'open'
    });

    expect(dismissEditorWorkflowTransition(held)).toEqual({
      kind: 'active',
      request: null,
      session
    });
  });
});
