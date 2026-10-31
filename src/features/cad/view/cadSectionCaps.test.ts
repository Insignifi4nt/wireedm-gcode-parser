import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { cadCapSolid, cadSectionCapGeometry, createCadSectionCaps } from './cadSectionCaps';

/** Keeps the side below `z`, as a section by the XY plane at that height does. */
const below = (z: number) => new THREE.Plane(new THREE.Vector3(0, 0, -1), z);
/** The area a cap covers, and whether it covers a point of its plane. */
function area(geometry: THREE.BufferGeometry) {
  const position = geometry.getAttribute('position'), index = geometry.index!, a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  let total = 0;
  for (let corner = 0; corner < index.count; corner += 3) {
    a.fromBufferAttribute(position, index.getX(corner)); b.fromBufferAttribute(position, index.getX(corner + 1)); c.fromBufferAttribute(position, index.getX(corner + 2));
    total += new THREE.Triangle(a, b, c).getArea();
  }
  return total;
}
function covers(geometry: THREE.BufferGeometry, point: THREE.Vector3) {
  const position = geometry.getAttribute('position'), index = geometry.index!, triangle = new THREE.Triangle();
  for (let corner = 0; corner < index.count; corner += 3) {
    triangle.a.fromBufferAttribute(position, index.getX(corner)); triangle.b.fromBufferAttribute(position, index.getX(corner + 1)); triangle.c.fromBufferAttribute(position, index.getX(corner + 2));
    if (triangle.containsPoint(point)) return true;
  }
  return false;
}
const square = (x: number, y: number, size: number) => [new THREE.Vector2(x, y), new THREE.Vector2(x + size, y), new THREE.Vector2(x + size, y + size), new THREE.Vector2(x, y + size)];
const zValues = (geometry: THREE.BufferGeometry) => [...new Set(Array.from(geometry.getAttribute('position').array as Float32Array).filter((_, item) => item % 3 === 2))];

describe('section cap geometry', () => {
  it('fills the cut of a closed body whose faces repeat their shared points, across the whole section and on the plane', () => {
    // Each box face carries its own copies of its corners, as a tessellation repeats the points of the edges two faces share.
    const solid = cadCapSolid(new THREE.BoxGeometry(10, 20, 30));
    expect(solid.closed).toBe(true);
    const cap = cadSectionCapGeometry(solid, below(5))!;
    expect(area(cap)).toBeCloseTo(200, 9); expect(zValues(cap)).toEqual([5]);
    // The other side of the same plane has the same cap.
    expect(area(cadSectionCapGeometry(solid, new THREE.Plane(new THREE.Vector3(0, 0, 1), -5))!)).toBeCloseTo(200, 9);
    // A plane that misses the body leaves nothing to fill.
    expect(cadSectionCapGeometry(solid, below(40))).toBeNull(); expect(cadSectionCapGeometry(solid, below(-40))).toBeNull();
  });

  it('leaves holes open and fills an island inside a hole, as nested loops', () => {
    // A 20 mm plate with a 10 mm square hole through it, and a separate 4 mm post standing inside the hole.
    const plate = new THREE.Shape(square(-10, -10, 20)); plate.holes.push(new THREE.Path(square(-5, -5, 10).reverse()));
    const solid = cadCapSolid(new THREE.ExtrudeGeometry([plate, new THREE.Shape(square(-2, -2, 4))], { depth: 10, bevelEnabled: false }));
    expect(solid.closed).toBe(true);
    const cap = cadSectionCapGeometry(solid, below(5))!;
    expect(area(cap)).toBeCloseTo(400 - 100 + 16, 9);
    expect(covers(cap, new THREE.Vector3(-7.5, 0, 5))).toBe(true);
    expect(covers(cap, new THREE.Vector3(-3.5, 0, 5))).toBe(false);
    expect(covers(cap, new THREE.Vector3(0, 0, 5))).toBe(true);
  });

  it('joins the cut through points lying on the plane, and leaves a face lying on the plane to draw itself', () => {
    // Two rows of side faces meet at z = 0, so the plane passes through vertices and along the edges between them.
    const solid = cadCapSolid(new THREE.BoxGeometry(10, 10, 10, 2, 2, 2));
    expect(solid.closed).toBe(true);
    const cap = cadSectionCapGeometry(solid, below(0))!;
    expect(area(cap)).toBeCloseTo(100, 9); expect(zValues(cap)).toEqual([0]);
    expect(cadSectionCapGeometry(solid, new THREE.Plane(new THREE.Vector3(0, 0, 1), 0))).not.toBeNull();
    // The top face lies on the plane and is kept, so nothing crosses: the face is the cut.
    expect(cadSectionCapGeometry(solid, below(5))).toBeNull();
  });

  it('gives an open shell no cap, even where its cut closes into a loop', () => {
    const box = new THREE.BoxGeometry(10, 10, 10);
    // Without its top face, the fifth of a box geometry's six, the box is an open shell, yet a cut across its four walls closes into a loop.
    const open = box.clone(); open.setIndex(Array.from(box.index!.array).filter((_, corner) => Math.floor(corner / 6) !== 4));
    const solid = cadCapSolid(open);
    expect(solid.closed).toBe(false);
    expect(cadSectionCapGeometry(solid, below(0))).toBeNull();
    // A single flat face is open too.
    expect(cadCapSolid(new THREE.PlaneGeometry(10, 10)).closed).toBe(false);
  });
});

