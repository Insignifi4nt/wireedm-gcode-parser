export type EditorWorkflowSaveAvailability =
  | { enabled: true }
  | { enabled: false; reason: string };

export interface EditorWorkflowSession<TSnapshot = unknown> {
  commandId: string;
  dirty: boolean;
  historyLabel: string | null;
  kind: 'mutating' | 'view';
  label: string;
  openingSnapshot: TSnapshot;
  panelId: string;
  saveAvailability: EditorWorkflowSaveAvailability;
}

export type EditorWorkflowTransitionRequest =
  | { kind: 'close' }
  | { commandId: string; kind: 'open' };

export type EditorWorkflowTransitionResolution = 'clean' | 'save' | 'discard';

export type EditorWorkflowTransition<TSnapshot = unknown> =
  | {
      kind: 'active';
      request: null;
      session: EditorWorkflowSession<TSnapshot>;
    }
  | {
      kind: 'held';
      request: EditorWorkflowTransitionRequest;
      session: EditorWorkflowSession<TSnapshot>;
    }
  | {
      kind: 'resolved';
      request: EditorWorkflowTransitionRequest;
      resolution: EditorWorkflowTransitionResolution;
      session: EditorWorkflowSession<TSnapshot>;
    };

type EditorWorkflowSessionInitializer<TSnapshot> = Omit<
  EditorWorkflowSession<TSnapshot>,
  'dirty'
>;

export function createEditorWorkflowSession<TSnapshot>(
  initializer: EditorWorkflowSessionInitializer<TSnapshot>
): EditorWorkflowSession<TSnapshot> {
  return { ...initializer, dirty: false };
}

export function markEditorWorkflowDirty<TSnapshot>(
  session: EditorWorkflowSession<TSnapshot>,
  saveAvailability: EditorWorkflowSaveAvailability = session.saveAvailability
): EditorWorkflowSession<TSnapshot> {
  return { ...session, dirty: true, saveAvailability };
}

export function requestEditorWorkflowTransition<TSnapshot>(
  session: EditorWorkflowSession<TSnapshot>,
  request: EditorWorkflowTransitionRequest
): EditorWorkflowTransition<TSnapshot> {
  if (session.dirty) return { kind: 'held', request, session };
  return { kind: 'resolved', request, resolution: 'clean', session };
}

export function dismissEditorWorkflowTransition<TSnapshot>(
  transition: EditorWorkflowTransition<TSnapshot>
): EditorWorkflowTransition<TSnapshot> {
  if (transition.kind !== 'held') return transition;
  return { kind: 'active', request: null, session: transition.session };
}

export function resolveEditorWorkflowTransition<TSnapshot>(
  transition: EditorWorkflowTransition<TSnapshot>,
  resolution: Exclude<EditorWorkflowTransitionResolution, 'clean'>
): EditorWorkflowTransition<TSnapshot> {
  if (transition.kind !== 'held') return transition;
  if (resolution === 'save' && !transition.session.saveAvailability.enabled) return transition;
  return { ...transition, kind: 'resolved', resolution };
}
