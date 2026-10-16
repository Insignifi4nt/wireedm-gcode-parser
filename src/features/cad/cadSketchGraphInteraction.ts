import type { CadSketchGraph } from '@/domain/cad/cadSketchGraph';
import { evaluateCadScalar } from '@/domain/cad/cadExpression';
import { compileCadSketchGraph } from '@/domain/cad/cadSketchGraphGeometry';
import { cadPathClosureTolerance } from '@/domain/cad/cadAnalyticSegments';
import { createLineSegment } from '@/domain/path-intel/segments';
import { classifyPathSegmentIntersection } from '@/domain/path-intel/intersections';
import type { Bounds2, Point2 } from '@/domain/path-intel/types';
import { CAD_SKETCH_PICK_RADIUS_PX, cadSketchBoundaryDistance } from './cadSketchPicking';
import type { SketchPoint } from './cadSketchInteraction';
import type { CadSketchGraphSelection } from './cadViewportControls';
import type { CadSketchGraphPickFilter } from './cadSketchGraphSelection';

export type { CadSketchGraphSelection } from './cadViewportControls';
export type { CadSketchGraphPickFilter } from './cadSketchGraphSelection';
export interface CadSketchGraphBoxQuery {
  readonly bounds: Readonly<Bounds2>;
  readonly mode: 'contain' | 'cross';
  readonly filter?: CadSketchGraphPickFilter;
}
export interface CadSketchGraphPointControl {
  readonly id: string;
  readonly position: SketchPoint;
  /** Explicit coordinate drivers only. Remaining geometric freedom is determined by the solver. */
  readonly freeAxes: readonly [boolean, boolean];
}

function inside(point: Point2, bounds: Readonly<Bounds2>, epsilon = 0): boolean {
  return point.x >= bounds.minX - epsilon && point.x <= bounds.maxX + epsilon
    && point.y >= bounds.minY - epsilon && point.y <= bounds.maxY + epsilon;
}
function boundsCorners(bounds: Readonly<Bounds2>): readonly Point2[] {
  return [{ x: bounds.minX, y: bounds.minY }, { x: bounds.maxX, y: bounds.minY },
    { x: bounds.maxX, y: bounds.maxY }, { x: bounds.minX, y: bounds.maxY }];
}

/** One immutable preparation supplies exact drawing and point/edge picking, without a profile fallback. */
export function prepareCadSketchGraphInteraction(graph: CadSketchGraph, parameters: Readonly<Record<string, number>>) {
  const geometry = compileCadSketchGraph(graph, parameters);
  const fixed = new Map<string, Set<number>>();
  for (const relation of graph.relations) if (relation.kind === 'fixed-point' || relation.kind === 'fixed-axis') {
    const axes = fixed.get(relation.pointId) ?? new Set<number>();
    if (relation.kind === 'fixed-point') { axes.add(0); axes.add(1); } else axes.add(relation.axis === 'x' ? 0 : 1);
    fixed.set(relation.pointId, axes);
  }
  const points: readonly CadSketchGraphPointControl[] = Object.freeze(graph.points.map(point => Object.freeze({ id: point.id,
    position: Object.freeze([evaluateCadScalar(point.position[0], parameters), evaluateCadScalar(point.position[1], parameters)] satisfies [number, number]),
    freeAxes: Object.freeze([typeof point.position[0] === 'number' && !fixed.get(point.id)?.has(0), typeof point.position[1] === 'number' && !fixed.get(point.id)?.has(1)] satisfies [boolean, boolean])
  })));
  return { graph, parameters, geometry, points,
    pick(point: SketchPoint, millimetersPerPixel: number, filter: CadSketchGraphPickFilter = 'auto'): readonly CadSketchGraphSelection[] {
      if (!point.every(Number.isFinite) || !Number.isFinite(millimetersPerPixel) || millimetersPerPixel <= 0) return [];
      const tolerance = CAD_SKETCH_PICK_RADIUS_PX * millimetersPerPixel;
      if (!Number.isFinite(tolerance)) return [];
      const hits = [
        ...(filter === 'edges' ? [] : points.map(control => ({ kind: 'point' as const, id: control.id, distance: Math.hypot(point[0] - control.position[0], point[1] - control.position[1]) }))),
        ...(filter === 'points' ? [] : geometry.segments.map(segment => ({ kind: 'entity' as const, id: segment.id, distance: cadSketchBoundaryDistance({ x: point[0], y: point[1] }, segment) })))
      ].filter(hit => hit.distance <= tolerance);
      hits.sort((a, b) => (a.kind === b.kind ? a.distance - b.distance : a.kind === 'point' ? -1 : 1) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      return hits.map(({ kind, id }) => ({ kind, id }));
    },
    /** Normalized world-mm box; direction is decided by the caller in screen coordinates. */
    pickBox({ bounds, mode, filter = 'auto' }: CadSketchGraphBoxQuery): readonly CadSketchGraphSelection[] {
      if (![bounds.minX, bounds.minY, bounds.maxX, bounds.maxY].every(Number.isFinite)
        || bounds.minX >= bounds.maxX || bounds.minY >= bounds.maxY) return [];
      const hits: CadSketchGraphSelection[] = [];
      if (filter !== 'edges') for (const point of points) if (inside({ x: point.position[0], y: point.position[1] }, bounds)) hits.push({ kind: 'point', id: point.id });
      if (filter !== 'points') {
        for (const segment of geometry.segments) {
          const extent = boundsCorners(segment.bounds), epsilon = cadPathClosureTolerance(extent);
          const contained = extent.every(point => inside(point, bounds, epsilon));
          if (contained) { hits.push({ kind: 'entity', id: segment.id }); continue; }
          if (mode !== 'cross') continue;
          // Clip the query to the curve's broad bounds before intersection math.
          // Distant box corners must not inflate contact tolerance or overflow edge vectors.
          const clipped = { minX: Math.max(bounds.minX, segment.bounds.minX - epsilon), minY: Math.max(bounds.minY, segment.bounds.minY - epsilon),
            maxX: Math.min(bounds.maxX, segment.bounds.maxX + epsilon), maxY: Math.min(bounds.maxY, segment.bounds.maxY + epsilon) };
          if (clipped.minX > clipped.maxX || clipped.minY > clipped.maxY) continue;
          const corners = boundsCorners(clipped);
          const crosses = inside(segment.start, bounds, epsilon) || corners.some((start, index) => {
            const edge = createLineSegment({ id: `box_${index}`, source: { sourceEntityIndex: index, sourceEntityType: 'line', layer: null, exact: true },
              start, end: corners[(index + 1) % corners.length] });
            return classifyPathSegmentIntersection(segment, edge, epsilon).kind !== 'none';
          });
          if (crosses) hits.push({ kind: 'entity', id: segment.id });
        }
      }
      hits.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'point' ? -1 : 1) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      return Object.freeze(hits.map(hit => Object.freeze(hit)));
    }
  };
}

export function cadSketchGraphPointTranslation(point: CadSketchGraphPointControl, target: SketchPoint): SketchPoint {
  return [point.freeAxes[0] ? target[0] - point.position[0] : 0, point.freeAxes[1] ? target[1] - point.position[1] : 0];
}
