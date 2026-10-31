import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { cadCapSolid, cadSectionCapGeometry, createCadSectionCaps, type CadSectionCap } from './cadSectionCaps';
import { capCoveredArea, capWinding } from './__tests__/cadSectionCapFixtures';

/** Keeps the side below `z`, as a section by the XY plane at that height does. */
const below = (z: number) => new THREE.Plane(new THREE.Vector3(0, 0, -1), z);
const square = (x: number, y: number, size: number) => [new THREE.Vector2(x, y), new THREE.Vector2(x + size, y), new THREE.Vector2(x + size, y + size), new THREE.Vector2(x, y + size)];
const zValues = (cap: CadSectionCap) => [...new Set([cap.fans, cap.fill].flatMap(geometry => Array.from(geometry.getAttribute('position').array as Float32Array).filter((_, item) => item % 3 === 2)))];
const covers = (cap: CadSectionCap, x: number, y: number, z: number) => capWinding(cap, new THREE.Vector3(x, y, z)) !== 0;

describe('section cap geometry', () => {
  it('fills the cut of a closed body whose faces repeat their shared points, across the whole section and on the plane', () => {
    // Each box face carries its own copies of its corners, as a tessellation repeats the points of the edges two faces share.
    const solid = cadCapSolid(new THREE.BoxGeometry(10, 20, 30));
    expect(solid.closed).toBe(true);
    const cap = cadSectionCapGeometry(solid, below(5))!;
    expect(capCoveredArea(cap, 5)).toBe(200); expect(zValues(cap)).toEqual([5]);
    // Seen from the kept side the cut winds once round its material, from the other side once the other way: the stencil counts one.
    expect(capWinding(cap, new THREE.Vector3(1.3, 2.9, 5))).toBe(1);
    expect(capWinding(cap, new THREE.Vector3(1.3, 2.9, 5), new THREE.Vector3(0, 0, 1))).toBe(-1);
    // The other side of the same plane has the same cap.
    expect(capCoveredArea(cadSectionCapGeometry(solid, new THREE.Plane(new THREE.Vector3(0, 0, 1), -5))!, 5)).toBe(200);
    // A plane that misses the body leaves nothing to fill.
    expect(cadSectionCapGeometry(solid, below(40))).toBeNull(); expect(cadSectionCapGeometry(solid, below(-40))).toBeNull();
  });

  it('leaves holes open and fills an island inside a hole, by how the cut winds round them', () => {
    // A 20 mm plate with a 10 mm square hole through it, and a separate 4 mm post standing inside the hole.
    const plate = new THREE.Shape(square(-10, -10, 20)); plate.holes.push(new THREE.Path(square(-5, -5, 10).reverse()));
    const solid = cadCapSolid(new THREE.ExtrudeGeometry([plate, new THREE.Shape(square(-2, -2, 4))], { depth: 10, bevelEnabled: false }));
    expect(solid.closed).toBe(true);
    const cap = cadSectionCapGeometry(solid, below(5))!;
    expect(capCoveredArea(cap, 5)).toBe(400 - 100 + 16);
    expect(covers(cap, -7.5, 0.3, 5)).toBe(true); expect(covers(cap, -3.5, 0.3, 5)).toBe(false); expect(covers(cap, 0.1, 0.3, 5)).toBe(true);
  });

  it('fills solids one inside another and overlapping solids wholly, where nesting would have left holes', () => {
    // Three boxes in one body, as a STEP file with several solids gives: a 4 mm box inside a 10 mm one, and two 10 mm boxes overlapping
    // by a 5 mm square. All face outward.
    const merged = (...boxes: THREE.BufferGeometry[]) => {
      const positions: number[] = [], indices: number[] = [];
      for (const box of boxes) {
        const base = positions.length / 3;
        positions.push(...box.getAttribute('position').array); indices.push(...Array.from(box.index!.array, index => index + base));
      }
      const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); geometry.setIndex(indices);
      return geometry;
    };
    const box = (size: number, x: number, y: number) => new THREE.BoxGeometry(size, size, 10).translate(x, y, 0);
    const nested = cadSectionCapGeometry(cadCapSolid(merged(box(10, 0, 0), box(4, 0, 0))), below(0))!;
    expect(capCoveredArea(nested, 0)).toBe(100);
    // The middle is inside both solids, so the cut winds round it twice.
    expect(capWinding(nested, new THREE.Vector3(0.1, 0.3, 0))).toBe(2);
    const overlapping = cadSectionCapGeometry(cadCapSolid(merged(box(10, 0, 0), box(10, 5, 5))), below(0))!;
    expect(capCoveredArea(overlapping, 0)).toBe(175);
    expect(covers(overlapping, 2.6, 2.7, 0)).toBe(true); expect(covers(overlapping, 8.1, 8.3, 0)).toBe(true); expect(covers(overlapping, -4.1, 8.3, 0)).toBe(false);
  });

  it('joins the cut through points lying on the plane, and leaves a face lying on the plane to draw itself', () => {
    // Two rows of side faces meet at z = 0, so the plane passes through vertices and along the edges between them.
    const solid = cadCapSolid(new THREE.BoxGeometry(10, 10, 10, 2, 2, 2));
    expect(solid.closed).toBe(true);
    const cap = cadSectionCapGeometry(solid, below(0))!;
    expect(capCoveredArea(cap, 0)).toBe(100); expect(zValues(cap)).toEqual([0]);
    expect(cadSectionCapGeometry(solid, new THREE.Plane(new THREE.Vector3(0, 0, 1), 0))).not.toBeNull();
    // The top face lies on the plane and is kept, so nothing crosses: the face is the cut.
    expect(cadSectionCapGeometry(solid, below(5))).toBeNull();
  });

  it('gives an open shell and a body whose faces disagree about their outside no cap, even where the cut closes into a loop', () => {
    const box = new THREE.BoxGeometry(10, 10, 10);
    // Without its top face, the fifth of a box geometry's six, the box is an open shell, yet a cut across its four walls closes into a loop.
    const open = box.clone(); open.setIndex(Array.from(box.index!.array).filter((_, corner) => Math.floor(corner / 6) !== 4));
    const solid = cadCapSolid(open);
    expect(solid.closed).toBe(false);
    expect(cadSectionCapGeometry(solid, below(0))).toBeNull();
    // With one face turned inside out, every edge still joins two triangles, but those round that face run the same way.
    const turned = box.clone(), corners = Array.from(box.index!.array);
    for (let corner = 0; corner < 6; corner += 3) [corners[corner + 1], corners[corner + 2]] = [corners[corner + 2], corners[corner + 1]];
    turned.setIndex(corners);
    expect(cadCapSolid(turned).closed).toBe(false);
    // A single flat face is open too.
    expect(cadCapSolid(new THREE.PlaneGeometry(10, 10)).closed).toBe(false);
  });
});

