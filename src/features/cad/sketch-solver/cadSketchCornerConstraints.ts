import type { SketchPrimitive } from '@salusoft89/planegcs/dist/sketch/sketch_primitive.js';
import type { CadSketchCornerRelation, CadSketchGraph } from '@/domain/cad/cadSketchGraph';
import { resolveCadSketchCornerTopology } from '@/domain/cad/cadSketchCornerGeometry';
import { evaluateCadScalar } from '@/domain/cad/cadExpression';

/** Topology and drivers only; input coordinates may be an unsolved parameter edit. */
export function compileCadSketchCornerConstraints(graph: CadSketchGraph, relation: CadSketchCornerRelation,
  parameters: Readonly<Record<string, number>>): SketchPrimitive[] {
  const topology = resolveCadSketchCornerTopology(graph, relation), [a, b] = topology.lines, [p, q] = topology.trimPointIds;
  const objects: SketchPrimitive[] = [
    { id: `$corner-support-a:${relation.id}`, type: 'point_on_line_ppp', p_id: relation.pointId, lp1_id: a.startPointId, lp2_id: a.endPointId },
    { id: `$corner-support-b:${relation.id}`, type: 'point_on_line_ppp', p_id: relation.pointId, lp1_id: b.startPointId, lp2_id: b.endPointId }
  ];
  if (relation.kind === 'fillet-corner') {
    if (topology.entity.kind !== 'arc') throw new Error('A fillet requires its referenced arc.');
    const center = topology.entity.centerPointId;
    objects.push(
      { id: `$corner-tangent-a:${relation.id}`, type: 'perpendicular_pppp', l1p1_id: a.startPointId, l1p2_id: a.endPointId, l2p1_id: center, l2p2_id: p },
      { id: `$corner-tangent-b:${relation.id}`, type: 'perpendicular_pppp', l1p1_id: b.startPointId, l1p2_id: b.endPointId, l2p1_id: center, l2p2_id: q },
      { id: `$corner-radius:${relation.id}`, type: 'p2p_distance', p1_id: center, p2_id: p, distance: evaluateCadScalar(relation.value, parameters) }
    );
  } else objects.push(
    { id: `$corner-setback-a:${relation.id}`, type: 'p2p_distance', p1_id: relation.pointId, p2_id: p, distance: evaluateCadScalar(relation.values[0], parameters) },
    { id: `$corner-setback-b:${relation.id}`, type: 'p2p_distance', p1_id: relation.pointId, p2_id: q, distance: evaluateCadScalar(relation.values[1], parameters) }
  );
  return objects;
}
