import type { EditorCommandId } from './editorCommands';

export interface EditorToolTarget {
  kind: 'document' | 'operation' | 'contour' | 'segment' | 'point';
  id: string;
}

export interface EditorToolCommitRequest {
  commandId: EditorCommandId;
  historyLabel: string;
  target: EditorToolTarget;
  provisional: readonly unknown[];
}

export interface EditorToolSession {
  commandId: EditorCommandId;
  label: string;
  historyLabel: string;
  target: EditorToolTarget;
  steps: readonly [string, ...string[]];
  stepIndex: number;
  provisional: readonly unknown[];
  status: 'active' | 'applied' | 'cancelled';
  commit?: EditorToolCommitRequest;
}

export type EditorToolSessionEvent =
  | { type: 'advance'; provisional?: unknown }
  | { type: 'back' }
  | { type: 'reset' }
  | { type: 'escape' }
  | { type: 'apply' }
  | { type: 'cancel' };

export function createEditorToolSession(
  session: Pick<
    EditorToolSession,
    'commandId' | 'label' | 'historyLabel' | 'target' | 'steps'
  >
): EditorToolSession {
  return {
    ...session,
    stepIndex: 0,
    provisional: [],
    status: 'active'
  };
}

export function editorToolSessionReducer(
  session: EditorToolSession,
  event: EditorToolSessionEvent
): EditorToolSession {
  if (session.status !== 'active') return session;

  switch (event.type) {
    case 'advance': {
      const nextIndex = Math.min(session.stepIndex + 1, session.steps.length - 1);
      return {
        ...session,
        stepIndex: nextIndex,
        provisional:
          event.provisional === undefined
            ? session.provisional
            : [...session.provisional, event.provisional]
      };
    }
    case 'back':
      return stepBack(session);
    case 'reset':
      return { ...session, stepIndex: 0, provisional: [] };
    case 'escape':
      return session.stepIndex > 0 || session.provisional.length > 0
        ? stepBack(session)
        : { ...session, status: 'cancelled' };
    case 'apply':
      if (session.stepIndex !== session.steps.length - 1) return session;
      return {
        ...session,
        status: 'applied',
        commit: {
          commandId: session.commandId,
          historyLabel: session.historyLabel,
          target: session.target,
          provisional: session.provisional
        }
      };
    case 'cancel':
      return { ...session, status: 'cancelled' };
  }
}

function stepBack(session: EditorToolSession): EditorToolSession {
  return {
    ...session,
    stepIndex: Math.max(0, session.stepIndex - 1),
    provisional: session.provisional.slice(0, -1)
  };
}
