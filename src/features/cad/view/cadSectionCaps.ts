import * as THREE from 'three';

/** The flat colour a section cap fills cut material with. */
export const CAD_SECTION_CAP_COLOR = 0xc98a5e;

/**
 * Section caps close the solids a section view cuts open. They are display only: nothing picks or exports them, and the exact section
 * of a body stays with the kernel.
 *
 * A cap is real geometry on the cut plane, made from the body's own triangles: every triangle the plane crosses gives one segment, the
 * segments join into closed loops, loops inside loops become holes, and the loops are filled. So it is drawn like any surface, wherever the
 * camera is: inside the kept material, or with the near plane through it. Caps are built once for each plane and each upload of the
 * model's meshes, never for a frame or a hover, and draw once for each cut body.
 *
 * A body whose triangles do not close, where some edge does not join exactly two triangles, gets no cap: an open shell has no inside to
 * fill, so its cut stays open.
 */
export interface CadSectionCaps {
  readonly group: THREE.Group;
  /** The bodies to cap. Called with every upload of the model's meshes. */
  setBodies(bodies: readonly THREE.Mesh[]): void;
  /** The plane the bodies are clipped by; with no plane the caps draw nothing. The caps are rebuilt only when the plane moves. */
  setPlane(plane: THREE.Plane | null): void;
  dispose(): void;
}

/** A body's triangles with the vertices its faces repeat joined into one, and whether every edge joins exactly two triangles. */
export interface CadCapSolid {
  readonly vertices: Float64Array;
  readonly triangles: Uint32Array;
  readonly closed: boolean;
}

/**
 * Joins the vertices `geometry` repeats at exactly the same place, as a tessellation repeats the points on an edge two faces share, and
 * checks that the triangles close. Costs O(vertices + triangles), once for each upload.
 */
export function cadCapSolid(geometry: THREE.BufferGeometry): CadCapSolid {
  const position = geometry.getAttribute('position'), index = geometry.index, total = position.count;
  // Open-addressed tables in typed arrays: a large mesh joins and counts in tens of milliseconds, where maps take hundreds.
  const scratch = new Float32Array(3), bits = new Uint32Array(scratch.buffer);
  const pointSlots = tableSize(2 * total), points = new Int32Array(pointSlots).fill(-1);
  const keys = new Uint32Array(3 * total), vertices = new Float64Array(3 * total), joined = new Uint32Array(total);
  let count = 0;
  for (let item = 0; item < total; item++) {
    // Adding zero turns a negative zero into zero, so both spellings of a point join.
    scratch[0] = position.getX(item) + 0; scratch[1] = position.getY(item) + 0; scratch[2] = position.getZ(item) + 0;
    let slot = mix(Math.imul(bits[0], 0x9e3779b1) ^ Math.imul(bits[1], 0x85ebca77) ^ Math.imul(bits[2], 0xc2b2ae3d)) & (pointSlots - 1), id = points[slot];
    while (id >= 0 && !(keys[3 * id] === bits[0] && keys[3 * id + 1] === bits[1] && keys[3 * id + 2] === bits[2])) { slot = (slot + 1) & (pointSlots - 1); id = points[slot]; }
    if (id < 0) {
      id = count++; points[slot] = id;
      for (let axis = 0; axis < 3; axis++) { keys[3 * id + axis] = bits[axis]; vertices[3 * id + axis] = scratch[axis]; }
    }
    joined[item] = id;
  }
  const corners = index ? index.count - index.count % 3 : total - total % 3, triangles = new Uint32Array(corners);
  let kept = 0;
  for (let corner = 0; corner < corners; corner += 3) {
    const a = joined[index ? index.getX(corner) : corner], b = joined[index ? index.getX(corner + 1) : corner + 1], c = joined[index ? index.getX(corner + 2) : corner + 2];
    if (a !== b && b !== c && c !== a) { triangles[kept++] = a; triangles[kept++] = b; triangles[kept++] = c; }
  }
  // Every edge must join exactly two triangles. The table has more slots than corners, so a free slot always ends a probe.
  const edgeSlots = tableSize(kept), low = new Int32Array(edgeSlots).fill(-1), high = new Uint32Array(edgeSlots), uses = new Uint8Array(edgeSlots);
  for (let corner = 0; corner < kept; corner++) {
    const from = triangles[corner], to = triangles[corner % 3 === 2 ? corner - 2 : corner + 1], a = Math.min(from, to), b = Math.max(from, to);
    let slot = mix(Math.imul(a, 0x9e3779b1) ^ Math.imul(b, 0x85ebca77)) & (edgeSlots - 1);
    while (low[slot] >= 0 && !(low[slot] === a && high[slot] === b)) slot = (slot + 1) & (edgeSlots - 1);
    low[slot] = a; high[slot] = b;
    if (uses[slot] < 3) uses[slot]++;
  }
  let closed = kept > 0;
  for (let slot = 0; closed && slot < edgeSlots; slot++) closed = low[slot] < 0 || uses[slot] === 2;
  return Object.freeze({ vertices: vertices.slice(0, 3 * count), triangles: triangles.slice(0, kept), closed });
}
/** A power of two above `entries`, for an open-addressed table. */
const tableSize = (entries: number) => 2 ** Math.ceil(Math.log2(entries + 16));
/** Folds a hash's high bits into its low bits, which pick the slot. */
const mix = (hash: number) => { hash = Math.imul(hash ^ (hash >>> 16), 0x45d9f3b); return hash ^ (hash >>> 16); };

