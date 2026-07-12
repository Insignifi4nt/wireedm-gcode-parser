import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { dxfEntitiesToUpidDocument } from '../dxfToUpid';
import { parseDxf } from '../parseDxf';
import type { DxfEntity } from '../types';

describe('dxfEntitiesToUpidDocument', () => {
  it('creates the internal UPID path document at the DXF import boundary', () => {
    const entities: DxfEntity[] = [
      {
        type: 'line',
        layer: 'CUT',
        start: { x: 0, y: 0 },
        end: { x: 10, y: 0 }
      }
    ];

    const document = dxfEntitiesToUpidDocument(entities);

    expect(document.source).toEqual({
      kind: 'dxf-entities',
      entityCount: 1,
      coordinateScaleToMillimeters: 1
    });
    expect(document.segments).toHaveLength(1);
    expect(document.plan.operations).toHaveLength(1);
    expect(document.options.endpointTolerance).toBe(0);
    expect(document.options.coincidenceEpsilon).toBe(0.000001);
  });

  it('treats sub-micron CAD endpoint noise as coincident at the DXF import boundary', () => {
    const document = dxfEntitiesToUpidDocument([
      line(0, 0, 10, 0),
      line(10.0000002, 0, 10, 10),
      line(10, 10.0000002, 0, 10),
      line(0, 10, 0, 0)
    ]);

    expect(document.chains).toHaveLength(1);
    expect(document.chains[0]).toMatchObject({
      closed: true,
      metrics: {
        gapLength: 0
      }
    });
    expect(document.contours).toHaveLength(1);
    expect(document.plan.operations).toHaveLength(1);
    expect(document.diagnostics.map((diagnostic) => diagnostic.code)).not.toContain('open-chain');
    expect(document.diagnostics.map((diagnostic) => diagnostic.code)).not.toContain('closed-chain-gap');
  });

  it('records source file identity when creating a UPID document from DXF import data', () => {
    const document = dxfEntitiesToUpidDocument([line(0, 0, 10, 0)], {}, {
      fileName: 'bracket.dxf',
      importedAt: '2026-05-31T12:00:00.000Z',
      projectId: 'bracket-2026-05-31'
    });

    expect(document.source).toMatchObject({
      entityCount: 1,
      fileName: 'bracket.dxf',
      importedAt: '2026-05-31T12:00:00.000Z',
      kind: 'dxf-entities',
      projectId: 'bracket-2026-05-31'
    });
  });

  it('does not keep a direct DXF-to-G-code adapter in the DXF boundary', () => {
    expect(existsSync(join(process.cwd(), 'src/domain/dxf/dxfToGcode.ts'))).toBe(false);
  });

  it('normalizes known DXF units to millimeters exactly once while retaining source units', () => {
    const parsed = parseDxf(inchGeometryDxf());
    const document = dxfEntitiesToUpidDocument(
      parsed.entities,
      {
        endpointTolerance: 0.01,
        coincidenceEpsilon: 0.0001,
        startPoint: { x: 2, y: 3 }
      },
      {
        drawing: parsed.drawing,
        units: parsed.units
      }
    );

    expect(document.source.units).toEqual({
      code: 1,
      label: 'inches',
      scaleToMillimeters: 25.4,
      source: 'dxf-insunits'
    });
    expect(document.source.coordinateScaleToMillimeters).toBe(25.4);
    expect(document.source.drawing).toEqual({
      basePoint: { x: 25.4, y: 50.8 },
      extents: {
        min: { x: 0, y: 0 },
        max: { x: 101.6, y: 127 }
      }
    });
    expect(document.options.endpointTolerance).toBeCloseTo(0.254, 12);
    expect(document.options.coincidenceEpsilon).toBeCloseTo(0.00254, 12);
    expect(document.options.startPoint).toEqual({ x: 50.8, y: 76.2 });
    expect(document.segments[0]).toMatchObject({
      kind: 'line',
      start: { x: 0, y: 0 },
      end: { x: 25.4, y: 0 }
    });
    expect(document.segments[1]).toMatchObject({
      kind: 'circle',
      center: { x: 50.8, y: 50.8 },
      radius: 12.7
    });
    expect(document.diagnostics.map((diagnostic) => diagnostic.code)).not.toContain(
      'units-assumed-millimeters'
    );
  });

  it('retains unitless coordinates and records an assumed-millimeters diagnostic', () => {
    const document = dxfEntitiesToUpidDocument([line(0, 0, 1, 0)]);

    expect(document.source.coordinateScaleToMillimeters).toBe(1);
    expect(document.segments[0]).toMatchObject({
      start: { x: 0, y: 0 },
      end: { x: 1, y: 0 }
    });
    expect(document.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: 'warning',
        code: 'units-assumed-millimeters'
      })
    );
  });

  it('filters non-cut layers through the path-planning API with deterministic diagnostics', () => {
    const document = dxfEntitiesToUpidDocument(
      [lineOnLayer('CUT', 0, 0, 1, 0), lineOnLayer('CONSTRUCTION', 10, 0, 11, 0)],
      { includeLayers: ['CUT'] }
    );

    expect(document.segments).toHaveLength(1);
    expect(document.segments[0].layer).toBe('CUT');
    expect(document.options.includeLayers).toEqual(['CUT']);
    expect(document.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: 'info',
        code: 'layer-filtered',
        details: expect.objectContaining({
          layer: 'CONSTRUCTION',
          sourceEntityIndex: 1
        })
      })
    );
  });

  it('applies excludeLayers even when the layer is otherwise included', () => {
    const document = dxfEntitiesToUpidDocument(
      [lineOnLayer('CUT', 0, 0, 1, 0), lineOnLayer('ETCH', 10, 0, 11, 0)],
      { includeLayers: ['CUT', 'ETCH'], excludeLayers: ['ETCH'] }
    );

    expect(document.segments.map((segment) => segment.layer)).toEqual(['CUT']);
    expect(document.options.excludeLayers).toEqual(['ETCH']);
  });

  it('keeps the bundled z18f25 fixture as 72 exact finite segments in one clean closed contour', () => {
    const filePath = join(process.cwd(), 'DXF-test-subjects/z18f25.dxf');
    const parsed = parseDxf(readFileSync(filePath, 'utf8'));
    const document = dxfEntitiesToUpidDocument(parsed.entities, {}, {
      drawing: parsed.drawing,
      units: parsed.units,
      fileName: 'z18f25.dxf'
    });

    expect(document.segments).toHaveLength(72);
    expect(document.segments.every((segment) => segment.source.exact)).toBe(true);
    expect(document.contours).toHaveLength(1);
    expect(document.contours[0]).toMatchObject({ closed: true });
    expect(document.diagnostics.filter((diagnostic) => diagnostic.severity === 'error')).toEqual([]);
    expect(document.segments.flatMap(segmentNumbers).every(Number.isFinite)).toBe(true);
  });
});

