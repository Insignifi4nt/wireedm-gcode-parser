import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { pathPlanToGcodeBody } from '@/domain/path-intel/postGcode';
import { approximateSegmentRef, orientedArcClockwise } from '@/domain/path-intel/segments';

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
    expect(document.options.startPoint?.x).toBeCloseTo(50.8, 12);
    expect(document.options.startPoint?.y).toBeCloseTo(76.2, 12);
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

  it('preserves distinct large unitless coordinates without precision quantization', () => {
    const startX = 1_234_567_890_123_456;
    const endX = startX + 2;
    const document = dxfEntitiesToUpidDocument([line(startX, 0, endX, 0)]);

    expect(document.segments).toHaveLength(1);
    expect(document.segments[0]).toMatchObject({
      start: { x: startX, y: 0 },
      end: { x: endX, y: 0 },
      length: 2
    });
  });

  it('keeps a tiny nonzero bulge over a huge chord as bounded finite arc geometry', () => {
    const chordLength = 5e15;
    const document = dxfEntitiesToUpidDocument([
      {
        type: 'lwpolyline',
        layer: 'CUT',
        closed: false,
        vertices: [
          { x: 0, y: 0, bulge: 1e-13 },
          { x: chordLength, y: 0, bulge: 0 }
        ]
      }
    ]);
    const segment = document.segments[0];

    expect(segment?.kind).toBe('arc');
    if (!segment || segment.kind !== 'arc') return;

    const encodedSagitta =
      (Math.hypot(segment.end.x - segment.start.x, segment.end.y - segment.start.y) / 2) *
      Math.tan(Math.abs(segment.sweepRadians) / 4);
    const numericOutput = segmentNumbers(segment);

    expect(encodedSagitta).toBeCloseTo(250, 0);
    expect(numericOutput.every(Number.isFinite)).toBe(true);
    expect(Math.max(...numericOutput.map(Math.abs))).toBeLessThan(1e29);
  });

  it.each([
    { label: 'positive 1e-16', chordLength: 1, bulge: 1e-16 },
    { label: 'negative 1e-16', chordLength: 1, bulge: -1e-16 },
    { label: 'positive 1e-15', chordLength: 1, bulge: 1e-15 },
    { label: 'negative 1e-15', chordLength: 1, bulge: -1e-15 },
    { label: '1e20-chord positive 1e-16', chordLength: 1e20, bulge: 1e-16 }
  ])(
    'preserves a stable signed sweep for $label bulge geometry',
    ({ chordLength, bulge }) => {
      const document = dxfEntitiesToUpidDocument([
        {
          type: 'lwpolyline',
          layer: 'CUT',
          closed: false,
          vertices: [
            { x: 0, y: 0, bulge },
            { x: chordLength, y: 0, bulge: 0 }
          ]
        }
      ]);
      const segment = document.segments[0];

      expect(segment?.kind).toBe('arc');
      if (!segment || segment.kind !== 'arc') return;

      const expectedSweep = 4 * Math.atan(bulge);
      const forwardRef = { segmentId: segment.id, reversed: false };
      const reversedRef = { segmentId: segment.id, reversed: true };
      const forwardPoints = approximateSegmentRef(segment, forwardRef, Math.PI / 18);
      const reversedPoints = approximateSegmentRef(segment, reversedRef, Math.PI / 18);
      const body = pathPlanToGcodeBody(document.plan, document.segments, {
        endpointTolerance: 0
      });
      const expectedCommand = bulge < 0 ? 'G2' : 'G3';

      expect(Math.abs((segment.sweepRadians - expectedSweep) / expectedSweep)).toBeLessThan(1e-12);
      expect(Math.abs((segment.length - chordLength) / chordLength)).toBeLessThan(1e-12);
      expect(segment.clockwise).toBe(bulge < 0);
      expect(orientedArcClockwise(segment, reversedRef)).toBe(bulge > 0);
      expect(segment.bounds.minX).toBeLessThanOrEqual(segment.start.x);
      expect(segment.bounds.minY).toBeLessThanOrEqual(segment.start.y);
      expect(segment.bounds.maxX).toBeGreaterThanOrEqual(segment.end.x);
      expect(segment.bounds.maxY).toBeGreaterThanOrEqual(segment.end.y);
      expect(forwardPoints[0]).toEqual(segment.start);
      expect(forwardPoints.at(-1)).toEqual(segment.end);
      expect(reversedPoints[0]).toEqual(segment.end);
      expect(reversedPoints.at(-1)).toEqual(segment.start);
      expect(body).toContain(
        `${expectedCommand} X${chordLength.toFixed(3)} Y0.000`
      );
      expect(body.split('\n').filter((line) => /^G[23] /.test(line))).toHaveLength(1);
      expect(segmentNumbers(segment).every(Number.isFinite)).toBe(true);
    }
  );

  it.each([
    { label: '1e20 chord / positive 1e-16 bulge', chordLength: 1e20, bulge: 1e-16 },
    { label: '1e20 chord / negative 1e-16 bulge', chordLength: 1e20, bulge: -1e-16 },
    { label: '5e15 chord / positive 1e-13 bulge', chordLength: 5e15, bulge: 1e-13 },
    { label: '5e15 chord / negative 1e-13 bulge', chordLength: 5e15, bulge: -1e-13 }
  ])(
    'bounds the cancellation-sensitive sagitta for $label',
    ({ chordLength, bulge }) => {
      const document = dxfEntitiesToUpidDocument([
        bulgePolyline({ x: 0, y: 0 }, { x: chordLength, y: 0 }, bulge)
      ]);
      const segment = document.segments[0];
      expect(segment?.kind).toBe('arc');
      if (!segment || segment.kind !== 'arc') return;

      const sagitta = (chordLength * Math.abs(bulge)) / 2;
      const midpoint = stableArcSample(segment, 0.5);

      expect(Math.abs(midpoint.y)).toBeGreaterThanOrEqual(sagitta * (1 - 1e-12));
      if (bulge > 0) {
        expect(segment.bounds.minY).toBeLessThanOrEqual(-sagitta * (1 - 1e-12));
      } else {
        expect(segment.bounds.maxY).toBeGreaterThanOrEqual(sagitta * (1 - 1e-12));
      }
      expectBoundsToContain(segment.bounds, midpoint);
      expectBoundsToContain(segment.bounds, segment.start);
      expectBoundsToContain(segment.bounds, segment.end);
    }
  );

  it.each([
    { label: '1e20 chord / positive 1e-16 bulge', chordLength: 1e20, bulge: 1e-16 },
    { label: '1e20 chord / negative 1e-16 bulge', chordLength: 1e20, bulge: -1e-16 },
    { label: '5e15 chord / positive 1e-13 bulge', chordLength: 5e15, bulge: 1e-13 },
    { label: '5e15 chord / negative 1e-13 bulge', chordLength: 5e15, bulge: -1e-13 }
  ])(
    'contains dense stable samples for a 90-degree-rotated $label tiny bulge',
    ({ chordLength, bulge }) => {
      const document = dxfEntitiesToUpidDocument([
        bulgePolyline({ x: 0, y: 0 }, { x: 0, y: chordLength }, bulge)
      ]);
      const segment = document.segments[0];
      expect(segment?.kind).toBe('arc');
      if (!segment || segment.kind !== 'arc') return;

      const sagitta = (chordLength * Math.abs(bulge)) / 2;
      const midpoint = stableArcSample(segment, 0.5);
      if (bulge > 0) {
        expect(segment.bounds.maxX).toBeGreaterThanOrEqual(sagitta * (1 - 1e-12));
      } else {
        expect(segment.bounds.minX).toBeLessThanOrEqual(-sagitta * (1 - 1e-12));
      }

      expectBoundsToContain(segment.bounds, segment.start);
      expectBoundsToContain(segment.bounds, segment.end);
      for (let index = 1; index < 100; index++) {
        expectBoundsToContain(segment.bounds, stableArcSample(segment, index / 100));
      }
      expectBoundsToContain(segment.bounds, midpoint);
    }
  );

  it.each([
    {
      label: 'positive',
      bulge: 5e15,
      expectedCenterY: -1.25e15,
      clockwise: false,
      sweepSign: 1
    },
    {
      label: 'negative',
      bulge: -5e15,
      expectedCenterY: 1.25e15,
      clockwise: true,
      sweepSign: -1
    }
  ])(
    'represents a large finite $label bulge with stable near-full-turn geometry',
    ({ bulge, expectedCenterY, clockwise, sweepSign }) => {
      const document = dxfEntitiesToUpidDocument([
        {
          type: 'lwpolyline',
          layer: 'CUT',
          closed: false,
          vertices: [
            { x: 0, y: 0, bulge },
            { x: 1, y: 0, bulge: 0 }
          ]
        }
      ]);
      const segment = document.segments[0];

      expect(segment?.kind).toBe('arc');
      if (!segment || segment.kind !== 'arc') return;

      expect(segment.radius).toBeCloseTo(1.25e15, 0);
      expect(segment.center.x).toBeCloseTo(0.5, 12);
      expect(segment.center.y).toBeCloseTo(expectedCenterY, 0);
      expect(segment.clockwise).toBe(clockwise);
      expect(Math.sign(segment.sweepRadians)).toBe(sweepSign);
      expect(Math.abs(segment.sweepRadians)).toBeGreaterThan(6);
      expect(Math.abs(segment.sweepRadians)).toBeLessThanOrEqual(2 * Math.PI);
      expect(segmentNumbers(segment).every(Number.isFinite)).toBe(true);
    }
  );

  it('normalizes a valid bulge chord independently of the global vector epsilon', () => {
    const document = dxfEntitiesToUpidDocument([
      {
        type: 'lwpolyline',
        layer: 'CUT',
        closed: false,
        vertices: [
          { x: 0, y: 0, bulge: 0.5 },
          { x: 5e-6, y: 0, bulge: 0 }
        ]
      }
    ]);
    const segment = document.segments[0];

    expect(segment?.kind).toBe('arc');
    if (!segment || segment.kind !== 'arc') return;

    expect(segment.radius).toBeCloseTo(3.125e-6, 15);
    expect(segment.center.x).toBeCloseTo(2.5e-6, 15);
    expect(segment.center.y).toBeCloseTo(1.875e-6, 15);
    expect(segment.sweepRadians).toBeCloseTo(4 * Math.atan(0.5), 12);
    expect(segmentNumbers(segment).every(Number.isFinite)).toBe(true);
  });

  it.each([
    { label: 'center and radius', bulge: 1e-13 },
    { label: 'path metrics', bulge: 1.3 },
    { label: 'stable-identity radius', bulge: 5e15 }
  ])('rejects a bulge arc when finite inputs overflow derived $label', ({ bulge }) => {
    const document = dxfEntitiesToUpidDocument([
      {
        type: 'lwpolyline',
        layer: 'CUT',
        closed: false,
        vertices: [
          { x: 0, y: 0, bulge },
          { x: 1e308, y: 0, bulge: 0 }
        ]
      },
      line(0, 1, 1, 1)
    ]);

    expect(document.segments).toHaveLength(1);
    expect(document.segments[0]?.kind).toBe('line');
    expect(document.segments.flatMap(segmentNumbers).every(Number.isFinite)).toBe(true);
    expect(document.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: 'warning',
        code: 'invalid-arc',
        details: expect.objectContaining({ sourceEntityIndex: 0, bulge })
      })
    );
  });

  it.each([
    {
      label: 'ARC length',
      entity: {
        type: 'arc',
        layer: 'CUT',
        center: { x: 0, y: 0 },
        radius: 1e308,
        startAngle: 0,
        endAngle: 180,
        clockwise: false,
        start: { x: 1e308, y: 0 },
        end: { x: -1e308, y: 0 }
      } satisfies DxfEntity
    },
    {
      label: 'CIRCLE bounds',
      entity: {
        type: 'circle',
        layer: 'CUT',
        center: { x: 1e308, y: 0 },
        radius: 1e308
      } satisfies DxfEntity
    }
  ])('rejects native $label when finite inputs create non-finite path geometry', ({ entity }) => {
    const document = dxfEntitiesToUpidDocument([entity, line(0, 1, 1, 1)]);

    expect(document.segments).toHaveLength(1);
    expect(document.segments[0]?.kind).toBe('line');
    expect(document.segments.flatMap(segmentNumbers).every(Number.isFinite)).toBe(true);
    expect(document.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: 'warning',
        code: 'invalid-arc',
        details: expect.objectContaining({ sourceEntityIndex: 0, radius: 1e308 })
      })
    );
  });

  it('rejects a LINE whose finite endpoints create non-finite path geometry', () => {
    const document = dxfEntitiesToUpidDocument([
      line(-1e308, 0, 1e308, 0),
      line(0, 1, 1, 1)
    ]);

    expect(document.segments).toHaveLength(1);
    expect(document.segments[0]).toMatchObject({
      kind: 'line',
      start: { x: 0, y: 1 },
      end: { x: 1, y: 1 }
    });
    expect(document.segments.flatMap(segmentNumbers).every(Number.isFinite)).toBe(true);
    expect(document.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: 'error',
        code: 'non-finite-geometry',
        details: expect.objectContaining({
          sourceEntityIndex: 0,
          sourceEntityType: 'line'
        })
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

function bulgePolyline(start: { x: number; y: number }, end: { x: number; y: number }, bulge: number): DxfEntity {
  return {
    type: 'lwpolyline',
    layer: 'CUT',
    closed: false,
    vertices: [
      { ...start, bulge },
      { ...end, bulge: 0 }
    ]
  };
}

function stableArcSample(
  segment: Extract<ReturnType<typeof dxfEntitiesToUpidDocument>['segments'][number], { kind: 'arc' }>,
  t: number
) {
  const delta = segment.sweepRadians * t;
  const sinDelta = Math.sin(delta);
  const sinHalf = Math.sin(delta / 2);
  const cosDeltaMinusOne = -2 * sinHalf * sinHalf;
  const radialX = segment.start.x - segment.center.x;
  const radialY = segment.start.y - segment.center.y;
  return {
    x: segment.start.x + cosDeltaMinusOne * radialX - sinDelta * radialY,
    y: segment.start.y + sinDelta * radialX + cosDeltaMinusOne * radialY
  };
}

function expectBoundsToContain(
  bounds: { minX: number; minY: number; maxX: number; maxY: number },
  point: { x: number; y: number }
) {
  expect(point.x).toBeGreaterThanOrEqual(bounds.minX);
  expect(point.x).toBeLessThanOrEqual(bounds.maxX);
  expect(point.y).toBeGreaterThanOrEqual(bounds.minY);
  expect(point.y).toBeLessThanOrEqual(bounds.maxY);
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

  if (segment.kind === 'arc') {
    values.push(
      segment.startAngleRadians,
      segment.endAngleRadians,
      segment.sweepRadians
    );
  }

  return values;
}
