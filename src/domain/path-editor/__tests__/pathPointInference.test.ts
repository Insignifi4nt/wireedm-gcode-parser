import { describe, expect, it } from 'vitest';

import type { DxfEntity } from '@/domain/dxf/types';
import { createPathPlanningDocumentFromDxfEntities } from '@/domain/path-intel/fromDxfEntities';

import {
  inferPathPoint,
  inferPerpendicularOperationOffset
} from '../pathPointInference';

function documentFrom(entities: DxfEntity[]) {
  return createPathPlanningDocumentFromDxfEntities(entities);
}

describe('inferPathPoint', () => {
  it('infers endpoint, nearest, and midpoint candidates on a line', () => {
    const document = documentFrom([
      { type: 'line', layer: 'CUT', start: { x: 0, y: 0 }, end: { x: 10, y: 0 } }
    ]);

    expect(inferPathPoint(document, { mode: 'endpoint', hintPoint: { x: 8, y: 2 } }))
      .toMatchObject({ point: { x: 10, y: 0 }, relation: 'endpoint', t: 1 });
    expect(inferPathPoint(document, { mode: 'nearest', hintPoint: { x: 8, y: 2 } }))
      .toMatchObject({ point: { x: 8, y: 0 }, relation: 'nearest', t: 0.8 });
    expect(inferPathPoint(document, { mode: 'midpoint', hintPoint: { x: 8, y: 2 } }))
      .toMatchObject({ point: { x: 5, y: 0 }, relation: 'midpoint', t: 0.5 });
  });

  it('constructs a perpendicular foot only when it lies on the finite segment', () => {
    const document = documentFrom([
      { type: 'line', layer: 'CUT', start: { x: 0, y: 0 }, end: { x: 10, y: 0 } }
    ]);

    expect(inferPathPoint(document, {
      mode: 'perpendicular',
      sourcePoint: { x: 4, y: 5 },
      hintPoint: { x: 4, y: 0 }
    })).toMatchObject({
      point: { x: 4, y: 0 },
      relation: 'perpendicular',
      sourcePoint: { x: 4, y: 5 },
      guide: { from: { x: 4, y: 5 }, to: { x: 4, y: 0 } }
    });

    expect(inferPathPoint(document, {
      mode: 'perpendicular',
      sourcePoint: { x: 14, y: 5 },
      hintPoint: { x: 9, y: 1 }
    })).toMatchObject({
      point: { x: 9, y: 0 },
      relation: 'nearest-fallback'
    });
  });

  it('infers arc midpoints and rejects perpendicular feet outside an arc sweep', () => {
    const document = documentFrom([{
      type: 'arc',
      layer: 'CUT',
      center: { x: 0, y: 0 },
      radius: 10,
      startAngle: 0,
      endAngle: 90,
      clockwise: false,
      start: { x: 10, y: 0 },
      end: { x: 0, y: 10 }
    }]);

    const midpoint = inferPathPoint(document, {
      mode: 'midpoint',
      hintPoint: { x: 7, y: 7 }
    });
    expect(midpoint?.relation).toBe('midpoint');
    expect(midpoint?.point.x).toBeCloseTo(Math.SQRT1_2 * 10);
    expect(midpoint?.point.y).toBeCloseTo(Math.SQRT1_2 * 10);

    expect(inferPathPoint(document, {
      mode: 'perpendicular',
      sourcePoint: { x: -20, y: 0 },
      hintPoint: { x: 0, y: 10 }
    })?.relation).toBe('nearest-fallback');
  });

  it('chooses the tangent nearest the cursor and exposes a construction guide', () => {
    const document = documentFrom([
      { type: 'circle', layer: 'CUT', center: { x: 0, y: 0 }, radius: 5 }
    ]);
    const candidate = inferPathPoint(document, {
      mode: 'tangent',
      sourcePoint: { x: 10, y: 0 },
      hintPoint: { x: 2.5, y: 4.5 }
    });

    expect(candidate?.relation).toBe('tangent');
    expect(candidate?.point.x).toBeCloseTo(2.5);
    expect(candidate?.point.y).toBeGreaterThan(0);
    expect(candidate?.guide?.from).toEqual({ x: 10, y: 0 });
    expect(candidate?.guide?.to).toEqual(candidate?.point);
  });

  it('uses an explicit nearest fallback when tangent construction is unavailable', () => {
    const document = documentFrom([
      { type: 'circle', layer: 'CUT', center: { x: 0, y: 0 }, radius: 5 }
    ]);

    const fallback = inferPathPoint(document, {
      mode: 'tangent',
      sourcePoint: { x: 1, y: 0 },
      hintPoint: { x: 0, y: 5 }
    });
    expect(fallback?.relation).toBe('nearest-fallback');
    expect(fallback?.point.x).toBeCloseTo(0);
    expect(fallback?.point.y).toBeCloseTo(5);
  });

  it('keeps inference inside an explicitly selected operation', () => {
    const document = documentFrom([
      { type: 'circle', layer: 'FIRST', center: { x: 0, y: 0 }, radius: 2 },
      { type: 'circle', layer: 'SECOND', center: { x: 20, y: 0 }, radius: 2 }
    ]);
    const firstOperationId = document.plan.operations[0].id;

    const candidate = inferPathPoint(document, {
      mode: 'nearest',
      operationId: firstOperationId,
      hintPoint: { x: 18, y: 0 }
    });

    expect(candidate?.operationId).toBe(firstOperationId);
    expect(candidate?.point.x).toBeCloseTo(2);
  });

  it('projects entry and exit points onto the operation endpoint normal', () => {
    const document = documentFrom([
      { type: 'line', layer: 'CUT', start: { x: 0, y: 0 }, end: { x: 10, y: 0 } }
    ]);
    const operationId = document.plan.operations[0].id;

    expect(inferPerpendicularOperationOffset(document, {
      endpoint: 'entry',
      operationId,
      hintPoint: { x: 2, y: -3 }
    })).toMatchObject({
      point: { x: 0, y: -3 },
      relation: 'perpendicular',
      sourcePoint: { x: 0, y: 0 }
    });
    expect(inferPerpendicularOperationOffset(document, {
      endpoint: 'exit',
      operationId,
      hintPoint: { x: 8, y: 4 }
    })).toMatchObject({
      point: { x: 10, y: 4 },
      relation: 'perpendicular',
      sourcePoint: { x: 10, y: 0 }
    });
  });
});
