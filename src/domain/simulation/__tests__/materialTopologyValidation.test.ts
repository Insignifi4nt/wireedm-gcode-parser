import { describe, expect, it } from 'vitest';
import { unsupportedMaterialPolygons } from '../materialTopology';

const rectangle = (id: string, x: number, y: number, width: number, height: number) => ({ id, polygon: [
  { x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }
] });

describe('sampled material boundary validation', () => {
  it('accepts separated and strictly nested loops regardless of winding', () => {
    const outer = rectangle('outer', 0, 0, 10, 10);
    const inner = rectangle('inner', 1, 1, 2, 2);
    inner.polygon.reverse();
    expect([...unsupportedMaterialPolygons([outer, inner, rectangle('apart', 20, 0, 2, 2)]).ids]).toEqual([]);
  });

  it('rejects crossing, collinear shared edges, corner contact and self-crossings', () => {
    for (const other of [rectangle('other', 5, 5, 10, 10), rectangle('other', 10, 2, 3, 4), rectangle('other', 10, 10, 2, 2)]) {
      expect([...unsupportedMaterialPolygons([rectangle('first', 0, 0, 10, 10), other]).ids].sort()).toEqual(['first', 'other']);
    }
    const crossing = { id: 'crossing', polygon: [{ x: 0, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }, { x: 4, y: 1 }] };
    expect([...unsupportedMaterialPolygons([crossing]).ids]).toEqual(['crossing']);
  });

  it('never approves unchecked material after exceeding the boundary budget', () => {
    const many = { id: 'large', polygon: Array.from({ length: 100_001 }, (_, index) => ({ x: index, y: 0 })) };
    const result = unsupportedMaterialPolygons([rectangle('small', 0, 0, 10, 10), many]);
    expect(result.budgetExceeded).toBe(true);
    expect([...result.ids].sort()).toEqual(['large', 'small']);
  });
});
