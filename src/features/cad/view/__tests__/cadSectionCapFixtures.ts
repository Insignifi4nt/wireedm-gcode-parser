import * as THREE from 'three';
import type { CadSectionCap } from '../cadSectionCaps';

/** How many times the fan vertices `start` to `start + count` wind round `point`, as `capWinding` counts them. */
function fanWinding(fans: THREE.BufferGeometry, start: number, count: number, point: THREE.Vector3, facing: THREE.Vector3): number {
  const position = fans.getAttribute('position'), triangle = new THREE.Triangle(), normal = new THREE.Vector3();
  let total = 0;
  for (let item = start; item < start + count; item += 3) {
    triangle.a.fromBufferAttribute(position, item); triangle.b.fromBufferAttribute(position, item + 1); triangle.c.fromBufferAttribute(position, item + 2);
    if (triangle.containsPoint(point)) total += Math.sign(triangle.getNormal(normal).dot(facing));
  }
  return total;
}

/**
 * How many times a cap's cut winds round `point`, as its fans count it in the stencil buffer when seen from the side `facing` points
 * to: each fan covering the point adds one when it turns anticlockwise from there and takes one away otherwise. A point on a fan's edge
 * would count twice, so probes keep off round coordinates.
 */
export function capWinding(cap: CadSectionCap, point: THREE.Vector3, facing = new THREE.Vector3(0, 0, -1)): number {
  return fanWinding(cap.fans, 0, cap.fans.getAttribute('position').count, point, facing);
}

/** How many times each count group's cut winds round `point`, as `capWinding` counts; one entry for a cap that counts at once. */
export function capGroupWindings(cap: CadSectionCap, point: THREE.Vector3, facing = new THREE.Vector3(0, 0, -1)): number[] {
  return (cap.groups ?? [{ start: 0, count: cap.fans.getAttribute('position').count }]).map(({ start, count }) => fanWinding(cap.fans, start, count, point, facing));
}

/**
 * The area a cap on the plane at height `z` colours: the cells of a `step` grid whose middle the cut winds round. The grid lines fall on
 * multiples of `step`, so a cap bounded by such lines is measured exactly.
 */
export function capCoveredArea(cap: CadSectionCap, z: number, step = 0.25): number {
  const box = new THREE.Box3().setFromBufferAttribute(cap.fill.getAttribute('position') as THREE.BufferAttribute), point = new THREE.Vector3();
  // A hair off the middle of each cell, so no probe lies on a fan's edge.
  const shift = 1e-4 * Math.SQRT2;
  let cells = 0;
  for (let x = Math.floor(box.min.x / step) * step + step / 2; x < box.max.x; x += step) {
    for (let y = Math.floor(box.min.y / step) * step + step / 2; y < box.max.y; y += step) if (capWinding(cap, point.set(x + shift, y + shift * Math.PI / 4, z)) !== 0) cells++;
  }
  return cells * step * step;
}
