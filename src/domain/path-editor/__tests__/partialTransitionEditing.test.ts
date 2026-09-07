import { describe, expect, it } from 'vitest';
import { createUpidFromDxfEntities } from '@/domain/upid/upidDocument';
import { setMachiningSpanParticipation } from '@/domain/path-intel/machiningParticipation';
import { setPathOperationManualLeadIn, setPathOperationTransitions } from '../pathDocumentOperations';

describe('partial contour transition editing', () => {
  it.each(['entry', 'exit'] as const)('rejects a zero-length effective %s while accepting a real lead', (side) => {
    const source = createUpidFromDxfEntities([{ type: 'line', layer: 'CUT', start: { x: 0, y: 0 }, end: { x: 10, y: 0 } }]);
    const partial = setMachiningSpanParticipation(source, { sourceSegmentId: source.segments[0].id,
      range: side === 'entry' ? { start: 0, end: 0.4 } : { start: 0.6, end: 1 }, participation: 'inactive-reference' })!;
    const operationId = source.plan.operations[0].id;
    const x = side === 'entry' ? 4 : 6;
    const edit = (y: number) => side === 'entry'
      ? setPathOperationManualLeadIn(partial, operationId, { x, y })
      : setPathOperationTransitions(partial, operationId, { exit: { strategy: 'manual-straight', move: 'cut',
          from: source.plan.operations[0].endPoint, to: { x, y }, review: 'reviewed' } });
    expect(edit(0)).toBeNull();
    expect(edit(2)).not.toBeNull();
  });
});
