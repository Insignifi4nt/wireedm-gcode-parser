import type { CadSketchGraph } from '@/domain/cad/cadSketchGraph';
import { evaluateCadScalar } from '@/domain/cad/cadExpression';
import { compileCadSketchGraph } from '@/domain/cad/cadSketchGraphGeometry';
import { CAD_SKETCH_PICK_RADIUS_PX, cadSketchBoundaryDistance } from './cadSketchPicking';
import type { SketchPoint } from './cadSketchInteraction';
import type { CadSketchGraphSelection } from './cadViewportControls';

export type { CadSketchGraphSelection } from './cadViewportControls';
export interface CadSketchGraphPointControl {
  readonly id: string;
  readonly position: SketchPoint;
  /** Explicit coordinate drivers only. Remaining geometric freedom is determined by the solver. */
  readonly freeAxes: readonly [boolean, boolean];
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
    pick(point: SketchPoint, millimetersPerPixel: number): readonly CadSketchGraphSelection[] {
      if (!point.every(Number.isFinite) || !Number.isFinite(millimetersPerPixel) || millimetersPerPixel <= 0) return [];
      const tolerance = CAD_SKETCH_PICK_RADIUS_PX * millimetersPerPixel;
      const hits = [
        ...points.map(control => ({ kind: 'point' as const, id: control.id, distance: Math.hypot(point[0] - control.position[0], point[1] - control.position[1]) })),
        ...geometry.segments.map(segment => ({ kind: 'entity' as const, id: segment.id, distance: cadSketchBoundaryDistance({ x: point[0], y: point[1] }, segment) }))
      ].filter(hit => hit.distance <= tolerance);
      hits.sort((a, b) => (a.kind === b.kind ? a.distance - b.distance : a.kind === 'point' ? -1 : 1) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      return hits.map(({ kind, id }) => ({ kind, id }));
    }
  };
}

export function cadSketchGraphPointTranslation(point: CadSketchGraphPointControl, target: SketchPoint): SketchPoint {
  return [point.freeAxes[0] ? target[0] - point.position[0] : 0, point.freeAxes[1] ? target[1] - point.position[1] : 0];
}
