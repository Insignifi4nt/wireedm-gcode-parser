import { describe, expect, it } from 'vitest';
import { prepareCadSketchTrim, trimCadSketchEntity } from '../cadSketchTrimExtend';
import { compileCadSketchGraph } from '../cadSketchGraphGeometry';
import { cadAnalyticSegments } from '../cadAnalyticSegments';
import { signedAreaOfPath } from '@/domain/path-intel/segments';
import { middleArcTrimPart } from './cadSketchMiddleArcTrimFixtures';
import { parseCadSketchGraph } from '../cadSketchGraph';

describe('exact middle-arc Trim', () => {
  it('removes only the D plate bottom span, retaining two exact quarter arcs on a visible ordinary equal-radius support', () => {
    const document = middleArcTrimPart(), sketch = document.features[0];
    if (sketch.kind !== 'sketch' || !sketch.graph) throw new Error('Expected original D sketch.');
    const graph = sketch.graph, arc = graph.entities.find(entity => entity.kind === 'arc'), before = JSON.stringify(document);
    if (!arc || arc.kind !== 'arc') throw new Error('Expected original major arc.');
    const preview = prepareCadSketchTrim({ graph, parameters: document.parameters, entityId: arc.id, parameter: .5 });
    if (!('survivors' in preview)) throw new Error('Expected two arc survivors.');
    expect(preview.target).toMatchObject({ kind: 'middle', boundaries: [{ position: [-6, -8] }, { position: [6, -8] }] });
    expect(preview.survivors).toMatchObject([{ kind: 'arc', radius: 10, sweepRadians: Math.PI / 2 }, { kind: 'arc', radius: 10, sweepRadians: Math.PI / 2 }]);
    const left = preview.target.boundaries[0].endpointPointId, right = preview.target.boundaries[1].endpointPointId;
    if (!left || !right) throw new Error('Expected real shared cutter endpoints.');
    const result = trimCadSketchEntity({ graph, parameters: document.parameters, trim: { ...preview.target, cutPointIds: [left, right], newEntityId: 'after', supportRelationId: 'common-radius' } });
    expect(result.graph.entities.filter(entity => entity.kind === 'arc')).toEqual([{ ...arc, endPointId: left }, { ...arc, id: 'after', startPointId: right }]);
    expect(result.graph.points).toEqual(graph.points);
    expect(result.graph.relations).toEqual([...graph.relations, { id: 'common-radius', kind: 'equal-radius', curveIds: [arc.id, 'after'] }]);
    const compiled = compileCadSketchGraph(result.graph, document.parameters), cycle = compiled.cycles.find(cycle => !cycle.construction);
    if (!cycle) throw new Error('Expected one exact clipped plate.');
    const path = cadAnalyticSegments(cycle.path);
    expect(Math.abs(signedAreaOfPath(path.refs, path.byId))).toBeCloseTo(50 * Math.PI + 96, 11);
    expect(JSON.stringify(document)).toBe(before);
    expect(Object.isFrozen(preview.survivors[1].end)).toBe(true);
  });

  it('preserves CW source traversal, construction and old-start identity under reversed endpoints and reordered records', () => {
    const document = middleArcTrimPart(), sketch = document.features[0];
    if (sketch.kind !== 'sketch' || !sketch.graph) throw new Error('Expected D sketch.');
    const graph = parseCadSketchGraph({ ...sketch.graph, points: [...sketch.graph.points].reverse(), entities: sketch.graph.entities.map(entity => entity.kind === 'arc'
      ? { ...entity, startPointId: entity.endPointId, endPointId: entity.startPointId, direction: 'cw', construction: true } : entity).reverse() });
    const preview = prepareCadSketchTrim({ graph, parameters: document.parameters, entityId: 'arc', parameter: .5 });
    if (!('survivors' in preview)) throw new Error('Expected middle CW arcs.');
    expect(preview.target.boundaries.map(boundary => boundary.endpointPointId)).toEqual(['q', 'p']);
    const pieces = [preview.survivors[0], preview.removed, preview.survivors[1]];
    const sweeps = pieces.map(piece => { if (piece.kind !== 'arc') throw new Error('Expected same-kind arcs.'); return piece.sweepRadians; });
    expect(sweeps[0]).toBeCloseTo(-Math.PI / 2, 14); expect(sweeps[1]).toBeCloseTo(-2 * Math.asin(.6), 14); expect(sweeps[2]).toBeCloseTo(-Math.PI / 2, 14);
    const result = trimCadSketchEntity({ graph, parameters: document.parameters, trim: { ...preview.target, cutPointIds: ['q', 'p'], newEntityId: 'after', supportRelationId: 'common-radius' } });
    expect(result.graph.entities.filter(entity => entity.kind === 'arc')).toEqual([
      { id: 'arc', kind: 'arc', centerPointId: 'center', startPointId: 'b', endPointId: 'q', direction: 'cw', construction: true },
      { id: 'after', kind: 'arc', centerPointId: 'center', startPointId: 'p', endPointId: 'a', direction: 'cw', construction: true }]);
    expect(result.graph.points).toEqual(graph.points);
    expect(result.graph.relations).toEqual([{ id: 'common-radius', kind: 'equal-radius', curveIds: ['arc', 'after'] }]);
  });

  it('keeps true major and half-turn pieces but rejects non-diametric contacts rounded onto the half-turn boundary', () => {
    const source = (first: readonly [number, number]) => parseCadSketchGraph({ points: [
      { id: 'c', position: [0, 0] }, { id: 'a', position: [10, 0] }, { id: 'b', position: [6, -8] },
      { id: 'p', position: first }, { id: 'q', position: [0, -10] },
      { id: 'in-p', position: [first[0] / 2, first[1] / 2] }, { id: 'in-q', position: [0, -5] }], entities: [
      { id: 'arc', kind: 'arc', centerPointId: 'c', startPointId: 'a', endPointId: 'b', direction: 'ccw', construction: true },
      { id: 'left', kind: 'line', startPointId: 'p', endPointId: 'in-p', construction: true },
      { id: 'right', kind: 'line', startPointId: 'q', endPointId: 'in-q', construction: true }], relations: [] });
    for (const first of [[-10, 0], [-8, -6]] as const) {
      const graph = source(first), preview = prepareCadSketchTrim({ graph, parameters: {}, entityId: 'arc', parameter: .8 });
      if (!('survivors' in preview) || preview.survivors[0].kind !== 'arc' || preview.survivors[1].kind !== 'arc' || preview.removed.kind !== 'arc')
        throw new Error('Expected three signed arc pieces.');
      expect(preview.survivors[0].sweepRadians).toBeCloseTo(first[1] === 0 ? Math.PI : Math.PI + Math.asin(.6), 14);
      const result = trimCadSketchEntity({ graph, parameters: {}, trim: { ...preview.target, cutPointIds: ['p', 'q'], newEntityId: 'after', supportRelationId: 'same' } });
      const actual = compileCadSketchGraph(result.graph, {}).segments.find(segment => segment.id === 'arc');
      expect(actual).toMatchObject({ kind: 'arc', radius: 10, sweepRadians: preview.survivors[0].sweepRadians });
    }
    for (const y of [1e-15, -1e-15]) expect(() => prepareCadSketchTrim({ graph: source([-10, y]), parameters: {}, entityId: 'arc', parameter: .8 }))
      .toThrowError(expect.objectContaining({ code: 'sketch-trim-precision' }));
  });

  it('retains center, original outer-point and radius drivers while keeping whole-edge deletion strict', () => {
    const document = middleArcTrimPart(true), sketch = document.features[0];
    if (sketch.kind !== 'sketch' || !sketch.graph) throw new Error('Expected fixed D source.');
    const retained = parseCadSketchGraph({ ...sketch.graph, relations: [
      { id: 'center-driver', kind: 'fixed-point', pointId: 'center', position: ['0.000', ' 0 '] },
      { id: 'outer-x', kind: 'fixed-axis', pointId: 'a', axis: 'x', value: ' -8 ' },
      { id: 'old-chord', kind: 'distance', pointIds: ['a', 'b'], value: ' 16 ' }] });
    const preview = prepareCadSketchTrim({ graph: retained, parameters: document.parameters, entityId: 'arc', parameter: .5 });
    if (!('survivors' in preview)) throw new Error('Expected middle arc with untouched outer drivers.');
    const result = trimCadSketchEntity({ graph: retained, parameters: document.parameters, trim: { ...preview.target, cutPointIds: ['p', 'q'], newEntityId: 'after', supportRelationId: 'same' } });
    expect(result.graph.points).toEqual(retained.points); expect(result.graph.relations.slice(0, retained.relations.length)).toEqual(retained.relations);
    const owned = parseCadSketchGraph({ ...retained, relations: [...retained.relations, { id: 'radius', kind: 'radial-size', entityId: 'arc', quantity: 'radius', value: ' 10 ' }] });
    const ownedPreview = prepareCadSketchTrim({ graph: owned, parameters: document.parameters, entityId: 'arc', parameter: .5 });
    if (ownedPreview.target.kind !== 'middle') throw new Error('Expected retained radius on the middle arc source.');
    const ownedResult = trimCadSketchEntity({ graph: owned, parameters: document.parameters, trim: { ...ownedPreview.target,
      cutPointIds: ['p', 'q'], newEntityId: 'after', supportRelationId: 'same' } });
    expect(ownedResult.graph.relations.slice(0, owned.relations.length)).toEqual(owned.relations);
    expect(() => prepareCadSketchTrim({ graph: result.graph, parameters: document.parameters, entityId: 'arc', parameter: .5 }))
      .toThrowError(expect.objectContaining({ code: 'dependent-sketch-trim', relationIds: expect.arrayContaining(['same']) }));
  });

  it('rejects changed receipts, forged cut identities and namespace collisions instead of retargeting or reusing nearby points', () => {
    const document = middleArcTrimPart(), sketch = document.features[0];
    if (sketch.kind !== 'sketch' || !sketch.graph) throw new Error('Expected D source.');
    const graph = sketch.graph, preview = prepareCadSketchTrim({ graph, parameters: document.parameters, entityId: 'arc', parameter: .5 });
    if (preview.target.kind !== 'middle') throw new Error('Expected middle target.');
    const request = { ...preview.target, cutPointIds: ['p', 'q'] as const, newEntityId: 'after', supportRelationId: 'same' };
    expect(() => trimCadSketchEntity({ graph, parameters: document.parameters, trim: { ...request, cutPointIds: ['new-p', 'q'] } }))
      .toThrowError(expect.objectContaining({ code: 'invalid-sketch-trim-point' }));
    for (const patch of [{ newEntityId: 'top' }, { supportRelationId: 'arc' }])
      expect(() => trimCadSketchEntity({ graph, parameters: document.parameters, trim: { ...request, ...patch } }))
        .toThrowError(expect.objectContaining({ code: 'duplicate-sketch-id' }));
    const changed = parseCadSketchGraph({ ...graph, points: graph.points.map(point => point.id === 'p' ? { ...point, position: [-6, -9] } : point) });
    expect(() => trimCadSketchEntity({ graph: changed, parameters: document.parameters, trim: request }))
      .toThrowError(expect.objectContaining({ code: 'stale-sketch-trim' }));
    const interior = parseCadSketchGraph({ ...graph, entities: graph.entities.filter(entity => !['bottom', 'left-guide', 'right-guide'].includes(entity.id)).concat([
      { id: 'left', kind: 'line', construction: true, startPointId: 'lp0', endPointId: 'lp1' },
      { id: 'right', kind: 'line', construction: true, startPointId: 'rq0', endPointId: 'rq1' }]),
      points: [...graph.points, { id: 'lp0', position: [-6, -12] }, { id: 'lp1', position: [-6, -4] }, { id: 'rq0', position: [6, -12] }, { id: 'rq1', position: [6, -4] }] });
    const cut = prepareCadSketchTrim({ graph: interior, parameters: document.parameters, entityId: 'arc', parameter: .5 });
    if (cut.target.kind !== 'middle') throw new Error('Expected numeric interior contacts.');
    const target = cut.target;
    for (const cutPointIds of [['center', 'fresh'], ['a', 'fresh'], ['same-cut', 'same-cut']] as const)
      expect(() => trimCadSketchEntity({ graph: interior, parameters: document.parameters, trim: { ...target, cutPointIds, newEntityId: 'after', supportRelationId: 'same' } }))
        .toThrowError(expect.objectContaining({ code: 'invalid-sketch-trim-point' }));
    const detached = trimCadSketchEntity({ graph: interior, parameters: document.parameters, trim: { ...target, cutPointIds: ['left-cut', 'right-cut'], newEntityId: 'after', supportRelationId: 'same' } });
    expect(detached.graph.points.slice(0, interior.points.length)).toEqual(interior.points);
    expect(detached.graph.points.slice(-2)).toEqual([{ id: 'left-cut', position: target.boundaries[0].position }, { id: 'right-cut', position: target.boundaries[1].position }]);
    expect(detached.graph.relations).toEqual([{ id: 'same', kind: 'equal-radius', curveIds: ['arc', 'after'] }]);
  });
});
