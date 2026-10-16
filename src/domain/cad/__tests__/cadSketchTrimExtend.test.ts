import { describe, expect, it } from 'vitest';
import { parseCadSketchGraph } from '../cadSketchGraph';
import { compileCadSketchGraph } from '../cadSketchGraphGeometry';
import { CadSketchTrimDependencyError, prepareCadSketchTrim, trimCadSketchEntity } from '../cadSketchTrimExtend';
import { cadAnalyticSegments } from '../cadAnalyticSegments';
import { signedAreaOfPath } from '@/domain/path-intel/segments';
import { createCadDocument, parseCadDocument } from '../cadSchema';
import { createCadFreshSketchGraph } from '../cadFreshSketchGraph';

function fences() {
  return parseCadSketchGraph({ points: [{ id: 'a', position: [0, 0] }, { id: 'b', position: [20, 0] },
    { id: 'c', position: [5, -5] }, { id: 'd', position: [5, 5] }, { id: 'e', position: [15, -5] }, { id: 'f', position: [15, 5] }],
  entities: [{ id: 'edge', kind: 'line', startPointId: 'a', endPointId: 'b', construction: false },
    { id: 'left', kind: 'line', startPointId: 'c', endPointId: 'd', construction: true },
    { id: 'right', kind: 'line', startPointId: 'e', endPointId: 'f', construction: true }], relations: [] });
}