function line(startX: number, startY: number, endX: number, endY: number): DxfEntity {
  return lineOnLayer('CUT', startX, startY, endX, endY);
}

function lineOnLayer(
  layer: string,
  startX: number,
  startY: number,
  endX: number,
  endY: number
): DxfEntity {
  return {
    type: 'line',
    layer,
    start: { x: startX, y: startY },
    end: { x: endX, y: endY }
  };
}

function inchGeometryDxf() {
  return [
    '0',
    'SECTION',
    '2',
    'HEADER',
    '9',
    '$INSUNITS',
    '70',
    '1',
    '9',
    '$INSBASE',
    '10',
    '1',
    '20',
    '2',
    '9',
    '$EXTMIN',
    '10',
    '0',
    '20',
    '0',
    '9',
    '$EXTMAX',
    '10',
    '4',
    '20',
    '5',
    '0',
    'ENDSEC',
    '0',
    'SECTION',
    '2',
    'ENTITIES',
    '0',
    'LINE',
    '8',
    'CUT',
    '10',
    '0',
    '20',
    '0',
    '11',
    '1',
    '21',
    '0',
    '0',
    'CIRCLE',
    '8',
    'CUT',
    '10',
    '2',
    '20',
    '2',
    '40',
    '0.5',
    '0',
    'ENDSEC',
    '0',
    'EOF'
  ].join('\n');
}

function segmentNumbers(segment: ReturnType<typeof dxfEntitiesToUpidDocument>['segments'][number]) {
  const values = [
    segment.start.x,
    segment.start.y,
    segment.end.x,
    segment.end.y,
    segment.length,
    segment.bounds.minX,
    segment.bounds.minY,
    segment.bounds.maxX,
    segment.bounds.maxY
  ];

  if (segment.kind === 'arc' || segment.kind === 'circle') {
    values.push(segment.center.x, segment.center.y, segment.radius);
  }

  return values;
}
