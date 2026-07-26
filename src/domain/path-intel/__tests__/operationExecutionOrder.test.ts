import { describe, expect, it, vi } from 'vitest';

import { createUpidFromDxfEntities } from '@/domain/upid/upidDocument';

import { orderedPathOperations } from '../operationExecutionOrder';

describe('operation execution order', () => {
  it('orders imported operations by orderIndex without mutating the source array', () => {
    const document = twoContourDocument();
    const [first, second] = document.plan.operations;
    const imported = [second, first];

    const ordered = orderedPathOperations(imported);

    expect(ordered.map((operation) => operation.id)).toEqual([first.id, second.id]);
    expect(imported.map((operation) => operation.id)).toEqual([second.id, first.id]);
    expect(ordered).not.toBe(imported);
  });

  it('uses operation id as a deterministic duplicate-orderIndex tie-break', () => {
    const document = twoContourDocument();
    const [first, second] = document.plan.operations;
    first.orderIndex = 4;
    second.orderIndex = 4;
    first.id = 'operation-z';
    second.id = 'operation-a';

    expect(orderedPathOperations([first, second]).map((operation) => operation.id))
      .toEqual(['operation-a', 'operation-z']);
  });

  it('uses locale-independent code-unit ordering for Unicode operation ids', () => {
    const document = twoContourDocument();
    const [first, second] = document.plan.operations;
    first.orderIndex = 4;
    second.orderIndex = 4;
    first.id = 'operation-ä';
    second.id = 'operation-z';
    const localeCompare = vi.spyOn(String.prototype, 'localeCompare')
      .mockImplementation(() => -1);

    try {
      expect(orderedPathOperations([first, second]).map((operation) => operation.id))
        .toEqual(['operation-z', 'operation-ä']);
      expect(localeCompare).not.toHaveBeenCalled();
    } finally {
      localeCompare.mockRestore();
    }
  });
});

function twoContourDocument() {
  return createUpidFromDxfEntities([
    { type: 'circle', layer: 'CUT', center: { x: 0, y: 0 }, radius: 3 },
    { type: 'circle', layer: 'CUT', center: { x: 20, y: 0 }, radius: 3 }
  ]);
}
