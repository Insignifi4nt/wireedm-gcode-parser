import { deriveSourceMachiningOperations, setMachiningSpanParticipation } from '@/domain/path-intel/machiningParticipation';
import { setPathOperationManualLeadIn } from '../pathDocumentOperations';
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
  it.each([false, true])('uses clipped arc endpoint normals with source identity (reversed %s)', (reversed) => {
    const source = documentFrom([{ type: 'arc', layer: 'CUT', center: { x: 0, y: 0 }, radius: 10,
      startAngle: 0, endAngle: 90, clockwise: false, start: { x: 10, y: 0 }, end: { x: 0, y: 10 } }]);
    const operationId = source.plan.operations[0].id;
    const segmentId = source.segments[0].id;
    source.plan.operations[0].segmentRefs[0].reversed = reversed;
    const first = setMachiningSpanParticipation(source, { sourceSegmentId: segmentId, range: { start: 0, end: 0.2 }, participation: 'inactive-reference' })!;
    const document = setMachiningSpanParticipation(first, { sourceSegmentId: segmentId, range: { start: 0.7, end: 1 }, participation: 'inactive-reference' })!;
    for (const endpoint of ['entry', 'exit'] as const) {
      const parameter = endpoint === 'entry' ? reversed ? 0.7 : 0.2 : reversed ? 0.2 : 0.7;
      const angle = parameter * Math.PI / 2;
      const radial = { x: Math.cos(angle), y: Math.sin(angle) };
      const inferred = inferPerpendicularOperationOffset(document, { endpoint, operationId,
        hintPoint: { x: radial.x * 15 - radial.y * 3, y: radial.y * 15 + radial.x * 3 } });
      expect(inferred).toMatchObject({ operationId, segmentId, segmentIndex: 0, endpointRole: null });
      expect(inferred!.sourcePoint.x).toBeCloseTo(radial.x * 10);
      expect(inferred!.sourcePoint.y).toBeCloseTo(radial.y * 10);
      expect(inferred!.point.x).toBeCloseTo(radial.x * 15);
      expect(inferred!.point.y).toBeCloseTo(radial.y * 15);
      expect(inferred!.t).toBeCloseTo(reversed ? 1 - parameter : parameter);
      if (endpoint === 'entry') {
        const edited = setPathOperationManualLeadIn(document, operationId, inferred!.point)!;
        const active = deriveSourceMachiningOperations(edited, operationId);
        expect(active?.status).toBe('ready');
        if (active?.status === 'ready') expect(active.operations[0].transitions?.entry).toMatchObject({ from: inferred!.point, to: inferred!.sourcePoint });
      }
    }
  });

  it('uses clipped line endpoints and declines blocked or wholly inactive paths', () => {
    const source = documentFrom([{ type: 'line', layer: 'CUT', start: { x: 0, y: 0 }, end: { x: 10, y: 0 } }]);
    const operationId = source.plan.operations[0].id;
    const partial = setMachiningSpanParticipation(source, { sourceSegmentId: source.segments[0].id, range: { start: 0, end: 0.4 }, participation: 'inactive-reference' })!;
    expect(inferPerpendicularOperationOffset(partial, { endpoint: 'entry', operationId, hintPoint: { x: 1, y: -3 } })).toMatchObject({ sourcePoint: { x: 4, y: 0 }, point: { x: 4, y: -3 }, t: 0.4 });
    for (const range of [{ start: 0.4, end: 0.6 }, { start: 0, end: 1 }]) {
      const blocked = setMachiningSpanParticipation(source, { sourceSegmentId: source.segments[0].id, range, participation: 'inactive-reference' })!;
      expect(inferPerpendicularOperationOffset(blocked, { endpoint: 'entry', operationId, hintPoint: { x: 1, y: -3 } })).toBeNull();
    }
  });

  it('infers endpoint, nearest, and midpoint candidates on a line', () => {
    const document = documentFrom([
      { type: 'line', layer: 'CUT', start: { x: 0, y: 0 }, end: { x: 10, y: 0 } }
    ]);

    expect(inferPathPoint(document, { mode: 'endpoint', hintPoint: { x: 8, y: 2 } }))
      .toMatchObject({ point: { x: 10, y: 0 }, relation: 'endpoint', t: 1 });
    expect(inferPathPoint(document, { mode: 'nearest', hintPoint: { x: 8, y: 2 } }))
      .toMatchObject({
        point: { x: 8, y: 0 },
        relation: 'nearest',
        t: 0.8,
        guide: { from: { x: 8, y: 2 }, to: { x: 8, y: 0 } }
      });
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

  it('constructs the perpendicular foot on the hovered side, not the closest foot', () => {
    const document = documentFrom([
      { type: 'line', layer: 'CUT', start: { x: 0, y: 0 }, end: { x: 10, y: 0 } },
      { type: 'line', layer: 'CUT', start: { x: 10, y: 0 }, end: { x: 10, y: 5 } },
      { type: 'line', layer: 'CUT', start: { x: 10, y: 5 }, end: { x: 0, y: 5 } },
      { type: 'line', layer: 'CUT', start: { x: 0, y: 5 }, end: { x: 0, y: 0 } }
    ]);

    expect(inferPathPoint(document, {
      mode: 'perpendicular',
      sourcePoint: { x: 2, y: 2 },
      hintPoint: { x: 8, y: 4.8 }
    })).toMatchObject({
      point: { x: 2, y: 5 },
      relation: 'perpendicular'
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
