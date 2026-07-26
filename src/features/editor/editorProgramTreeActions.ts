import type { UpidProgramTreeEditTarget } from '@/domain/upid/upidProgramTree';

export type EditorProgramTreeExactTarget =
  | { diagnosticId: string; kind: 'diagnostic' }
  | { kind: 'machining-span'; operationId: string; spanId: string }
  | { kind: 'program-stop'; operationId: string; stopId: string };

export interface EditorProgramTreeAction {
  commandId:
    | 'view.summary'
    | 'geometry.setup'
    | 'machine.profile'
    | 'machining.initial-wire'
    | 'machining.between-contours'
    | 'machining.contour-setup'
    | 'machining.sequence'
    | 'machining.set-start'
    | 'machining.entry-exit'
    | 'machining.participation'
    | 'machining.program-stops'
    | 'view.diagnostics';
  exactTarget: EditorProgramTreeExactTarget | null;
  operationId: string | null;
}

export function resolveEditorProgramTreeAction(
  target: UpidProgramTreeEditTarget
): EditorProgramTreeAction {
  switch (target.kind) {
    case 'path-summary':
      return action('view.summary');
    case 'geometry-setup':
      return action('geometry.setup');
    case 'machine-setup':
      return action('machine.profile');
    case 'initial-wire':
      return action('machining.initial-wire');
    case 'threading-default':
      return action('machining.between-contours');
    case 'operation':
      return action('machining.contour-setup', target.operationId);
    case 'cut-sequence':
      return action('machining.sequence', target.operationId);
    case 'contour-start':
      return action('machining.set-start', target.operationId);
    case 'incoming-connection':
      return action('machining.between-contours', target.operationId);
    case 'entry-exit':
      return action('machining.entry-exit', target.operationId);
    case 'machining-participation':
      return action(
        'machining.participation',
        target.operationId ?? null,
        target.operationId && target.spanId
          ? {
              kind: 'machining-span',
              operationId: target.operationId,
              spanId: target.spanId
            }
          : null
      );
    case 'program-stop':
      return action(
        'machining.program-stops',
        target.operationId,
        {
          kind: 'program-stop',
          operationId: target.operationId,
          stopId: target.stopId
        }
      );
    case 'diagnostics':
      return action(
        'view.diagnostics',
        null,
        target.diagnosticId
          ? { diagnosticId: target.diagnosticId, kind: 'diagnostic' }
          : null
      );
    default:
      return assertNever(target);
  }
}

function action(
  commandId: EditorProgramTreeAction['commandId'],
  operationId: string | null = null,
  exactTarget: EditorProgramTreeExactTarget | null = null
): EditorProgramTreeAction {
  return { commandId, exactTarget, operationId };
}

function assertNever(value: never): never {
  throw new Error(`Unsupported UPID program-tree edit target: ${JSON.stringify(value)}`);
}
