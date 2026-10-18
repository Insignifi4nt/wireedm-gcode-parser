import { describe, expect, it } from 'vitest';
import { createCadFreshSketchDrawing, type CadFreshSketchDrawing, type CadFreshSketchPick } from '../cadFreshSketchGraph';
import { parseCadSketchGraph } from '../cadSketchGraph';
import { createCadDocument, parseCadDocument } from '../cadSchema';
import { applyCadEdits } from '../cadOperations';
import { measureCadSketch } from '../cadMeasurements';

function idFactory() { let next = 0; return () => `fresh-${++next}`; }

describe('fresh authored sketch picks', () => {
  it.each([
    { first: [0, 0], opposite: [20, 10] }, { first: [20, 0], opposite: [0, 10] },
    { first: [20, 10], opposite: [0, 0] }, { first: [0, 10], opposite: [20, 0] }
  ] as const)('attaches the actual first/opposite rectangle roles with independent fresh IDs: %j', ({ first, opposite }) => {
    const existingGraph = parseCadSketchGraph({ points: [{ id: 'first-source', position: first }, { id: 'opposite-source', position: opposite }], entities: [], relations: [] });
    const drawing = { kind: 'rectangle', first: { kind: 'coincident', point: first, sourcePointId: 'first-source', relationId: 'join-first' },
      opposite: { kind: 'coincident', point: opposite, sourcePointId: 'opposite-source', relationId: 'join-opposite' } } as const;
    const before = JSON.stringify({ existingGraph, drawing });
    const created = createCadFreshSketchDrawing({ drawing, construction: false, createId: idFactory(), existingGraph });
    if (created.kind !== 'rectangle') throw new Error('Expected rectangle role map.');
    const graph = created.geometry;
    expect(graph.points.map(point => point.position)).toEqual([[0, 0], [20, 0], [20, 10], [0, 10]]);
    expect(graph.points.find(point => point.id === created.pointIds.first)?.position).toEqual(first);
    expect(graph.points.find(point => point.id === created.pointIds.opposite)?.position).toEqual(opposite);
    expect(graph.points.some(point => point.id === 'first-source' || point.id === 'opposite-source')).toBe(false);
    expect(graph.relations.slice(0, 4).map(relation => relation.kind)).toEqual(['horizontal', 'vertical', 'horizontal', 'vertical']);
    expect(graph.relations.slice(4)).toEqual([
      { id: 'join-first', kind: 'coincident', pointIds: [created.pointIds.first, 'first-source'] },
      { id: 'join-opposite', kind: 'coincident', pointIds: [created.pointIds.opposite, 'opposite-source'] }
    ]);
    const source = parseCadDocument({ ...createCadDocument(), schemaVersion: 2, features: [{ id: 'sketch', kind: 'sketch', name: 'Sketch', suppressed: false, plane: 'XY', offset: 0, profiles: [], graph: existingGraph }] });
    const accepted = applyCadEdits(source, [{ kind: 'append-sketch-entities', sketchId: 'sketch', geometry: graph }]);
    expect(measureCadSketch(accepted, 'sketch')).toMatchObject({ materialAreaMm2: 200, boundaryLengthMm: 60 });
    expect(new Set([...graph.points, ...graph.entities, ...graph.relations].map(item => item.id)).size).toBe(14);
    expect(Object.isFrozen(created)).toBe(true); expect(Object.isFrozen(created.pointIds)).toBe(true); expect(Object.isFrozen(graph)).toBe(true);
    expect(JSON.stringify({ existingGraph, drawing })).toBe(before); expect(Object.isFrozen(drawing)).toBe(false);
  });

  it('attaches only a new circle center and preserves source expressions while a numeric-only pick stays independent', () => {
    const parameters = { offset: 3.25, height: 6, oldRadius: 1 }, existingGraph = parseCadSketchGraph({ points: [{ id: 'driver', position: [' offset ', 'height + 1'] }], entities: [
      { id: 'guide', kind: 'circle', construction: true, centerPointId: 'driver', radius: ' oldRadius ' }
    ], relations: [] }), before = JSON.stringify(existingGraph), createId = idFactory();
    const attached = createCadFreshSketchDrawing({ drawing: { kind: 'circle', center: { kind: 'coincident', point: [3.25, 7], sourcePointId: 'driver', relationId: 'join-center' }, radius: 3 },
      construction: false, createId, existingGraph, parameters });
    if (attached.kind !== 'circle') throw new Error('Expected circle role map.');
    expect(attached.geometry.points).toEqual([{ id: attached.centerPointId, position: [3.25, 7] }]);
    expect(attached.geometry.relations).toEqual([{ id: 'join-center', kind: 'coincident', pointIds: [attached.centerPointId, 'driver'] }]);
    expect(attached.geometry.entities).toEqual([{ id: expect.any(String), kind: 'circle', construction: false, centerPointId: attached.centerPointId, radius: 3 }]);
    const independent = createCadFreshSketchDrawing({ drawing: { kind: 'circle', center: { kind: 'position', point: [3.25, 7] }, radius: 2 },
      construction: true, createId, existingGraph, parameters });
    expect(independent.geometry.relations).toEqual([]); expect(independent.geometry.points).toHaveLength(1);
    expect(independent.geometry.entities[0].construction).toBe(true);
    expect(attached.geometry.points[0].id).not.toBe('driver'); expect(Object.isFrozen(attached.geometry.points[0].position)).toBe(true);
    expect(JSON.stringify(existingGraph)).toBe(before);
  });

  it.each([false, true])('preserves polygon vertex roles and nearly adjacent distinct identities, reversed=%s', reversed => {
    const authored: readonly CadFreshSketchPick[] = [
      { kind: 'coincident', point: [0, 0], sourcePointId: 'origin', relationId: 'join-origin' },
      { kind: 'coincident', point: [6, 0], sourcePointId: 'edge', relationId: 'join-edge' },
      { kind: 'position', point: [6, .000001] }, { kind: 'position', point: [6, 2] }, { kind: 'position', point: [0, 2] }
    ];
    const vertices = reversed ? [...authored].reverse() : authored, before = JSON.stringify(vertices);
    const existingGraph = parseCadSketchGraph({ points: [{ id: 'origin', position: [0, 0] }, { id: 'edge', position: [6, 0] }], entities: [], relations: [] });
    const created = createCadFreshSketchDrawing({ drawing: { kind: 'polygon', vertices }, construction: false, createId: idFactory(), existingGraph });
    if (created.kind !== 'polygon') throw new Error('Expected polygon role map.');
    expect(created.geometry.points.map(point => point.position)).toEqual(vertices.map(vertex => vertex.point));
    expect(created.vertexPointIds).toEqual(created.geometry.points.map(point => point.id));
    expect(created.geometry.points).toHaveLength(5); expect(new Set(created.vertexPointIds).size).toBe(5);
    expect(created.geometry.relations.find(relation => relation.id === 'join-origin')).toEqual({ id: 'join-origin', kind: 'coincident', pointIds: [created.vertexPointIds[reversed ? 4 : 0], 'origin'] });
    expect(created.geometry.relations.find(relation => relation.id === 'join-edge')).toEqual({ id: 'join-edge', kind: 'coincident', pointIds: [created.vertexPointIds[reversed ? 3 : 1], 'edge'] });
    const source = parseCadDocument({ ...createCadDocument(), schemaVersion: 2, features: [{ id: 'sketch', kind: 'sketch', name: 'Sketch', suppressed: false, plane: 'XY', offset: 0, profiles: [], graph: existingGraph }] });
    const accepted = applyCadEdits(source, [{ kind: 'append-sketch-entities', sketchId: 'sketch', geometry: created.geometry }]);
    expect(measureCadSketch(accepted, 'sketch')).toMatchObject({ materialAreaMm2: 12, boundaryLengthMm: 16 });
    expect(Object.isFrozen(created.vertexPointIds)).toBe(true); expect(JSON.stringify(vertices)).toBe(before);
  });

  it('retains the exact picked rectangle axes through cancellation instead of reconstructing an attached corner from width', () => {
    const highX = 1.23456789e-9, existingGraph = parseCadSketchGraph({ points: [{ id: 'tiny', position: [' highX ', '10'] }], entities: [], relations: [] });
    const created = createCadFreshSketchDrawing({ drawing: { kind: 'rectangle', first: { kind: 'position', point: [-100000, 0] },
      opposite: { kind: 'coincident', point: [highX, 10], sourcePointId: 'tiny', relationId: 'join-tiny' } }, construction: false, createId: idFactory(), existingGraph, parameters: { highX } });
    if (created.kind !== 'rectangle') throw new Error('Expected rectangle roles.');
    expect(created.geometry.points.find(point => point.id === created.pointIds.opposite)?.position).toEqual([1.23456789e-9, 10]);
    expect(created.geometry.points.map(point => point.position)).toEqual([[-100000, 0], [1.23456789e-9, 0], [1.23456789e-9, 10], [-100000, 10]]);
    expect(existingGraph.points[0].position).toEqual([' highX ', '10']);
  });

  it('rejects missing, changed and nearly equal borrowed source references before allocating fresh identities', () => {
    const existingGraph = parseCadSketchGraph({ points: [{ id: 'anchor', position: [' x ', ' y '] }], entities: [], relations: [] }), before = JSON.stringify(existingGraph);
    for (const sourcePointId of ['anchor', 'missing']) for (const point of [[1.25, 2.5], [1.250000000000001, 2.5], [1.25, 2.500000000000001]] as const) {
      if (sourcePointId === 'anchor' && point[0] === 1.25 && point[1] === 2.5) continue;
      let allocations = 0;
      expect(() => createCadFreshSketchDrawing({ drawing: { kind: 'circle', center: { kind: 'coincident', point, sourcePointId, relationId: 'join' }, radius: 3 },
        construction: false, createId: () => `unused-${++allocations}`, existingGraph, parameters: { x: 1.25, y: 2.5 } }))
        .toThrowError(expect.objectContaining({ code: 'stale-fresh-sketch-point-reference' }));
      expect(allocations).toBe(0);
    }
    expect(() => createCadFreshSketchDrawing({ drawing: { kind: 'circle', center: { kind: 'coincident', point: [1.25, 2.5], sourcePointId: 'anchor', relationId: 'join' }, radius: 3 },
      construction: false, createId: idFactory(), parameters: { x: 1.25, y: 2.5 } })).toThrowError(expect.objectContaining({ code: 'stale-fresh-sketch-point-reference' }));
    expect(JSON.stringify(existingGraph)).toBe(before);
  });

  it('rejects collisions across source, new geometry and explicit relation identities without changing inputs', () => {
    const existingGraph = parseCadSketchGraph({ points: [{ id: 'anchor', position: [0, 0] }], entities: [], relations: [] }), before = JSON.stringify(existingGraph);
    for (const relationId of ['anchor', 'fresh-1']) expect(() => createCadFreshSketchDrawing({
      drawing: { kind: 'circle', center: { kind: 'coincident', point: [0, 0], sourcePointId: 'anchor', relationId }, radius: 3 },
      construction: false, createId: idFactory(), existingGraph
    })).toThrowError(expect.objectContaining({ code: 'duplicate-sketch-id' }));
    for (const createId of [() => 'anchor', () => 'duplicate']) expect(() => createCadFreshSketchDrawing({
      drawing: { kind: 'circle', center: { kind: 'position', point: [5, 0] }, radius: 3 }, construction: false, createId, existingGraph
    })).toThrowError(expect.objectContaining({ code: 'duplicate-sketch-id' }));
    expect(() => createCadFreshSketchDrawing({ drawing: { kind: 'rectangle', first: { kind: 'coincident', point: [0, 0], sourcePointId: 'anchor', relationId: 'join' },
      opposite: { kind: 'coincident', point: [20, 10], sourcePointId: 'other', relationId: 'join' } }, construction: false, createId: idFactory(),
      existingGraph: { ...existingGraph, points: [...existingGraph.points, { id: 'other', position: [20, 10] }] }
    })).toThrowError(expect.objectContaining({ code: 'duplicate-sketch-id' }));
    expect(JSON.stringify(existingGraph)).toBe(before);
  });

  it.each<CadFreshSketchDrawing>([
    { kind: 'rectangle', first: { kind: 'position', point: [0, 0] }, opposite: { kind: 'position', point: [20, 10] } },
    { kind: 'circle', center: { kind: 'position', point: [0, 0] }, radius: 3 },
    { kind: 'polygon', vertices: [{ kind: 'position', point: [0, 0] }, { kind: 'position', point: [20, 0] }, { kind: 'position', point: [20, 10] }] }
  ])('retains purely numeric picks as fresh independent topology without inferring same-coordinate joins: %j', drawing => {
    const existingGraph = parseCadSketchGraph({ points: [{ id: 'a', position: [0, 0] }, { id: 'b', position: [20, 10] }], entities: [], relations: [] });
    const created = createCadFreshSketchDrawing({ drawing, construction: false, createId: idFactory(), existingGraph });
    expect(created.geometry.relations.some(relation => relation.kind === 'coincident' || relation.kind === 'fixed-axis' || relation.kind === 'fixed-point')).toBe(false);
    expect(created.geometry.points.some(point => point.id === 'a' || point.id === 'b')).toBe(false);
    expect(created.geometry.points.every(point => point.position.every(value => typeof value === 'number'))).toBe(true);
  });

  it.each<CadFreshSketchDrawing>([
    { kind: 'rectangle', first: { kind: 'position', point: [0, 0] }, opposite: { kind: 'position', point: [0, 10] } },
    { kind: 'circle', center: { kind: 'position', point: [0, 0] }, radius: 0 },
    { kind: 'polygon', vertices: [{ kind: 'position', point: [0, 0] }, { kind: 'position', point: [5, 0] }, { kind: 'position', point: [5, 0] }, { kind: 'position', point: [0, 5] }] }
  ])('rejects degenerate authored geometry before consuming IDs: %j', drawing => {
    let allocations = 0;
    expect(() => createCadFreshSketchDrawing({ drawing, construction: false, createId: () => `unused-${++allocations}` })).toThrow();
    expect(allocations).toBe(0);
  });

  it('places fresh points on an existing line or the plane origin and axes with removable relations', () => {
    const existingGraph = parseCadSketchGraph({ points: [{ id: 'a', position: [0, 20] }, { id: 'b', position: [40, 20] }],
      entities: [{ id: 'top', kind: 'line', construction: true, startPointId: 'a', endPointId: 'b' }], relations: [] });
    const drawing: CadFreshSketchDrawing = { kind: 'polygon', vertices: [
      { kind: 'datum', point: [0, 0], datum: 'origin', relationIds: ['at-x', 'at-y'] },
      { kind: 'datum', point: [30, 0], datum: 'x-axis', relationIds: ['on-x'] },
      { kind: 'on-line', point: [25, 20], lineId: 'top', relationId: 'on-top' }] };
    const created = createCadFreshSketchDrawing({ drawing, construction: false, createId: idFactory(), existingGraph });
    if (created.kind !== 'polygon') throw new Error('Expected polygon role map.');
    const [origin, axis, top] = created.vertexPointIds;
    expect(created.geometry.relations.filter(relation => !relation.id.startsWith('fresh-'))).toEqual([
      { id: 'at-x', kind: 'fixed-axis', pointId: origin, axis: 'x', value: 0 }, { id: 'at-y', kind: 'fixed-axis', pointId: origin, axis: 'y', value: 0 },
      { id: 'on-x', kind: 'fixed-axis', pointId: axis, axis: 'y', value: 0 }, { id: 'on-top', kind: 'point-on-line', pointId: top, lineId: 'top' }]);
    const source = parseCadDocument({ ...createCadDocument(), schemaVersion: 2, features: [{ id: 'sketch', kind: 'sketch', name: 'Sketch', suppressed: false, plane: 'XY', offset: 0, profiles: [], graph: existingGraph }] });
    expect(() => applyCadEdits(source, [{ kind: 'append-sketch-entities', sketchId: 'sketch', geometry: created.geometry }])).not.toThrow();
    expect(() => createCadFreshSketchDrawing({ drawing: { kind: 'circle', center: { kind: 'datum', point: [0, .5], datum: 'y-axis', relationIds: ['r'] }, radius: 2 },
      construction: false, createId: idFactory(), existingGraph })).not.toThrow();
    expect(() => createCadFreshSketchDrawing({ drawing: { kind: 'circle', center: { kind: 'datum', point: [0, .5], datum: 'origin', relationIds: ['r', 's'] }, radius: 2 },
      construction: false, createId: idFactory(), existingGraph })).toThrow('must lie exactly on it');
    expect(() => createCadFreshSketchDrawing({ drawing: { kind: 'circle', center: { kind: 'on-line', point: [5, 20], lineId: 'gone', relationId: 'r' }, radius: 2 },
      construction: false, createId: idFactory(), existingGraph })).toThrow('A picked line changed or no longer exists');
  });
});
