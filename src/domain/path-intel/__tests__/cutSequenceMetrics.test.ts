import { describe, expect, it } from 'vitest';
import { createPathPlanningDocumentFromDxfEntities } from '../fromDxfEntities';
import { setMachiningSpanParticipation } from '../machiningParticipation';
import { deriveCutSequenceMetrics } from '../cutSequenceMetrics';

function lines() {
  const document = createPathPlanningDocumentFromDxfEntities([
    { type: 'line', layer: 'CUT', start: { x: 0, y: 0 }, end: { x: 10, y: 0 } },
    { type: 'line', layer: 'CUT', start: { x: 20, y: 0 }, end: { x: 30, y: 0 } }
  ]);
  document.setup = { initialWirePosition: { kind: 'manual', point: { x: -2, y: 0 }, review: 'reviewed' } };
  return document;
}

describe('cut sequence metrics', () => {
  it('uses active endpoints and leads and skips excluded operations', () => {
    const document = lines();
    const [first, second] = document.plan.operations;
    first.transitions = { exit: { strategy: 'manual-straight', move: 'cut', from: { x: 10, y: 0 }, to: { x: 12, y: 0 }, review: 'reviewed' } };
    const partial = setMachiningSpanParticipation(document, { sourceSegmentId: first.segmentRefs[0].segmentId, range: { start: 0.6, end: 1 }, participation: 'inactive-reference' });
    if (!partial) throw new Error('Expected partial document');
    expect(deriveCutSequenceMetrics(partial).get(first.id)).toEqual({ status: 'active', cutLength: 12, rapidInLength: 2 });
    expect(deriveCutSequenceMetrics(partial).get(second.id)).toEqual({ status: 'active', cutLength: 10, rapidInLength: 8 });
    const excluded = setMachiningSpanParticipation(document, { sourceSegmentId: first.segmentRefs[0].segmentId, range: { start: 0, end: 1 }, participation: 'inactive-reference' });
    if (!excluded) throw new Error('Expected excluded document');
    expect(deriveCutSequenceMetrics(excluded).get(first.id)).toEqual({ status: 'inactive' });
    expect(deriveCutSequenceMetrics(excluded).get(second.id)).toEqual({ status: 'active', cutLength: 10, rapidInLength: 22 });
  });

  it('reports blocked derivation without source lengths or zero substitutes', () => {
    const document = lines();
    const partial = setMachiningSpanParticipation(document, { sourceSegmentId: document.plan.operations[0].segmentRefs[0].segmentId, range: { start: 0.3, end: 0.6 }, participation: 'inactive-reference' });
    if (!partial) throw new Error('Expected partial document');
    for (const metrics of deriveCutSequenceMetrics(partial).values()) expect(metrics).toEqual({ status: 'unavailable', reason: 'Resolve separated active cutting ranges in Machining Participation.' });
  });

  it('keeps only the first travel unavailable when initial wire position is unresolved', () => {
    const document = lines();
    delete document.setup;
    const [first, second] = document.plan.operations;
    expect(deriveCutSequenceMetrics(document).get(first.id)).toEqual({ status: 'active', cutLength: 10, rapidInLength: null });
    expect(deriveCutSequenceMetrics(document).get(second.id)).toEqual({ status: 'active', cutLength: 10, rapidInLength: 10 });
  });
});



