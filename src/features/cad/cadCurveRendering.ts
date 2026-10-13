import * as THREE from 'three';
import type { CadFeature } from '@/domain/cad/cadDocument';
import { inspectCadCurve, type CadBounds3 } from '@/domain/cad/cadCurve';
import { cadPlanePointToWorld } from '@/domain/cad/cadPlanes';

export interface CadCurveViewportReference {
  readonly featureId: string;
  readonly name: string;
  readonly positions: readonly number[];
  readonly bounds: CadBounds3;
}
export const MAX_CAD_REFERENCE_DISPLAY_SEGMENTS = 32768;

/** Display tessellation only. Source curves, measurements and DXF stay analytic. */
export function prepareCadCurveReferences(features: readonly CadFeature[], parameters: Readonly<Record<string, number>>): readonly CadCurveViewportReference[] {
  const resolved = features.flatMap(feature => {
    if (feature.kind !== 'curve' || feature.suppressed) return [];
    const result = inspectCadCurve(feature, parameters);
    return result.eligible ? [{ feature, curve: result.curve }] : [];
  });
  const count = resolved.reduce((sum, entry) => sum + entry.curve.segments.length, 0);
  const perEdge = Math.max(1, Math.floor(MAX_CAD_REFERENCE_DISPLAY_SEGMENTS / Math.max(1, count)));
  return Object.freeze(resolved.map(({ feature, curve }) => {
    const positions: number[] = [];
    const point = (x: number, y: number) => cadPlanePointToWorld(curve.plane, curve.offset, [x, y]);
    for (const segment of curve.segments) {
      if (segment.kind === 'line') { positions.push(...point(...segment.start), ...point(...segment.end)); continue; }
      const steps = Math.min(perEdge, Math.max(1, Math.ceil(Math.abs(segment.sweep) / 3)));
      const at = (index: number) => {
        const angle = (segment.startAngle + segment.sweep * index / steps) * Math.PI / 180;
        return point(segment.center[0] + segment.radius * Math.cos(angle), segment.center[1] + segment.radius * Math.sin(angle));
      };
      let previous = at(0);
      for (let index = 1; index <= steps; index++) { const next = at(index); positions.push(...previous, ...next); previous = next; }
    }
    return Object.freeze({ featureId: feature.id, name: feature.name, positions: Object.freeze(positions), bounds: curve.worldBounds });
  }));
}

/** Reference features remain pickable without an evaluated solid build. */
export function pickCadCurveReference({ raycaster, references, bodies, camera, viewportHeight }: {
  raycaster: THREE.Raycaster; references: readonly THREE.LineSegments[]; bodies: readonly THREE.Mesh[];
  camera: THREE.OrthographicCamera; viewportHeight: number;
}): string | null {
  if (!viewportHeight || !references.length) return null;
  const tolerance = (camera.top - camera.bottom) / camera.zoom / viewportHeight * 6;
  raycaster.params.Line.threshold = tolerance;
  const frontBody = raycaster.intersectObjects([...bodies], false)[0]?.distance ?? Infinity;
  const hit = raycaster.intersectObjects([...references], false).find(entry => entry.distance <= frontBody + Math.max(1e-7, tolerance * 0.01));
  const id: unknown = hit?.object.userData.featureId;
  return typeof id === 'string' ? id : null;
}