/**
 * The cap of `solid` on `plane`, in the solid's own coordinates, or `null` when the solid is open or the plane misses it. `plane` keeps
 * points whose signed distance is not negative, as a three.js clipping plane does. Points on the plane count as kept, so every crossing
 * lies on an edge from a kept to a removed vertex, and the two triangles on that edge find the same point: the segments join exactly.
 */
export function cadSectionCapGeometry(solid: CadCapSolid, plane: THREE.Plane): THREE.BufferGeometry | null {
  if (!solid.closed) return null;
  const { vertices, triangles } = solid, count = vertices.length / 3, { normal, constant } = plane;
  const side = new Float64Array(count);
  for (let vertex = 0; vertex < count; vertex++) side[vertex] = normal.x * vertices[3 * vertex] + normal.y * vertices[3 * vertex + 1] + normal.z * vertices[3 * vertex + 2] + constant;
  const nodes = new Map<number, number>(), points: number[] = [], links: number[] = [];
  const node = (p: number, q: number) => {
    const a = Math.min(p, q), b = Math.max(p, q), key = a * count + b;
    let id = nodes.get(key);
    if (id === undefined) {
      id = links.length / 2; nodes.set(key, id); links.push(-1, -1);
      const t = side[a] / (side[a] - side[b]);
      for (let axis = 0; axis < 3; axis++) points.push(vertices[3 * a + axis] + (vertices[3 * b + axis] - vertices[3 * a + axis]) * t);
    }
    return id;
  };
  const link = (from: number, to: number) => {
    if (links[2 * from] < 0) links[2 * from] = to;
    else if (links[2 * from + 1] < 0) links[2 * from + 1] = to;
    else return false;
    return true;
  };
  const crossing: number[] = [];
  for (let corner = 0; corner < triangles.length; corner += 3) {
    crossing.length = 0;
    for (let edge = 0; edge < 3; edge++) {
      const p = triangles[corner + edge], q = triangles[corner + (edge + 1) % 3];
      if ((side[p] >= 0) !== (side[q] >= 0)) crossing.push(node(p, q));
    }
    // A closed surface crosses the plane through two edges of a triangle or none; a third link on a point means it does not close.
    if (crossing.length === 2 && !(link(crossing[0], crossing[1]) && link(crossing[1], crossing[0]))) return null;
  }
  const total = links.length / 2;
  if (!total) return null;
  // Plane coordinates: two directions across the plane, from the first crossing, so far-away bodies keep their precision.
  const across = new THREE.Vector3(), up = new THREE.Vector3();
  const least = Math.abs(normal.x) <= Math.abs(normal.y) && Math.abs(normal.x) <= Math.abs(normal.z) ? new THREE.Vector3(1, 0, 0) : Math.abs(normal.y) <= Math.abs(normal.z) ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1);
  across.crossVectors(normal, least).normalize(); up.crossVectors(normal, across);
  const flat = new Float64Array(2 * total);
  for (let id = 0; id < total; id++) {
    const x = points[3 * id] - points[0], y = points[3 * id + 1] - points[1], z = points[3 * id + 2] - points[2];
    flat[2 * id] = x * across.x + y * across.y + z * across.z; flat[2 * id + 1] = x * up.x + y * up.y + z * up.z;
  }
  interface Loop { readonly ids: number[]; readonly area: number; readonly min: [number, number]; readonly max: [number, number]; parent: number; depth: number }
  const loops: Loop[] = [], seen = new Uint8Array(total);
  for (let start = 0; start < total; start++) {
    if (seen[start]) continue;
    if (links[2 * start + 1] < 0) return null;
    const ids: number[] = [];
    let previous = -1, current = start;
    while (!seen[current]) {
      seen[current] = 1;
      // A crossing through a vertex on the plane repeats that point; one copy is enough.
      const last = ids.at(-1);
      if (last === undefined || flat[2 * last] !== flat[2 * current] || flat[2 * last + 1] !== flat[2 * current + 1]) ids.push(current);
      const next = links[2 * current] !== previous ? links[2 * current] : links[2 * current + 1];
      previous = current; current = next;
    }
    if (current !== start) return null;
    if (ids.length > 1 && flat[2 * ids[0]] === flat[2 * ids.at(-1)!] && flat[2 * ids[0] + 1] === flat[2 * ids.at(-1)! + 1]) ids.pop();
    if (ids.length < 3) continue;
    let area = 0;
    const min: [number, number] = [Infinity, Infinity], max: [number, number] = [-Infinity, -Infinity];
    for (let item = 0; item < ids.length; item++) {
      const a = ids[item], b = ids[(item + 1) % ids.length];
      area += flat[2 * a] * flat[2 * b + 1] - flat[2 * b] * flat[2 * a + 1];
      for (let axis = 0; axis < 2; axis++) { min[axis] = Math.min(min[axis], flat[2 * a + axis]); max[axis] = Math.max(max[axis], flat[2 * a + axis]); }
    }
    if (area !== 0) loops.push({ ids, area: Math.abs(area) / 2, min, max, parent: -1, depth: 0 });
  }
  // A loop's parent is the smallest loop around it. Loops of a solid's section never cross, so one point of a loop tells.
  loops.sort((left, right) => right.area - left.area);
  const inside = (loop: Loop, x: number, y: number) => {
    if (x < loop.min[0] || x > loop.max[0] || y < loop.min[1] || y > loop.max[1]) return false;
    let crossings = false;
    for (let item = 0, before = loop.ids.length - 1; item < loop.ids.length; before = item++) {
      const ax = flat[2 * loop.ids[item]], ay = flat[2 * loop.ids[item] + 1], bx = flat[2 * loop.ids[before]], by = flat[2 * loop.ids[before] + 1];
      if ((ay > y) !== (by > y) && x < (bx - ax) * (y - ay) / (by - ay) + ax) crossings = !crossings;
    }
    return crossings;
  };
  for (let item = 0; item < loops.length; item++) {
    const probe = loops[item].ids[0], x = flat[2 * probe], y = flat[2 * probe + 1];
    for (let outer = item - 1; outer >= 0; outer--) {
      if (!inside(loops[outer], x, y)) continue;
      loops[item].parent = outer; loops[item].depth = loops[outer].depth + 1; break;
    }
  }
  // Loops at an even depth bound material and those at an odd depth are its holes; a loop inside a hole is an island again.
  const positions: number[] = [], indices: number[] = [];
  const holesOf = new Map<number, Loop[]>();
  for (const loop of loops) if (loop.depth % 2 === 1) holesOf.set(loop.parent, [...holesOf.get(loop.parent) ?? [], loop]);
  const vector = (id: number) => new THREE.Vector2(flat[2 * id], flat[2 * id + 1]);
  loops.forEach((loop, item) => {
    if (loop.depth % 2 === 1) return;
    const holes = holesOf.get(item) ?? [], base = positions.length / 3;
    for (const id of [loop, ...holes].flatMap(part => part.ids)) positions.push(points[3 * id], points[3 * id + 1], points[3 * id + 2]);
    for (const face of THREE.ShapeUtils.triangulateShape(loop.ids.map(vector), holes.map(hole => hole.ids.map(vector)))) indices.push(base + face[0], base + face[1], base + face[2]);
  });
  if (!indices.length) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  return geometry;
}