describe('section caps in the view', () => {
  const body = (geometry: THREE.BufferGeometry, position: readonly [number, number, number]) => {
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial()); mesh.position.set(...position); mesh.updateMatrixWorld(); return mesh;
  };
  const caps = () => { const made = createCadSectionCaps(); return { made, shown: () => made.group.children as THREE.Mesh[] }; };

  it('caps every cut body where it lies, far from the origin too, and none it does not cut or that is open', () => {
    const { made, shown } = caps();
    const near = body(new THREE.BoxGeometry(10, 10, 10), [0, 0, 0]);
    // Far away, the body's vertices are near its own origin and the cap keeps their precision.
    const far = body(new THREE.BoxGeometry(2, 2, 2), [6000000, 0.005, 0.5]);
    const missed = body(new THREE.BoxGeometry(2, 2, 2), [20, 0, 10]);
    const open = new THREE.BoxGeometry(10, 10, 10); open.setIndex(Array.from(open.index!.array).slice(6));
    made.setBodies([near, far, missed, body(open, [40, 0, 0])]);
    made.setPlane(below(1));
    expect(made.group.visible).toBe(true);
    expect(shown().map(cap => cap.position.toArray())).toEqual([[0, 0, 0], [6000000, 0.005, 0.5]]);
    for (const cap of shown()) {
      expect(cap.name).toBe('cad-section-cap'); expect(cap.userData.featureId).toBeUndefined();
      cap.updateMatrixWorld();
      const point = new THREE.Vector3().fromBufferAttribute(cap.geometry.getAttribute('position'), 0).applyMatrix4(cap.matrixWorld);
      expect(point.z).toBeCloseTo(1, 12);
    }
    expect(area(shown()[0].geometry)).toBeCloseTo(100, 9); expect(area(shown()[1].geometry)).toBeCloseTo(4, 6);
    // The far cap's corners sit at its body's own ±1 mm, not rounded to the far coordinates.
    expect(Math.min(...Array.from(shown()[1].geometry.getAttribute('position').array as Float32Array).filter((_, item) => item % 3 === 1))).toBe(-1);
  });

  it('builds caps once for each plane and upload, keeps them while hidden, and draws nothing when no body is cut', () => {
    const { made, shown } = caps();
    made.setBodies([body(new THREE.BoxGeometry(10, 10, 10), [0, 0, 0])]);
    const plane = below(1);
    made.setPlane(plane); const first = shown()[0];
    made.setPlane(plane.clone()); expect(shown()[0]).toBe(first);
    made.setPlane(null); expect(made.group.visible).toBe(false);
    made.setPlane(plane); expect(shown()[0]).toBe(first); expect(made.group.visible).toBe(true);
    made.setPlane(below(2)); expect(shown()[0]).not.toBe(first); expect(zValues(shown()[0].geometry)).toEqual([2]);
    const moved = shown()[0];
    made.setBodies([body(new THREE.BoxGeometry(10, 10, 10), [0, 0, 0])]); expect(made.group.visible).toBe(false);
    made.setPlane(below(2)); expect(shown()[0]).not.toBe(moved);
    made.setPlane(below(50)); expect(shown()).toHaveLength(0); expect(made.group.visible).toBe(false);
    made.dispose();
  });
});
