import { describe, expect, it } from 'vitest';

import { createUpidFromDxfEntities } from '@/domain/upid/upidDocument';

import { resolveProgramStopPoints } from '../programStops';

describe('operation program stops', () => {
  it('places a remaining-distance stop at an exact point without changing source geometry', () => {
    const document = createUpidFromDxfEntities([
      { type: 'line', layer: 'CUT', start: { x: 0, y: 0 }, end: { x: 10, y: 0 } }
    ]);
    const operation = document.plan.operations[0];
    operation.programStops = [{
      id: 'stop-retain',
      enabled: true,
      placement: { kind: 'before-operation-end', remainingCutLengthMm: 2 },
      reason: 'part-retention'
    }];

    expect(resolveProgramStopPoints(document, operation.id)).toEqual({
      status: 'ready',
      stops: [{
        id: 'stop-retain',
        placement: 'before-operation-end',
        point: { x: 8, y: 0 },
        remainingCutLengthMm: 2
      }]
    });
    expect(document.segments).toHaveLength(1);
  });

  it('uses oriented contour geometry rather than cached metrics or transition lengths', () => {
    const document = createUpidFromDxfEntities([
      { type: 'line', layer: 'CUT', start: { x: 0, y: 0 }, end: { x: 10, y: 0 } }
    ]);
    const operation = document.plan.operations[0];
    operation.transitions = {
      entry: {
        strategy: 'manual-straight', move: 'cut', from: { x: -5, y: 0 },
        to: { x: 0, y: 0 }, review: 'reviewed'
      }
    };
    operation.metrics.cutLength = 10;
    operation.programStops = [{
      id: 'stop-geometry', enabled: true,
      placement: { kind: 'before-operation-end', remainingCutLengthMm: 7 },
      reason: 'part-retention'
    }];

    expect(resolveProgramStopPoints(document, operation.id)).toEqual({
      status: 'ready',
      stops: [expect.objectContaining({ point: { x: 3, y: 0 } })]
    });
  });
});
