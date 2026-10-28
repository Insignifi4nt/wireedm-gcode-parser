import { describe, expect, it } from 'vitest';
import { createCadFreshSketchDrawing, type CadFreshSketchPick } from '../cadFreshSketchGraph';
import { checkCadSketchGraph, parseCadSketchGraph, type CadSketchGraph } from '../cadSketchGraph';
import { compileCadSketchGraph } from '../cadSketchGraphGeometry';
import { prepareCadSketchTrim, trimCadSketchEntity } from '../cadSketchTrimExtend';

const empty: CadSketchGraph = { points: [], entities: [], relations: [] };
const at = (x: number, y: number): CadFreshSketchPick => ({ kind: 'position', point: [x, y] });

function rectangle(graph: CadSketchGraph, first: CadFreshSketchPick, opposite: CadFreshSketchPick, prefix: string): CadSketchGraph {
  let next = 0;
  const created = createCadFreshSketchDrawing({ drawing: { kind: 'rectangle', first, opposite }, construction: false,
    createId: () => `${prefix}${++next}`, existingGraph: graph });
  return parseCadSketchGraph({ points: [...graph.points, ...created.geometry.points], entities: [...graph.entities, ...created.geometry.entities],
    relations: [...graph.relations, ...created.geometry.relations] });
}
/** The line through a sketch position, with the clicked parameter along it. */
function lineAt(graph: CadSketchGraph, x: number, y: number, except?: string) {
  for (const segment of compileCadSketchGraph(graph, {}).segments) {
    if (segment.kind !== 'line' || segment.id === except) continue;
    const dx = segment.end.x - segment.start.x, dy = segment.end.y - segment.start.y;
    const t = ((x - segment.start.x) * dx + (y - segment.start.y) * dy) / (dx * dx + dy * dy);
    if (t > 0 && t < 1 && Math.hypot(segment.start.x + t * dx - x, segment.start.y + t * dy - y) < 1e-9) return { entityId: segment.id, parameter: t };
  }
  throw new Error(`No line at ${x}, ${y}.`);
}
const pointAt = (graph: CadSketchGraph, x: number, y: number) => graph.points.find(point => point.position[0] === x && point.position[1] === y)!.id;

