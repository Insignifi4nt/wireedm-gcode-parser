import { evaluateCadScalar } from '../../../../domain/cad/cadExpression';
import { cadSketchExternalReferenceComponents } from '../../../../domain/cad/cadSketchExternalReferences';
import { resolveCadSketchCornerTopology } from '../../../../domain/cad/cadSketchCornerGeometry';
import { cadSketchLineDirection, resolveCadSketchLinePair } from '../../../../domain/cad/cadSketchLineRelations';
import { cadSketchRadialTarget, resolveCadSketchRadialEntity } from '../../../../domain/cad/cadSketchRadialRelations';
import { resolveCadSketchRadiusPair } from '../../../../domain/cad/cadSketchEqualRelations';
import { cadSketchAngleTarget, resolveCadSketchAngleRays } from '../../../../domain/cad/cadSketchAngleRelations';
import { resolveCadSketchMidpointOperands } from '../../../../domain/cad/cadSketchMidpointRelations';
import { resolveCadSketchSymmetryOperands } from '../../../../domain/cad/cadSketchSymmetryRelations';
import { resolveCadSketchPointOnLineOperands } from '../../../../domain/cad/cadSketchPointOnLineRelations';
import { resolveCadSketchTangentJoint } from '../../../../domain/cad/cadSketchTangentRelations';
import { cadSketchLinearPatternInstances } from '../../../../domain/cad/cadSketchLinearPattern';
import type { Point2 } from '../../../../domain/path-intel/types';
import type { CadSketchSolveInput } from '../cadSketchSolverTypes';
import type { CadSketchEquation, CadSketchEquationKind, CadSketchEquationModel } from './cadSketchEquationModel';

interface Segment { readonly startPointId: string; readonly endPointId: string }

/**
 * The scalar equations of a parsed solve input, with the same relations, operand order,
 * source identities and fixed values as the PlaneGCS compilation had, which the frozen PlaneGCS corpus
 * checks. A drag target becomes two temporary value equations on the dragged point, last, as
 * PlaneGCS's temporary coordinates were.
 */