export function createCadSectionCaps(): CadSectionCaps {
  const group = new THREE.Group();
  group.name = 'cad-section-caps';
  group.visible = false;
  // Not clipped: a cap lies on the plane by construction, and rounding must not cut it away.
  const material = new THREE.MeshBasicMaterial({ color: CAD_SECTION_CAP_COLOR, side: THREE.DoubleSide });
  let bodies: readonly THREE.Mesh[] = [];
  const solids = new Map<THREE.Mesh, CadCapSolid>();
  const placed = new THREE.Plane(), local = new THREE.Plane();
  let built = false;
  const clear = () => {
    for (const child of group.children) if (child instanceof THREE.Mesh) child.geometry.dispose();
    group.clear(); built = false;
  };
  return {
    group,
    setBodies(next) { clear(); solids.clear(); bodies = next; group.visible = false; },
    setPlane(plane) {
      if (!plane) { group.visible = false; return; }
      if (!built || !placed.equals(plane)) {
        clear(); placed.copy(plane);
        for (const body of bodies) {
          let solid = solids.get(body);
          if (!solid) { solid = cadCapSolid(body.geometry); solids.set(body, solid); }
          // In the body's own coordinates the cap is as precise as its vertices: n · (p + o) + c = n · p + (n · o + c).
          local.normal.copy(plane.normal); local.constant = plane.constant + plane.normal.dot(body.position);
          const geometry = cadSectionCapGeometry(solid, local);
          if (!geometry) continue;
          const cap = new THREE.Mesh(geometry, material);
          cap.name = 'cad-section-cap';
          cap.position.copy(body.position);
          cap.matrixAutoUpdate = false; cap.updateMatrix();
          group.add(cap);
        }
        built = true;
      }
      group.visible = group.children.length > 0;
    },
    dispose() { clear(); solids.clear(); material.dispose(); },
  };
}
