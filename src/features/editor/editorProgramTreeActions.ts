import type { EditorProgramTreeNode } from './EditorProgramTree';

export type EditorProgramTreeExactTarget =
  | { diagnosticId: string; kind: 'diagnostic' }
  | { kind: 'machining-span'; operationId: string; spanId: string }
  | { kind: 'program-stop'; operationId: string; stopId: string }
  | { kind: 'spatial-action'; actionKey: string; operationId: string | null };

export interface EditorProgramTreeAction {
  readonly commandId:
    | 'view.statistics'
    | 'geometry.setup'
    | 'machining.initial-wire'
    | 'machining.between-contours'
    | 'machining.contour-setup'
    | 'machining.set-start'
    | 'machining.entry-exit'
    | 'machining.program-stops'
    | 'machining.participation'
    | 'view.diagnostics';
  readonly exactTarget: EditorProgramTreeExactTarget | null;
  readonly operationId: string | null;
}

export function resolveEditorProgramTreeAction(node: EditorProgramTreeNode): EditorProgramTreeAction {
  if (node.kind === 'source') {
    switch (node.sourceKind) {
      case 'path-summary': return action('view.statistics');
      case 'geometry': return action('geometry.setup');
      case 'initial-wire': return action('machining.initial-wire');
      case 'threading-default': return action('machining.between-contours');
    }
  }
  if (node.kind === 'operation') return action('machining.contour-setup', node.operationId);
  if (node.kind === 'diagnostic') {
    switch (node.diagnostic.code) {
      case 'EXECUTION_PLAN_INITIAL_WIRE_REQUIRED': return action('machining.initial-wire');
      case 'EXECUTION_PLAN_THREADING_REQUIRED':
      case 'EXECUTION_PLAN_THREADING_INVALID': return action('machining.between-contours', node.operationId);
      case 'EXECUTION_PLAN_COMPENSATION_UNRESOLVED': return action('machining.contour-setup', node.operationId);
      case 'EXECUTION_PLAN_TRANSITION_REVIEW_REQUIRED':
        return action(node.diagnostic.operationId !== node.operationId
          ? 'machining.participation' : 'machining.entry-exit', node.operationId);
      case 'EXECUTION_PLAN_DEGENERATE_TRANSITION': return action('machining.entry-exit', node.operationId);
      case 'EXECUTION_PLAN_PROGRAM_STOP_INVALID': return action('machining.program-stops', node.operationId);
      case 'EXECUTION_PLAN_EMPTY':
      case 'EXECUTION_PLAN_MACHINING_UNRESOLVED': return action('machining.participation', node.operationId);
    }
    return action('view.diagnostics', node.operationId, {
      kind: 'diagnostic',
      diagnosticId: node.treeKey
    });
  }
  const exactAction = node.spatialAction ? {
    kind: 'spatial-action' as const,
    actionKey: node.spatialAction.key,
    operationId: node.spatialAction.operationId
  } : null;
  if (node.eventKind === 'program-start') return action('machining.initial-wire');
  if (node.eventKind === 'wire-continue' || node.eventKind === 'wire-separate' ||
      node.eventKind === 'wire-thread' || node.eventKind === 'position') {
    return action('machining.between-contours', node.operationId, exactAction);
  }
  if (node.eventKind === 'program-stop') {
    const source = node.sourceTrace.find((candidate) => candidate.kind === 'program-stop');
    return source?.kind === 'program-stop'
      ? action('machining.program-stops', source.operationId, exactAction ?? {
          kind: 'program-stop', operationId: source.operationId, stopId: source.stopId
        })
      : action('machining.program-stops', node.operationId);
  }
  if (node.eventKind === 'motion') {
    const transition = node.sourceTrace.find((candidate) => candidate.kind === 'transition');
    if (transition?.kind === 'transition' && (transition.role === 'entry' || transition.role === 'exit')) {
      return action('machining.entry-exit', node.operationId, exactAction);
    }
  }
  return action('machining.contour-setup', node.operationId, exactAction);
}

function action(
  commandId: EditorProgramTreeAction['commandId'],
  operationId: string | null = null,
  exactTarget: EditorProgramTreeExactTarget | null = null
): EditorProgramTreeAction {
  return { commandId, exactTarget, operationId };
}
