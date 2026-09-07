import { describe, expect, it } from 'vitest';
import { createUpidFromDxfEntities } from '@/domain/upid/upidDocument';
import { setMachiningSpanParticipation } from '@/domain/path-intel/machiningParticipation';
import { setPathOperationManualLeadIn, setPathOperationTransitions } from '../pathDocumentOperations';

describe('partial contour transition editing', () => {
  it.each([false, true])('repairs invalid imported leads independently (partial %s)', (isPartial) => {
    const source = createUpidFromDxfEntities([{ type: 'line', layer: 'CUT', start: { x: 0, y: 0 }, end: { x: 10, y: 0 } }]);
    const first = setMachiningSpanParticipation(source, { sourceSegmentId: source.segments[0].id, range: { start: 0, end: 0.2 }, participation: 'inactive-reference' })!;
    const partial = isPartial ? setMachiningSpanParticipation(first, { sourceSegmentId: source.segments[0].id, range: { start: 0.8, end: 1 }, participation: 'inactive-reference' })! : source;
    const operation = partial.plan.operations[0];
    operation.transitions = {
      entry: { strategy: 'manual-straight', move: 'cut', from: { x: isPartial ? 2 : 0, y: 0 }, to: operation.startPoint, review: 'reviewed' },
      exit: { strategy: 'manual-straight', move: 'cut', from: operation.endPoint, to: { x: isPartial ? 8 : 10, y: 0 }, review: 'reviewed' }
    };
    const entryFixed = setPathOperationManualLeadIn(partial, operation.id, { x: 2, y: 2 });
    expect(entryFixed).not.toBeNull();
    const exitFixed = setPathOperationTransitions(entryFixed!, operation.id, {
      ...entryFixed!.plan.operations[0].transitions,
      exit: { strategy: 'manual-straight', move: 'cut', from: operation.endPoint, to: { x: 8, y: 2 }, review: 'reviewed' }
    });
    expect(exitFixed).not.toBeNull();
    const exitFirst = setPathOperationTransitions(partial, operation.id, {
      ...operation.transitions,
      exit: { strategy: 'manual-straight', move: 'cut', from: operation.endPoint, to: { x: 8, y: 2 }, review: 'reviewed' }
    });
    expect(exitFirst).not.toBeNull();
  });
  it('does not bypass validation when another operation has disconnected active ranges', () => {
    const source = createUpidFromDxfEntities([
      { type: 'line', layer: 'CUT', start: { x: 0, y: 0 }, end: { x: 10, y: 0 } },
      { type: 'line', layer: 'CUT', start: { x: 0, y: 20 }, end: { x: 10, y: 20 } }
    ]);
    const first = setMachiningSpanParticipation(source, { sourceSegmentId: source.segments[0].id,
      range: { start: 0, end: 0.4 }, participation: 'inactive-reference' })!;
    const blockedElsewhere = setMachiningSpanParticipation(first, { sourceSegmentId: source.segments[1].id,
      range: { start: 0.4, end: 0.6 }, participation: 'inactive-reference' })!;
    const operation = source.plan.operations.find((candidate) => candidate.segmentRefs[0].segmentId === source.segments[0].id)!;
    expect(setPathOperationManualLeadIn(blockedElsewhere, operation.id, { x: 4, y: 0 })).toBeNull();
  });

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
