import type { CadSketchFeature, CadSketchProfile } from './cadDocument';
import { CadError } from './cadError';
import { compileCadSketchGraph, type CadSketchGraphGeometry, type CadSketchGraphSourceRef } from './cadSketchGraphGeometry';
import type { PathSegment } from '@/domain/path-intel/types';
import type { DxfEntity } from '@/domain/dxf/types';

/** Exact supports for display/reference consumers, including open entities. */
export function cadSketchGraphBoundary(segment: PathSegment): Extract<DxfEntity, { type: 'line' | 'circle' | 'arc' }> {
  if (segment.kind === 'line') return { type: 'line', layer: null, start: segment.start, end: segment.end };
  if (segment.kind === 'circle') return { type: 'circle', layer: null, center: segment.center, radius: segment.radius };
  return { type: 'arc', layer: null, center: segment.center, radius: segment.radius, start: segment.start, end: segment.end,
    startAngle: segment.startAngleRadians, endAngle: segment.startAngleRadians + segment.sweepRadians, sweepRadians: segment.sweepRadians, clockwise: segment.sweepRadians < 0 };
}

export interface CadCompiledSketchProfile extends CadSketchProfile {
  /** Derived only. Never saved back as a second authoritative coordinate owner. */
  readonly graphSourceRefs?: readonly CadSketchGraphSourceRef[];
}

/** One material adapter for legacy groups and the graph's exact simple cycles. */
export function compileCadSketchGeometry(sketch: CadSketchFeature, parameters: Readonly<Record<string, number>>): { readonly profiles: readonly CadCompiledSketchProfile[]; readonly graph: CadSketchGraphGeometry | null } {
  if (!sketch.graph) return { profiles: sketch.profiles, graph: null };
  const graph = compileCadSketchGraph(sketch.graph, parameters);
  const legacyIds = new Set(sketch.profiles.map(profile => profile.id));
  for (const item of [...sketch.graph.points, ...sketch.graph.entities, ...sketch.graph.relations]) {
    if (legacyIds.has(item.id)) throw new CadError('duplicate-sketch-id', `Sketch graph identity "${item.id}" is already owned by a legacy profile.`);
  }
  const profiles: readonly CadCompiledSketchProfile[] = [...sketch.profiles, ...graph.cycles.map(cycle => ({
    id: cycle.sourceRefs[0].entityId, name: 'Contour', construction: cycle.construction,
    geometry: { kind: 'path' as const, segments: cycle.path }, graphSourceRefs: cycle.sourceRefs
  }))];
  return { profiles, graph };
}
