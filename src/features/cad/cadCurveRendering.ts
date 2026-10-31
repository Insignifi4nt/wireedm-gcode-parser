import * as THREE from 'three';
import type { CadFeature } from '@/domain/cad/cadDocument';
import { prepareCadViewportReferences, type CadViewportReference } from './cadViewportReferences';
import { cadClipRaycaster, cadKeptLineHits } from './view/cadSectionView';
export type CadCurveViewportReference = CadViewportReference;

/** Compatibility wrapper; world sketches use the same analytic display sampler. */
export function prepareCadCurveReferences(features: readonly CadFeature[], parameters: Readonly<Record<string, number>>): readonly CadViewportReference[] {
  return Object.freeze(prepareCadViewportReferences(features.filter(feature => feature.kind === 'curve' || feature.kind === 'datum-plane'), parameters).filter(reference => reference.featureKind === 'curve'));
}
/**
 * Reference features remain pickable without an evaluated solid build. A section's `clip` keeps the removed side of every body from
 * hiding a reference. Lines the section `cut`s, sketch and curve outlines, are measured to the part of them it keeps, so a removed
 * outline is never picked from beside the cut; reference geometry, which it does not cut, is measured whole. `key` names the line data
 * returned, the feature ID unless the lines are not features.
 */
export function pickCadCurveReference({ raycaster, references, bodies, camera, viewportHeight, clip = null, cut = false, key = 'featureId' }: {
  raycaster: THREE.Raycaster; references: readonly THREE.LineSegments[]; bodies: readonly THREE.Mesh[];
  camera: THREE.OrthographicCamera; viewportHeight: number; clip?: THREE.Plane | null; cut?: boolean; key?: 'featureId' | 'referenceId';
}): string | null {
  if (!viewportHeight || !references.length) return null;
  const tolerance = (camera.top - camera.bottom) / camera.zoom / viewportHeight * 6;
  const depthRay = new THREE.Raycaster();
  const bodyObjects = [...bodies];
  for (const hit of cadKeptLineHits(raycaster, references, cut ? clip : null, tolerance)) {
    if (!(hit.object instanceof THREE.LineSegments)) continue;
    // The pointer can miss a solid near its silhouette while the nearby outline
    // remains behind it. Check depth through the actual closest reference point.
    const projected = hit.point.clone().project(camera);
    depthRay.setFromCamera(new THREE.Vector2(projected.x, projected.y), camera); cadClipRaycaster(depthRay, clip);
    const surface = depthRay.intersectObjects(bodyObjects, false)[0];
    const previewPrecision = Math.max(1e-7, (hit.object.geometry.boundingSphere?.radius ?? 0) * 4e-7);
    if (surface && surface.distance + previewPrecision < depthRay.ray.origin.distanceTo(hit.point)) continue;
    const id: unknown = hit.object.userData[key];
    if (typeof id === 'string') return id;
  }
  return null;
}
