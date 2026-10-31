import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { cadPrincipalFrame, resolveCadWorldDatum, type CadResolvedFrame } from '@/domain/cad/cadDatumPlanes';
import type { CadDatumPlaneFeature } from '@/domain/cad/cadDocument';
import { cadSketchClipPlane, cadSketchClipTolerance, cadSketchWorldPoint, createCadSketchCameraLink, sameCadSketchPlacementFrame, syncCadSketchCamera, type CadSketchCameraView, type CadSketchPlacementFrame } from './cadSketchCamera';

const datum = (origin: [number, number, number], rotation: [number, number, number]): CadResolvedFrame => resolveCadWorldDatum({ id: 'datum', name: 'Datum', kind: 'datum-plane', suppressed: false,
  definition: { kind: 'world', basePlane: 'XY', origin, rotation } } satisfies CadDatumPlaneFeature, {});
/** XY turned over: its normal points down, so it is seen from below. */
const flipped: CadResolvedFrame = { origin: [0, 0, 10], u: [1, 0, 0], v: [0, -1, 0], normal: [0, 0, -1], precision: { angularUncertainty: 0, originUncertaintyMm: 0 } };
const placements: Readonly<Record<string, CadSketchPlacementFrame>> = {
  'XY': { frame: cadPrincipalFrame('XY'), offsetMm: 0 },
  'XY offset 12.5': { frame: cadPrincipalFrame('XY'), offsetMm: 12.5 },
  'XZ offset -4': { frame: cadPrincipalFrame('XZ'), offsetMm: -4 },
  'YZ': { frame: cadPrincipalFrame('YZ'), offsetMm: 0 },
  'rotated datum offset 3': { frame: datum([10, 20, 30], [30, 45, 0]), offsetMm: 3 },
  'far rotated datum': { frame: datum([100000, -200000, 30000], [17, -62, 105]), offsetMm: -7.25 },
  'flipped plane': { frame: flipped, offsetMm: 0 },
};
// Canvas sizes and views as the sketch canvas makes them: width is span times the canvas aspect, or the 1.3 default before it is measured.
const views: readonly { readonly pixels: readonly [number, number]; readonly view: CadSketchCameraView }[] = [
  { pixels: [800, 600], view: { center: [0, 0], span: 160, width: 160 * 800 / 600 } },
  { pixels: [800, 600], view: { center: [37.5, -12.25], span: 12, width: 12 * 800 / 600 } },
  { pixels: [1280, 700], view: { center: [-400, 250], span: 2500, width: 2500 * 1280 / 700 } },
  { pixels: [640, 900], view: { center: [10000, -3000], span: 0.5, width: 0.5 * 640 / 900 } },
  { pixels: [800, 600], view: { center: [3, 4], span: 160, width: 160 * 1.3 } },
];
const bounds = new THREE.Box3(new THREE.Vector3(-60, -50, -20), new THREE.Vector3(80, 40, 35));

/** Where the sketch canvas draws a sketch point: its view box stretched over the canvas, sketch Y up. */
function canvasPixel([width, height]: readonly [number, number], view: CadSketchCameraView, x: number, y: number) {
  return { x: ((x - view.center[0]) / view.width + 0.5) * width, y: (0.5 - (y - view.center[1]) / view.span) * height };
}
function cameraPixel(camera: THREE.Camera, [width, height]: readonly [number, number], world: THREE.Vector3) {
  const ndc = world.clone().project(camera);
  return { x: (ndc.x + 1) / 2 * width, y: (1 - ndc.y) / 2 * height, z: ndc.z };
}

