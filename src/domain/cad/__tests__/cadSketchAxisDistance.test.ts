import { describe, expect, it } from 'vitest';
import { checkCadSketchGraph, parseCadSketchGraph } from '../cadSketchGraph';
import { cadSketchRelationEntityIds, cadSketchRelationPointIds, mapCadSketchRelationScalars } from '../cadSketchGraphReferences';
import { createCadDocument, parseCadDocument } from '../cadSchema';
import { applyCadEdits } from '../cadOperations';
import { inspectCadParameters } from '../cadParameters';

const parameters = { anchor: 10, dx: 30, dy: 20, radius: 2 };
const source = () => ({
  points: [{ id: 'corner', position: [' anchor ', ' 7 '] }, { id: 'center', position: [40, 27] }],
  entities: [{ id: 'bore', kind: 'circle', construction: false, centerPointId: 'center', radius: ' radius ' }],
  relations: [
    { id: 'right', kind: 'axis-distance', pointIds: ['corner', 'center'], axis: 'x', value: ' dx ' },
    { id: 'above', kind: 'axis-distance', pointIds: ['corner', 'center'], axis: 'y', value: ' dy ' }
  ]
});

describe('signed sketch axis distances', () => {
  it('owns ordered point references and exact scalars while accepting unsolved intent', () => {
    const raw = source(), graph = parseCadSketchGraph(raw), before = JSON.stringify(graph);
    raw.points[1].position[0] = 99; raw.relations[0].value = 'changed';
    expect(graph.points[1].position).toEqual([40, 27]);
    expect(graph.relations[0]).toEqual({ id: 'right', kind: 'axis-distance', pointIds: ['corner', 'center'], axis: 'x', value: ' dx ' });
    expect(Object.isFrozen(graph.relations[0])).toBe(true);
    expect(Object.isFrozen(cadSketchRelationPointIds(graph, graph.relations[0]))).toBe(true);
    expect(cadSketchRelationPointIds(graph, graph.relations[0])).toEqual(['corner', 'center']);
    expect(cadSketchRelationEntityIds(graph.relations[0])).toEqual([]);
    expect(mapCadSketchRelationScalars(graph.relations[0], (value, key) => {
      expect(key).toBe('value'); expect(value).toBe(' dx '); return ' dx + 5 ';
    })).toMatchObject({ value: ' dx + 5 ', pointIds: ['corner', 'center'] });
    expect(checkCadSketchGraph(graph, parameters)).toEqual([]);
    expect(checkCadSketchGraph(graph, { ...parameters, dx: 31 })).toMatchObject([
      { source: { kind: 'relation', id: 'right' }, code: 'relation-residual', residualMm: 1 }
    ]);
    expect(JSON.stringify(graph)).toBe(before);
  });

  it('checks signed coordinate differences independently of alignment, length and point order', () => {
    const graph = parseCadSketchGraph({ points: [{ id: 'a', position: [5, 7] }, { id: 'b', position: [-25, 27] }], entities: [], relations: [
      { id: 'left', kind: 'axis-distance', pointIds: ['a', 'b'], axis: 'x', value: -30 },
      { id: 'reverse', kind: 'axis-distance', pointIds: ['b', 'a'], axis: 'y', value: -20 }
    ] });
    expect(checkCadSketchGraph(graph, {})).toEqual([]);
    const wrong = parseCadSketchGraph({ ...graph, relations: [{ ...graph.relations[0], value: 30 }] });
    expect(checkCadSketchGraph(wrong, {})).toMatchObject([{ source: { id: 'left' }, residualMm: 60 }]);
    const zero = parseCadSketchGraph({ points: [{ id: 'a', position: [5, 7] }, { id: 'b', position: [5, 27] }], entities: [],
      relations: [{ id: 'zero', kind: 'axis-distance', pointIds: ['b', 'a'], axis: 'x', value: 0 }] });
    expect(checkCadSketchGraph(zero, {})).toEqual([]);
    expect(zero.points.map(point => point.id)).toEqual(['a', 'b']);
  });

  it('uses the existing physical driver gate for tiny and translated coordinates without repairing them', () => {
    for (const [origin, offset] of [[0, 1e-8], [1e6, 30]]) {
      const graph = parseCadSketchGraph({ points: [{ id: 'a', position: [origin, 4] }, { id: 'b', position: [origin + offset, 9] }],
        entities: [], relations: [{ id: 'offset', kind: 'axis-distance', pointIds: ['a', 'b'], axis: 'x', value: offset }] });
      const before = JSON.stringify(graph);
      expect(checkCadSketchGraph(graph, {})).toEqual([]);
      expect(checkCadSketchGraph(parseCadSketchGraph({ ...graph, relations: [{ ...graph.relations[0], value: offset + 1e-4 }] }), {}))
        .toMatchObject([{ source: { id: 'offset' }, code: 'relation-residual' }]);
      expect(JSON.stringify(graph)).toBe(before);
    }
  });

  it('rejects malformed operands and invalid evaluated drivers at their existing boundaries', () => {
    for (const change of [{ pointIds: ['corner', 'corner'] }, { pointIds: ['corner', 'missing'] }, { axis: 'z' }, { value: Infinity }]) {
      const graph = source();
      expect(() => parseCadSketchGraph({ ...graph, relations: [{ ...graph.relations[0], ...change }] })).toThrow();
    }
    const graph = parseCadSketchGraph(source());
    expect(checkCadSketchGraph(graph, { ...parameters, dx: Infinity })).toMatchObject([
      { source: { kind: 'relation', id: 'right' }, code: 'invalid-expression' }
    ]);
    expect(checkCadSketchGraph(graph, { anchor: 10, radius: 2 }).map(issue => issue.source.id)).toEqual(['right', 'above']);
  });

  it('retains real parameter dependencies and point deletion ownership through shared visitors', () => {
    const document = parseCadDocument({ ...createCadDocument('Bore', 'bore'), schemaVersion: 2, parameters, features: [{
      id: 'sketch', name: 'Sketch', kind: 'sketch', plane: 'XY', offset: 0, suppressed: false, profiles: [], graph: source()
    }] }), before = JSON.stringify(document);
    expect(inspectCadParameters(document).parameters.find(parameter => parameter.name === 'dx')?.usages)
      .toMatchObject([{ featureId: 'sketch', path: 'graph.relations.0.value', expression: ' dx ', active: true }]);
    const renamed = applyCadEdits(document, [{ kind: 'rename-parameter', name: 'dx', newName: 'boreX' }]), sketch = renamed.features[0];
    if (sketch.kind !== 'sketch' || !sketch.graph) throw new Error('Missing graph fixture.');
    expect(sketch.graph.relations[0]).toEqual({ id: 'right', kind: 'axis-distance', pointIds: ['corner', 'center'], axis: 'x', value: ' boreX ' });
    expect(sketch.graph.relations[1]).toEqual(source().relations[1]);
    expect(() => applyCadEdits(document, [{ kind: 'remove-parameter', name: 'dx' }])).toThrow();
    expect(() => applyCadEdits(document, [{ kind: 'delete-sketch-elements', sketchId: 'sketch', pointIds: ['corner'], entityIds: [], relationIds: [], cascade: false }]))
      .toThrow('depends');
    expect(JSON.stringify(document)).toBe(before);
  });
});