export function compileCadSketchEquations(input: CadSketchSolveInput): CadSketchEquationModel {
  const graph = input.graph, scalar = (value: number | string) => evaluateCadScalar(value, input.parameters);
  const owned = cadSketchExternalReferenceComponents(graph);
  const values: number[] = [], fixed: boolean[] = [], equations: CadSketchEquation[] = [];
  const pointParameters = new Map<string, number>(), radiusParameters = new Map<string, number>(), numericPoints = new Map<string, Point2>();
  for (const point of graph.points) {
    pointParameters.set(point.id, values.length);
    const position = { x: scalar(point.position[0]), y: scalar(point.position[1]) }; numericPoints.set(point.id, position);
    values.push(position.x, position.y);
    fixed.push(typeof point.position[0] === 'string' || owned.pointIds.has(point.id), typeof point.position[1] === 'string' || owned.pointIds.has(point.id));
  }
  for (const entity of graph.entities) if (entity.kind === 'circle') {
    radiusParameters.set(entity.id, values.length);
    values.push(scalar(entity.radius)); fixed.push(typeof entity.radius === 'string' || owned.circleIds.has(entity.id));
  }
  const x = (pointId: string) => pointParameters.get(pointId)!, y = (pointId: string) => x(pointId) + 1;
  const point = (pointId: string) => [x(pointId), y(pointId)];
  const radius = (circleId: string) => radiusParameters.get(circleId)!;
  const line = (subject: Segment) => [...point(subject.startPointId), ...point(subject.endPointId)];
  // Each equation is its own constraint, as in PlaneGCS, except where a two-equation constraint passes its tag.
  let tags = 0;
  const add = (kind: CadSketchEquationKind, operands: readonly number[], value: number, sourceId: string, tag = tags++) => equations.push({ kind, operands, value, sourceId, tag });
  const directed = (subject: Parameters<typeof cadSketchLineDirection>[0], message: string) => {
    if (!cadSketchLineDirection(subject, numericPoints)) throw new Error(message);
  };
  for (const entity of graph.entities) if (entity.kind === 'arc')
    add('equal-length', [...line({ startPointId: entity.centerPointId, endPointId: entity.startPointId }),
      ...line({ startPointId: entity.centerPointId, endPointId: entity.endPointId })], 0, entity.id);
  for (const relation of graph.relations) {
    const id = relation.id;
    switch (relation.kind) {
      case 'linear-pattern': {
        const axis = relation.direction.endsWith('x') ? 0 : 1, sign = relation.direction.startsWith('-') ? -1 : 1;
        for (const member of cadSketchLinearPatternInstances(relation).filter(member => member.active)) {
          for (const coordinate of [0, 1]) add('difference', [point(relation.seed.centerPointId)[coordinate], point(member.pointId)[coordinate]],
            coordinate === axis ? sign * member.index * scalar(relation.spacing) : 0, id);
          add('difference', [radius(relation.seed.entityId), radius(member.entityId)], 0, id);
        }
        break;
      }
      case 'reference-dimension': case 'external-reference': break;
      case 'coincident': {
        const tag = tags++;
        for (const coordinate of [0, 1]) add('difference', [point(relation.pointIds[0])[coordinate], point(relation.pointIds[1])[coordinate]], 0, id, tag);
        break;
      }
      case 'horizontal': add('difference', [y(relation.pointIds[0]), y(relation.pointIds[1])], 0, id); break;
      case 'vertical': add('difference', [x(relation.pointIds[0]), x(relation.pointIds[1])], 0, id); break;
      case 'midpoint': {
        const { line: segment } = resolveCadSketchMidpointOperands(graph, relation);
        const tag = tags++;
        for (const coordinate of [0, 1]) add('midpoint', [point(segment.startPointId)[coordinate], point(segment.endPointId)[coordinate], point(relation.pointId)[coordinate]], 0, id, tag);
        break;
      }
      case 'symmetric': {
        const { line: axis } = resolveCadSketchSymmetryOperands(graph, relation);
        directed(axis, 'A symmetry axis has no numeric endpoints.');
        const operands = [...point(relation.pointIds[0]), ...point(relation.pointIds[1]), ...line(axis)];
        const tag = tags++;
        add('symmetric-midpoint', operands, 0, id, tag); add('symmetric-perpendicular', operands, 0, id, tag); break;
      }
      case 'point-on-line': {
        const { line: guide } = resolveCadSketchPointOnLineOperands(graph, relation);
        directed(guide, 'A point-on-line guide has no numeric endpoints.');
        add('point-on-line', [...point(relation.pointId), ...line(guide)], 0, id); break;
      }
      case 'tangent-joint': {
        const { line: segment, arc, linePointId, arcPointId, otherLineEndId } = resolveCadSketchTangentJoint(graph, relation);
        const tangent = { startPointId: linePointId, endPointId: otherLineEndId }, normal = { startPointId: arc.centerPointId, endPointId: arcPointId };
        for (const support of [tangent, normal]) directed({ ...segment, ...support }, 'A tangent support has no numeric endpoints.');
        add('perpendicular', [...line(tangent), ...line(normal)], 0, id); break;
      }
      case 'line-angle': {
        const [a, b] = resolveCadSketchAngleRays(graph, relation.rays);
        for (const ray of [a, b]) directed(ray.line, 'A sketch ray has no numeric endpoints.');
        add('angle', [...line({ startPointId: a.fromPointId, endPointId: a.towardPointId }), ...line({ startPointId: b.fromPointId, endPointId: b.towardPointId })],
          cadSketchAngleTarget(relation, input.parameters).signedRadians, id); break;
      }
      case 'collinear': {
        const [a, b] = resolveCadSketchLinePair(graph, relation.lineIds);
        for (const subject of [a, b]) directed(subject, 'A sketch line has no numeric endpoints.');
        add('parallel', [...line(a), ...line(b)], 0, id);
        // A shared authored endpoint already supplies incidence; disjoint lines need one more equation.
        if (![b.startPointId, b.endPointId].some(pointId => pointId === a.startPointId || pointId === a.endPointId))
          add('point-on-line', [...point(b.startPointId), ...line(a)], 0, id);
        break;
      }
      case 'parallel': case 'perpendicular': case 'equal-length': {
        const [a, b] = resolveCadSketchLinePair(graph, relation.lineIds);
        for (const subject of [a, b]) directed(subject, 'A sketch line has no numeric endpoints.');
        add(relation.kind, [...line(a), ...line(b)], 0, id); break;
      }
      case 'equal-radius': {
        const [a, b] = resolveCadSketchRadiusPair(graph, relation.curveIds);
        const span = (arc: { centerPointId: string; startPointId: string }) => line({ startPointId: arc.centerPointId, endPointId: arc.startPointId });
        if (a.kind === 'circle' && b.kind === 'circle') add('difference', [radius(a.id), radius(b.id)], 0, id);
        else if (a.kind === 'circle' && b.kind === 'arc') add('distance-to-parameter', [...span(b), radius(a.id)], 0, id);
        else if (a.kind === 'arc' && b.kind === 'circle') add('distance-to-parameter', [...span(a), radius(b.id)], 0, id);
        else if (a.kind === 'arc' && b.kind === 'arc') add('equal-length', [...span(a), ...span(b)], 0, id);
        break;
      }
      case 'distance': add('distance', [...point(relation.pointIds[0]), ...point(relation.pointIds[1])], scalar(relation.value), id); break;
      case 'axis-distance': {
        const coordinate = relation.axis === 'x' ? 0 : 1;
        add('difference', [point(relation.pointIds[0])[coordinate], point(relation.pointIds[1])[coordinate]], scalar(relation.value), id); break;
      }
      case 'radial-size': {
        const entity = resolveCadSketchRadialEntity(graph, relation.entityId), target = cadSketchRadialTarget(relation, input.parameters);
        if (entity.kind === 'arc') add('distance', line({ startPointId: entity.centerPointId, endPointId: entity.startPointId }), target, id);
        else add('value', [radius(entity.id)], target, id);
        break;
      }
      case 'fixed-point':
        add('value', [x(relation.pointId)], scalar(relation.position[0]), id); add('value', [y(relation.pointId)], scalar(relation.position[1]), id); break;
      case 'fixed-axis': add('value', [relation.axis === 'x' ? x(relation.pointId) : y(relation.pointId)], scalar(relation.value), id); break;
      case 'fillet-corner': case 'chamfer-corner': {
        const topology = resolveCadSketchCornerTopology(graph, relation), [a, b] = topology.lines, [p, q] = topology.trimPointIds;
        add('point-on-line', [...point(relation.pointId), ...line(a)], 0, id);
        add('point-on-line', [...point(relation.pointId), ...line(b)], 0, id);
        if (relation.kind === 'fillet-corner') {
          if (topology.entity.kind !== 'arc') throw new Error('A fillet requires its referenced arc.');
          const center = topology.entity.centerPointId;
          add('perpendicular', [...line(a), ...line({ startPointId: center, endPointId: p })], 0, id);
          add('perpendicular', [...line(b), ...line({ startPointId: center, endPointId: q })], 0, id);
          add('distance', [...point(center), ...point(p)], scalar(relation.value), id);
        } else {
          add('distance', [...point(relation.pointId), ...point(p)], scalar(relation.values[0]), id);
          add('distance', [...point(relation.pointId), ...point(q)], scalar(relation.values[1]), id);
        }
        break;
      }
      default: { const exhaustive: never = relation; throw exhaustive; }
    }
  }
  if (input.drag) {
    const { pointId, position } = input.drag;
    if (!pointParameters.has(pointId) || position.some(value => !Number.isFinite(value) || Math.abs(value) > 1e9)) throw new Error('Invalid sketch drag target.');
    for (const coordinate of [0, 1]) equations.push({ kind: 'value', operands: [point(pointId)[coordinate]], value: position[coordinate], sourceId: pointId, tag: tags++, temporary: true });
  }
  return { values, fixed, pointParameters, radiusParameters, equations };
}