describe('sketch background camera', () => {
  it('puts every sketch point on the pixel the sketch canvas draws it on, at every zoom and pan, on principal, offset, datum and flipped planes', () => {
    const camera = new THREE.OrthographicCamera();
    let worst = 0;
    for (const [name, placement] of Object.entries(placements)) for (const { pixels, view } of views) {
      syncCadSketchCamera(camera, placement, view, bounds);
      for (const [fx, fy] of [[0, 0], [-0.5, -0.5], [0.5, 0.5], [0.37, -0.21], [-0.45, 0.3]]) {
        const x = view.center[0] + fx * view.width, y = view.center[1] + fy * view.span;
        const expected = canvasPixel(pixels, view, x, y), actual = cameraPixel(camera, pixels, cadSketchWorldPoint(placement, x, y));
        const error = Math.hypot(actual.x - expected.x, actual.y - expected.y);
        worst = Math.max(worst, error);
        expect(error, `${name} at ${view.center.join(',')}/${view.span}`).toBeLessThanOrEqual(0.5);
      }
    }
    // Far less than half a pixel: the camera is exact, not merely close.
    expect(worst).toBeLessThan(1e-3);
  });

  it('looks along the negative normal with the sketch V axis up, and keeps the whole model between its near and far planes', () => {
    const camera = new THREE.OrthographicCamera();
    for (const placement of Object.values(placements)) {
      if (Math.abs(placement.frame.origin[0]) > 1000) continue;
      const view = views[0].view;
      syncCadSketchCamera(camera, placement, view, bounds);
      const normal = new THREE.Vector3(...placement.frame.normal), up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
      expect(camera.getWorldDirection(new THREE.Vector3()).dot(normal)).toBeCloseTo(-1, 12);
      expect(up.distanceTo(new THREE.Vector3(...placement.frame.v))).toBeLessThan(1e-12);
      for (let index = 0; index < 8; index++) {
        const corner = new THREE.Vector3(index & 1 ? bounds.max.x : bounds.min.x, index & 2 ? bounds.max.y : bounds.min.y, index & 4 ? bounds.max.z : bounds.min.z);
        const { z } = cameraPixel(camera, views[0].pixels, corner);
        expect(z).toBeGreaterThan(-1); expect(z).toBeLessThan(1);
      }
      // Seen square to the plane, a point off it lands on the pixel of its foot on the plane.
      const foot = cadSketchWorldPoint(placement, 12, -7), lifted = foot.clone().addScaledVector(normal, 9);
      const a = cameraPixel(camera, views[0].pixels, foot), b = cameraPixel(camera, views[0].pixels, lifted);
      expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThan(1e-9);
    }
  });

  it('cuts away the side of the sketch plane that faces the viewer, for either sense of the normal', () => {
    // XY offset 10: the viewer is above, so everything above z = 10 goes.
    const up = cadSketchClipPlane({ frame: cadPrincipalFrame('XY'), offsetMm: 10 });
    expect(up.distanceToPoint(new THREE.Vector3(5, 5, 15))).toBeLessThan(0);
    expect(up.distanceToPoint(new THREE.Vector3(5, 5, 5))).toBeGreaterThan(0);
    expect(up.distanceToPoint(new THREE.Vector3(-3, 8, 10))).toBeCloseTo(0, 12);
    // The plane turned over: the viewer is below z = 10, so everything below it goes.
    const down = cadSketchClipPlane({ frame: flipped, offsetMm: 0 });
    expect(down.distanceToPoint(new THREE.Vector3(5, 5, 5))).toBeLessThan(0);
    expect(down.distanceToPoint(new THREE.Vector3(5, 5, 15))).toBeGreaterThan(0);
    // XZ has its normal along -Y, so the viewer stands at negative Y; an offset moves the cut along the normal.
    const front = cadSketchClipPlane({ frame: cadPrincipalFrame('XZ'), offsetMm: 4 });
    const normal = new THREE.Vector3(...cadPrincipalFrame('XZ').normal);
    const planePoint = normal.clone().multiplyScalar(4);
    expect(front.distanceToPoint(planePoint.clone().addScaledVector(normal, 1))).toBeCloseTo(-1, 12);
    expect(front.distanceToPoint(planePoint.clone().addScaledVector(normal, -1))).toBeCloseTo(1, 12);
    // A tolerance keeps faces lying on the sketch plane, such as the face a sketch was opened on.
    const tolerance = cadSketchClipTolerance(bounds);
    expect(tolerance).toBeGreaterThan(0);
    expect(cadSketchClipPlane({ frame: cadPrincipalFrame('XY'), offsetMm: 10 }, tolerance).distanceToPoint(new THREE.Vector3(1, 2, 10))).toBeCloseTo(tolerance, 15);
  });

  it('carries each new view to its listeners once and compares placements by value', () => {
    const link = createCadSketchCameraLink(), listener = vi.fn();
    const release = link.subscribe(listener);
    expect(link.current()).toBeNull();
    link.publish({ center: [1, 2], width: 40, span: 30 });
    link.publish({ center: [1, 2], width: 40, span: 30 });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(link.current()).toEqual({ center: [1, 2], width: 40, span: 30 });
    expect(Object.isFrozen(link.current())).toBe(true);
    link.publish({ center: [1, 2], width: 40, span: 31 });
    expect(listener).toHaveBeenCalledTimes(2);
    release();
    link.publish({ center: [0, 0], width: 40, span: 31 });
    expect(listener).toHaveBeenCalledTimes(2);
    const placement = placements['XY offset 12.5'];
    expect(sameCadSketchPlacementFrame(placement, { frame: { ...placement.frame }, offsetMm: 12.5 })).toBe(true);
    expect(sameCadSketchPlacementFrame(placement, { ...placement, offsetMm: 12.4 })).toBe(false);
    expect(sameCadSketchPlacementFrame(placement, placements['XZ offset -4'])).toBe(false);
    expect(sameCadSketchPlacementFrame(null, null)).toBe(true);
    expect(sameCadSketchPlacementFrame(placement, null)).toBe(false);
  });
});
