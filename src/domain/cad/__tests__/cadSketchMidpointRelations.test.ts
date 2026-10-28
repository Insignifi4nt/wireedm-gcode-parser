import { describe, expect, it } from 'vitest';
import { checkCadSketchGraph, parseCadSketchGraph } from '../cadSketchGraph';
import { cadSketchRelationEntityIds, cadSketchRelationPointIds, mapCadSketchRelationScalars } from '../cadSketchGraphReferences';
import { splitCadSketchEntity, CadSketchSplitDependencyError } from '../cadSketchSplit';
import { prepareCadSketchTrim, prepareCadSketchExtend, CadSketchExtendDependencyError } from '../cadSketchTrimExtend';
import { deleteCadSketchElements } from '../cadSketchGraphEdits';
import type { CadSketchFeature } from '../cadDocument';

function source() {
  return { points: [{ id: 'a', position: [0, 0] }, { id: 'b', position: [10, 0] }, { id: 'm', position: [5, 0] }],
    entities: [{ id: 'line', kind: 'line', construction: true, startPointId: 'a', endPointId: 'b' }],
    relations: [{ id: 'mid', kind: 'midpoint', pointId: 'm', lineId: 'line' }] };
}
describe('persistent line midpoint intent', () => {
  it('validates exact point/line owners and rejects direct or transitive endpoint aliases without solving', () => {
    const raw = source(), graph = parseCadSketchGraph(raw);
    expect(graph.relations).toEqual(raw.relations);
    expect(() => parseCadSketchGraph({ ...raw, relations: [{ ...raw.relations[0], lineId: 'missing' }] })).toThrow();
    expect(() => parseCadSketchGraph({ ...raw, relations: [{ ...raw.relations[0], pointId: 'missing' }] })).toThrow();
    expect(() => parseCadSketchGraph({ ...raw, relations: [{ ...raw.relations[0], pointId: 'a' }] })).toThrow();
    expect(() => parseCadSketchGraph({ ...raw, entities: [{ id: 'line', kind: 'circle', construction: false, centerPointId: 'a', radius: 5 }] })).toThrow();
    const alias = { ...raw, points: [...raw.points, { id: 'alias', position: [7, 8] }], relations: [...raw.relations,
      { id: 'link-one', kind: 'coincident', pointIds: ['m', 'alias'] }, { id: 'link-two', kind: 'coincident', pointIds: ['alias', 'a'] }] };
    expect(() => parseCadSketchGraph(alias)).toThrow(/midpoint|endpoint/i);
    expect(() => parseCadSketchGraph({ ...raw, relations: [...raw.relations, { id: 'collapse', kind: 'coincident', pointIds: ['a', 'b'] }] })).toThrow();
    // Unsolved coordinates are legal source intent and are not snapped by parsing.
    const unsolved = parseCadSketchGraph({ ...raw, points: raw.points.map(point => point.id === 'm' ? { ...point, position: [99, 3] } : point) });
    expect(unsolved.points[2].position).toEqual([99, 3]);
    expect(Object.isFrozen(unsolved)).toBe(true);
  });

  it('checks both midpoint coordinates with current driver precision and visits all real operands without scalars', () => {
    const raw = source(), graph = parseCadSketchGraph(raw), relation = graph.relations[0];
    expect(checkCadSketchGraph(graph, {})).toEqual([]);
    expect(cadSketchRelationEntityIds(relation)).toEqual(['line']);
    expect(cadSketchRelationPointIds(graph, relation)).toEqual(['m', 'a', 'b']);
    expect(mapCadSketchRelationScalars(relation, () => { throw Error('Midpoint has no scalar'); })).toBe(relation);
    for (const position of [[6, 0], [5, 2]]) {
      const candidate = parseCadSketchGraph({ ...raw, points: raw.points.map(point => point.id === 'm' ? { ...point, position } : point) });
      expect(checkCadSketchGraph(candidate, {})).toContainEqual(expect.objectContaining({ source: { kind: 'relation', id: 'mid' }, code: 'relation-residual' }));
    }
    const reversed = parseCadSketchGraph({ ...raw, points: [
      { id: 'a', position: [' origin ', -4] }, { id: 'b', position: ['end', 8] }, { id: 'm', position: [3, 2] }
    ], entities: [{ ...raw.entities[0], startPointId: 'b', endPointId: 'a' }] });
    expect(checkCadSketchGraph(reversed, { origin: -3, end: 9 })).toEqual([]);
    expect(reversed.points[0].position[0]).toBe(' origin ');
  });

  it('blocks midpoint line Split and Extend, removes it only with a confirmed Trim, and keeps cascade deletion deliberate', () => {
    const raw = source(), graph = parseCadSketchGraph({ ...raw,
      points: [...raw.points, ...[2, 8, 15].flatMap(x => [{ id: `low${x}`, position: [x, -2] }, { id: `high${x}`, position: [x, 2] }])],
      entities: [...raw.entities, ...[2, 8, 15].map(x => ({ id: `cutter${x}`, kind: 'line', construction: true, startPointId: `low${x}`, endPointId: `high${x}` }))] });
    const before = JSON.stringify(graph);
    expect(() => splitCadSketchEntity({ graph, parameters: {}, split: { kind: 'line', entityId: 'line', parameter: .5,
      splitPointId: 'split', newEntityId: 'second', supportRelationId: 'direction' } })).toThrow(CadSketchSplitDependencyError);
    for (const parameter of [.1, .5]) expect(prepareCadSketchTrim({ graph, parameters: {}, entityId: 'line', parameter }).target.removedRelationIds).toEqual(['mid']);
    expect(() => prepareCadSketchExtend({ graph, parameters: {}, entityId: 'line', end: 'end' })).toThrow(CadSketchExtendDependencyError);
    const sketch: CadSketchFeature = { id: 's', kind: 'sketch', name: 'Midpoint', suppressed: false, plane: 'XY', offset: 0, profiles: [], graph };
    expect(() => deleteCadSketchElements({ sketch, entityIds: ['line'], pointIds: [], relationIds: [], cascade: false })).toThrow(/depend/i);
    const removed = deleteCadSketchElements({ sketch, entityIds: ['line'], pointIds: [], relationIds: [], cascade: true });
    expect(removed.graph?.relations).toEqual([]);
    expect(removed.graph?.points).toEqual(graph.points);
    const branch = parseCadSketchGraph({ ...raw, points: [...raw.points, { id: 'end', position: [5, 10] }, { id: 'cut-a', position: [3, 5] }, { id: 'cut-b', position: [7, 5] }],
      entities: [...raw.entities, { id: 'branch', kind: 'line', construction: false, startPointId: 'm', endPointId: 'end' },
        { id: 'cross', kind: 'line', construction: true, startPointId: 'cut-a', endPointId: 'cut-b' }] });
    // Trimming away the branch end on the midpoint leaves that point unused, so its midpoint intent leaves with it.
    expect(prepareCadSketchTrim({ graph: branch, parameters: {}, entityId: 'branch', parameter: .1 }).target.removedRelationIds).toEqual(['mid']);
    expect(JSON.stringify(graph)).toBe(before);
  });
});