describe('section caps in the view', () => {
  const body = (geometry: THREE.BufferGeometry, position: readonly [number, number, number]) => {
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial()); mesh.position.set(...position); mesh.updateMatrixWorld(); return mesh;
  };
  const shownCaps = (made: ReturnType<typeof createCadSectionCaps>) => made.group.children as THREE.Group[];
  const capIn = (object: THREE.Group): CadSectionCap => ({ fans: (object.children[0] as THREE.Mesh).geometry, fill: (object.children[2] as THREE.Mesh).geometry });

  it('caps every cut body where it lies, far from the origin too, and none it does not cut or that is open', () => {
    const made = createCadSectionCaps();
    const near = body(new THREE.BoxGeometry(10, 10, 10), [0, 0, 0]);
    // Far away, the body's vertices are near its own origin and the cap keeps their precision.
    const far = body(new THREE.BoxGeometry(2, 2, 2), [6000000, 0.005, 0.5]);
    const missed = body(new THREE.BoxGeometry(2, 2, 2), [20, 0, 10]);
    const open = new THREE.BoxGeometry(10, 10, 10); open.setIndex(Array.from(open.index!.array).slice(6));
    made.setBodies([near, far, missed, body(open, [40, 0, 0])]);
    made.setPlane(below(1));
    expect(made.group.visible).toBe(true);
    expect(shownCaps(made).map(cap => cap.position.toArray())).toEqual([[0, 0, 0], [6000000, 0.005, 0.5]]);
    for (const cap of shownCaps(made)) {
      expect(cap.name).toBe('cad-section-cap'); cap.traverse(object => expect(object.userData.featureId).toBeUndefined());
      // Two passes count the winding and a third fills, each in its own turn after the bodies.
      expect(cap.children.map(child => [child.name, child.renderOrder])).toEqual([['cad-section-cap-count', expect.any(Number)], ['cad-section-cap-count', expect.any(Number)], ['cad-section-cap-fill', expect.any(Number)]]);
      expect(cap.children[1].renderOrder - cap.children[0].renderOrder).toBe(1); expect(cap.children[2].renderOrder - cap.children[1].renderOrder).toBe(1);
      cap.updateMatrixWorld();
      const point = new THREE.Vector3().fromBufferAttribute((cap.children[2] as THREE.Mesh).geometry.getAttribute('position'), 0).applyMatrix4(cap.matrixWorld);
      expect(point.z).toBeCloseTo(1, 12);
    }
    // Local plane height: the far body sits at z = 0.5, so the cut lies 0.5 above its own origin.
    expect(capCoveredArea(capIn(shownCaps(made)[0]), 1)).toBe(100); expect(capCoveredArea(capIn(shownCaps(made)[1]), 0.5)).toBe(4);
    // The far cap's corners sit at its body's own ±1 mm, not rounded to the far coordinates.
    expect(Math.min(...Array.from(capIn(shownCaps(made)[1]).fans.getAttribute('position').array as Float32Array).filter((_, item) => item % 3 === 1))).toBe(-1);
  });

  it('builds caps once for each plane and upload, keeps them while hidden, and draws nothing when no body is cut', () => {
    const made = createCadSectionCaps();
    made.setBodies([body(new THREE.BoxGeometry(10, 10, 10), [0, 0, 0])]);
    const plane = below(1);
    made.setPlane(plane); const first = shownCaps(made)[0];
    made.setPlane(plane.clone()); expect(shownCaps(made)[0]).toBe(first);
    made.setPlane(null); expect(made.group.visible).toBe(false);
    made.setPlane(plane); expect(shownCaps(made)[0]).toBe(first); expect(made.group.visible).toBe(true);
    made.setPlane(below(2)); expect(shownCaps(made)[0]).not.toBe(first); expect(zValues(capIn(shownCaps(made)[0]))).toEqual([2]);
    const moved = shownCaps(made)[0];
    made.setBodies([body(new THREE.BoxGeometry(10, 10, 10), [0, 0, 0])]); expect(made.group.visible).toBe(false);
    made.setPlane(below(2)); expect(shownCaps(made)[0]).not.toBe(moved);
    made.setPlane(below(50)); expect(shownCaps(made)).toHaveLength(0); expect(made.group.visible).toBe(false);
    made.dispose();
  });

  it('skips a body whose box the plane misses without reading its triangles', () => {
    // Built in one go, however long it takes.
    const made = createCadSectionCaps({ sliceMs: Infinity }), geometry = new THREE.BoxGeometry(10, 10, 10, 40, 40, 40);
    geometry.computeBoundingBox();
    const read = vi.spyOn(geometry, 'getAttribute');
    made.setBodies([body(geometry, [0, 0, 0])]);
    made.setPlane(below(6)); made.setPlane(below(-6));
    expect(read).not.toHaveBeenCalled(); expect(shownCaps(made)).toHaveLength(0);
    made.setPlane(below(1)); expect(read).toHaveBeenCalled(); expect(shownCaps(made)).toHaveLength(1);
  });

  it('builds a large body in slices, and never shows a build that a new plane, upload or hiding replaced', () => {
    const queue = new Set<() => void>();
    const schedule = (next: () => void) => { queue.add(next); return () => { queue.delete(next); }; };
    const drain = () => { let slices = 0; while (queue.size) { const [next] = queue; queue.delete(next); next(); slices++; } return slices; };
    const onChange = vi.fn();
    // A zero slice gives input a turn at every chance, so even this 43,200-triangle box takes many slices.
    const made = createCadSectionCaps({ onChange, sliceMs: 0, schedule });
    const large = () => body(new THREE.BoxGeometry(10, 10, 10, 60, 60, 60), [0, 0, 0]);
    made.setBodies([large()]);
    made.setPlane(below(1));
    expect(shownCaps(made)).toHaveLength(0); expect(made.group.visible).toBe(false); expect(queue.size).toBe(1);
    // A slice still queued when the plane moves is cancelled, and one that runs anyway changes nothing.
    const stale = [...queue][0];
    made.setPlane(below(2)); stale();
    expect(shownCaps(made)).toHaveLength(0);
    expect(drain()).toBeGreaterThan(3);
    expect(shownCaps(made)).toHaveLength(1); expect(zValues(capIn(shownCaps(made)[0]))).toEqual([2]); expect(made.group.visible).toBe(true);
    expect(onChange).toHaveBeenCalledTimes(1);
    // The prepared body is kept for the next plane, which needs only the cut.
    made.setPlane(below(3)); drain(); expect(zValues(capIn(shownCaps(made)[0]))).toEqual([3]);
    // A new upload drops a build in progress for the old bodies.
    made.setPlane(below(4)); expect(queue.size).toBe(1);
    const old = [...queue][0];
    made.setBodies([]); old(); drain(); made.setPlane(below(4)); drain();
    expect(shownCaps(made)).toHaveLength(0);
    // Hiding the caps part-way drops that build too, and showing them again starts afresh.
    made.setBodies([large()]); made.setPlane(below(1)); made.setPlane(null); drain();
    expect(shownCaps(made)).toHaveLength(0); expect(made.group.visible).toBe(false);
    made.setPlane(below(1)); drain();
    expect(shownCaps(made)).toHaveLength(1); expect(zValues(capIn(shownCaps(made)[0]))).toEqual([1]);
    made.dispose(); expect(queue.size).toBe(0);
  });
});