describe('exact sketch end Trim', () => {
  it.each([false, true])('transfers only the fresh rectangle line’s unordered H/V pair, keeping old adjacent direction and reversed=%s source intent', reversed => {
    let id = 0;
    const rectangle = createCadFreshSketchGraph({ geometry: { kind: 'rectangle', x: 0, y: 0, width: 20, height: 10, cornerRadius: 0 },
      construction: false, createId: () => `rect_${++id}` });
    const graph = parseCadSketchGraph({ ...rectangle, points: [...rectangle.points, { id: 'fence-a', position: [' cutX ', '0'] },
      { id: 'fence-b', position: [5, 5] }], entities: [...rectangle.entities.map(entity => reversed && entity.id === 'rect_5' && entity.kind === 'line'
      ? { ...entity, startPointId: 'rect_2', endPointId: 'rect_1' } : entity),
      { id: 'fence', kind: 'line', construction: true, startPointId: 'fence-a', endPointId: 'fence-b' }],
      relations: rectangle.relations.map(relation => relation.id === 'rect_9' ? { ...relation, pointIds: ['rect_2', 'rect_1'] } : relation) });
    const parameters = { cutX: 5 }, before = JSON.stringify(graph);
    const preview = prepareCadSketchTrim({ graph, parameters, entityId: 'rect_5', parameter: reversed ? 0.9 : 0.1 });
    if (preview.target.kind !== 'end') throw new Error('Expected surviving line.');
    expect(preview.target.boundary.endpointPointId).toBe('fence-a');
    const result = trimCadSketchEntity({ graph, parameters, trim: { ...preview.target, cutPointId: 'fence-a' } });
    expect(result.graph.relations).toEqual([{ id: 'rect_9', kind: 'horizontal', pointIds: ['rect_2', 'fence-a'] }, ...graph.relations.slice(1)]);
    expect(result.graph.points).toEqual(graph.points);
    expect(result.graph.entities[0]).toEqual({ ...graph.entities[0], [reversed ? 'endPointId' : 'startPointId']: 'fence-a' });
    expect(result.graph.entities.slice(1)).toEqual(graph.entities.slice(1));
    expect(JSON.stringify(graph)).toBe(before);
  });

  it('keeps ambiguous shared endpoint-pair ownership, arc direction pairs and no-hit line deletion blocked', () => {
    const original = fences(), horizontal = { id: 'direction', kind: 'horizontal' as const, pointIds: ['b', 'a'] as const };
    const shared = parseCadSketchGraph({ ...original, points: [...original.points, { id: 'center', position: [10, 0] }],
      entities: [...original.entities, { id: 'other-arc', kind: 'arc', construction: false, centerPointId: 'center', startPointId: 'a', endPointId: 'b', direction: 'ccw' }],
      relations: [horizontal] });
    expect(() => prepareCadSketchTrim({ graph: shared, parameters: {}, entityId: 'edge', parameter: 0.1 }))
      .toThrowError(expect.objectContaining({ code: 'dependent-sketch-trim', relationIds: ['direction'] }));
    const deleted = parseCadSketchGraph({ ...original, entities: [original.entities[0]], relations: [horizontal] });
    expect(() => prepareCadSketchTrim({ graph: deleted, parameters: {}, entityId: 'edge', parameter: 0.1 }))
      .toThrowError(expect.objectContaining({ code: 'dependent-sketch-trim', relationIds: ['direction'] }));
    const arc = parseCadSketchGraph({ points: [{ id: 'o', position: [0, 0] }, { id: 'a', position: [10, 0] }, { id: 'b', position: [-10, 0] },
      { id: 'c', position: [5, -20] }, { id: 'd', position: [5, 20] }], entities: [
      { id: 'arc', kind: 'arc', construction: false, centerPointId: 'o', startPointId: 'a', endPointId: 'b', direction: 'ccw' },
      { id: 'fence', kind: 'line', construction: true, startPointId: 'c', endPointId: 'd' }], relations: [horizontal,
      { id: 'radius', kind: 'radial-size', entityId: 'arc', quantity: 'radius', value: ' 10 ' }] });
    expect(() => prepareCadSketchTrim({ graph: arc, parameters: {}, entityId: 'arc', parameter: 0.1 }))
      .toThrowError(expect.objectContaining({ code: 'dependent-sketch-trim', relationIds: ['direction'], pointIds: ['a'] }));
  });

  it('rejects an out-of-range cut on a legal arc bulge rather than exposing a malformed ready witness', () => {
    const document = parseCadDocument({ ...createCadDocument('Arc range', 'arc-range'), schemaVersion: 2, features: [{
      id: 'sketch', name: 'Sketch', kind: 'sketch', plane: 'XY', offset: 0, suppressed: false, profiles: [], graph: {
        points: [{ id: 'o', position: [999999999, 0] }, { id: 'a', position: [999999999, 20] },
          { id: 'b', position: [999999999, -20] }, { id: 'c', position: [999999989, 0] }],
        entities: [{ id: 'arc', kind: 'arc', construction: false, centerPointId: 'o', startPointId: 'a', endPointId: 'b', direction: 'cw' },
          { id: 'circle', kind: 'circle', construction: true, centerPointId: 'c', radius: 25 }], relations: []
      }
    }] });
    const sketch = document.features[0]; if (sketch.kind !== 'sketch' || !sketch.graph) throw new Error('Expected accepted graph.');
    const graph = sketch.graph, before = JSON.stringify(document);
    expect(() => prepareCadSketchTrim({ graph, parameters: {}, entityId: 'arc', parameter: 0.01 }))
      .toThrowError(expect.objectContaining({ code: 'sketch-trim-precision' }));
    expect(JSON.stringify(document)).toBe(before);
  });

  it('removes only the clicked outer span at its nearest finite intersection, retaining source and cutter identities', () => {
    const graph = fences(), before = JSON.stringify(graph);
    const preview = prepareCadSketchTrim({ graph, parameters: {}, entityId: 'edge', parameter: 0.1 });
    if ('cuts' in preview) throw new Error('Expected one end survivor.');
    expect(preview.target).toEqual({ kind: 'end', entityId: 'edge', parameter: 0.1, end: 'start',
      boundary: { entityId: 'left', index: 0, parameter: 0.25, position: [5, 0] } });
    expect(preview.removed).toMatchObject({ kind: 'line', start: { x: 0, y: 0 }, end: { x: 5, y: 0 } });
    expect(preview.survivor).toMatchObject({ kind: 'line', start: { x: 5, y: 0 }, end: { x: 20, y: 0 } });
    expect(preview.boundary?.id).toBe('left'); expect(preview.point).toEqual([5, 0]);
    if (preview.target.kind !== 'end') throw new Error('Expected one retained end.');
    const result = trimCadSketchEntity({ graph, parameters: {}, trim: { ...preview.target, cutPointId: 'cut' } });
    expect(result).toMatchObject({ retainedEntityId: 'edge', removedEntityId: null, cutPointId: 'cut' });
    expect(result.graph.entities).toEqual([{ ...graph.entities[0], startPointId: 'cut' }, ...graph.entities.slice(1)]);
    expect(result.graph.points).toEqual([...graph.points, { id: 'cut', position: [5, 0] }]);
    expect(result.graph.relations).toEqual([]);
    expect(compileCadSketchGraph(result.graph, {}).segments.find(segment => segment.id === 'edge')?.length).toBe(15);
    expect(JSON.stringify(graph)).toBe(before); expect(Object.isFrozen(preview.removed.start)).toBe(true);
    expect(Object.isFrozen(result.graph.points.at(-1)?.position)).toBe(true);
  });

  it('reuses only the analytically witnessed boundary endpoint, preserving its exact expression and leaving unrelated colocated points alone', () => {
    const original = fences(), graph = parseCadSketchGraph({ ...original, points: original.points.map(point => point.id === 'c'
      ? { ...point, position: [' cutX ', ' 0 '] } : point.id === 'd' ? { ...point, position: [5, 10] } : point),
    entities: original.entities.filter(entity => entity.id !== 'right') });
    const preview = prepareCadSketchTrim({ graph, parameters: { cutX: 5 }, entityId: 'edge', parameter: 0.1 });
    if (preview.target.kind !== 'end') throw new Error('Expected end trim.');
    const target = preview.target;
    expect(target.boundary.endpointPointId).toBe('c');
    const result = trimCadSketchEntity({ graph, parameters: { cutX: 5 }, trim: { ...target, cutPointId: 'c' } });
    expect(result.graph.points).toEqual(graph.points); expect(result.graph.relations).toEqual([]);
    expect(result.graph.entities[0]).toMatchObject({ id: 'edge', startPointId: 'c', endPointId: 'b' });
    expect(() => trimCadSketchEntity({ graph, parameters: { cutX: 5 }, trim: { ...target, cutPointId: 'new' } }))
      .toThrowError(expect.objectContaining({ code: 'invalid-sketch-trim-point' }));
  });

  it('closes a real 100-square-millimetre contour only by reusing its explicit boundary endpoint', () => {
    const graph = parseCadSketchGraph({ points: [{ id: 'a', position: [-5, 0] }, { id: 'b', position: [10, 0] },
      { id: 'c', position: [10, 10] }, { id: 'd', position: [0, 10] }, { id: 'e', position: [0, 0] }], entities: [
      { id: 'bottom', kind: 'line', startPointId: 'a', endPointId: 'b', construction: false },
      { id: 'right', kind: 'line', startPointId: 'b', endPointId: 'c', construction: false },
      { id: 'top', kind: 'line', startPointId: 'c', endPointId: 'd', construction: false },
      { id: 'left', kind: 'line', startPointId: 'd', endPointId: 'e', construction: false }], relations: [] });
    expect(compileCadSketchGraph(graph, {}).cycles).toEqual([]);
    const preview = prepareCadSketchTrim({ graph, parameters: {}, entityId: 'bottom', parameter: 0.1 });
    if (preview.target.kind !== 'end') throw new Error('Expected end trim.');
    const result = trimCadSketchEntity({ graph, parameters: {}, trim: { ...preview.target, cutPointId: 'e' } });
    const compiled = compileCadSketchGraph(result.graph, {});
    expect(compiled.cycles).toHaveLength(1); expect(compiled.arrangementEntityIds).toEqual([]);
    const path = cadAnalyticSegments(compiled.cycles[0].path);
    expect(Math.abs(signedAreaOfPath(path.refs, path.byId))).toBe(100);
    expect(result.graph.points).toEqual(graph.points); expect(result.graph.relations).toEqual([]);
  });

  it.each([false, true])('keeps the physical nearest side and witness stable under reordered source and reversed direction=%s', reversed => {
    const original = fences(), graph = parseCadSketchGraph({ ...original, points: [...original.points].reverse(), entities: original.entities.map(entity =>
      reversed && entity.id === 'edge' && entity.kind === 'line' ? { ...entity, startPointId: 'b', endPointId: 'a' } : entity).reverse() });
    const preview = prepareCadSketchTrim({ graph, parameters: {}, entityId: 'edge', parameter: reversed ? 0.9 : 0.1 });
    if (preview.target.kind !== 'end') throw new Error('Expected end trim.');
    expect(preview.target).toMatchObject({ end: reversed ? 'end' : 'start', boundary: { entityId: 'left', position: [5, 0] } });
    const result = trimCadSketchEntity({ graph, parameters: {}, trim: { ...preview.target, cutPointId: 'm' } });
    expect(result.graph.entities.find(entity => entity.id === 'edge')).toMatchObject({ startPointId: reversed ? 'b' : 'm', endPointId: reversed ? 'm' : 'b' });
    expect(result.graph.points.slice(0, graph.points.length)).toEqual(graph.points);
  });

  it.each(['cw', 'ccw'] as const)('keeps exact %s arc support and expected remaining sweep rather than its complementary branch', direction => {
    const major = direction === 'cw';
    const graph = parseCadSketchGraph({ points: [{ id: 'o', position: [' cx ', ' cy '] }, { id: 'a', position: [10, 0] },
      { id: 'b', position: [0, ' ten '] }, { id: 'c', position: major ? [0, -20] : [-20, -20] },
      { id: 'd', position: major ? [0, -5] : [20, 20] }], entities: [
      { id: 'arc', kind: 'arc', construction: false, centerPointId: 'o', startPointId: 'a', endPointId: 'b', direction },
      { id: 'fence', kind: 'line', construction: true, startPointId: 'c', endPointId: 'd' }], relations: [] });
    const parameters = { cx: 0, cy: 0, ten: 10 }, before = JSON.stringify(graph);
    const preview = prepareCadSketchTrim({ graph, parameters, entityId: 'arc', parameter: 0.1 });
    if (preview.target.kind !== 'end') throw new Error('Expected end trim.');
    const result = trimCadSketchEntity({ graph, parameters, trim: { ...preview.target, cutPointId: 'm' } });
    expect(result.graph.points.slice(0, 5)).toEqual(graph.points); expect(result.graph.relations).toEqual([]);
    expect(result.graph.entities[0]).toEqual({ ...graph.entities[0], startPointId: 'm' });
    const segment = compileCadSketchGraph(result.graph, parameters).segments.find(segment => segment.id === 'arc');
    if (segment?.kind !== 'arc' || preview.removed.kind !== 'arc') throw new Error('Expected analytic arcs.');
    expect(segment.radius).toBeCloseTo(10, 12); expect(segment.sweepRadians).toBeCloseTo(major ? -Math.PI : Math.PI / 4, 13);
    expect(segment.sweepRadians + preview.removed.sweepRadians).toBeCloseTo(major ? -1.5 * Math.PI : Math.PI / 2, 13);
    expect(JSON.stringify(graph)).toBe(before);
  });

  it('uses both finite circle intersections for a middle line span while retaining a source-circle radius expression', () => {
    const graph = parseCadSketchGraph({ points: [{ id: 'a', position: [-20, 0] }, { id: 'b', position: [20, 0] }, { id: 'o', position: [0, 0] }],
      entities: [{ id: 'edge', kind: 'line', construction: true, startPointId: 'a', endPointId: 'b' },
        { id: 'ring', kind: 'circle', construction: false, centerPointId: 'o', radius: ' 10 ' }], relations: [] });
    const preview = prepareCadSketchTrim({ graph, parameters: {}, entityId: 'edge', parameter: 0.1 });
    expect(preview).toMatchObject({ point: [-10, 0] });
    expect(prepareCadSketchTrim({ graph, parameters: {}, entityId: 'edge', parameter: 0.5 }))
      .toMatchObject({ target: { kind: 'middle', boundaries: [{ entityId: 'ring', index: 0 }, { entityId: 'ring', index: 1 }] },
        survivors: [{ length: 10 }, { length: 10 }], removed: { length: 20 } });
    expect(() => prepareCadSketchTrim({ graph, parameters: {}, entityId: 'ring', parameter: 0.1 }))
      .toThrowError(expect.objectContaining({ code: 'driven-sketch-trim-radius' }));
  });

  it('previews whole-edge deletion only when no finite interior intersection exists, preserving points and cutters', () => {
    const graph = parseCadSketchGraph({ points: [{ id: 'a', position: [0, -20] }, { id: 'b', position: [0, -5] },
      { id: 'o', position: [0, 0] }, { id: 'c', position: [10, 0] }, { id: 'd', position: [0, 10] }], entities: [
      { id: 'edge', kind: 'line', construction: false, startPointId: 'a', endPointId: 'b' },
      { id: 'arc', kind: 'arc', construction: false, centerPointId: 'o', startPointId: 'c', endPointId: 'd', direction: 'ccw' }], relations: [] });
    const before = JSON.stringify(graph), preview = prepareCadSketchTrim({ graph, parameters: {}, entityId: 'edge', parameter: 0.5 });
    expect(preview.target).toEqual({ kind: 'delete', entityId: 'edge', parameter: 0.5 });
    expect(preview).toMatchObject({ survivor: null, boundary: null, point: null });
    if (preview.target.kind !== 'delete') throw new Error('Expected complete deletion.');
    const result = trimCadSketchEntity({ graph, parameters: {}, trim: preview.target });
    expect(result).toMatchObject({ retainedEntityId: null, removedEntityId: 'edge', cutPointId: null });
    expect(result.graph.entities).toEqual([graph.entities[1]]); expect(result.graph.points).toEqual(graph.points);
    expect(JSON.stringify(graph)).toBe(before);
  });

  it('reports actual whole-entity and detached-end drivers, while preserving unrelated exact relation text', () => {
    const original = fences(), graph = parseCadSketchGraph({ ...original, relations: [
      { id: 'span', kind: 'distance', pointIds: ['a', 'b'], value: ' length ' },
      { id: 'horizontal', kind: 'horizontal', pointIds: ['a', 'b'] }] });
    try { prepareCadSketchTrim({ graph, parameters: { length: 20 }, entityId: 'edge', parameter: 0.1 }); throw new Error('Expected blocker.'); }
    catch (error) {
      expect(error).toBeInstanceOf(CadSketchTrimDependencyError);
      if (!(error instanceof CadSketchTrimDependencyError)) throw error;
      expect(error.relationIds).toEqual(['span']); expect(error.pointIds).toEqual(['a']);
      expect(Object.isFrozen(error.relationIds)).toBe(true); expect(error.message).not.toContain('span');
    }
    const driven = parseCadSketchGraph({ ...original, points: original.points.map(point => point.id === 'a' ? { ...point, position: [' origin ', 0] } : point) });
    expect(() => prepareCadSketchTrim({ graph: driven, parameters: { origin: 0 }, entityId: 'edge', parameter: 0.1 }))
      .toThrowError(expect.objectContaining({ code: 'dependent-sketch-trim', relationIds: [], pointIds: ['a'] }));
    const owned = parseCadSketchGraph({ ...original, points: original.points.map(point => point.id === 'c' ? { ...point, position: [5, -10] }
      : point.id === 'd' ? { ...point, position: [5, 10] } : point), relations: [{ id: 'equal', kind: 'equal-length', lineIds: ['edge', 'left'] }] });
    expect(() => prepareCadSketchTrim({ graph: owned, parameters: {}, entityId: 'edge', parameter: 0.1 }))
      .toThrowError(expect.objectContaining({ code: 'dependent-sketch-trim', relationIds: ['equal'] }));
    const unrelated = parseCadSketchGraph({ ...original, relations: [{ id: 'height', kind: 'fixed-axis', pointId: 'b', axis: 'y', value: ' 0 ' }] });
    const preview = prepareCadSketchTrim({ graph: unrelated, parameters: {}, entityId: 'edge', parameter: 0.1 });
    if (preview.target.kind !== 'end') throw new Error('Expected end trim.');
    expect(trimCadSketchEntity({ graph: unrelated, parameters: {}, trim: { ...preview.target, cutPointId: 'cut' } }).graph.relations).toEqual(unrelated.relations);
  });

  it('rejects stale, forged, colliding and nonportable requests without retargeting or mutating source', () => {
    const graph = fences(), before = JSON.stringify(graph), preview = prepareCadSketchTrim({ graph, parameters: {}, entityId: 'edge', parameter: 0.1 });
    if (preview.target.kind !== 'end') throw new Error('Expected end trim.');
    const request = { ...preview.target, cutPointId: 'm' };
    const moved = parseCadSketchGraph({ ...graph, points: graph.points.map(point => point.id === 'c' || point.id === 'd' ? { ...point, position: [6, point.position[1]] } : point) });
    expect(() => trimCadSketchEntity({ graph: moved, parameters: {}, trim: request })).toThrowError(expect.objectContaining({ code: 'stale-sketch-trim' }));
    expect(() => trimCadSketchEntity({ graph, parameters: {}, trim: { ...request, boundary: { ...request.boundary, position: [6, 0] } } }))
      .toThrowError(expect.objectContaining({ code: 'stale-sketch-trim' }));
    expect(() => trimCadSketchEntity({ graph, parameters: {}, trim: { ...request, cutPointId: 'a' } }))
      .toThrowError(expect.objectContaining({ code: 'duplicate-sketch-id' }));
    for (const parameter of [-0.1, 1.1, Infinity, NaN]) expect(() => prepareCadSketchTrim({ graph, parameters: {}, entityId: 'edge', parameter })).toThrow();
    expect(() => prepareCadSketchTrim({ graph, parameters: {}, entityId: 'missing', parameter: 0.5 })).toThrow();
    expect(() => trimCadSketchEntity({ graph, parameters: {}, trim: { ...request, cutPointId: ' invalid ' } })).toThrow();
    expect(JSON.stringify(graph)).toBe(before);
  });

  it('never turns tangent, overlapping, tied undeclared or unrepresentable cuts into whole-edge deletion', () => {
    const original = fences(), overlap = parseCadSketchGraph({ ...original, points: original.points.map(point => point.id === 'c' ? { ...point, position: [5, 0] }
      : point.id === 'd' ? { ...point, position: [10, 0] } : point), entities: original.entities.filter(entity => entity.id !== 'right') });
    expect(() => prepareCadSketchTrim({ graph: overlap, parameters: {}, entityId: 'edge', parameter: 0.1 }))
      .toThrowError(expect.objectContaining({ code: 'ambiguous-sketch-trim' }));
    const tangent = parseCadSketchGraph({ points: [{ id: 'a', position: [-10, 5] }, { id: 'b', position: [10, 5] }, { id: 'o', position: [0, 0] }], entities: [
      { id: 'edge', kind: 'line', construction: false, startPointId: 'a', endPointId: 'b' },
      { id: 'ring', kind: 'circle', construction: true, centerPointId: 'o', radius: 5 }], relations: [] });
    expect(() => prepareCadSketchTrim({ graph: tangent, parameters: {}, entityId: 'edge', parameter: 0.1 }))
      .toThrowError(expect.objectContaining({ code: 'ambiguous-sketch-trim' }));
    const endpointTangent = parseCadSketchGraph({ ...tangent, points: tangent.points.map(point => point.id === 'b' ? { ...point, position: [0, 5] } : point) });
    expect(() => prepareCadSketchTrim({ graph: endpointTangent, parameters: {}, entityId: 'edge', parameter: 0.1 }))
      .toThrowError(expect.objectContaining({ code: 'ambiguous-sketch-trim' }));
    const tied = parseCadSketchGraph({ ...original, points: original.points.map(point => point.id === 'c' || point.id === 'e' ? { ...point, position: [5, 0] }
      : point.id === 'd' ? { ...point, position: [5, 10] } : point.id === 'f' ? { ...point, position: [5, -10] } : point) });
    expect(() => prepareCadSketchTrim({ graph: tied, parameters: {}, entityId: 'edge', parameter: 0.1 }))
      .toThrowError(expect.objectContaining({ code: 'ambiguous-sketch-trim' }));
    const declared = parseCadSketchGraph({ ...tied, relations: [{ id: 'joint', kind: 'coincident', pointIds: ['c', 'e'] }] });
    const preview = prepareCadSketchTrim({ graph: declared, parameters: {}, entityId: 'edge', parameter: 0.1 });
    expect(preview.target).toMatchObject({ kind: 'end', boundary: { entityId: 'left', endpointPointId: 'c' } });
    const near = parseCadSketchGraph({ ...original, points: original.points.map(point => point.id === 'c' || point.id === 'd' ? { ...point, position: [1e-8, point.position[1]] } : point) });
    expect(() => prepareCadSketchTrim({ graph: near, parameters: {}, entityId: 'edge', parameter: 0 }))
      .toThrowError(expect.objectContaining({ code: 'sketch-trim-precision' }));
    expect(() => prepareCadSketchTrim({ graph: original, parameters: {}, entityId: 'edge', parameter: 0.25 }))
      .toThrowError(expect.objectContaining({ code: 'ambiguous-sketch-trim' }));
  });
});
