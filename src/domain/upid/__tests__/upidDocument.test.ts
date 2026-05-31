import { describe, expect, it } from 'vitest';

import { createUpidFromDxfEntities, postUpidToGcodeBody } from '../upidDocument';

describe('UPID document boundary', () => {
  it('creates a Universal Path Intelligence Document from DXF entities and posts it at the export boundary', () => {
    const document = createUpidFromDxfEntities([
      {
        type: 'line',
        layer: 'CUT',
        start: { x: 0, y: 0 },
        end: { x: 10, y: 0 }
      }
    ]);

    expect(document.source.kind).toBe('dxf-entities');
    expect(document.segments).toHaveLength(1);
    expect(document.plan.operations).toHaveLength(1);
    expect(postUpidToGcodeBody(document)).toBe('G0 X0.000 Y0.000\nG1 X10.000 Y0.000');
  });
});
