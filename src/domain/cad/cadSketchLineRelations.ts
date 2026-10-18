import type { CadSketchGraph, CadSketchGraphEntity, CadSketchGraphIssue, CadSketchLineRelation } from './cadSketchGraph';
import { CadError } from './cadError';
import { cadSketchDriverTolerance } from './cadSketchPrecision';
import type { Point2 } from '@/domain/path-intel/types';

type Line = Extract<CadSketchGraphEntity, { kind: 'line' }>;

/** Entity ownership only. Numeric coordinates may still be unsolved intent. */
export function resolveCadSketchLinePair(graph: CadSketchGraph, lineIds: readonly [string, string]): readonly [Line, Line] {
  const a = graph.entities.find(entity => entity.id === lineIds[0]), b = graph.entities.find(entity => entity.id === lineIds[1]);
  if (lineIds[0] === lineIds[1] || a?.kind !== 'line' || b?.kind !== 'line')
    throw new CadError('invalid-sketch-line-pair', 'Choose two distinct existing sketch lines.');
  return [a, b];
}

/** Missing numeric points already have an owning coordinate/expression issue. */
export function cadSketchLineDirection(line: Line, points: ReadonlyMap<string, Point2>) {
  const start = points.get(line.startPointId), end = points.get(line.endPointId);
  if (!start || !end) return null;
  const x = end.x - start.x, y = end.y - start.y, length = Math.hypot(x, y);
  if (!Number.isFinite(length) || length <= 1e-7)
    throw new CadError('invalid-sketch-line-pair', 'Line relations require nondegenerate line directions.');
  return { x: x / length, y: y / length, length, start, end };
}

/** Independently enforce orientation and both lines' endpoint deflection in world millimeters. */
export function checkCadSketchLineRelation(graph: CadSketchGraph, relation: CadSketchLineRelation, points: ReadonlyMap<string, Point2>): CadSketchGraphIssue[] {
  const source = { kind: 'relation', id: relation.id } as const;
  try {
    const lines = resolveCadSketchLinePair(graph, relation.lineIds), a = cadSketchLineDirection(lines[0], points), b = cadSketchLineDirection(lines[1], points);
    if (!a || !b) return [];
    const q = Math.abs(relation.kind === 'perpendicular' ? a.x * b.x + a.y * b.y : a.x * b.y - a.y * b.x);
    let residualMm = q * Math.max(a.length, b.length);
    if (relation.kind === 'collinear') {
      // Both finite segments must lie on the same infinite support. Check both
      // directions so source order or a short reference cannot hide an offset.
      const supportDistance = (line: NonNullable<typeof a>, point: Point2) => Math.abs(line.x * (point.y - line.start.y) - line.y * (point.x - line.start.x));
      residualMm = Math.max(residualMm, supportDistance(a, b.start), supportDistance(a, b.end), supportDistance(b, a.start), supportDistance(b, a.end));
    }
    const tolerance = cadSketchDriverTolerance([a.start, a.end, b.start, b.end]);
    // A separate dimensionless accuracy contract: <=1e-12 transverse error per
    // unit direction. World-origin roundoff must never license a large angle.
    // This tightens the existing world-mm gate; neither native thresholds nor
    // the shorter line can widen it. Uncertain far-origin directions reject.
    if (!Number.isFinite(q) || q > 1e-12 || residualMm > tolerance) return [{ source, code: 'relation-residual',
      message: `Sketch lines do not satisfy their ${relation.kind} relation.`, ...(Number.isFinite(residualMm) ? { residualMm } : {}) }];
    return [];
  } catch (error) {
    return [{ source, code: 'relation-residual', message: error instanceof Error ? error.message : 'Invalid sketch line relation.' }];
  }
}
