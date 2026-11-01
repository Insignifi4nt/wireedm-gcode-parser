import { describe, expect, it } from 'vitest';
import { createCadFreshSketchDrawing, type CadFreshSketchDrawing, type CadFreshSketchPick } from '../cadFreshSketchGraph';
import { parseCadSketchGraph } from '../cadSketchGraph';
import { createCadDocument, parseCadDocument } from '../cadSchema';
import { applyCadEdits } from '../cadOperations';
import { measureCadSketch } from '../cadMeasurements';

function idFactory() { let next = 0; return () => `fresh-${++next}`; }
function polyline([start, ...ends]: readonly CadFreshSketchPick[], closed: boolean): CadFreshSketchDrawing {
  return { kind: 'polyline', start, steps: ends.map(end => ({ kind: 'line', end })), closed };
}
function polylineWith(steps: Extract<CadFreshSketchDrawing, { kind: 'polyline' }>['steps'], closed: boolean): CadFreshSketchDrawing {
  return { kind: 'polyline', start: { kind: 'position', point: [0, 0] }, steps, closed };
}

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

  it.each([false, true])('preserves closed polyline point roles and nearly adjacent distinct identities, reversed=%s', reversed => {
    const authored: readonly CadFreshSketchPick[] = [
      { kind: 'coincident', point: [0, 0], sourcePointId: 'origin', relationId: 'join-origin' },
      { kind: 'coincident', point: [6, 0], sourcePointId: 'edge', relationId: 'join-edge' },
      { kind: 'position', point: [6, .000001] }, { kind: 'position', point: [6, 2] }, { kind: 'position', point: [0, 2] }
    ];
    const vertices = reversed ? [...authored].reverse() : authored, before = JSON.stringify(vertices);
    const existingGraph = parseCadSketchGraph({ points: [{ id: 'origin', position: [0, 0] }, { id: 'edge', position: [6, 0] }], entities: [], relations: [] });
    const created = createCadFreshSketchDrawing({ drawing: polyline(vertices, true), construction: false, createId: idFactory(), existingGraph });
    if (created.kind !== 'polyline') throw new Error('Expected polyline role map.');
    expect(created.geometry.points.map(point => point.position)).toEqual(vertices.map(vertex => vertex.point));
    expect(created.pointIds).toEqual(created.geometry.points.map(point => point.id));
    expect(created.geometry.points).toHaveLength(5); expect(new Set(created.pointIds).size).toBe(5);
    // Four drawn lines and one closing line back to the start.
    expect(created.geometry.entities.map(entity => entity.kind)).toEqual(['line', 'line', 'line', 'line', 'line']);
    expect(created.geometry.relations.find(relation => relation.id === 'join-origin')).toEqual({ id: 'join-origin', kind: 'coincident', pointIds: [created.pointIds[reversed ? 4 : 0], 'origin'] });
    expect(created.geometry.relations.find(relation => relation.id === 'join-edge')).toEqual({ id: 'join-edge', kind: 'coincident', pointIds: [created.pointIds[reversed ? 3 : 1], 'edge'] });
    const source = parseCadDocument({ ...createCadDocument(), schemaVersion: 2, features: [{ id: 'sketch', kind: 'sketch', name: 'Sketch', suppressed: false, plane: 'XY', offset: 0, profiles: [], graph: existingGraph }] });
    const accepted = applyCadEdits(source, [{ kind: 'append-sketch-entities', sketchId: 'sketch', geometry: created.geometry }]);
    expect(measureCadSketch(accepted, 'sketch')).toMatchObject({ materialAreaMm2: 12, boundaryLengthMm: 16 });
    expect(Object.isFrozen(created.pointIds)).toBe(true); expect(JSON.stringify(vertices)).toBe(before);
  });

  it('draws one line or one three-point arc whose picked ends attach with removable relations', () => {
    const existingGraph = parseCadSketchGraph({ points: [{ id: 'a', position: [0, 20] }, { id: 'b', position: [40, 20] }],
      entities: [{ id: 'top', kind: 'line', construction: false, startPointId: 'a', endPointId: 'b' }], relations: [] }), before = JSON.stringify(existingGraph);
    const line = createCadFreshSketchDrawing({ drawing: { kind: 'line', start: { kind: 'coincident', point: [0, 20], sourcePointId: 'a', relationId: 'join-a' },
      end: { kind: 'on-line', point: [10, 20], lineId: 'top', relationId: 'on-top' } }, construction: false, createId: idFactory(), existingGraph });
    if (line.kind !== 'line') throw new Error('Expected line roles.');
    expect(line.geometry.points).toEqual([{ id: line.pointIds.start, position: [0, 20] }, { id: line.pointIds.end, position: [10, 20] }]);
    expect(line.geometry.entities).toEqual([{ id: expect.any(String), kind: 'line', construction: false, startPointId: line.pointIds.start, endPointId: line.pointIds.end }]);
    expect(line.geometry.relations).toEqual([{ id: 'join-a', kind: 'coincident', pointIds: [line.pointIds.start, 'a'] },
      { id: 'on-top', kind: 'point-on-line', pointId: line.pointIds.end, lineId: 'top' }]);
    const arc = createCadFreshSketchDrawing({ drawing: { kind: 'arc', start: { kind: 'fixed', point: [0, 0], targetId: '@origin', relationIds: ['at-x', 'at-y'] },
      end: { kind: 'position', point: [20, 0] }, through: [10, -10] }, construction: true, createId: idFactory(), existingGraph });
    if (arc.kind !== 'arc') throw new Error('Expected arc roles.');
    expect(arc.geometry.points.find(point => point.id === arc.pointIds.center)?.position).toEqual([10, 0]);
    expect(arc.geometry.entities).toEqual([{ id: expect.any(String), kind: 'arc', construction: true, centerPointId: arc.pointIds.center,
      startPointId: arc.pointIds.start, endPointId: arc.pointIds.end, direction: 'ccw' }]);
    expect(arc.geometry.relations).toEqual([{ id: 'at-x', kind: 'fixed-axis', pointId: arc.pointIds.start, axis: 'x', value: 0 },
      { id: 'at-y', kind: 'fixed-axis', pointId: arc.pointIds.start, axis: 'y', value: 0 }]);
    // A through point picked on other geometry only shapes the arc, and collinear picks are rejected before any ID is used.
    let allocations = 0;
    expect(() => createCadFreshSketchDrawing({ drawing: { kind: 'arc', start: { kind: 'position', point: [0, 0] }, end: { kind: 'position', point: [20, 0] }, through: [10, 0] },
      construction: false, createId: () => `unused-${++allocations}` })).toThrow();
    expect(allocations).toBe(0); expect(JSON.stringify(existingGraph)).toBe(before);
  });

  it('keeps an open polyline open, shares an exact closing return and rejects a return attached elsewhere', () => {
    const existingGraph = parseCadSketchGraph({ points: [{ id: 'anchor', position: [0, 0] }, { id: 'other', position: [5, 5] }], entities: [], relations: [] });
    const start: CadFreshSketchPick = { kind: 'coincident', point: [0, 0], sourcePointId: 'anchor', relationId: 'join-start' };
    const steps = [{ kind: 'line', end: { kind: 'position', point: [20, 0] } }, { kind: 'arc', end: { kind: 'position', point: [20, 10] }, through: [25, 5] }] as const;
    const open = createCadFreshSketchDrawing({ drawing: { kind: 'polyline', start, steps, closed: false }, construction: false, createId: idFactory(), existingGraph });
    if (open.kind !== 'polyline') throw new Error('Expected polyline roles.');
    expect(open.geometry.entities.map(entity => entity.kind)).toEqual(['line', 'arc']);
    expect(open.pointIds).toHaveLength(3); expect(open.geometry.points).toHaveLength(4);
    const arc = open.geometry.entities[1];
    if (arc.kind !== 'arc') throw new Error('Expected arc.');
    expect([arc.startPointId, arc.endPointId]).toEqual(open.pointIds.slice(1));
    expect(open.geometry.points.find(point => point.id === arc.centerPointId)?.position).toEqual([20, 5]);
    // Clicking the start again closes on the start point itself and keeps only its own attachment.
    for (const end of [{ kind: 'position', point: [0, 0] }, { ...start, relationId: 'join-again' }] as const) {
      const closed = createCadFreshSketchDrawing({ drawing: { kind: 'polyline', start, steps: [...steps, { kind: 'line', end }], closed: true }, construction: false, createId: idFactory(), existingGraph });
      if (closed.kind !== 'polyline') throw new Error('Expected polyline roles.');
      expect(closed.pointIds.at(-1)).toBe(closed.pointIds[0]); expect(closed.geometry.entities).toHaveLength(3);
      expect(closed.geometry.relations).toEqual([{ id: 'join-start', kind: 'coincident', pointIds: [closed.pointIds[0], 'anchor'] }]);
    }
    // Without an exact return, a closed polyline gets one more line back to its start.
    const bridged = createCadFreshSketchDrawing({ drawing: { kind: 'polyline', start, steps, closed: true }, construction: false, createId: idFactory(), existingGraph });
    expect(bridged.geometry.entities.map(entity => entity.kind)).toEqual(['line', 'arc', 'line']);
    let allocations = 0;
    expect(() => createCadFreshSketchDrawing({ drawing: { kind: 'polyline', start: { kind: 'position', point: [5, 5] }, steps: [...steps,
      { kind: 'line', end: { kind: 'coincident', point: [5, 5], sourcePointId: 'other', relationId: 'join-other' } }], closed: true },
    construction: false, createId: () => `unused-${++allocations}`, existingGraph })).toThrowError(expect.objectContaining({ code: 'ambiguous-path-closure' }));
    expect(allocations).toBe(0);
  });

  it('adds inferred horizontal and vertical relations after every attachment, only on exactly level or plumb drawn lines', () => {
    const existingGraph = parseCadSketchGraph({ points: [{ id: 'anchor', position: [0, 0] }, { id: 'corner', position: [20, 10] }], entities: [], relations: [] });
    const start: CadFreshSketchPick = { kind: 'coincident', point: [0, 0], sourcePointId: 'anchor', relationId: 'join-start' };
    const square = [
      { kind: 'line', end: { kind: 'position', point: [20, 0] }, inferred: { kind: 'horizontal', relationId: 'level' } },
      { kind: 'line', end: { kind: 'coincident', point: [20, 10], sourcePointId: 'corner', relationId: 'join-corner' }, inferred: { kind: 'vertical', relationId: 'plumb' } },
      { kind: 'line', end: { kind: 'position', point: [0, 10] } }
    ] as const;
    const created = createCadFreshSketchDrawing({ drawing: { kind: 'polyline', start, steps: square, closed: true }, construction: false, createId: idFactory(), existingGraph });
    if (created.kind !== 'polyline') throw new Error('Expected polyline roles.');
    const [first, second, third] = created.pointIds;
    expect(created.geometry.relations).toEqual([{ id: 'join-start', kind: 'coincident', pointIds: [first, 'anchor'] }, { id: 'join-corner', kind: 'coincident', pointIds: [third, 'corner'] },
      { id: 'level', kind: 'horizontal', pointIds: [first, second] }, { id: 'plumb', kind: 'vertical', pointIds: [second, third] }]);
    let allocations = 0;
    const fails = (steps: Parameters<typeof polylineWith>[0], closed = false) => () =>
      createCadFreshSketchDrawing({ drawing: polylineWith(steps, closed), construction: false, createId: () => `unused-${++allocations}`, existingGraph });
    expect(fails([{ kind: 'line', end: { kind: 'position', point: [20, 1e-9] }, inferred: { kind: 'horizontal', relationId: 'off' } }]))
      .toThrowError(expect.objectContaining({ code: 'invalid-fresh-sketch-inference' }));
    expect(fails([{ kind: 'line', end: { kind: 'position', point: [20, 0] }, inferred: { kind: 'vertical', relationId: 'off' } }]))
      .toThrowError(expect.objectContaining({ code: 'invalid-fresh-sketch-inference' }));
    // A line returning to the start closes the polyline and never keeps one, although the same open return may.
    const back = [{ kind: 'line', end: { kind: 'position', point: [0, 10] } }, { kind: 'line', end: { kind: 'position', point: [0, 0] }, inferred: { kind: 'vertical', relationId: 'closing' } }] as const;
    expect(fails(back, true)).toThrowError(expect.objectContaining({ code: 'invalid-fresh-sketch-inference' }));
    expect(allocations).toBe(0);
    const open = createCadFreshSketchDrawing({ drawing: polylineWith([{ kind: 'line', end: { kind: 'position', point: [10, 10] } }, ...back], false), construction: false, createId: idFactory(), existingGraph });
    expect(open.geometry.relations.map(relation => relation.id)).toEqual(['closing']);
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
    polyline([{ kind: 'position', point: [0, 0] }, { kind: 'position', point: [20, 0] }, { kind: 'position', point: [20, 10] }], true),
    { kind: 'line', start: { kind: 'position', point: [0, 0] }, end: { kind: 'position', point: [20, 10] } },
    { kind: 'slot', first: { kind: 'position', point: [0, 0] }, second: { kind: 'position', point: [20, 10] }, width: 4 }
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
    polyline([{ kind: 'position', point: [0, 0] }, { kind: 'position', point: [5, 0] }, { kind: 'position', point: [5, 0] }, { kind: 'position', point: [0, 5] }], true),
    polyline([{ kind: 'position', point: [0, 0] }, { kind: 'position', point: [0, 0] }], true),
    { kind: 'line', start: { kind: 'position', point: [3, 4] }, end: { kind: 'position', point: [3, 4] } },
    { kind: 'polyline', start: { kind: 'position', point: [0, 0] }, steps: [], closed: false },
    { kind: 'slot', first: { kind: 'position', point: [3, 4] }, second: { kind: 'position', point: [3, 4] }, width: 4 },
    { kind: 'slot', first: { kind: 'position', point: [0, 0] }, second: { kind: 'position', point: [10, 0] }, width: 0 }
  ])('rejects degenerate authored geometry before consuming IDs: %j', drawing => {
    let allocations = 0;
    expect(() => createCadFreshSketchDrawing({ drawing, construction: false, createId: () => `unused-${++allocations}` })).toThrow();
    expect(allocations).toBe(0);
  });

  it('places fresh points on an existing line or the plane origin and axes with removable relations', () => {
    const existingGraph = parseCadSketchGraph({ points: [{ id: 'a', position: [0, 20] }, { id: 'b', position: [40, 20] }],
      entities: [{ id: 'top', kind: 'line', construction: true, startPointId: 'a', endPointId: 'b' }], relations: [] });
    const drawing = polyline([
      { kind: 'fixed', point: [0, 0], targetId: '@origin', relationIds: ['at-x', 'at-y'] },
      { kind: 'fixed', point: [30, 0], targetId: '@h', relationIds: ['on-x'] },
      { kind: 'on-line', point: [25, 20], lineId: 'top', relationId: 'on-top' }], true);
    const created = createCadFreshSketchDrawing({ drawing, construction: false, createId: idFactory(), existingGraph });
    if (created.kind !== 'polyline') throw new Error('Expected polyline role map.');
    const [origin, axis, top] = created.pointIds;
    expect(created.geometry.relations.filter(relation => !relation.id.startsWith('fresh-'))).toEqual([
      { id: 'at-x', kind: 'fixed-axis', pointId: origin, axis: 'x', value: 0 }, { id: 'at-y', kind: 'fixed-axis', pointId: origin, axis: 'y', value: 0 },
      { id: 'on-x', kind: 'fixed-axis', pointId: axis, axis: 'y', value: 0 }, { id: 'on-top', kind: 'point-on-line', pointId: top, lineId: 'top' }]);
    const source = parseCadDocument({ ...createCadDocument(), schemaVersion: 2, features: [{ id: 'sketch', kind: 'sketch', name: 'Sketch', suppressed: false, plane: 'XY', offset: 0, profiles: [], graph: existingGraph }] });
    expect(() => applyCadEdits(source, [{ kind: 'append-sketch-entities', sketchId: 'sketch', geometry: created.geometry }])).not.toThrow();
    expect(() => createCadFreshSketchDrawing({ drawing: { kind: 'circle', center: { kind: 'fixed', point: [0, .5], targetId: '@v', relationIds: ['r'] }, radius: 2 },
      construction: false, createId: idFactory(), existingGraph })).not.toThrow();
    expect(() => createCadFreshSketchDrawing({ drawing: { kind: 'circle', center: { kind: 'fixed', point: [0, .5], targetId: '@origin', relationIds: ['r', 's'] }, radius: 2 },
      construction: false, createId: idFactory(), existingGraph })).toThrow('must lie exactly on it');
    expect(() => createCadFreshSketchDrawing({ drawing: { kind: 'circle', center: { kind: 'on-line', point: [5, 20], lineId: 'gone', relationId: 'r' }, radius: 2 },
      construction: false, createId: idFactory(), existingGraph })).toThrow('A picked line changed or no longer exists');
  });
  it('places fresh points along an existing arc or circle with removable point-on-curve relations', () => {
    const existingGraph = parseCadSketchGraph({ points: [{ id: 'o', position: [0, 0] }, { id: 's', position: [10, 0] }, { id: 'e', position: [0, 10] }, { id: 'c', position: [30, 0] }],
      entities: [{ id: 'bow', kind: 'arc', construction: false, centerPointId: 'o', startPointId: 's', endPointId: 'e', direction: 'ccw' },
        { id: 'ring', kind: 'circle', construction: true, centerPointId: 'c', radius: 5 },
        { id: 'chord', kind: 'line', construction: true, startPointId: 's', endPointId: 'c' }], relations: [] });
    const line = createCadFreshSketchDrawing({ drawing: { kind: 'line', start: { kind: 'on-curve', point: [6, 8], curveId: 'bow', relationId: 'on-bow' },
      end: { kind: 'on-curve', point: [34, 3], curveId: 'ring', relationId: 'on-ring' } }, construction: false, createId: idFactory(), existingGraph });
    if (line.kind !== 'line') throw new Error('Expected line roles.');
    expect(line.geometry.relations).toEqual([{ id: 'on-bow', kind: 'point-on-curve', pointId: line.pointIds.start, curveId: 'bow' },
      { id: 'on-ring', kind: 'point-on-curve', pointId: line.pointIds.end, curveId: 'ring' }]);
    const source = parseCadDocument({ ...createCadDocument(), schemaVersion: 2, features: [{ id: 'sketch', kind: 'sketch', name: 'Sketch', suppressed: false, plane: 'XY', offset: 0, profiles: [], graph: existingGraph }] });
    expect(() => applyCadEdits(source, [{ kind: 'append-sketch-entities', sketchId: 'sketch', geometry: line.geometry }])).not.toThrow();
    for (const curveId of ['gone', 'chord'])
      expect(() => createCadFreshSketchDrawing({ drawing: { kind: 'circle', center: { kind: 'on-curve', point: [6, 8], curveId, relationId: 'r' }, radius: 2 },
        construction: false, createId: idFactory(), existingGraph })).toThrow('A picked arc or circle changed or no longer exists');
  });
  it('builds a slot from two tangent lines and equal end arcs about the two picked centers', () => {
    const existingGraph = parseCadSketchGraph({ points: [{ id: 'anchor', position: [12, 8] }], entities: [], relations: [] });
    const created = createCadFreshSketchDrawing({ drawing: { kind: 'slot', first: { kind: 'coincident', point: [12, 8], sourcePointId: 'anchor', relationId: 'join-first' },
      second: { kind: 'position', point: [12, 28] }, width: 10 }, construction: false, createId: idFactory(), existingGraph });
    if (created.kind !== 'slot') throw new Error('Expected slot role map.');
    const { geometry, centerPointIds: [first, second] } = created;
    expect(geometry.points).toHaveLength(6);
    expect(geometry.entities.map(entity => [entity.kind, entity.construction])).toEqual([['line', false], ['arc', false], ['line', false], ['arc', false]]);
    expect(geometry.entities.filter(entity => entity.kind === 'arc').map(entity => entity.centerPointId)).toEqual([second, first]);
    expect(geometry.relations.map(relation => relation.kind)).toEqual(['tangent-joint', 'tangent-joint', 'tangent-joint', 'tangent-joint', 'equal-radius', 'coincident']);
    expect(geometry.relations.at(-1)).toEqual({ id: 'join-first', kind: 'coincident', pointIds: [first, 'anchor'] });
    expect(geometry.points.find(point => point.id === first)?.position).toEqual([12, 8]);
    expect(geometry.points.find(point => point.id === second)?.position).toEqual([12, 28]);
    const source = parseCadDocument({ ...createCadDocument(), schemaVersion: 2, features: [{ id: 'sketch', kind: 'sketch', name: 'Sketch', suppressed: false, plane: 'XY', offset: 0, profiles: [], graph: existingGraph }] });
    const drawn = applyCadEdits(source, [{ kind: 'append-sketch-entities', sketchId: 'sketch', geometry }]);
    // Centers 20 mm apart, 10 mm wide: a 20 x 10 band between the centers plus one full 5 mm circle.
    expect(measureCadSketch(drawn, 'sketch').materialAreaMm2).toBeCloseTo(20 * 10 + Math.PI * 25, 6);
    const guide = createCadFreshSketchDrawing({ drawing: { kind: 'slot', first: { kind: 'position', point: [0, 0] }, second: { kind: 'position', point: [10, 0] }, width: 2 }, construction: true, createId: idFactory() });
    expect(guide.geometry.entities.every(entity => entity.construction)).toBe(true);
    // Far from the origin, rounding alone turns the short tangent supports of a rotated slot by more than 1e-12 radians.
    const far = createCadFreshSketchDrawing({ drawing: { kind: 'slot', first: { kind: 'position', point: [100000, 100000] }, second: { kind: 'position', point: [100012, 100020] }, width: 10 }, construction: false, createId: idFactory() });
    expect(far.geometry.relations.filter(relation => relation.kind === 'tangent-joint')).toHaveLength(4);
  });
});
