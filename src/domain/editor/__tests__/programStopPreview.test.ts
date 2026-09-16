import { describe, expect, it } from 'vitest';
import { createUpidFromDxfEntities } from '@/domain/upid/upidDocument';
import { compileWireEdmExecutionPlan } from '@/domain/execution-plan/executionPlan';
import { programStopPreview } from '../programStopPreview';

function fixture() {
  const document = createUpidFromDxfEntities([
    { type: 'line', layer: 'CUT', start: { x: 0, y: 0 }, end: { x: 10, y: 0 } }
  ]);
  document.setup = { initialWirePosition: { kind: 'manual', point: { x: -2, y: 0 }, review: 'reviewed' } };
  document.plan.operations[0].programStops = [
    { id: 'before', enabled: true, reason: 'manual', placement: { kind: 'before-entry' } },
    { id: 'positioned', enabled: true, reason: 'manual', placement: { kind: 'after-positioning' } },
    { id: 'distance', enabled: true, reason: 'manual', placement: { kind: 'before-operation-end', remainingCutLengthMm: 2 } },
    { id: 'contour', enabled: true, reason: 'manual', placement: { kind: 'after-contour' } },
    { id: 'exit', enabled: true, reason: 'manual', placement: { kind: 'after-exit' } }
  ];
  return document;
}

describe('program stop preview', () => {
  it('matches executed stop coordinates for all placement kinds', () => {
    const document = fixture();
    const execution = compileWireEdmExecutionPlan(document);
    if (!execution.ok) throw new Error(JSON.stringify(execution.diagnostics));
    expect(programStopPreview(document)).toEqual(execution.plan.events
      .filter((event) => event.kind === 'program-stop')
      .map(({ operationId, stopId, point }) => ({ operationId, stopId, point })));
    expect(programStopPreview(document).map(({ point }) => point)).toEqual([
      { x: -2, y: 0 }, { x: 0, y: 0 }, { x: 8, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 0 }
    ]);
  });

  it('previews known geometry without guessing an unreviewed initial wire point', () => {
    const document = fixture();
    document.setup = undefined;
    expect(programStopPreview(document).map(({ stopId }) => stopId)).toEqual(['positioned', 'distance', 'contour', 'exit']);
  });

  it('omits disabled and invalid distance markers', () => {
    const document = fixture();
    const stops = document.plan.operations[0].programStops!;
    stops[0].enabled = false;
    stops[2].placement = { kind: 'before-operation-end', remainingCutLengthMm: 20 };
    expect(programStopPreview(document).map(({ stopId }) => stopId)).toEqual(['positioned', 'contour', 'exit']);
  });
});
