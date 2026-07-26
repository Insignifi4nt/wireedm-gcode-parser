import { describe, expect, it } from 'vitest';

import type { UpidProgramTreeEditTarget } from '@/domain/upid/upidProgramTree';

import { resolveEditorProgramTreeAction } from './editorProgramTreeActions';

describe('resolveEditorProgramTreeAction', () => {
  it.each<readonly [UpidProgramTreeEditTarget, string, string | null, string | null]>([
    [{ kind: 'path-summary' }, 'view.summary', null, null],
    [{ kind: 'geometry-setup' }, 'geometry.setup', null, null],
    [{ kind: 'machine-setup' }, 'machine.profile', null, null],
    [{ kind: 'initial-wire' }, 'machining.initial-wire', null, null],
    [{ kind: 'threading-default' }, 'machining.between-contours', null, null],
    [{ kind: 'operation', operationId: 'op-1' }, 'machining.contour-setup', 'op-1', null],
    [{ kind: 'cut-sequence', operationId: 'op-2' }, 'machining.sequence', 'op-2', null],
    [{ kind: 'contour-start', operationId: 'op-3' }, 'machining.set-start', 'op-3', null],
    [{ kind: 'incoming-connection', operationId: 'op-4' }, 'machining.between-contours', 'op-4', null],
    [{ kind: 'entry-exit', operationId: 'op-5' }, 'machining.entry-exit', 'op-5', null],
    [
      { kind: 'machining-participation', operationId: 'op-6', spanId: 'span-6' },
      'machining.participation',
      'op-6',
      null
    ],
    [
      { kind: 'program-stop', operationId: 'op_2', stopId: 'stop-3' },
      'machining.program-stops',
      'op_2',
      'stop-3'
    ],
    [{ kind: 'diagnostics', diagnosticId: 'diagnostic-1' }, 'view.diagnostics', null, null]
  ])('routes %# with its explicit identity', (target, commandId, operationId, stopId) => {
    expect(resolveEditorProgramTreeAction(target)).toEqual({ commandId, operationId, stopId });
  });
});
