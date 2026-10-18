import { describe, expect, it } from 'vitest';
import { checkCadSketchGraph, parseCadSketchGraph } from '../cadSketchGraph';
import { cadSketchRelationEntityIds, cadSketchRelationPointIds, mapCadSketchRelationScalars } from '../cadSketchGraphReferences';
import { resolveCadSketchSymmetryOperands } from '../cadSketchSymmetryRelations';
import { deleteCadSketchElements } from '../cadSketchGraphEdits';
import { applyCadEdits } from '../cadOperations';
import { circleRow, circleRowPart, rowSketch } from './cadSketchLinearPatternFixtures';
import { symmetricRelation, symmetryPart, symmetrySketch } from './cadSketchSymmetryFixtures';

describe('point-pair symmetry source', () => {
  it('strictly resolves the line and four distinct declared identity classes, without repairing unsolved positions', () => {
    const original = symmetrySketch(symmetryPart()).graph, raw = { ...original, relations: [symmetricRelation] }, graph = parseCadSketchGraph(raw);
    expect(graph.relations).toEqual([symmetricRelation]); expect(graph.points).toEqual(original.points);
    expect(resolveCadSketchSymmetryOperands(graph, symmetricRelation).line.id).toBe('axis');
    for (const relation of [{ ...symmetricRelation, value: 1 }, { ...symmetricRelation, lineId: 'left-bore' },
      { ...symmetricRelation, pointIds: ['left', 'missing'] }, { ...symmetricRelation, pointIds: ['left', 'left'] },
      { ...symmetricRelation, pointIds: ['axis-a', 'right'] }]) expect(() => parseCadSketchGraph({ ...raw, relations: [relation] })).toThrow();
    for (const pair of [['left', 'right'], ['axis-a', 'axis-b'], ['right', 'axis-a']]) {
      expect(() => parseCadSketchGraph({ ...raw, points: [...raw.points, { id: 'alias', position: [100, 200] }], relations: [symmetricRelation,
        { id: 'first', kind: 'coincident', pointIds: [pair[0], 'alias'] }, { id: 'second', kind: 'coincident', pointIds: ['alias', pair[1]] }] })).toThrow();
    }
  });
  it('checks the combined physical reflection residual and actual nondegenerate axis, preserving tuple and driver strings', () => {
    const raw = symmetrySketch(symmetryPart()).graph;
    const graph = parseCadSketchGraph({ ...raw, points: raw.points.map(point => point.id === 'right' ? { ...point, position: [55, 10] } : point), relations: [symmetricRelation] });
    expect(checkCadSketchGraph(graph, { leftX: 15 })).toEqual([]);
    for (const [delta, valid] of [[3e-11, true], [8e-11, false]] as const) {
      const candidate = parseCadSketchGraph({ ...graph, points: graph.points.map(point => point.id === 'right' ? { ...point, position: [55 + delta, 10 + delta] } : point) });
      expect(checkCadSketchGraph(candidate, { leftX: 15 }).some(issue => issue.source.id === 'symmetry')).toBe(!valid);
    }
    const collapsed = parseCadSketchGraph({ ...graph, points: graph.points.map(point => point.id === 'axis-b' ? { ...point, position: ['35.000', '0'] } : point) });
    expect(checkCadSketchGraph(collapsed, { leftX: 15 })).toContainEqual(expect.objectContaining({ source: { kind: 'relation', id: 'symmetry' }, code: 'relation-residual' }));
    expect(cadSketchRelationEntityIds(symmetricRelation)).toEqual(['axis']);
    expect(cadSketchRelationPointIds(graph, symmetricRelation)).toEqual(['left', 'right', 'axis-a', 'axis-b']);
    expect(mapCadSketchRelationScalars(symmetricRelation, () => { throw new Error('No scalar'); })).toBe(symmetricRelation);
  });
  it('protects actual axis/point deletion dependencies and rejects pattern-owned member operands', () => {
    const sketch = symmetrySketch(symmetryPart()), owned = { ...sketch, graph: parseCadSketchGraph({ ...sketch.graph, relations: [symmetricRelation] }) };
    expect(() => deleteCadSketchElements({ sketch: owned, pointIds: [], entityIds: ['axis'], relationIds: [], cascade: false })).toThrow();
    const removed = deleteCadSketchElements({ sketch: owned, pointIds: [], entityIds: ['axis'], relationIds: [], cascade: true });
    expect(removed.graph?.relations).toEqual([]); expect(removed.graph?.points).toEqual(owned.graph.points);
    const row = applyCadEdits(circleRowPart(), [{ kind: 'set-sketch-relation', sketchId: 'sketch', relation: circleRow }]), patterned = rowSketch(row);
    const raw = { ...patterned.graph, points: [...patterned.graph.points, { id: 'a', position: [0, 0] }, { id: 'b', position: [0, 50] }],
      entities: [...patterned.graph.entities, { id: 'axis', kind: 'line', construction: true, startPointId: 'a', endPointId: 'b' }], relations: [...patterned.graph.relations,
        { ...symmetricRelation, pointIds: ['center', 'holes_i1_p0'] }] };
    expect(() => parseCadSketchGraph(raw)).toThrow(/pattern/i);
  });
});
