import { describe, expect, it } from 'vitest';
import { createCadFreshSketchDrawing } from '../cadFreshSketchGraph';
import { parseCadSketchGraph, type CadSketchGraph, type CadSketchGraphRelation } from '../cadSketchGraph';
import { cadSketchRelationPlacement } from '../cadSketchRelationPlacement';
import { translateCadSketchGraph } from '../cadSketchTranslation';

/** A slot from its first arc center, 30 mm long between centers and 10 mm wide; `centerPointId` is the first center. */
function slot(first: readonly [number, number], degrees = 0) {
  let next = 0, angle = degrees * Math.PI / 180;
  const created = createCadFreshSketchDrawing({ drawing: { kind: 'slot', first: { kind: 'position', point: first },
    second: { kind: 'position', point: [first[0] + 30 * Math.cos(angle), first[1] + 30 * Math.sin(angle)] }, width: 10 },
  construction: false, createId: () => `slot-${++next}` });
  if (created.kind !== 'slot') throw new Error('Expected slot role map.');
  return { ...created, centerPointId: created.centerPointIds[0], otherCenterPointId: created.centerPointIds[1] };
}
const atOrigin = (pointId: string): CadSketchGraphRelation[] => (['x', 'y'] as const).map(axis => ({ id: `origin-${axis}`, kind: 'fixed-axis', pointId, axis, value: 0 }));
const withCircle = (graph: CadSketchGraph) => parseCadSketchGraph({ ...graph, points: [...graph.points, { id: 'hole', position: [-30, 4] }],
  entities: [...graph.entities, { id: 'hole-edge', kind: 'circle', construction: false, centerPointId: 'hole', radius: 2 }] });

describe('carrying free sketch shapes onto new positional relations', () => {
  it('carries a whole slot when one of its arc centers goes to the origin', () => {
    const { geometry, centerPointId } = slot([12, 8]), graph = withCircle(geometry);
    expect(cadSketchRelationPlacement(graph, atOrigin(centerPointId))).toEqual({ translation: [-12, -8], selections:
      geometry.entities.map(entity => ({ kind: 'entity', id: entity.id })) });
    expect(cadSketchRelationPlacement(graph, [atOrigin(centerPointId)[1]])?.translation).toEqual([0, -8]);
    expect(cadSketchRelationPlacement(graph, [{ id: 'join', kind: 'coincident', pointIds: [centerPointId, 'hole'] }])?.translation).toEqual([-42, -4]);
  });

  it('moves a slot drawn at any angle, whose half-circle ends sit on the arc branch boundary', () => {
    for (let degrees = 0; degrees < 360; degrees++) {
      const { geometry, centerPointId } = slot([12.3, 8.7], degrees), placement = cadSketchRelationPlacement(geometry, atOrigin(centerPointId));
      if (!placement) throw new Error(`Expected a placement at ${degrees} degrees.`);
      const moved = translateCadSketchGraph({ graph: geometry, parameters: {}, ...placement });
      const center = moved.points.find(point => point.id === centerPointId)?.position;
      expect(Math.hypot(Number(center?.[0]), Number(center?.[1]))).toBeLessThan(1e-12);
    }
  });

  it('leaves anchored shapes, shapes joined to their target and met targets to the solver', () => {
    const { geometry, centerPointId, otherCenterPointId } = slot([12, 8]), edge = geometry.entities.find(entity => entity.kind === 'line');
    if (edge?.kind !== 'line') throw new Error('Expected a slot side.');
    const anchored = parseCadSketchGraph({ ...geometry, relations: [...geometry.relations, { id: 'pin', kind: 'fixed-axis', pointId: edge.startPointId, axis: 'x', value: 2 }] });
    expect(cadSketchRelationPlacement(anchored, atOrigin(centerPointId))).toBeNull();
    expect(cadSketchRelationPlacement(geometry, [{ id: 'join', kind: 'coincident', pointIds: [centerPointId, otherCenterPointId] }])).toBeNull();
    expect(cadSketchRelationPlacement(slot([0, 0]).geometry, atOrigin(slot([0, 0]).centerPointId))).toBeNull();
    expect(cadSketchRelationPlacement(geometry, [{ id: 'level', kind: 'horizontal', pointIds: [centerPointId, otherCenterPointId] }])).toBeNull();
    // One geometry move names at most 64 points and edges, so a larger connected shape is left to the solver.
    const chain = (edges: number) => parseCadSketchGraph({ points: Array.from({ length: edges + 1 }, (_, index) => ({ id: `p${index}`, position: [index + 1, 1] })),
      entities: Array.from({ length: edges }, (_, index) => ({ id: `e${index}`, kind: 'line', construction: false, startPointId: `p${index}`, endPointId: `p${index + 1}` })), relations: [] });
    expect(cadSketchRelationPlacement(chain(64), atOrigin('p0'))?.selections).toHaveLength(64);
    expect(cadSketchRelationPlacement(chain(65), atOrigin('p0'))).toBeNull();
  });

  it('carries only the measured shape when a reference dimension reads across to another', () => {
    const graph = parseCadSketchGraph({ points: [{ id: 'a', position: [10, 5] }, { id: 'b', position: [30, 5] }],
      entities: [{ id: 'ring-a', kind: 'circle', construction: false, centerPointId: 'a', radius: 2 }, { id: 'ring-b', kind: 'circle', construction: false, centerPointId: 'b', radius: 2 }],
      relations: [{ id: 'gap', kind: 'reference-dimension', measurement: { kind: 'point-distance', pointIds: ['a', 'b'] } }] });
    expect(cadSketchRelationPlacement(graph, [atOrigin('a')[0]])).toEqual({ translation: [-10, 0], selections: [{ kind: 'entity', id: 'ring-a' }] });
  });
});
