export type EditorWorkflowSaveAvailability =
  | { enabled: true }
  | { enabled: false; reason: string };

interface EditorWorkflowSessionBase<TSnapshot> {
  commandId: string;
  label: string;
  openingSnapshot: TSnapshot;
  panelId: string;
  saveAvailability: EditorWorkflowSaveAvailability;
}

export interface EditorMutatingWorkflowSession<TSnapshot = unknown>
  extends EditorWorkflowSessionBase<TSnapshot> {
  dirty: boolean;
  historyLabel: string;
  kind: 'mutating';
}

export interface EditorViewWorkflowSession<TSnapshot = unknown>
  extends EditorWorkflowSessionBase<TSnapshot> {
  dirty: false;
  historyLabel: null;
  kind: 'view';
}

export type EditorWorkflowSession<TSnapshot = unknown> =
  | EditorMutatingWorkflowSession<TSnapshot>
  | EditorViewWorkflowSession<TSnapshot>;

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

export type EditorWorkflowSessionInitializer<TSnapshot> =
  | Omit<EditorMutatingWorkflowSession<TSnapshot>, 'dirty'>
  | Omit<EditorViewWorkflowSession<TSnapshot>, 'dirty'>;

export function createEditorWorkflowSession<TSnapshot>(
  initializer: Omit<EditorMutatingWorkflowSession<TSnapshot>, 'dirty'>
): EditorMutatingWorkflowSession<TSnapshot>;
export function createEditorWorkflowSession<TSnapshot>(
  initializer: Omit<EditorViewWorkflowSession<TSnapshot>, 'dirty'>
): EditorViewWorkflowSession<TSnapshot>;
export function createEditorWorkflowSession<TSnapshot>(
  initializer: EditorWorkflowSessionInitializer<TSnapshot>
): EditorWorkflowSession<TSnapshot> {
  if (initializer.kind === 'mutating') {
    if (typeof initializer.historyLabel !== 'string' || initializer.historyLabel.trim() === '') {
      throw new Error('A mutating editor workflow requires a nonempty history label.');
    }
    return { ...initializer, dirty: false };
  }
  if (initializer.historyLabel !== null) {
    throw new Error('A view workflow cannot have a history label.');
  }
  return { ...initializer, dirty: false };
}

export function markEditorWorkflowDirty<TSnapshot>(
  session: EditorMutatingWorkflowSession<TSnapshot>,
  saveAvailability?: EditorWorkflowSaveAvailability
): EditorMutatingWorkflowSession<TSnapshot>;
export function markEditorWorkflowDirty<TSnapshot>(
  session: EditorWorkflowSession<TSnapshot>,
  saveAvailability: EditorWorkflowSaveAvailability = session.saveAvailability
): EditorMutatingWorkflowSession<TSnapshot> {
  if (session.kind === 'view') {
    throw new Error('A view workflow cannot become dirty.');
  }
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
  if (
    resolution === 'save' &&
    (transition.session.kind !== 'mutating' ||
      transition.session.historyLabel.trim() === '' ||
      !transition.session.saveAvailability.enabled)
  ) {
    return transition;
  }
  return { ...transition, kind: 'resolved', resolution };
}
