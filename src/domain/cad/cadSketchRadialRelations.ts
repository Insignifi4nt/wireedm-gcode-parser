import type { CadSketchGraph, CadSketchGraphEntity, CadSketchGraphIssue, CadSketchRadialRelation } from './cadSketchGraph';
import { CadError } from './cadError';
import { evaluateCadScalar } from './cadExpression';
import { cadSketchDriverTolerance } from './cadSketchPrecision';
import type { Point2 } from '@/domain/path-intel/types';
import { CAD_SKETCH_RADIAL_OPERANDS, resolveCadSketchOperands } from './sketch-relations/cadSketchOperandSignatures';
import { cadSupportedLength } from '@/domain/precision/cadPrecision';

/** Source topology only: a changed dimension may have unsolved numeric geometry. */
export function resolveCadSketchRadialEntity(graph: CadSketchGraph, entityId: string) {
  return resolveCadSketchOperands(graph, CAD_SKETCH_RADIAL_OPERANDS, [entityId])[0] as Extract<CadSketchGraphEntity, { kind: 'arc' | 'circle' }>;
}

function validRadius(radius: number): boolean { return Number.isFinite(radius) && cadSupportedLength(radius); }

/** Evaluate the displayed quantity without changing its exact source scalar. */
export function cadSketchRadialTarget(relation: CadSketchRadialRelation, parameters: Readonly<Record<string, number>>): number {
  return cadSketchDrivingRadius(evaluateCadScalar(relation.value, parameters), relation.quantity);
}
/** The radius an evaluated displayed radius or diameter drives, within the supported range. */
export function cadSketchDrivingRadius(displayed: number, quantity: CadSketchRadialRelation['quantity']): number {
  const radius = quantity === 'diameter' ? displayed / 2 : displayed;
  if (!validRadius(radius)) throw new CadError('invalid-radius', 'Driving radius must exceed 0.0000001 mm and be at most one million millimeters.');
  return radius;
}

/** Compare actual analytic radii, including both endpoints of an arc, without repair. */
export function checkCadSketchRadialRelation(graph: CadSketchGraph, relation: CadSketchRadialRelation,
  points: ReadonlyMap<string, Point2>, parameters: Readonly<Record<string, number>>): CadSketchGraphIssue[] {
  const source = { kind: 'relation', id: relation.id } as const;
  try {
    const entity = resolveCadSketchRadialEntity(graph, relation.entityId), target = cadSketchRadialTarget(relation, parameters);
    let actual: number[], operands: Point2[];
    if (entity.kind === 'circle') {
      const radius = evaluateCadScalar(entity.radius, parameters); actual = [radius];
      // Circle radius is an independent scalar. An unrelated translated center
      // must not widen its arithmetic roundoff allowance.
      operands = [{ x: radius, y: target }];
    } else {
      const center = points.get(entity.centerPointId), start = points.get(entity.startPointId), end = points.get(entity.endPointId);
      if (!center || !start || !end) return []; // Owning point checks report invalid coordinates.
      actual = [Math.hypot(start.x - center.x, start.y - center.y), Math.hypot(end.x - center.x, end.y - center.y)];
      operands = [center, start, end, { x: target, y: target }];
    }
    if (actual.some(radius => !validRadius(radius))) return [{ source, code: 'invalid-radius', message: 'Radial geometry is outside the supported radius range.' }];
    const residualMm = Math.max(...actual.map(radius => Math.abs(radius - target)));
    return residualMm > cadSketchDriverTolerance(operands) ? [{ source, code: 'relation-residual', message: 'Sketch geometry does not satisfy its radial dimension.', residualMm }] : [];
  } catch (error) {
    return [{ source, code: error instanceof CadError && error.code === 'invalid-radius' ? 'invalid-radius' : 'invalid-expression',
      message: error instanceof Error ? error.message : 'Invalid radial dimension.' }];
  }
}
