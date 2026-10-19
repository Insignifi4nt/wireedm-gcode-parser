import * as THREE from 'three';
import { cadFramePointToWorld } from '@/domain/cad/cadDatumPlanes';
import type { CadNumericPoint2, CadNumericPoint3 } from '@/domain/cad/cadPlanes';
import { cadExtrudeEndFaceAt, type CadExtrudeDepthCapability, type CadExtrudeDepthControl, type CadExtrudeDepthState } from './cadExtrudeDepthInteraction';
import { formatCadQuantity } from './cadDisplayQuantity';

export interface CadDepthScreenPoint { readonly x: number; readonly y: number }
export interface CadExtrudeDepthHandleState {
  readonly visible: boolean;
  readonly endpointMm: CadNumericPoint3;
  readonly screenPoint: CadDepthScreenPoint;
  readonly quantityMm: number;
  readonly label: string;
  readonly active: boolean;
  readonly hovered: boolean;
  readonly capability: CadExtrudeDepthCapability;
}
// Below this projected axis fraction, pointer noise is amplified by >10 times.
// This is a gesture condition, never a geometry or saved-document limit.
const MIN_AXIS_PROJECTION_SQUARED = .01;
const unitY = new THREE.Vector3(0, 1, 0);
const tuple = (point: THREE.Vector3): CadNumericPoint3 => [point.x, point.y, point.z];
const finiteRay = (ray: THREE.Ray) => [...ray.origin, ...ray.direction].every(Number.isFinite) && Math.abs(ray.direction.lengthSq() - 1) < 1e-10;
const frameKey = (state: CadExtrudeDepthState) => `${state.model.sketchId}/${JSON.stringify(state.model.placement)}`;
const sameState = (a: CadExtrudeDepthState | null | undefined, b: CadExtrudeDepthState | null | undefined) => a === b || Boolean(a && b
  && a.model === b.model && a.definitionKey === b.definitionKey && a.gestureActive === b.gestureActive
  && a.capability.kind === b.capability.kind && (a.capability.kind !== 'locked' || b.capability.kind === 'locked' && a.capability.reason === b.capability.reason));
function axisStation(ray: THREE.Ray, point: THREE.Vector3, normal: THREE.Vector3): number | null {
  if (!finiteRay(ray)) return null;
  const dot = normal.dot(ray.direction), denominator = 1 - dot * dot;
  if (denominator < MIN_AXIS_PROJECTION_SQUARED) return null;
  // Subtract first: absolute far-coordinate dot products lose local displacement.
  const relative = ray.origin.clone().sub(point);
  const station = (normal.dot(relative) - dot * ray.direction.dot(relative)) / denominator;
  return Number.isFinite(station) ? station : null;
}

