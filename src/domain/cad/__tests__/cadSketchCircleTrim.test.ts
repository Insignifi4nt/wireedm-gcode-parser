import { describe, expect, it } from 'vitest';
import { parseCadSketchGraph } from '../cadSketchGraph';
import { compileCadSketchGraph } from '../cadSketchGraphGeometry';
import { cadAnalyticSegments } from '../cadAnalyticSegments';
import { cadSketchCircleTrimParameter, prepareCadSketchTrim, trimCadSketchEntity } from '../cadSketchTrimExtend';
import { createCircleSegment, signedAreaOfPath } from '@/domain/path-intel/segments';

function cap() {
  return parseCadSketchGraph({ points: [{ id: 'o', position: [' cx ', ' cy '] },
    { id: 'a', position: [' -8 ', ' 6 '] }, { id: 'b', position: [' 8 ', ' 6 '] }], entities: [
    { id: 'rim', kind: 'circle', centerPointId: 'o', radius: 10, construction: false },
    { id: 'chord', kind: 'line', startPointId: 'a', endPointId: 'b', construction: false }],
    relations: [{ id: 'center-driver', kind: 'fixed-point', pointId: 'o', position: [' cx ', ' cy '] }] });
}
const parameters = { cx: 0, cy: 0 };

describe('exact free-circle Trim', () => {
  it('keeps actual radial phase, normalizes only axis signed zero and rejects an unrepresentable near-seam side', () => {
    const circle = createCircleSegment({ id: 'ring', center: { x: 0, y: 0 }, radius: 1,
      source: { sourceEntityIndex: 0, sourceEntityType: 'circle', layer: null, exact: true } });
    expect(cadSketchCircleTrimParameter(circle, { x: 0, y: 1 })).toBe(.25);
    expect(cadSketchCircleTrimParameter(circle, { x: 0, y: -1 })).toBe(.75);
    expect(cadSketchCircleTrimParameter(circle, { x: 1, y: -0 })).toBe(0);
    expect(cadSketchCircleTrimParameter(circle, { x: 0, y: 0 })).toBeNull();
    expect(cadSketchCircleTrimParameter(circle, { x: NaN, y: 1 })).toBeNull();
    expect(cadSketchCircleTrimParameter(circle, { x: 1, y: -Number.MIN_VALUE })).toBeNull();
    expect(cadSketchCircleTrimParameter(circle, { x: 1, y: Number.MIN_VALUE })).toBeNull();
  });
  it('removes a clicked top cap and shares the real chord endpoints in the complementary major D arc', () => {
    const graph = cap(), before = JSON.stringify(graph);
    const preview = prepareCadSketchTrim({ graph, parameters, entityId: 'rim', parameter: .25 });
    expect(preview.target).toMatchObject({ kind: 'circle', entityId: 'rim', parameter: .25,
      boundaries: [{ entityId: 'chord', index: 0, position: [8, 6], endpointPointId: 'b' },
        { entityId: 'chord', index: 1, position: [-8, 6], endpointPointId: 'a' }] });
    if (preview.target.kind !== 'circle' || !('survivor' in preview) || preview.removed.kind !== 'arc' || preview.survivor?.kind !== 'arc')
      throw new Error('Expected complementary circle arcs.');
    expect(preview.removed.sweepRadians).toBeCloseTo(2 * Math.acos(.6), 14);
    expect(preview.survivor.sweepRadians).toBeGreaterThan(Math.PI);
    expect(preview.removed.sweepRadians + preview.survivor.sweepRadians).toBe(2 * Math.PI);
    const result = trimCadSketchEntity({ graph, parameters, trim: { ...preview.target, cutPointIds: ['b', 'a'] } });
    expect(result.graph.entities).toEqual([{ id: 'rim', kind: 'arc', centerPointId: 'o', startPointId: 'a', endPointId: 'b', direction: 'ccw', construction: false }, graph.entities[1]]);
    expect(result.graph.points).toEqual(graph.points); expect(result.graph.relations).toEqual(graph.relations);
    const compiled = compileCadSketchGraph(result.graph, parameters);
    expect(compiled.cycles).toHaveLength(1);
    const analytic = cadAnalyticSegments(compiled.cycles[0].path);
    expect(Math.abs(signedAreaOfPath(analytic.refs, analytic.byId))).toBeCloseTo(100 * Math.PI - (100 * Math.acos(.6) - 48), 11);
    expect(JSON.stringify(graph)).toBe(before);
    expect(Object.isFrozen(preview.survivor.center)).toBe(true);
  });

  it('owns wrapped adjacency without a seam, preserves request zero/one receipts and retains real phase-zero half-turn contacts', () => {
    const graph = cap(), zero = prepareCadSketchTrim({ graph, parameters, entityId: 'rim', parameter: 0 });
    const one = prepareCadSketchTrim({ graph, parameters, entityId: 'rim', parameter: 1 });
    expect(one.target).toEqual({ ...zero.target, parameter: 1 });
    expect(one.removed).toEqual(zero.removed);
    expect(zero.target).toMatchObject({ kind: 'circle', boundaries: [{ endpointPointId: 'a' }, { endpointPointId: 'b' }] });
    if (zero.target.kind !== 'circle' || !('survivor' in zero) || zero.survivor?.kind !== 'arc') throw new Error('Expected wrapped circle span.');
    expect(zero.removed.length).toBeGreaterThan(10 * Math.PI);
    expect(zero.survivor.sweepRadians).toBeCloseTo(2 * Math.acos(.6), 14);
    const reordered = parseCadSketchGraph({ ...graph, points: [...graph.points].reverse(), entities: [...graph.entities].reverse() });
    expect(prepareCadSketchTrim({ graph: reordered, parameters, entityId: 'rim', parameter: 0 }).target).toEqual(zero.target);
    const diameter = parseCadSketchGraph({ ...graph, points: graph.points.map(point => point.id === 'a' ? { ...point, position: [-10, 0] }
      : point.id === 'b' ? { ...point, position: [10, 0] } : point) });
    const half = prepareCadSketchTrim({ graph: diameter, parameters, entityId: 'rim', parameter: .25 });
    expect(half.target).toMatchObject({ kind: 'circle', boundaries: [{ parameter: 0, endpointPointId: 'b' }, { parameter: .5, endpointPointId: 'a' }] });
    if (half.target.kind !== 'circle' || !('survivor' in half) || half.survivor?.kind !== 'arc') throw new Error('Expected exact half-turn.');
    expect(half.removed).toMatchObject({ sweepRadians: Math.PI, radius: 10 });
    expect(half.survivor).toMatchObject({ sweepRadians: Math.PI, radius: 10 });
    expect(compileCadSketchGraph(trimCadSketchEntity({ graph: diameter, parameters, trim: { ...half.target, cutPointIds: ['b', 'a'] } }).graph, parameters).cycles).toHaveLength(1);
    for (const parameter of [0, 1, Number.EPSILON, 1 - Number.EPSILON])
      expect(() => prepareCadSketchTrim({ graph: diameter, parameters, entityId: 'rim', parameter })).toThrowError(expect.objectContaining({ code: 'ambiguous-sketch-trim' }));
  });

  it('rejects a lost minor/major side when non-diametric Cartesian contacts round to half-turn phases', () => {
    const base = cap();
    for (const y of [1e-15, -1e-15]) {
      const graph = parseCadSketchGraph({ ...base, points: base.points.map(point => point.id === 'a' ? { ...point, position: [10, 0] }
        : point.id === 'b' ? { ...point, position: [-10, y] } : point) });
      expect(() => prepareCadSketchTrim({ graph, parameters, entityId: 'rim', parameter: .25 }))
        .toThrowError(expect.objectContaining({ code: 'sketch-trim-precision' }));
    }
  });

  it('chooses cyclic neighboring cuts among four real contacts rather than the first and last sorted pair', () => {
    const base = cap(), graph = parseCadSketchGraph({ ...base, points: [...base.points, { id: 'low', position: [0, -20] }, { id: 'high', position: [0, 20] }],
      entities: [...base.entities, { id: 'diameter', kind: 'line', startPointId: 'low', endPointId: 'high', construction: true }] });
    const preview = prepareCadSketchTrim({ graph, parameters, entityId: 'rim', parameter: .01 });
    expect(preview.target).toMatchObject({ kind: 'circle', boundaries: [{ entityId: 'diameter', index: 1, parameter: .75, position: [0, -10] },
      { entityId: 'chord', index: 0, position: [8, 6], endpointPointId: 'b' }] });
    if (preview.target.kind !== 'circle' || !('survivor' in preview) || preview.survivor?.kind !== 'arc' || preview.removed.kind !== 'arc')
      throw new Error('Expected one cyclic span.');
    expect(preview.removed.sweepRadians).toBeCloseTo(Math.PI / 2 + Math.asin(.6), 14);
    expect(preview.survivor.sweepRadians).toBeGreaterThan(Math.PI);
    expect(preview.removed.sweepRadians + preview.survivor.sweepRadians).toBe(2 * Math.PI);
  });

  it('combines only declared shared boundary contacts and rejects close distinct contacts across the cyclic seam', () => {
    const base = cap(), extra = parseCadSketchGraph({ ...base, points: [...base.points, { id: 'alias-b', position: [8, 6] }, { id: 'out', position: [8, 0] }],
      entities: [...base.entities, { id: 'radial-cut', kind: 'line', startPointId: 'alias-b', endPointId: 'out', construction: true }] });
    expect(() => prepareCadSketchTrim({ graph: extra, parameters, entityId: 'rim', parameter: .25 }))
      .toThrowError(expect.objectContaining({ code: 'ambiguous-sketch-trim' }));
    const declared = parseCadSketchGraph({ ...extra, relations: [...extra.relations, { id: 'declared', kind: 'coincident', pointIds: ['b', 'alias-b'] }] });
    const preview = prepareCadSketchTrim({ graph: declared, parameters, entityId: 'rim', parameter: .25 });
    if (preview.target.kind !== 'circle') throw new Error('Expected two declared circle contacts.');
    const result = trimCadSketchEntity({ graph: declared, parameters, trim: { ...preview.target, cutPointIds: ['b', 'a'] } });
    expect(result.graph.relations).toEqual(declared.relations); expect(result.graph.points).toEqual(declared.points);
    const near = parseCadSketchGraph({ ...base, points: [...base.points, { id: 'left', position: [-20, 0] }, { id: 'right', position: [20, 0] },
      { id: 'inside', position: [0, 0] }, { id: 'below', position: [20, -1e-14] }], entities: [...base.entities,
      { id: 'diameter', kind: 'line', startPointId: 'left', endPointId: 'right', construction: true },
      { id: 'near-seam', kind: 'line', startPointId: 'inside', endPointId: 'below', construction: true }] });
    expect(() => prepareCadSketchTrim({ graph: near, parameters, entityId: 'rim', parameter: .25 }))
      .toThrowError(expect.objectContaining({ code: 'ambiguous-sketch-trim' }));
  });

  it('keeps retained center-only owners, blocks actual curve/radius drivers and deletes only a genuinely isolated eligible circle', () => {
    const graph = cap(), isolated = parseCadSketchGraph({ ...graph, entities: [graph.entities[0]] }), before = JSON.stringify(graph);
    const deletion = prepareCadSketchTrim({ graph: isolated, parameters, entityId: 'rim', parameter: 1 });
    expect(deletion.target).toEqual({ kind: 'delete', entityId: 'rim', parameter: 1 });
    if (deletion.target.kind !== 'delete') throw new Error('Expected whole free-circle deletion.');
    const deleted = trimCadSketchEntity({ graph: isolated, parameters, trim: deletion.target });
    expect(deleted.graph).toEqual({ ...isolated, entities: [] });
    const guide = parseCadSketchGraph({ ...graph, points: [...graph.points, { id: 'g0', position: [-2, 0] }, { id: 'g1', position: [2, 0] }],
      entities: [...graph.entities, { id: 'guide', kind: 'line', startPointId: 'g0', endPointId: 'g1', construction: true }],
      relations: [...graph.relations, { id: 'center-midpoint', kind: 'midpoint', pointId: 'o', lineId: 'guide' }] });
    const preview = prepareCadSketchTrim({ graph: guide, parameters, entityId: 'rim', parameter: .25 });
    if (preview.target.kind !== 'circle') throw new Error('Expected retained center.');
    expect(trimCadSketchEntity({ graph: guide, parameters, trim: { ...preview.target, cutPointIds: ['b', 'a'] } }).graph.relations).toEqual(guide.relations);
    const expression = parseCadSketchGraph({ ...graph, entities: graph.entities.map(entity => entity.kind === 'circle' ? { ...entity, radius: ' 10 ' } : entity) });
    expect(() => prepareCadSketchTrim({ graph: expression, parameters, entityId: 'rim', parameter: .25 }))
      .toThrowError(expect.objectContaining({ code: 'driven-sketch-trim-radius' }));
    const radial = parseCadSketchGraph({ ...graph, relations: [...graph.relations, { id: 'radius-driver', kind: 'radial-size', entityId: 'rim', quantity: 'radius', value: ' 10 ' }] });
    expect(() => prepareCadSketchTrim({ graph: radial, parameters, entityId: 'rim', parameter: .25 }))
      .toThrowError(expect.objectContaining({ code: 'dependent-sketch-trim', relationIds: ['radius-driver'], pointIds: [] }));
    const equal = parseCadSketchGraph({ ...graph, points: [...graph.points, { id: 'other-center', position: [30, 0] }],
      entities: [...graph.entities, { id: 'other-circle', kind: 'circle', centerPointId: 'other-center', radius: 10, construction: true }],
      relations: [...graph.relations, { id: 'equal-driver', kind: 'equal-radius', curveIds: ['rim', 'other-circle'] }] });
    expect(() => prepareCadSketchTrim({ graph: equal, parameters, entityId: 'rim', parameter: .25 }))
      .toThrowError(expect.objectContaining({ code: 'dependent-sketch-trim', relationIds: ['equal-driver'] }));
    for (const points of [[[10, 0], [20, 0]], [[-20, 10], [20, 10]]] as const) {
      const blocked = parseCadSketchGraph({ ...graph, points: [graph.points[0], { id: 'u', position: points[0] }, { id: 'v', position: points[1] }],
        entities: [graph.entities[0], { id: 'boundary', kind: 'line', startPointId: 'u', endPointId: 'v', construction: true }] });
      expect(() => prepareCadSketchTrim({ graph: blocked, parameters, entityId: 'rim', parameter: .25 }))
        .toThrowError(expect.objectContaining({ code: 'ambiguous-sketch-trim' }));
    }
    const overlap = parseCadSketchGraph({ ...isolated, entities: [...isolated.entities, { ...isolated.entities[0], id: 'duplicate' }] });
    expect(() => prepareCadSketchTrim({ graph: overlap, parameters, entityId: 'rim', parameter: .25 }))
      .toThrowError(expect.objectContaining({ code: 'ambiguous-sketch-trim' }));
    expect(JSON.stringify(graph)).toBe(before);
  });

  it('requires exact witnessed identities, a collision-free cut namespace and an unchanged source receipt', () => {
    const graph = cap(), preview = prepareCadSketchTrim({ graph, parameters, entityId: 'rim', parameter: .25 });
    if (preview.target.kind !== 'circle') throw new Error('Expected circle target.');
    const target = preview.target;
    expect(() => trimCadSketchEntity({ graph, parameters, trim: { ...target, cutPointIds: ['new-b', 'a'] } }))
      .toThrowError(expect.objectContaining({ code: 'invalid-sketch-trim-point' }));
    const interior = parseCadSketchGraph({ ...graph, points: graph.points.map(point => point.id === 'a' ? { ...point, position: [-20, 6] }
      : point.id === 'b' ? { ...point, position: [20, 6] } : point) });
    const cuts = prepareCadSketchTrim({ graph: interior, parameters, entityId: 'rim', parameter: .25 });
    if (cuts.target.kind !== 'circle') throw new Error('Expected interior contacts.');
    const cutTarget = cuts.target;
    for (const cutPointIds of [['o', 'fresh'], ['same', 'same']] as const)
      expect(() => trimCadSketchEntity({ graph: interior, parameters, trim: { ...cutTarget, cutPointIds } }))
        .toThrowError(expect.objectContaining({ code: 'invalid-sketch-trim-point' }));
    for (const cutPointIds of [['a', 'fresh'], ['center-driver', 'fresh']] as const)
      expect(() => trimCadSketchEntity({ graph: interior, parameters, trim: { ...cutTarget, cutPointIds } }))
        .toThrowError(expect.objectContaining({ code: 'duplicate-sketch-id' }));
    const detached = trimCadSketchEntity({ graph: interior, parameters, trim: { ...cuts.target, cutPointIds: ['new-b', 'new-a'] } });
    expect(detached.graph.points.slice(0, graph.points.length)).toEqual(interior.points);
    const appended = detached.graph.points.slice(-2);
    expect(appended).toEqual([{ id: 'new-b', position: cuts.target.boundaries[0].position }, { id: 'new-a', position: cuts.target.boundaries[1].position }]);
    expect(appended[0].position[0]).toBeCloseTo(8, 13); expect(appended[1].position[0]).toBeCloseTo(-8, 13);
    expect(appended.map(point => point.position[1])).toEqual([6, 6]);
    expect(detached.graph.relations).toEqual(graph.relations);
    const changed = parseCadSketchGraph({ ...graph, entities: graph.entities.map(entity => entity.kind === 'circle' ? { ...entity, radius: 11 } : entity) });
    expect(() => trimCadSketchEntity({ graph: changed, parameters, trim: { ...target, cutPointIds: ['b', 'a'] } }))
      .toThrowError(expect.objectContaining({ code: 'stale-sketch-trim' }));
    expect(() => trimCadSketchEntity({ graph, parameters, trim: { ...target, boundaries: [{ ...target.boundaries[0], position: [7, 6] }, target.boundaries[1]], cutPointIds: ['b', 'a'] } }))
      .toThrowError(expect.objectContaining({ code: 'stale-sketch-trim' }));
  });
});
