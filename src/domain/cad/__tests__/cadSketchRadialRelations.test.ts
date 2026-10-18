import { describe, expect, it } from 'vitest';
import { checkCadSketchGraph, parseCadSketchGraph } from '../cadSketchGraph';
import { cadSketchRelationEntityIds, cadSketchRelationPointIds, mapCadSketchRelationScalars } from '../cadSketchGraphReferences';
import { deleteCadSketchElements } from '../cadSketchGraphEdits';
import { createCadDocument, parseCadDocument } from '../cadSchema';
import { applyCadEdits } from '../cadOperations';
import { inspectCadParameters } from '../cadParameters';

const circle = () => ({ points: [{ id: 'center', position: [' 0 ', '0'] }],
  entities: [{ id: 'circle', kind: 'circle', construction: true, centerPointId: 'center', radius: 6 }],
  relations: [{ id: 'size', kind: 'radial-size', entityId: 'circle', quantity: 'diameter', value: ' hole ' }] });

describe('explicit graph radial-size intent', () => {
  it('owns the exact displayed diameter scalar and circle reference while allowing unsolved numeric intent', () => {
    const input = circle(), original = JSON.stringify(input), graph = parseCadSketchGraph(input), relation = graph.relations[0];
    expect(cadSketchRelationEntityIds(relation)).toEqual(['circle']); expect(cadSketchRelationPointIds(graph, relation)).toEqual(['center']);
    expect(checkCadSketchGraph(graph, { hole: 20 })).toMatchObject([{ source: { kind: 'relation', id: 'size' }, code: 'relation-residual', residualMm: 4 }]);
    expect(mapCadSketchRelationScalars(relation, (value, key) => { expect(key).toBe('value'); expect(value).toBe(' hole '); return ' bore '; })).toMatchObject({ value: ' bore ' });
    expect(JSON.stringify(input)).toBe(original);
    input.entities[0].radius = 99;
    expect(graph.entities[0]).toMatchObject({ radius: 6 }); expect(relation).toMatchObject({ quantity: 'diameter', value: ' hole ' });
    expect(Object.isFrozen(relation)).toBe(true);
  });

  it('checks both actual arc endpoint radii without changing a major direction or its source', () => {
    const graph = parseCadSketchGraph({ points: [{ id: 'center', position: [0, 0] }, { id: 'start', position: [10, 0] }, { id: 'end', position: [0, 11] }],
      entities: [{ id: 'arc', kind: 'arc', construction: true, centerPointId: 'center', startPointId: 'start', endPointId: 'end', direction: 'cw' }],
      relations: [{ id: 'size', kind: 'radial-size', entityId: 'arc', quantity: 'radius', value: ' target ' }] }), before = JSON.stringify(graph);
    expect(checkCadSketchGraph(graph, { target: 10 })).toMatchObject([
      { source: { kind: 'entity', id: 'arc' }, code: 'arc-radius-mismatch', residualMm: 1 },
      { source: { kind: 'relation', id: 'size' }, code: 'relation-residual', residualMm: 1 }
    ]);
    expect(cadSketchRelationPointIds(graph, graph.relations[0])).toEqual(['center', 'start', 'end']);
    expect(JSON.stringify(graph)).toBe(before);
  });

  it('rejects missing or line targets and checks physical radius bounds for both displayed quantities', () => {
    for (const entityId of ['missing', 'center', 'line']) expect(() => parseCadSketchGraph({ ...circle(), entities: [...circle().entities,
      { id: 'line', kind: 'line', construction: false, startPointId: 'center', endPointId: 'other' }],
      points: [...circle().points, { id: 'other', position: [3, 4] }], relations: [{ ...circle().relations[0], entityId }] })).toThrow();
    for (const quantity of ['radius', 'diameter']) {
      const scale = quantity === 'diameter' ? 2 : 1;
      for (const radius of [-1, 0, 1e-7, 1e6 + 1]) {
        const graph = parseCadSketchGraph({ ...circle(), relations: [{ ...circle().relations[0], quantity, value: radius * scale }] });
        expect(checkCadSketchGraph(graph, {}).find(issue => issue.source.id === 'size')).toMatchObject({ code: 'invalid-radius' });
      }
      const edge = parseCadSketchGraph({ ...circle(), entities: [{ ...circle().entities[0], radius: 1e6 }],
        relations: [{ ...circle().relations[0], quantity, value: 1e6 * scale }] });
      expect(checkCadSketchGraph(edge, {})).toEqual([]);
    }
  });

  it('keeps scalar radius precision independent of a distant circle center', () => {
    const graph = parseCadSketchGraph({ ...circle(), points: [{ id: 'center', position: [9e8, 9e8] }],
      entities: [{ ...circle().entities[0], radius: 10 + 1e-8 }], relations: [{ ...circle().relations[0], value: 20 }] });
    expect(checkCadSketchGraph(graph, {})).toMatchObject([{ source: { id: 'size' }, code: 'relation-residual' }]);
  });

  it('rejects a second radial driver on an exact circle-radius expression for either target without rewriting source', () => {
    for (const radius of [' existing ', ' 6 ']) for (const value of [6, 10]) {
      const input = { ...circle(), entities: [{ ...circle().entities[0], radius }],
        relations: [{ ...circle().relations[0], quantity: 'radius', value }] }, before = JSON.stringify(input);
      let failure: unknown;
      try { parseCadSketchGraph(input); } catch (error) { failure = error; }
      expect(failure).toMatchObject({ code: 'already-driven-sketch-radius' });
      expect(JSON.stringify(input)).toBe(before);
    }
  });

  it('uses shared parameter and deletion ownership while retaining the untouched driver source', () => {
    const document = parseCadDocument({ ...createCadDocument('Circle', 'part'), schemaVersion: 2, parameters: { hole: 20 }, features: [{
      id: 'sketch', kind: 'sketch', name: 'Circle', suppressed: false, plane: 'XY', offset: 0, profiles: [],
      graph: { ...circle(), entities: [{ ...circle().entities[0], radius: 10 }] }
    }] }), sketch = document.features[0], before = JSON.stringify(document);
    if (sketch.kind !== 'sketch') throw new Error('Missing sketch fixture.');
    expect(inspectCadParameters(document).parameters[0].usages).toContainEqual(expect.objectContaining({ featureId: 'sketch', path: 'graph.relations.0.value' }));
    expect(() => applyCadEdits(document, [{ kind: 'remove-parameter', name: 'hole' }])).toThrow();
    const renamed = applyCadEdits(document, [{ kind: 'rename-parameter', name: 'hole', newName: 'bore' }]);
    expect(renamed.features[0]).toMatchObject({ graph: { relations: [{ id: 'size', quantity: 'diameter', value: ' bore ' }] } });
    expect(() => deleteCadSketchElements({ sketch, pointIds: [], entityIds: ['circle'], relationIds: [], cascade: false })).toThrow('depend');
    expect(deleteCadSketchElements({ sketch, pointIds: [], entityIds: ['circle'], relationIds: [], cascade: true }).graph?.relations).toEqual([]);
    expect(JSON.stringify(document)).toBe(before);
  });
});
