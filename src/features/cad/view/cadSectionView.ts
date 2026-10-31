import * as THREE from 'three';
import type { CadFeature } from '@/domain/cad/cadDocument';
import { cadPrincipalFrame, resolveCadWorldDatum, type CadResolvedFrame } from '@/domain/cad/cadDatumPlanes';
import type { CadSectionPlane } from './cadViewState';

/**
 * The section view is a visual cut: three.js clipping planes on the model materials, the same mechanism as the cut behind an open sketch,
 * and a raycast limit so picks never land on the removed side. Exact sections stay with the kernel.
 */

/** Whether the plane is still there to cut by: an origin plane always is, a datum plane while it exists and is not suppressed. */
export function cadSectionPlaneAvailable(plane: CadSectionPlane, features: readonly CadFeature[]): boolean {
  if (typeof plane === 'string') return true;
  return features.some(feature => feature.id === plane.featureId && feature.kind === 'datum-plane' && !feature.suppressed);
}

/** Where the section plane lies in the world, or `null` when it no longer resolves. */
export function resolveCadSectionFrame(plane: CadSectionPlane, features: readonly CadFeature[], parameters: Readonly<Record<string, number>>): CadResolvedFrame | null {
  if (typeof plane === 'string') return cadPrincipalFrame(plane);
  const feature = features.find(entry => entry.id === plane.featureId);
  if (feature?.kind !== 'datum-plane' || feature.suppressed) return null;
  try { return resolveCadWorldDatum(feature, parameters); } catch { return null; }
}

/**
 * The clipping plane of a section. three.js keeps points whose signed distance is not negative. Unflipped, the plane's normal side is
 * removed, as the sketch cut removes the side facing the viewer, so the default isometric view looks into the cut of every origin plane.
 * Flipped, the normal side is kept and the other side removed. `tolerance` keeps faces lying on the plane from flickering with rounding.
 */
export function cadSectionClipPlane(frame: CadResolvedFrame, flip: boolean, tolerance = 0, target = new THREE.Plane()): THREE.Plane {
  const normal = new THREE.Vector3(frame.normal[0], frame.normal[1], frame.normal[2]);
  if (!flip) normal.negate();
  target.setFromNormalAndCoplanarPoint(normal, new THREE.Vector3(frame.origin[0], frame.origin[1], frame.origin[2]));
  target.constant += tolerance;
  return target;
}

/**
 * Limits a ray to the kept side of `plane` through the raycaster's near and far distances, which three.js meshes, lines and points honour,
 * so a pick through the cut finds only geometry that is drawn. With no plane the ray is unlimited again. Costs O(1) per ray.
 */
export function cadClipRaycaster(raycaster: THREE.Raycaster, plane: THREE.Plane | null): THREE.Raycaster {
  raycaster.near = 0; raycaster.far = Infinity;
  if (!plane) return raycaster;
  const start = plane.distanceToPoint(raycaster.ray.origin), rate = plane.normal.dot(raycaster.ray.direction);
  if (Math.abs(rate) < 1e-12) {
    // Parallel to the plane: the whole ray is kept or removed.
    if (start < 0) { raycaster.near = 1; raycaster.far = 0; }
    return raycaster;
  }
  const crossing = -start / rate;
  if (rate > 0) raycaster.near = Math.max(0, crossing);
  else if (crossing < 0) { raycaster.near = 1; raycaster.far = 0; }
  else raycaster.far = crossing;
  return raycaster;
}

/** Whether every point of the box lies on the removed side, so nothing of it is drawn. */
export function cadBoundsClipped(bounds: { readonly min: readonly number[]; readonly max: readonly number[] }, plane: THREE.Plane | null): boolean {
  if (!plane) return false;
  const corner = new THREE.Vector3();
  for (let index = 0; index < 8; index++) {
    corner.set(index & 1 ? bounds.max[0] : bounds.min[0], index & 2 ? bounds.max[1] : bounds.min[1], index & 4 ? bounds.max[2] : bounds.min[2]);
    if (plane.distanceToPoint(corner) >= 0) return false;
  }
  return true;
}

const sameVector = (a: readonly number[], b: readonly number[]) => a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
/** Whether two resolved frames lie in the same place, so a rebuild that leaves the plane where it was keeps the view's section as it is. */
export function sameCadSectionFrame(a: CadResolvedFrame | null, b: CadResolvedFrame | null): boolean {
  return a === b || Boolean(a && b && sameVector(a.origin, b.origin) && sameVector(a.u, b.u) && sameVector(a.v, b.v) && sameVector(a.normal, b.normal));
}
