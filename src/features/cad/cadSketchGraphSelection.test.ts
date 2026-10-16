import { describe, expect, it } from 'vitest';
import type { CadSketchGraph } from '@/domain/cad/cadSketchGraph';
import { cadSketchGraphSelectionSet, cadSketchGraphSelectionsEqual, isCadSketchGraphSelected, reconcileCadSketchGraphSelection, toggleCadSketchGraphSelection } from './cadSketchGraphSelection';

const graph: CadSketchGraph = {
  points: [{ id: 'a', position: ['width', 0] }, { id: 'b', position: [10, 0] }],
  entities: [{ id: 'ab', kind: 'line', construction: false, startPointId: 'a', endPointId: 'b' }], relations: [],
};

describe('sketch graph selection sets', () => {
  it('preserves ordered typed identities in a detached immutable set without changing source drivers', () => {
    const input = [{ kind: 'entity', id: 'ab' }, { kind: 'point', id: 'a' }];
    const source = structuredClone(graph);
    const selected = cadSketchGraphSelectionSet(graph, input);
    expect(selected).toEqual([{ kind: 'entity', id: 'ab' }, { kind: 'point', id: 'a' }]);
    input[0].id = 'b'; input.reverse();
    expect(selected).toEqual([{ kind: 'entity', id: 'ab' }, { kind: 'point', id: 'a' }]);
    expect(Object.isFrozen(selected)).toBe(true);
    expect(selected.every(Object.isFrozen)).toBe(true);
    expect(graph).toEqual(source);
    expect(cadSketchGraphSelectionSet(undefined, [])).toEqual([]);
  });
  it.each([
    null, {}, [{ kind: 'relation', id: 'a' }], [{ kind: 'point', id: 'a', extra: true }],
    [{ kind: 'point', id: 'a' }, { id: 'a', kind: 'point' }], [{ kind: 'point', id: 'bad id' }],
  ].map(input => ({ input })))('rejects malformed or duplicate requests atomically: $input', ({ input }) => {
    expect(() => cadSketchGraphSelectionSet(graph, input)).toThrowError(expect.objectContaining({ code: 'invalid-sketch-selection' }));
  });
  it.each([
    [{ kind: 'point', id: 'a' }, { kind: 'entity', id: 'a' }],
    [{ kind: 'point', id: 'ab' }], [{ kind: 'entity', id: 'other-sketch-edge' }],
  ].map(input => ({ input })))('rejects a whole set containing foreign or wrong-category IDs: $input', ({ input }) => {
    expect(() => cadSketchGraphSelectionSet(graph, input)).toThrowError(expect.objectContaining({ code: 'missing-sketch-selection' }));
    expect(() => cadSketchGraphSelectionSet(undefined, [{ kind: 'point', id: 'a' }])).toThrow('active sketch');
  });
  it('allows exactly 64 source identities and refuses one more without truncation', () => {
    const points = Array.from({ length: 65 }, (_, index) => ({ id: `p${index}`, position: [index, 0] as const }));
    const source = { points, entities: [], relations: [] };
    const selections = points.map(point => ({ kind: 'point', id: point.id }));
    expect(cadSketchGraphSelectionSet(source, selections.slice(0, 64))).toHaveLength(64);
    expect(() => cadSketchGraphSelectionSet(source, selections)).toThrowError(expect.objectContaining({ code: 'invalid-sketch-selection' }));
  });
  it('toggles only the requested atom and preserves insertion order and category membership', () => {
    const initial = cadSketchGraphSelectionSet(graph, [{ kind: 'point', id: 'a' }, { kind: 'entity', id: 'ab' }]);
    const toggled = toggleCadSketchGraphSelection(initial, { kind: 'point', id: 'b' });
    expect(toggled).toEqual([{ kind: 'point', id: 'a' }, { kind: 'entity', id: 'ab' }, { kind: 'point', id: 'b' }]);
    expect(toggleCadSketchGraphSelection(toggled, { kind: 'point', id: 'a' })).toEqual([{ kind: 'entity', id: 'ab' }, { kind: 'point', id: 'b' }]);
    expect(initial).toHaveLength(2);
    expect(Object.isFrozen(toggled)).toBe(true);
    expect(toggled.every(Object.isFrozen)).toBe(true);
    expect(isCadSketchGraphSelected(initial, { kind: 'point', id: 'a' })).toBe(true);
    expect(isCadSketchGraphSelected(initial, { kind: 'entity', id: 'a' })).toBe(false);
    expect(cadSketchGraphSelectionsEqual(initial, [{ kind: 'point', id: 'a' }, { kind: 'entity', id: 'ab' }])).toBe(true);
    expect(cadSketchGraphSelectionsEqual(initial, [...initial].reverse())).toBe(false);
    expect(cadSketchGraphSelectionsEqual(initial, toggled)).toBe(false);
  });
  it('permits removing from a full set but refuses appending past 64', () => {
    const full = Array.from({ length: 64 }, (_, index) => ({ kind: 'point' as const, id: `p${index}` }));
    expect(toggleCadSketchGraphSelection(full, full[0])).toHaveLength(63);
    expect(() => toggleCadSketchGraphSelection(full, { kind: 'point', id: 'p64' })).toThrow('64');
  });
  it('reconciles accepted source deletion by exact category and identity without coordinate retargeting', () => {
    const selected = cadSketchGraphSelectionSet(graph, [{ kind: 'entity', id: 'ab' }, { kind: 'point', id: 'a' }, { kind: 'point', id: 'b' }]);
    expect(reconcileCadSketchGraphSelection(graph, selected)).toBe(selected);
    const changed: CadSketchGraph = { points: [{ id: 'a', position: [20, 0] }, { id: 'replacement-b', position: [10, 0] }],
      entities: [{ id: 'b', kind: 'line', construction: false, startPointId: 'a', endPointId: 'replacement-b' }], relations: [] };
    const reconciled = reconcileCadSketchGraphSelection(changed, selected);
    expect(reconciled).toEqual([{ kind: 'point', id: 'a' }]);
    expect(Object.isFrozen(reconciled)).toBe(true);
    expect(selected).toHaveLength(3);
    expect(reconcileCadSketchGraphSelection(undefined, selected)).toEqual([]);
  });
});