describe('Trim between overlapping and touching edges', () => {
  it('trims each piece of corner-snapped rectangles whose edges overlap', () => {
    const first = rectangle(empty, at(0, 0), at(100, 50), 'a');
    const graph = rectangle(first, { kind: 'coincident', point: [100, 50], sourcePointId: pointAt(first, 100, 50), relationId: 'snap' }, at(150, 30), 'b');
    const shared = lineAt(graph, 100, 40), covered = lineAt(graph, 100, 40, shared.entityId);
    // The longer edge loses only the stretch the other rectangle's edge also covers.
    const end = prepareCadSketchTrim({ graph, parameters: {}, ...shared });
    if (end.target.kind !== 'end') throw new Error('Expected end trim.');
    const corner = pointAt(graph, 100, 30);
    expect(end.target.boundary).toMatchObject({ position: [100, 30], endpointPointId: corner });
    expect(end.target.removedRelationIds).toBeUndefined();
    const trimmed = trimCadSketchEntity({ graph, parameters: {}, trim: { ...end.target, cutPointId: corner } }).graph;
    const edge = compileCadSketchGraph(trimmed, {}).segments.find(segment => segment.id === shared.entityId);
    expect(edge?.kind === 'line' && [edge.start, edge.end].map(point => [point.x, point.y]).sort((a, b) => a[1] - b[1])).toEqual([[100, 0], [100, 30]]);
    expect(checkCadSketchGraph(trimmed, {})).toEqual([]);
    // The covered edge has no crossing of its own, so Trim removes it whole and only its own vertical relation goes.
    const deletion = prepareCadSketchTrim({ graph, parameters: {}, ...covered });
    expect(deletion.target).toMatchObject({ kind: 'delete', entityId: covered.entityId, removedRelationIds: [expect.any(String)] });
    if (deletion.target.kind !== 'delete') throw new Error('Expected deletion.');
    const removed = trimCadSketchEntity({ graph, parameters: {}, trim: deletion.target }).graph;
    expect(removed.relations.find(relation => relation.id === 'snap')).toBeDefined();
    expect(removed.entities).toHaveLength(graph.entities.length - 1); expect(removed.points).toEqual(graph.points);
    // The top edge only touches the other rectangle at its own corner, so Trim removes it whole.
    expect(prepareCadSketchTrim({ graph, parameters: {}, ...lineAt(graph, 50, 50) }).target.kind).toBe('delete');
  });

  it('cuts at shared and touching corners of rotated edges despite rounding', () => {
    for (const degrees of [17, 30, 61]) {
      const turn = degrees * Math.PI / 180, rotate = (x: number, y: number) => [x * Math.cos(turn) - y * Math.sin(turn), x * Math.sin(turn) + y * Math.cos(turn)];
      // A rotated triangle whose base is crossed by a fence and touched by a spur ending on it.
      const graph = parseCadSketchGraph({ points: [{ id: 'p', position: rotate(0, 0) }, { id: 'q', position: rotate(40, 0) }, { id: 'r', position: rotate(20, 30) },
        { id: 'f0', position: rotate(10, -5) }, { id: 'f1', position: rotate(10, 5) }, { id: 's0', position: rotate(30, 0) }, { id: 's1', position: rotate(30, -10) }], entities: [
        { id: 'pq', kind: 'line', construction: false, startPointId: 'p', endPointId: 'q' },
        { id: 'qr', kind: 'line', construction: false, startPointId: 'q', endPointId: 'r' },
        { id: 'rp', kind: 'line', construction: false, startPointId: 'r', endPointId: 'p' },
        { id: 'fence', kind: 'line', construction: true, startPointId: 'f0', endPointId: 'f1' },
        { id: 'spur', kind: 'line', construction: true, startPointId: 's0', endPointId: 's1' }], relations: [] });
      const start = prepareCadSketchTrim({ graph, parameters: {}, entityId: 'pq', parameter: .1 });
      expect(start.target, `${degrees}°`).toMatchObject({ kind: 'end', end: 'start', boundary: { entityId: 'fence' } });
      const middle = prepareCadSketchTrim({ graph, parameters: {}, entityId: 'pq', parameter: .5 });
      expect(middle.target, `${degrees}°`).toMatchObject({ kind: 'middle', boundaries: [{ entityId: 'fence' }, { entityId: 'spur', endpointPointId: 's0' }] });
    }
  });

  it('keeps a fresh cut on the cutting line, and refuses that relation for a curved cutter', () => {
    const graph = parseCadSketchGraph({ points: [{ id: 'a', position: [0, 0] }, { id: 'b', position: [20, 0] }, { id: 'c', position: [5, -5] },
      { id: 'd', position: [5, 5] }, { id: 'o', position: [15, 0] }], entities: [
      { id: 'edge', kind: 'line', construction: false, startPointId: 'a', endPointId: 'b' },
      { id: 'fence', kind: 'line', construction: false, startPointId: 'c', endPointId: 'd' },
      { id: 'ring', kind: 'circle', construction: false, centerPointId: 'o', radius: 2 }], relations: [] });
    const end = prepareCadSketchTrim({ graph, parameters: {}, entityId: 'edge', parameter: .1 });
    if (end.target.kind !== 'end' || !('attachLineId' in end)) throw new Error('Expected end trim.');
    expect(end.attachLineId).toBe('fence');
    const attached = trimCadSketchEntity({ graph, parameters: {}, trim: { ...end.target, cutPointId: 'cut', attachRelationId: 'on-fence' } }).graph;
    expect(attached.relations).toEqual([{ id: 'on-fence', kind: 'point-on-line', pointId: 'cut', lineId: 'fence' }]);
    expect(checkCadSketchGraph(attached, {})).toEqual([]);
    const middle = prepareCadSketchTrim({ graph, parameters: {}, entityId: 'edge', parameter: .5 });
    if (middle.target.kind !== 'middle' || !('attachLineIds' in middle)) throw new Error('Expected middle trim.');
    expect(middle.attachLineIds).toEqual(['fence', null]);
    const request = { ...middle.target, cutPointIds: ['m0', 'm1'] as [string, string], newEntityId: 'after', supportRelationId: 'support' };
    expect(trimCadSketchEntity({ graph, parameters: {}, trim: { ...request, attachRelationIds: ['on-fence', null] } }).graph.relations)
      .toContainEqual({ id: 'on-fence', kind: 'point-on-line', pointId: 'm0', lineId: 'fence' });
    expect(() => trimCadSketchEntity({ graph, parameters: {}, trim: { ...request, attachRelationIds: ['on-fence', 'on-ring'] } }))
      .toThrowError(expect.objectContaining({ code: 'invalid-sketch-trim-attachment' }));
  });
});
