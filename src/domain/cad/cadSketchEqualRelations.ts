import type { CadSketchEqualRelation, CadSketchGraph, CadSketchGraphEntity, CadSketchGraphIssue } from './cadSketchGraph';
import { CadError } from './cadError';
import { evaluateCadScalar } from './cadExpression';
import { cadSketchDriverTolerance } from './cadSketchPrecision';
import { cadSketchLineDirection, resolveCadSketchLinePair } from './cadSketchLineRelations';
import { resolveCadSketchRadialEntity } from './cadSketchRadialRelations';
import type { Point2 } from '@/domain/path-intel/types';
import { CAD_SKETCH_RADIUS_PAIR_OPERANDS, resolveCadSketchOperands } from './sketch-relations/cadSketchOperandSignatures';

/** Exact entity ownership only; no source sorting, driver transfer or numeric healing. */
export function resolveCadSketchRadiusPair(graph: CadSketchGraph, curveIds: readonly [string, string]) {
  type Round = Extract<CadSketchGraphEntity, { kind: 'arc' | 'circle' }>;
  return resolveCadSketchOperands(graph, CAD_SKETCH_RADIUS_PAIR_OPERANDS, curveIds) as readonly [Round, Round];
}

function radialMeasurements(entity: ReturnType<typeof resolveCadSketchRadialEntity>, points: ReadonlyMap<string, Point2>, parameters: Readonly<Record<string, number>>) {
  if (entity.kind === 'circle') {
    const radius = evaluateCadScalar(entity.radius, parameters);
    // Radius scalars do not lose precision when a circle center is translated.
    return { radii: [radius], operands: [{ x: radius, y: radius }] };
  }
  const center = points.get(entity.centerPointId), start = points.get(entity.startPointId), end = points.get(entity.endPointId);
  if (!center || !start || !end) return null;
  return { radii: [Math.hypot(start.x - center.x, start.y - center.y), Math.hypot(end.x - center.x, end.y - center.y)], operands: [center, start, end] };
}

/** Independent actual sizes in world millimeters, including every arc endpoint radius. */
export function checkCadSketchEqualRelation(graph: CadSketchGraph, relation: CadSketchEqualRelation,
  points: ReadonlyMap<string, Point2>, parameters: Readonly<Record<string, number>>): CadSketchGraphIssue[] {
  const source = { kind: 'relation', id: relation.id } as const;
  try {
    let residualMm: number, operands: Point2[];
    if (relation.kind === 'equal-length') {
      const lines = resolveCadSketchLinePair(graph, relation.lineIds), a = cadSketchLineDirection(lines[0], points), b = cadSketchLineDirection(lines[1], points);
      if (!a || !b) return []; // Owning point checks report invalid coordinates.
      residualMm = Math.abs(a.length - b.length); operands = [a.start, a.end, b.start, b.end];
    } else {
      const curves = resolveCadSketchRadiusPair(graph, relation.curveIds), a = radialMeasurements(curves[0], points, parameters), b = radialMeasurements(curves[1], points, parameters);
      if (!a || !b) return [];
      const radii = [...a.radii, ...b.radii];
      if (radii.some(radius => !Number.isFinite(radius) || radius <= 1e-7 || radius > 1e6))
        return [{ source, code: 'invalid-radius', message: 'Equal radii require supported nondegenerate circles or arcs.' }];
      residualMm = Math.max(...radii) - Math.min(...radii); operands = [...a.operands, ...b.operands];
    }
    return residualMm > cadSketchDriverTolerance(operands) ? [{ source, code: 'relation-residual',
      message: relation.kind === 'equal-length' ? 'Sketch lines do not have equal lengths.' : 'Sketch curves do not have equal radii.', residualMm }] : [];
  } catch (error) {
    return [{ source, code: error instanceof CadError && error.code === 'invalid-sketch-line-pair' ? 'relation-residual' : 'invalid-expression',
      message: error instanceof Error ? error.message : 'Invalid equal-size relation.' }];
  }
}
