import * as THREE from 'three';
import type { CadFeature } from '@/domain/cad/cadDocument';
import { prepareCadViewportReferences, type CadViewportReference } from './cadViewportReferences';
export { MAX_CAD_REFERENCE_DISPLAY_SEGMENTS } from './cadViewportReferences';
export type CadCurveViewportReference = CadViewportReference;

/** Compatibility wrapper; world sketches use the same bounded analytic sampler. */
export function prepareCadCurveReferences(features: readonly CadFeature[], parameters: Readonly<Record<string, number>>): readonly CadViewportReference[] {
  return prepareCadViewportReferences(features.filter(feature => feature.kind === 'curve'), parameters);
}
/** Reference features remain pickable without an evaluated solid build. */
export function pickCadCurveReference({ raycaster, references, bodies, camera, viewportHeight }: {
  raycaster: THREE.Raycaster; references: readonly THREE.LineSegments[]; bodies: readonly THREE.Mesh[];
  camera: THREE.OrthographicCamera; viewportHeight: number;
}): string | null {
  if (!viewportHeight || !references.length) return null;
  const tolerance = (camera.top - camera.bottom) / camera.zoom / viewportHeight * 6;
  raycaster.params.Line.threshold = tolerance;
  const depthRay = new THREE.Raycaster();
  const bodyObjects = [...bodies];
  for (const hit of raycaster.intersectObjects([...references], false)) {
    if (!(hit.object instanceof THREE.LineSegments) || raycaster.ray.distanceSqToPoint(hit.point) > tolerance ** 2) continue;
    // The pointer can miss a solid near its silhouette while the nearby outline
    // remains behind it. Check depth through the actual closest reference point.
    const projected = hit.point.clone().project(camera);
    depthRay.setFromCamera(new THREE.Vector2(projected.x, projected.y), camera);
    const surface = depthRay.intersectObjects(bodyObjects, false)[0];
    const previewPrecision = Math.max(1e-7, (hit.object.geometry.boundingSphere?.radius ?? 0) * 4e-7);
    if (surface && surface.distance + previewPrecision < depthRay.ray.origin.distanceTo(hit.point)) continue;
    const id: unknown = hit.object.userData.featureId;
    if (typeof id === 'string') return id;
  }
  return null;
}
