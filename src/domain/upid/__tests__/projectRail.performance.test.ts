import { describe, expect, it } from 'vitest';
import { createUpidFromDxfEntities } from '../upidDocument';
import { readUpidEndpointTopologyRows } from '../projectRail';

describe('endpoint topology work budget', () => {
  it('keeps operation traversal proportional to input while resolving every selectable endpoint', () => {
    const count = 300;
    const document = createUpidFromDxfEntities(Array.from({ length: count }, (_, index) => ({
      type: 'line' as const, layer: 'CUT', start: { x: index * 3, y: 0 }, end: { x: index * 3 + 1, y: 0 }
    })), { operationOrderStrategy: 'source-order' });
    let operationReads = 0;
    for (const operation of document.plan.operations) {
      const refs = operation.segmentRefs;
      Object.defineProperty(operation, 'segmentRefs', { get: () => { operationReads++; return refs; } });
    }
    const rows = readUpidEndpointTopologyRows(document);
    expect(rows).toHaveLength(count * 2);
    expect(rows.every(row => row.kind === 'open-endpoint-cluster' && row.selectRef?.operationId && row.selectRef?.pointRole)).toBe(true);
    // A deterministic traversal budget detects repeated full-document scans without timing noise.
    expect(operationReads).toBeLessThanOrEqual(count * 3);
    expect(new Set(rows.map(row => row.selectRef?.segmentId)).size).toBe(count);
  });
});
