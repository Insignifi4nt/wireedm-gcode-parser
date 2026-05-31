import { describe, expect, it } from 'vitest';

import { dxfEntitiesToGcode, dxfEntitiesToGcodeBody } from '../dxfToGcode';
import type { DxfEntity } from '../types';

describe('dxfEntitiesToGcodeBody', () => {
  it('converts lines, arcs, and circles into clean IJ body G-code without feeds', () => {
    const entities: DxfEntity[] = [
      {
        type: 'line',
        layer: 'CUT',
        start: { x: 0, y: 0 },
        end: { x: 10, y: 0 }
      },
      {
        type: 'arc',
        layer: 'CUT',
        center: { x: 10, y: 10 },
        radius: 10,
        startAngle: 270,
        endAngle: 180,
        clockwise: false,
        start: { x: 10, y: 0 },
        end: { x: 0, y: 10 }
      },
      {
        type: 'circle',
        layer: 'HOLE',
        center: { x: 30, y: 30 },
        radius: 5
      }
    ];

    expect(dxfEntitiesToGcodeBody(entities)).toBe(
      [
        'G0 X0.000 Y0.000',
        'G1 X10.000 Y0.000',
        'G3 X0.000 Y10.000 I0.000 J10.000',
        'G0 X35.000 Y30.000',
        'G3 X25.000 Y30.000 I-5.000 J0.000',
        'G3 X35.000 Y30.000 I5.000 J0.000'
      ].join('\n')
    );
    expect(dxfEntitiesToGcodeBody(entities)).not.toMatch(/\bF\d/);
  });

  it('converts LWPOLYLINE bulge segments into G2/G3 arc moves', () => {
    const entities: DxfEntity[] = [
      {
        type: 'lwpolyline',
        layer: 'PROFILE',
        closed: false,
        vertices: [
          { x: 0, y: 0, bulge: 0 },
          { x: 10, y: 0, bulge: 0.41421356237309503 },
          { x: 10, y: 10, bulge: 0 }
        ]
      }
    ];

    expect(dxfEntitiesToGcodeBody(entities)).toBe(
      [
        'G0 X0.000 Y0.000',
        'G1 X10.000 Y0.000',
        'G3 X10.000 Y10.000 I-5.000 J5.000'
      ].join('\n')
    );
  });

  it('adds a rapid move when entity starts are disconnected', () => {
    const entities: DxfEntity[] = [
      {
        type: 'line',
        layer: null,
        start: { x: 0, y: 0 },
        end: { x: 1, y: 0 }
      },
      {
        type: 'line',
        layer: null,
        start: { x: 10, y: 10 },
        end: { x: 11, y: 10 }
      }
    ];

    expect(dxfEntitiesToGcodeBody(entities)).toBe(
      [
        'G0 X0.000 Y0.000',
        'G1 X1.000 Y0.000',
        'G0 X10.000 Y10.000',
        'G1 X11.000 Y10.000'
      ].join('\n')
    );
  });

  it('preserves open-chain direction by default', () => {
    expect(dxfEntitiesToGcodeBody([line(10, 0, 0, 0)])).toBe(
      ['G0 X10.000 Y0.000', 'G1 X0.000 Y0.000'].join('\n')
    );
  });

  it('returns path and post diagnostics when tolerance healing is requested', () => {
    const result = dxfEntitiesToGcode(gappedRectangle(0.004), {
      endpointTolerance: 0.01
    });

    expect(result.body).toBe(
      [
        'G0 X0.000 Y0.000',
        'G1 X10.000 Y0.000',
        'G1 X10.004 Y0.000',
        'G1 X10.000 Y5.000',
        'G1 X0.000 Y5.000',
        'G1 X0.000 Y0.000'
      ].join('\n')
    );
    expect(result.document.options.endpointTolerance).toBe(0.01);
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === 'endpoint-cluster-snap')).toBe(true);
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === 'post-bridged-gap')).toBe(true);
  });
});

function gappedRectangle(gap: number): DxfEntity[] {
  return [
    line(0, 0, 10, 0),
    line(10 + gap, 0, 10, 5),
    line(10, 5, 0, 5),
    line(0, 5, 0, 0)
  ];
}

function line(startX: number, startY: number, endX: number, endY: number): DxfEntity {
  return {
    type: 'line',
    layer: 'CUT',
    start: { x: startX, y: startY },
    end: { x: endX, y: endY }
  };
}