/** View-only handle. The editor control owns every provisional change and guard. */
export function createCadExtrudeDepthHandle({ requestRender, onInteractionChange }: {
  requestRender(): void;
  onInteractionChange(active: boolean): void;
}) {
  const group = new THREE.Group(); group.name = 'Extrusion Length'; group.visible = false;
  const material = new THREE.MeshBasicMaterial({ color: 0xb84f18, depthTest: false, depthWrite: false });
  const guideMaterial = new THREE.MeshBasicMaterial({ color: 0xb84f18, transparent: true, opacity: .55, depthTest: false, depthWrite: false });
  const head = new THREE.Mesh(new THREE.ConeGeometry(6, 14, 12), material);
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 14, 8), material);
  const guide = new THREE.Mesh(new THREE.CylinderGeometry(.6, .6, 1, 8), guideMaterial);
  for (const object of [head, stem, guide]) { object.renderOrder = 5; group.add(object); }
  let control: CadExtrudeDepthControl | null = null, unsubscribe: (() => void) | null = null;
  let camera: THREE.OrthographicCamera | null = null, width = 0, height = 0, viewKey = '';
  let state: CadExtrudeDepthHandleState | null = null, hovered = false, disposed = false;
  let inputLocked = false;
  let lastCurrent: CadExtrudeDepthState | null | undefined, renderedViewKey = '';
  let gesture: { pointerId: number; token: string; control: CadExtrudeDepthControl; anchor: CadNumericPoint2;
    frameKey: string; point: THREE.Vector3; normal: THREE.Vector3; station: number; quantity: number; factor: number; latest: number } | null = null;

  const finish = (cancel: boolean) => {
    const saved = gesture; if (!saved) return false;
    gesture = null;
    const result = cancel ? saved.control.cancel(saved.token) : saved.control.release(saved.token);
    onInteractionChange(false); refresh(); return result;
  };
  const refresh = () => {
    if (disposed) return false;
    const actual = control?.getState() ?? null;
    // An input lock must not change an unchanged idle capture visual. Real
    // model/owner loss and gesture cancellation continue through normally.
    const current = inputLocked && actual && lastCurrent && !actual.gestureActive && !lastCurrent.gestureActive
      && actual.model === lastCurrent.model && actual.definitionKey === lastCurrent.definitionKey ? lastCurrent : actual;
    if (gesture && (!current || gesture.control !== control || frameKey(current) !== gesture.frameKey)) { finish(true); return true; }
    // Camera normalization may change its exact matrix during capture. With no
    // helper visual, that cannot publish a new rendered-content revision.
    if (!current && state === null) { lastCurrent = null; renderedViewKey = viewKey; return false; }
    if (sameState(current, lastCurrent) && viewKey === renderedViewKey && (state?.hovered ?? false) === hovered && (state?.active ?? false) === Boolean(gesture)) return false;
    // The viewport owns camera publications. Synchronize its exact projection
    // without republishing from render/capture; editor and gesture changes own
    // their own visual revisions, including removal of an existing handle.
    const publish = !sameState(current, lastCurrent) || (state?.hovered ?? false) !== hovered || (state?.active ?? false) !== Boolean(gesture);
    lastCurrent = current; renderedViewKey = viewKey;
    if (!current || !camera || !width || !height) { state = null; group.visible = false; if (publish) requestRender(); return true; }
    const model = current.model, bounds = model.materialBoundsMm;
    const anchor: CadNumericPoint2 = gesture?.anchor ?? [bounds.minX / 2 + bounds.maxX / 2, bounds.minY / 2 + bounds.maxY / 2];
    const normal = new THREE.Vector3(...model.normalWorld), distance = model.quantityMm;
    const endpoint = new THREE.Vector3(...cadFramePointToWorld(model.placement.frame,
      model.placement.offsetMm + distance * (model.symmetric ? .5 : 1), anchor));
    const projected = endpoint.clone().project(camera), worldPerPixel = (camera.top - camera.bottom) / camera.zoom / height;
    const cameraDirection = camera.getWorldDirection(new THREE.Vector3());
    const endOn = 1 - normal.dot(cameraDirection) ** 2 < MIN_AXIS_PROJECTION_SQUARED;
    const capability: CadExtrudeDepthCapability = current.capability.kind === 'locked' ? current.capability
      : endOn ? { kind: 'locked', reason: 'Rotate the view to drag Length. Its axis points toward the camera.' } : { kind: 'editable' };
    const visible = Number.isFinite(worldPerPixel) && worldPerPixel > 0 && [projected.x, projected.y, projected.z].every(Number.isFinite)
      && Math.abs(projected.x) <= 1 && Math.abs(projected.y) <= 1 && projected.z >= -1 && projected.z <= 1;
    state = { visible, endpointMm: tuple(endpoint), screenPoint: { x: (projected.x + 1) * width / 2, y: (1 - projected.y) * height / 2 },
      quantityMm: distance, label: `Length ${formatCadQuantity(distance)} mm`, active: gesture !== null, hovered, capability };
    group.visible = visible; group.position.copy(endpoint);
    const arrowDirection = normal.clone().multiplyScalar(distance < 0 ? -1 : 1);
    for (const object of [head, stem]) { object.scale.setScalar(worldPerPixel); object.quaternion.setFromUnitVectors(unitY, arrowDirection); }
    head.position.copy(arrowDirection).multiplyScalar(-7 * worldPerPixel);
    stem.position.copy(arrowDirection).multiplyScalar(-21 * worldPerPixel);
    guide.quaternion.setFromUnitVectors(unitY, normal); guide.scale.set(worldPerPixel, Math.abs(distance), worldPerPixel);
    guide.position.copy(normal).multiplyScalar(-distance / 2);
    material.color.setHex(capability.kind === 'locked' ? 0x8ea5af : hovered || gesture ? 0xa6440e : 0xb84f18);
    group.updateMatrixWorld(true); if (publish) requestRender(); return true;
  };
  const start = (pointerId: number, ray: THREE.Ray, origin: THREE.Vector3) => {
    if (disposed || inputLocked || gesture || !control || state?.capability.kind !== 'editable') return false;
    const current = control.getState(); if (!current) return false;
    const normal = new THREE.Vector3(...current.model.normalWorld);
    const station = axisStation(ray, origin, normal); if (station === null) return false;
    const token = control.begin(current.definitionKey); if (!token) return false;
    const bounds = current.model.materialBoundsMm;
    gesture = { pointerId, token, control, frameKey: frameKey(current), anchor: [bounds.minX / 2 + bounds.maxX / 2, bounds.minY / 2 + bounds.maxY / 2],
      point: origin.clone(), normal, station, quantity: current.model.quantityMm, factor: current.model.symmetric ? 2 : 1, latest: current.model.quantityMm };
    onInteractionChange(true); refresh(); return true;
  };
  /** Whether a picked model point and its face normal lie on the end cap this handle drags. */
  const faceAt = (point: CadNumericPoint3, faceNormal: CadNumericPoint3) => {
    const current = !disposed && !inputLocked && state?.capability.kind === 'editable' ? control?.getState() : null;
    return Boolean(current && cadExtrudeEndFaceAt(current.model, point, faceNormal));
  };
  const hitTest = (point: CadDepthScreenPoint) => {
    if (!state?.visible || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return false;
    // A generous constant-screen target remains independent of world zoom.
    return Math.hypot(point.x - state.screenPoint.x, point.y - state.screenPoint.y) <= 14;
  };
  return {
    group,
    getState: () => state,
    update(next: CadExtrudeDepthControl | null, nextInputLocked = false) {
      if (disposed) return false;
      if (nextInputLocked && !inputLocked) finish(true);
      inputLocked = nextInputLocked;
      const changed = next !== control;
      if (changed) { finish(true); unsubscribe?.(); control = next; unsubscribe = next?.subscribe(refresh) ?? null; hovered = false; lastCurrent = undefined; }
      return refresh() || changed;
    },
    setView(next: THREE.OrthographicCamera, nextWidth: number, nextHeight: number) {
      if (disposed) return false;
      next.updateMatrixWorld();
      const key = JSON.stringify([next.matrixWorld.elements, next.projectionMatrix.elements, nextWidth, nextHeight]);
      if (next === camera && key === viewKey) return false;
      if (gesture && key !== viewKey) finish(true);
      camera = next; width = nextWidth; height = nextHeight; viewKey = key; refresh(); return true;
    },
    hitTest,
    hover(point: CadDepthScreenPoint | null) {
      if (inputLocked) return false;
      const next = Boolean(point && hitTest(point)); if (next === hovered || disposed) return false;
      hovered = next; refresh(); return true;
    },
    begin(pointerId: number, ray: THREE.Ray, point: CadDepthScreenPoint) {
      if (!state || !hitTest(point)) return false;
      return start(pointerId, ray, new THREE.Vector3(...state.endpointMm));
    },
    faceAt,
    /** Drags the end cap from the pressed point, so the face follows the pointer. */
    beginFace(pointerId: number, ray: THREE.Ray, point: CadNumericPoint3, faceNormal: CadNumericPoint3) {
      return faceAt(point, faceNormal) && start(pointerId, ray, new THREE.Vector3(...point));
    },
    move(pointerId: number, ray: THREE.Ray) {
      const saved = gesture; if (disposed || inputLocked || !saved || saved.pointerId !== pointerId) return false;
      const station = axisStation(ray, saved.point, saved.normal); if (station === null) return false;
      const quantity = saved.quantity + (station - saved.station) * saved.factor;
      if (!Number.isFinite(quantity)) return false;
      if (quantity === saved.latest) return true;
      if (!saved.control.setQuantity(saved.token, quantity)) { finish(true); return false; }
      saved.latest = quantity; return true;
    },
    release(pointerId: number) { return !disposed && gesture?.pointerId === pointerId ? finish(false) : false; },
    cancel: () => !disposed && finish(true),
    dispose() {
      if (disposed) return;
      finish(true); unsubscribe?.(); unsubscribe = null; control = null; disposed = true; state = null;
      for (const object of [head, stem, guide]) object.geometry.dispose();
      material.dispose(); guideMaterial.dispose(); group.clear(); group.visible = false;
    }
  };
}
