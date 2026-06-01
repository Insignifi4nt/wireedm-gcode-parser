import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { dxfEntitiesToUpidDocument } from '../dxfToUpid';
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
      entityCount: 1
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
});

function line(startX: number, startY: number, endX: number, endY: number): DxfEntity {
  return {
    type: 'line',
    layer: 'CUT',
    start: { x: startX, y: startY },
    end: { x: endX, y: endY }
  };
}
