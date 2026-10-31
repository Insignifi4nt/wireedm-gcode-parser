import * as THREE from 'three';
import type { CadResolvedFrame } from '@/domain/cad/cadDatumPlanes';

/** Where a sketch lies in the world: its resolved frame and its offset along the frame normal. */
export interface CadSketchPlacementFrame { readonly frame: CadResolvedFrame; readonly offsetMm: number }
/** The part of the sketch the canvas shows: `width` by `span` sketch millimetres around `center`, as `CadSketchViewFrame` describes it. */
export interface CadSketchCameraView { readonly center: readonly [number, number]; readonly width: number; readonly span: number }

const vector = (value: readonly [number, number, number]) => new THREE.Vector3(value[0], value[1], value[2]);
/** The world point at sketch coordinates `(x, y)`, on the plane after its offset. */
export function cadSketchWorldPoint({ frame, offsetMm }: CadSketchPlacementFrame, x: number, y: number, target = new THREE.Vector3()): THREE.Vector3 {
  return target.set(
    frame.origin[0] + frame.u[0] * x + frame.v[0] * y + frame.normal[0] * offsetMm,
    frame.origin[1] + frame.u[1] * x + frame.v[1] * y + frame.normal[1] * offsetMm,
    frame.origin[2] + frame.u[2] * x + frame.v[2] * y + frame.normal[2] * offsetMm);
}

/** How far `bounds` reaches in front of the plane through `point` (toward `normal`) and behind it. */
function depthExtent(bounds: THREE.Box3 | null, point: THREE.Vector3, normal: THREE.Vector3) {
  let front = 0, back = 0;
  if (!bounds || bounds.isEmpty()) return { front, back };
  const corner = new THREE.Vector3();
  for (let index = 0; index < 8; index++) {
    corner.set(index & 1 ? bounds.max.x : bounds.min.x, index & 2 ? bounds.max.y : bounds.min.y, index & 4 ? bounds.max.z : bounds.min.z);
    const distance = normal.dot(corner.sub(point));
    if (distance > front) front = distance;
    if (-distance > back) back = -distance;
  }
  return { front, back };
}

/**
 * Points an orthographic camera at the sketch as the sketch canvas draws it: it looks along the negative normal with the sketch V axis up,
 * and its frustum is the canvas view box, so a world point on the sketch plane lands on the same pixel as the sketch point the canvas draws
 * there. Frames are right-handed (U × V = normal), so U runs to the right exactly as on the canvas. `bounds` sets only the depth range, which
 * keeps every model point on either side of the plane between the near and far planes; it never moves anything on screen.
 */
export function syncCadSketchCamera(camera: THREE.OrthographicCamera, placement: CadSketchPlacementFrame, view: CadSketchCameraView, bounds: THREE.Box3 | null): void {
  const { frame } = placement;
  const u = vector(frame.u), v = vector(frame.v), normal = vector(frame.normal);
  const target = cadSketchWorldPoint(placement, view.center[0], view.center[1]);
  const { front, back } = depthExtent(bounds, target, normal);
  const margin = Math.max(1, (front + back) * 0.05);
  const distance = front + margin;
  camera.position.copy(target).addScaledVector(normal, distance);
  // The rotation comes straight from the frame, not from a look-at, so far-origin frames keep their exact axes.
  camera.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(u, v, normal));
  camera.up.copy(v);
  camera.left = -view.width / 2; camera.right = view.width / 2;
  camera.top = view.span / 2; camera.bottom = -view.span / 2;
  camera.zoom = 1; camera.near = 0; camera.far = distance + back + margin;
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
}

/**
 * The plane that cuts the part at the sketch: three.js keeps points whose signed distance is not negative, so its normal points away from
 * the viewer and everything between the viewer and the sketch plane is removed. `tolerance` keeps faces that lie on the sketch plane, such as
 * the top face a sketch was opened on, from flickering in and out with rounding.
 */
export function cadSketchClipPlane(placement: CadSketchPlacementFrame, tolerance = 0, target = new THREE.Plane()): THREE.Plane {
  const normal = vector(placement.frame.normal);
  target.setFromNormalAndCoplanarPoint(normal.negate(), cadSketchWorldPoint(placement, 0, 0));
  target.constant += tolerance;
  return target;
}

const samePoint = (a: readonly number[], b: readonly number[]) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
/** Whether two placements put the sketch in exactly the same place, so a view keyed on one can keep it for the other. */
export function sameCadSketchPlacementFrame(a: CadSketchPlacementFrame | null, b: CadSketchPlacementFrame | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.offsetMm === b.offsetMm && samePoint(a.frame.origin, b.frame.origin) && samePoint(a.frame.u, b.frame.u) && samePoint(a.frame.v, b.frame.v) && samePoint(a.frame.normal, b.frame.normal);
}

/** A tolerance that stays above float32 rounding in view space for a scene of this size. */
export function cadSketchClipTolerance(bounds: THREE.Box3 | null): number {
  const size = bounds && !bounds.isEmpty() ? bounds.getSize(new THREE.Vector3()).length() : 0;
  return 1e-5 * Math.max(1, size);
}

type Listener = () => void;
/**
 * Carries the sketch canvas's view to the 3D background without React: the canvas publishes each new view box, and the viewport moves its
 * camera and draws one frame. Only a pan, zoom or resize publishes, so pointer moves over the sketch never reach the 3D view.
 */
export interface CadSketchCameraLink {
  publish(view: CadSketchCameraView): void;
  current(): CadSketchCameraView | null;
  subscribe(listener: Listener): () => void;
}
export function createCadSketchCameraLink(): CadSketchCameraLink {
  let view: CadSketchCameraView | null = null;
  const listeners = new Set<Listener>();
  return {
    publish(next) {
      if (view && view.center[0] === next.center[0] && view.center[1] === next.center[1] && view.width === next.width && view.span === next.span) return;
      view = Object.freeze({ center: Object.freeze([next.center[0], next.center[1]] as const), width: next.width, span: next.span });
      for (const listener of [...listeners]) listener();
    },
    current: () => view,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
}
