import { describe, expect, it } from 'vitest';
import { parseCadSketchGraph } from '../cadSketchGraph';
import { translateCadSketchGraph } from '../cadSketchTranslation';
import { createCadSketchCornerTreatment } from '../cadSketchCornerTreatment';
import { checkCadSketchGraph } from '../cadSketchGraph';

describe('exact selected sketch translation', () => {
  it('moves shared source points once for mixed selections while retaining outside source and exact sizes', () => {
    const graph = parseCadSketchGraph({ points: [{ id: 'a', position: [0, 0] }, { id: 'b', position: [20, 0] },
      { id: 'c', position: [20, 10] }, { id: 'o', position: [50, 30] }], entities: [
      { id: 'ab', kind: 'line', construction: false, startPointId: 'a', endPointId: 'b' },
      { id: 'bc', kind: 'line', construction: true, startPointId: 'b', endPointId: 'c' },
      { id: 'circle', kind: 'circle', construction: false, centerPointId: 'o', radius: ' size / 2 ' }
    ], relations: [{ id: 'length', kind: 'distance', pointIds: ['a', 'b'], value: 20 }] });
    const before = JSON.stringify(graph);
    const moved = translateCadSketchGraph({ graph, parameters: { size: 8 }, selections: [{ kind: 'entity', id: 'ab' }, { kind: 'point', id: 'b' }], translation: [7, -3] });
    expect(moved.points.map(point => point.position)).toEqual([[7, -3], [27, -3], [20, 10], [50, 30]]);
    expect(moved.entities).toEqual(graph.entities); expect(moved.relations).toEqual(graph.relations);
    expect(JSON.stringify(graph)).toBe(before); expect(Object.isFrozen(moved.points[0].position)).toBe(true);
  });

  it('retains exact coordinate drivers and rejects an entire blocked vector, including numeric strings and fixed relations', () => {
    const graph = parseCadSketchGraph({ points: [{ id: 'p', position: [' 0e0 ', 2] }], entities: [], relations: [] });
    const selection = [{ kind: 'point', id: 'p' }] as const;
    expect(translateCadSketchGraph({ graph, selections: selection, translation: [0, 3], parameters: {} }).points[0].position).toEqual([' 0e0 ', 5]);
    expect(() => translateCadSketchGraph({ graph, selections: selection, translation: [1, 3], parameters: {} })).toThrowError(expect.objectContaining({ code: 'driven-sketch-position' }));
    for (const relation of [{ id: 'fixed', kind: 'fixed-axis', pointId: 'p', axis: 'x', value: 0 },
      { id: 'fixed', kind: 'fixed-point', pointId: 'p', position: [0, 2] }] as const) {
      const fixed = parseCadSketchGraph({ ...graph, points: [{ id: 'p', position: [0, 2] }], relations: [relation] });
      expect(() => translateCadSketchGraph({ graph: fixed, selections: selection, translation: [1, 3], parameters: {} })).toThrowError(expect.objectContaining({ code: 'driven-sketch-position' }));
    }
    expect(graph.points[0].position).toEqual([' 0e0 ', 2]);
  });

  it.each(['fillet', 'chamfer'] as const)('moves the owned original %s corner with complete treatment operands without rewriting its relation', kind => {
    const raw = parseCadSketchGraph({ points: [{ id: 'v', position: [0, 0] }, { id: 'a', position: [20, 0] }, { id: 'b', position: [0, 20] }], entities: [
      { id: 'a-line', kind: 'line', startPointId: 'v', endPointId: 'a', construction: false },
      { id: 'b-line', kind: 'line', startPointId: 'v', endPointId: 'b', construction: false }], relations: [] });
    let n = 0;
    const { graph } = createCadSketchCornerTreatment({ graph: raw, pointId: 'v', parameters: { size: 2 }, createId: () => `new-${++n}`,
      treatment: kind === 'fillet' ? { kind, radius: ' size ' } : { kind, setbacks: [' size ', 3] } });
    const moved = translateCadSketchGraph({ graph, parameters: { size: 2 }, selections: graph.entities.map(entity => ({ kind: 'entity', id: entity.id })), translation: [5, 7] });
    expect(moved.points.find(point => point.id === 'v')?.position).toEqual([5, 7]);
    expect(moved.relations).toEqual(graph.relations); expect(moved.entities).toEqual(graph.entities);
    expect(checkCadSketchGraph(moved, { size: 2 })).toEqual([]);
    const driven = parseCadSketchGraph({ ...graph, points: graph.points.map(point => point.id === 'v' ? { ...point, position: [' 0 ', 0] } : point) });
    expect(() => translateCadSketchGraph({ graph: driven, parameters: { size: 2 }, selections: graph.entities.map(entity => ({ kind: 'entity', id: entity.id })), translation: [5, 7] }))
      .toThrowError(expect.objectContaining({ code: 'driven-sketch-position' }));
  });

  it('translates an entire major arc and a linked circle without changing radii, branch or outside points', () => {
    const graph = parseCadSketchGraph({ points: [{ id: 'o', position: [2, 3] }, { id: 's', position: [12, 3] }, { id: 'e', position: [2, 13] },
      { id: 'c', position: [40, 30] }, { id: 'near', position: [40, 30] }], entities: [
      { id: 'arc', kind: 'arc', construction: false, centerPointId: 'o', startPointId: 's', endPointId: 'e', direction: 'cw' },
      { id: 'circle', kind: 'circle', construction: true, centerPointId: 'c', radius: ' radius ' }], relations: [] });
    const moved = translateCadSketchGraph({ graph, parameters: { radius: 4 }, selections: [{ kind: 'entity', id: 'arc' }, { kind: 'entity', id: 'circle' }], translation: [7, -3] });
    expect(moved.points.map(point => point.position)).toEqual([[9, 0], [19, 0], [9, 10], [47, 27], [40, 30]]);
    expect(moved.entities).toEqual(graph.entities); expect(checkCadSketchGraph(moved, { radius: 4 })).toEqual([]);
  });

  it('rejects lost displacement and local shape distortion at far origins instead of licensing them with world roundoff', () => {
    const graph = parseCadSketchGraph({ points: [{ id: 'a', position: [0, 0] }, { id: 'b', position: [1e-6, 0] }], entities: [
      { id: 'line', kind: 'line', construction: false, startPointId: 'a', endPointId: 'b' }], relations: [] });
    expect(() => translateCadSketchGraph({ graph, parameters: {}, selections: [{ kind: 'entity', id: 'line' }], translation: [9e8, 0] }))
      .toThrowError(expect.objectContaining({ code: 'sketch-translation-precision' }));
    const far = parseCadSketchGraph({ points: [{ id: 'a', position: [9e8, 0] }], entities: [], relations: [] });
    expect(() => translateCadSketchGraph({ graph: far, parameters: {}, selections: [{ kind: 'point', id: 'a' }], translation: [1e-12, 0] }))
      .toThrowError(expect.objectContaining({ code: 'sketch-translation-precision' }));
  });

  it('rejects rounding a barely major or minor arc onto a half-turn during rigid translation', () => {
    for (const direction of ['cw', 'ccw'] as const) {
      const graph = parseCadSketchGraph({ points: [{ id: 'o', position: [0, 0] }, { id: 's', position: [1, 0] }, { id: 'e', position: [-1, 2e-13] }], entities: [
        { id: 'arc', kind: 'arc', centerPointId: 'o', startPointId: 's', endPointId: 'e', direction, construction: false }], relations: [] });
      expect(() => translateCadSketchGraph({ graph, parameters: {}, selections: [{ kind: 'entity', id: 'arc' }], translation: [0, 1e4] }))
        .toThrowError(expect.objectContaining({ code: 'sketch-translation-precision' }));
    }
    // A far arc just short of a half turn keeps that exact minor sweep when brought home.
    const far = parseCadSketchGraph({ points: [{ id: 'o', position: [1e8, 0] }, { id: 's', position: [1e8 + 1, 0] }, { id: 'e', position: [1e8 - 1, 1e-8] }], entities: [
      { id: 'arc', kind: 'arc', centerPointId: 'o', startPointId: 's', endPointId: 'e', direction: 'ccw', construction: false }], relations: [] });
    expect(translateCadSketchGraph({ graph: far, parameters: {}, selections: [{ kind: 'entity', id: 'arc' }], translation: [-1e8, 0] }).points.find(point => point.id === 'e')?.position).toEqual([-1, 1e-8]);
  });

  it('returns the original for zero motion but still rejects empty, duplicate or wrong-owner selections', () => {
    const graph = parseCadSketchGraph({ points: [{ id: 'p', position: [' 0 ', 2] }], entities: [], relations: [] });
    expect(translateCadSketchGraph({ graph, parameters: {}, selections: [{ kind: 'point', id: 'p' }], translation: [0, 0] })).toBe(graph);
    for (const selections of [[], [{ kind: 'point', id: 'missing' }], [{ kind: 'entity', id: 'p' }], [{ kind: 'point', id: 'p' }, { kind: 'point', id: 'p' }]] as const)
      expect(() => translateCadSketchGraph({ graph, parameters: {}, selections, translation: [0, 0] })).toThrow();
  });
});
