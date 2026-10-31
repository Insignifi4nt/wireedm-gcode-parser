import * as THREE from 'three';
import { cadClipRaycaster, cadKeptLineHits } from './view/cadSectionView';
import type { CadMesh, CadMeshTopologyGroup } from '@/domain/cad/cadDocument';
import type { CadTopologyPick, CadTopologyPickSet } from '@/domain/cad/cadTopology';

/** `auto` picks an edge near the pointer, else the face under it; the others restrict picking to one kind. */
export type CadPickMode = 'auto' | 'body' | 'face' | 'edge';
export interface CadTopologyHit { readonly bodyId: string; readonly pick: CadTopologyPick }

/** Face offsets are triangle indices; edge offsets are line vertices, not XYZ scalars. */
export function topologyGroupAt(groups: readonly CadMeshTopologyGroup[], offset: number): CadMeshTopologyGroup | null {
  if (!Number.isInteger(offset) || offset < 0) return null;
  let low = 0, high = groups.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const group = groups[middle];
    if (offset < group.start) high = middle - 1;
    else if (offset >= group.start + group.count) low = middle + 1;
    else return group;
  }
  return null;
}

export function orthographicPixelSize(camera: THREE.OrthographicCamera, viewportHeight: number): number {
  return (camera.top - camera.bottom) / (camera.zoom * Math.max(1, viewportHeight));
}

/** The exact same bounded transition serves pointer picks and declarative viewport commands. */
export function mergeTopologySelection(current: CadTopologyPickSet | null, incoming: CadTopologyPickSet, additive: boolean): CadTopologyPickSet {
  if (incoming.picks.length === 0 || incoming.picks.length > 64) throw new Error('Select between 1 and 64 topology elements.');
  const kind = incoming.picks[0].kind;
  if (incoming.picks.some((pick) => pick.kind !== kind)) throw new Error('Select either edges or one face.');
  if (kind === 'face' && incoming.picks.length !== 1) throw new Error('Select one face at a time.');
  let picks = [...new Map(incoming.picks.map((pick) => [pick.key, pick])).values()];
  if (additive && kind === 'edge' && current?.picks.some((pick) => pick.kind === 'edge')) {
    if (current.documentVersion !== incoming.documentVersion || current.buildId !== incoming.buildId) throw new Error('The selected topology is stale. Select edges from the current build.');
    if (current.bodyId !== incoming.bodyId) throw new Error('Select edges from one body for this operation.');
    const toggled = new Map(current.picks.map((pick) => [pick.key, pick]));
    for (const pick of picks) { if (toggled.has(pick.key)) toggled.delete(pick.key); else toggled.set(pick.key, pick); }
    picks = [...toggled.values()];
  }
  if (picks.length > 64) throw new Error('A topology selection can contain at most 64 edges.');
  return Object.freeze({ ...incoming, picks: Object.freeze(picks.map((pick) => Object.freeze({ ...pick }))) });
}

export function validateTopologySelection(selection: CadTopologyPickSet, source: {
  documentVersion: string; buildId: string | null; meshes: readonly CadMesh[]; ready: boolean;
}): void {
  if (!source.ready || source.buildId !== selection.buildId || source.documentVersion !== selection.documentVersion) throw new Error('The solid build changed. Select topology from the current CAD draft.');
  const mesh = source.meshes.find((entry) => entry.featureId === selection.bodyId);
  if (!mesh) throw new Error('Select topology on a current visible body.');
  for (const pick of selection.picks) {
    const groups = pick.kind === 'edge' ? mesh.edgeGroups : mesh.faceGroups;
    if (!groups.some((group) => group.key === pick.key)) throw new Error('This topology key does not belong to the current body build.');
  }
}

/**
 * With a section's `clip`, `raycaster` is already limited to the kept side for faces, and the depth checks behind each edge are limited
 * the same way. Edges are measured to the part of them the section keeps, so an edge it removes is never picked from beside the cut.
 */
export function pickTopology({ mode, raycaster, bodies, edges, meshByObject, camera, viewportHeight, clip = null }: {
  mode: 'auto' | 'edge' | 'face'; raycaster: THREE.Raycaster; bodies: readonly THREE.Mesh[];
  edges: readonly THREE.LineSegments[]; meshByObject: ReadonlyMap<THREE.Object3D, CadMesh>;
  camera: THREE.OrthographicCamera; viewportHeight: number; clip?: THREE.Plane | null;
}): CadTopologyHit | null {
  if (mode === 'auto') {
    const options = { raycaster, bodies, edges, meshByObject, camera, viewportHeight, clip };
    return pickTopology({ ...options, mode: 'edge' }) ?? pickTopology({ ...options, mode: 'face' });
  }
  if (mode === 'face') {
    const hit = raycaster.intersectObjects([...bodies], false)[0];
    const mesh = hit && meshByObject.get(hit.object);
    const group = mesh && typeof hit.faceIndex === 'number' ? topologyGroupAt(mesh.faceGroups, hit.faceIndex * 3) : null;
    return mesh && group ? { bodyId: mesh.featureId, pick: { kind: 'face', key: group.key } } : null;
  }
  const pixelSize = orthographicPixelSize(camera, viewportHeight);
  const depthRay = new THREE.Raycaster();
  const candidates = cadKeptLineHits(raycaster, edges, clip, pixelSize * 6).sort((left, right) =>
    raycaster.ray.distanceSqToPoint(left.point) - raycaster.ray.distanceSqToPoint(right.point) || left.distance - right.distance);
  for (const hit of candidates) {
    if (raycaster.ray.distanceSqToPoint(hit.point) > (pixelSize * 6) ** 2) continue;
    const mesh = meshByObject.get(hit.object);
    const group = mesh && typeof hit.index === 'number' ? topologyGroupAt(mesh.edgeGroups, hit.index) : null;
    if (!mesh || !group) continue;
    // Cast through the actual closest edge point. The pointer may be several pixels
    // away, especially at silhouettes, and must not reveal an edge behind a face.
    const projected = hit.point.clone().project(camera);
    depthRay.setFromCamera(new THREE.Vector2(projected.x, projected.y), camera); cadClipRaycaster(depthRay, clip);
    const surface = depthRay.intersectObjects([...bodies], false)[0];
    const extent = Math.max(...mesh.bounds.max.map((value, index) => value - mesh.bounds.min[index]));
    const tolerance = Math.max(1e-7, extent * 2e-7); // Only floating-point preview precision, not a whole mesh tolerance.
    if (surface && surface.distance + tolerance < depthRay.ray.origin.distanceTo(hit.point)) continue;
    return { bodyId: mesh.featureId, pick: { kind: 'edge', key: group.key } };
  }
  return null;
}
