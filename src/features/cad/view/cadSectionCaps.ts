import * as THREE from 'three';

/** The flat colour a section cap fills cut material with. */
export const CAD_SECTION_CAP_COLOR = 0xc98a5e;
/** The longest stretch of cap building before input and drawing get a turn, in milliseconds. */
export const CAD_SECTION_CAP_SLICE_MS = 6;
/** Caps draw after everything else that is opaque; each cut body takes three steps in a row from here. */
const CAP_RENDER_ORDER = 10;
/** How many vertices or triangles a build handles between looks at the clock. */
const CHECK_EVERY = 8192;

/**
 * Section caps close the solids a section view cuts open. They are display only: nothing picks or exports them, and the exact section
 * of a body stays with the kernel.
 *
 * A cap is drawn on the cut plane from the body's own triangles. Every triangle the plane crosses gives one segment, directed by the
 * triangle's outward winding, so a body's segments run one way round its material and the other way round a cavity, whose shell faces
 * inward. The cap fills the plane wherever the segments wind round a point a number of times other than zero:
 *
 * - a fan of triangles from one point to every segment counts the winding into the stencil buffer, front faces adding one and back
 *   faces taking one away;
 * - one quad on the plane then colours where the count is not zero, and clears the count.
 *
 * That fills the union of a body's solids. Two solids one inside the other, or overlapping, fill all they cover. A cavity cancels the
 * solid around it, and so stays open. Solids that touch, or edges that four triangles share, need no joining. Everything drawn lies on
 * the plane, so the count does not depend on where the camera is: inside the kept material, or with the near plane through it.
 *
 * Caps are built once for each plane and each upload of the model's meshes, never for a frame or a hover, and draw three times for each
 * cut body: twice to count, once to fill. A body whose box the plane misses is skipped without preparing its triangles. A large body
 * builds in slices of a few milliseconds, so input keeps its turn. A build that a new plane, upload or hiding replaces is dropped, and
 * none of its caps is ever shown.
 *
 * A body gets no cap when some edge is not crossed as often one way as the other by the triangles on it: an open shell has no inside
 * to fill, and triangles that disagree about their outside cannot say where it is. Its cut stays open.
 */
export interface CadSectionCaps {
  readonly group: THREE.Group;
  /** The bodies to cap. Called with every upload of the model's meshes. */
  setBodies(bodies: readonly THREE.Mesh[]): void;
  /** The plane the bodies are clipped by; with no plane the caps draw nothing. The caps are rebuilt only when the plane moves. */
  setPlane(plane: THREE.Plane | null): void;
  dispose(): void;
}

export interface CadSectionCapsOptions {
  /** Called when caps that finished in a later slice join the group, so the view can draw them. */
  readonly onChange?: () => void;
  /** The longest stretch of building before input gets a turn, in milliseconds. */
  readonly sliceMs?: number;
  /** Runs `next` later and returns a way to cancel it; a new task by default. */
  readonly schedule?: (next: () => void) => () => void;
}

/** A body's triangles with the vertices its faces repeat joined into one, and whether they close. */
export interface CadCapSolid {
  readonly vertices: Float64Array;
  readonly triangles: Uint32Array;
  /** Every edge is crossed as often one way as the other by the triangles on it, so the triangles bound solids and their cavities. */
  readonly closed: boolean;
}

/** What one body's cap draws, in the body's own coordinates: the counting fans and the quad that fills where the count is not zero. */
export interface CadSectionCap {
  readonly fans: THREE.BufferGeometry;
  readonly fill: THREE.BufferGeometry;
}

/** Runs a build to its end at once. */
function finish<T>(steps: Generator<void, T>): T {
  for (;;) { const step = steps.next(); if (step.done) return step.value; }
}

/**
 * Joins the vertices `geometry` repeats at exactly the same place, as a tessellation repeats the points on an edge two faces share, and
 * checks that the triangles close. Costs O(vertices + triangles), once for each upload.
 */
export function cadCapSolid(geometry: THREE.BufferGeometry): CadCapSolid {
  return finish(cadCapSolidSteps(geometry));
}

function* cadCapSolidSteps(geometry: THREE.BufferGeometry): Generator<void, CadCapSolid> {
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
    if (item % CHECK_EVERY === CHECK_EVERY - 1) yield;
  }
  const corners = index ? index.count - index.count % 3 : total - total % 3, triangles = new Uint32Array(corners);
  let kept = 0;
  for (let corner = 0; corner < corners; corner += 3) {
    const a = joined[index ? index.getX(corner) : corner], b = joined[index ? index.getX(corner + 1) : corner + 1], c = joined[index ? index.getX(corner + 2) : corner + 2];
    if (a !== b && b !== c && c !== a) { triangles[kept++] = a; triangles[kept++] = b; triangles[kept++] = c; }
    if (corner % (3 * CHECK_EVERY) === 3 * CHECK_EVERY - 3) yield;
  }
  // Each triangle runs along its edges in its winding. Closed solids run along every edge as often one way as the other: once each for
  // an edge of one solid, twice each where two solids touch. The table has more slots than corners, so a free slot always ends a probe.
  const edgeSlots = tableSize(kept), low = new Int32Array(edgeSlots).fill(-1), high = new Uint32Array(edgeSlots), balance = new Int32Array(edgeSlots);
  for (let corner = 0; corner < kept; corner++) {
    const from = triangles[corner], to = triangles[corner % 3 === 2 ? corner - 2 : corner + 1], a = Math.min(from, to), b = Math.max(from, to);
    let slot = mix(Math.imul(a, 0x9e3779b1) ^ Math.imul(b, 0x85ebca77)) & (edgeSlots - 1);
    while (low[slot] >= 0 && !(low[slot] === a && high[slot] === b)) slot = (slot + 1) & (edgeSlots - 1);
    low[slot] = a; high[slot] = b; balance[slot] += from < to ? 1 : -1;
    if (corner % CHECK_EVERY === CHECK_EVERY - 1) yield;
  }
  let closed = kept > 0;
  for (let slot = 0; closed && slot < edgeSlots; slot++) closed = balance[slot] === 0;
  return Object.freeze({ vertices: vertices.slice(0, 3 * count), triangles: triangles.slice(0, kept), closed });
}
/** A power of two above `entries`, for an open-addressed table. */
const tableSize = (entries: number) => 2 ** Math.ceil(Math.log2(entries + 16));
/** Folds a hash's high bits into its low bits, which pick the slot. */
const mix = (hash: number) => { hash = Math.imul(hash ^ (hash >>> 16), 0x45d9f3b); return hash ^ (hash >>> 16); };

/**
 * The cap of `solid` on `plane`, in the solid's own coordinates, or `null` when the solid is open or the plane misses it. `plane` keeps
 * points whose signed distance is not negative, as a three.js clipping plane does.
 *
 * Points on the plane count as kept, so every crossing lies on an edge from a kept to a removed vertex, and the triangles on that edge
 * find the same point, computed from its lower vertex. A triangle the plane crosses leaves the kept side through one edge and returns
 * through another; its segment runs from where it leaves to where it returns, as the kept part's boundary does. Seen from the side the
 * plane's normal points to, the segments then run anticlockwise round material and clockwise round a cavity, and the fans count +1 in
 * material.
 */
export function cadSectionCapGeometry(solid: CadCapSolid, plane: THREE.Plane): CadSectionCap | null {
  return finish(cadSectionCapSteps(solid, plane));
}

function* cadSectionCapSteps(solid: CadCapSolid, plane: THREE.Plane): Generator<void, CadSectionCap | null> {
  if (!solid.closed) return null;
  const { vertices, triangles } = solid, count = vertices.length / 3, { normal, constant } = plane;
  const side = new Float64Array(count);
  for (let vertex = 0; vertex < count; vertex++) {
    side[vertex] = normal.x * vertices[3 * vertex] + normal.y * vertices[3 * vertex + 1] + normal.z * vertices[3 * vertex + 2] + constant;
    if (vertex % CHECK_EVERY === CHECK_EVERY - 1) yield;
  }
  // Each segment's start and end, x, y and z each.
  const ends: number[] = [], at = new Float64Array(6);
  const cross = (p: number, q: number, offset: number) => {
    const a = Math.min(p, q), b = Math.max(p, q), t = side[a] / (side[a] - side[b]);
    for (let axis = 0; axis < 3; axis++) {
      const from = vertices[3 * a + axis], to = vertices[3 * b + axis];
      at[offset + axis] = t === 0 ? from : t === 1 ? to : from + (to - from) * t;
    }
  };
  for (let corner = 0; corner < triangles.length; corner += 3) {
    if (corner % (3 * CHECK_EVERY) === 3 * CHECK_EVERY - 3) yield;
    let leaves = -1, returns = -1;
    for (let edge = 0; edge < 3; edge++) {
      const p = triangles[corner + edge], q = triangles[corner + (edge + 1) % 3], fromKept = side[p] >= 0, toKept = side[q] >= 0;
      if (fromKept && !toKept) leaves = edge; else if (!fromKept && toKept) returns = edge;
    }
    if (leaves < 0) continue;
    cross(triangles[corner + leaves], triangles[corner + (leaves + 1) % 3], 0);
    cross(triangles[corner + returns], triangles[corner + (returns + 1) % 3], 3);
    // A triangle that only touches the plane at a vertex gives a segment of no length, which counts nothing.
    if (at[0] !== at[3] || at[1] !== at[4] || at[2] !== at[5]) for (let item = 0; item < 6; item++) ends.push(at[item]);
  }
  const segments = ends.length / 6;
  if (!segments) return null;
  // The fans start from the middle of the cut, so they overlap little; any point of the plane would count the same.
  let ox = 0, oy = 0, oz = 0;
  for (let item = 0; item < ends.length; item += 3) { ox += ends[item]; oy += ends[item + 1]; oz += ends[item + 2]; }
  ox /= 2 * segments; oy /= 2 * segments; oz /= 2 * segments;
  // Snap the start onto the plane, which rounding in the average may have left a hair off.
  const off = normal.x * ox + normal.y * oy + normal.z * oz + constant;
  ox -= off * normal.x; oy -= off * normal.y; oz -= off * normal.z;
  const fans = new Float32Array(9 * segments);
  for (let segment = 0; segment < segments; segment++) {
    fans[9 * segment] = ox; fans[9 * segment + 1] = oy; fans[9 * segment + 2] = oz;
    for (let item = 0; item < 6; item++) fans[9 * segment + 3 + item] = ends[6 * segment + item];
  }
  // The quad covers every fan, with a margin so that no counted pixel on its border is missed.
  const across = new THREE.Vector3(), up = new THREE.Vector3();
  const least = Math.abs(normal.x) <= Math.abs(normal.y) && Math.abs(normal.x) <= Math.abs(normal.z) ? new THREE.Vector3(1, 0, 0) : Math.abs(normal.y) <= Math.abs(normal.z) ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1);
  across.crossVectors(least, normal).normalize(); up.crossVectors(normal, across);
  let minU = 0, maxU = 0, minV = 0, maxV = 0;
  for (let item = 0; item < ends.length; item += 3) {
    const x = ends[item] - ox, y = ends[item + 1] - oy, z = ends[item + 2] - oz, u = x * across.x + y * across.y + z * across.z, v = x * up.x + y * up.y + z * up.z;
    minU = Math.min(minU, u); maxU = Math.max(maxU, u); minV = Math.min(minV, v); maxV = Math.max(maxV, v);
  }
  const margin = 0.01 * Math.max(maxU - minU, maxV - minV) + 1e-6, quad = new Float32Array(12);
  [[minU - margin, minV - margin], [maxU + margin, minV - margin], [maxU + margin, maxV + margin], [minU - margin, maxV + margin]].forEach(([u, v], corner) => {
    quad[3 * corner] = ox + u * across.x + v * up.x; quad[3 * corner + 1] = oy + u * across.y + v * up.y; quad[3 * corner + 2] = oz + u * across.z + v * up.z;
  });
  const fanGeometry = new THREE.BufferGeometry(), fillGeometry = new THREE.BufferGeometry();
  fanGeometry.setAttribute('position', new THREE.BufferAttribute(fans, 3));
  fillGeometry.setAttribute('position', new THREE.BufferAttribute(quad, 3)); fillGeometry.setIndex([0, 1, 2, 0, 2, 3]);
  return { fans: fanGeometry, fill: fillGeometry };
}

const later = (next: () => void) => { const timer = setTimeout(next, 0); return () => clearTimeout(timer); };

export function createCadSectionCaps({ onChange, sliceMs = CAD_SECTION_CAP_SLICE_MS, schedule = later }: CadSectionCapsOptions = {}): CadSectionCaps {
  const group = new THREE.Group();
  group.name = 'cad-section-caps';
  group.visible = false;
  // Not clipped: a cap lies on the plane by construction, and rounding must not cut it away. The counting passes write only the
  // stencil buffer, whatever is in front, so the count is whole; the fill is depth-tested like any surface.
  const counting = (side: THREE.Side, operation: THREE.StencilOp) => new THREE.MeshBasicMaterial({ side, colorWrite: false, depthWrite: false, depthTest: false,
    stencilWrite: true, stencilFunc: THREE.AlwaysStencilFunc, stencilFail: operation, stencilZFail: operation, stencilZPass: operation });
  const front = counting(THREE.FrontSide, THREE.IncrementWrapStencilOp), back = counting(THREE.BackSide, THREE.DecrementWrapStencilOp);
  const fill = new THREE.MeshBasicMaterial({ color: CAD_SECTION_CAP_COLOR, side: THREE.DoubleSide, stencilWrite: true, stencilRef: 0, stencilFunc: THREE.NotEqualStencilFunc,
    stencilFail: THREE.ZeroStencilOp, stencilZFail: THREE.ZeroStencilOp, stencilZPass: THREE.ZeroStencilOp });
  let bodies: readonly THREE.Mesh[] = [];
  const solids = new Map<THREE.Mesh, CadCapSolid>();
  const placed = new THREE.Plane();
  let shown = false, built = false, generation = 0, cancel: (() => void) | null = null;
  /** Drops the caps and any build in progress, so nothing it was making can appear. */
  const clear = () => {
    cancel?.(); cancel = null; generation++;
    const geometries = new Set<THREE.BufferGeometry>();
    group.traverse(object => { if (object instanceof THREE.Mesh) geometries.add(object.geometry); });
    for (const geometry of geometries) geometry.dispose();
    group.clear(); built = false;
  };
  const capObject = (cap: CadSectionCap, body: THREE.Mesh, order: number) => {
    const object = new THREE.Group();
    object.name = 'cad-section-cap';
    // In the body's own coordinates the cap is as precise as its vertices.
    object.position.copy(body.position); object.matrixAutoUpdate = false; object.updateMatrix();
    for (const [geometry, material, step] of [[cap.fans, front, 0], [cap.fans, back, 1], [cap.fill, fill, 2]] as const) {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = step < 2 ? 'cad-section-cap-count' : 'cad-section-cap-fill';
      mesh.renderOrder = order + step; mesh.matrixAutoUpdate = false;
      object.add(mesh);
    }
    return object;
  };
  function* build(plane: THREE.Plane, of: readonly THREE.Mesh[]): Generator<void, void> {
    const local = new THREE.Plane();
    for (const [index, body] of of.entries()) {
      // n · (p + o) + c = n · p + (n · o + c).
      local.normal.copy(plane.normal); local.constant = plane.constant + plane.normal.dot(body.position);
      const geometry = body.geometry;
      if (!geometry.boundingBox) geometry.computeBoundingBox();
      if (!geometry.boundingBox!.intersectsPlane(local)) continue;
      let solid = solids.get(body);
      if (!solid) { solid = yield* cadCapSolidSteps(geometry); solids.set(body, solid); }
      const cap = yield* cadSectionCapSteps(solid, local);
      if (cap) group.add(capObject(cap, body, CAP_RENDER_ORDER + 3 * index));
      yield;
    }
  }
  const run = (steps: Generator<void, void>, own: number, inLaterSlice: boolean) => {
    if (own !== generation) return;
    cancel = null;
    const before = group.children.length, until = performance.now() + sliceMs;
    for (;;) {
      if (steps.next().done) { built = true; break; }
      if (performance.now() >= until) { cancel = schedule(() => run(steps, own, true)); break; }
    }
    group.visible = shown && group.children.length > 0;
    if (inLaterSlice && group.children.length !== before) onChange?.();
  };
  return {
    group,
    setBodies(next) { clear(); solids.clear(); bodies = next; group.visible = false; },
    setPlane(plane) {
      if (!plane) {
        shown = false; group.visible = false;
        // A build stopped part-way is dropped, not kept for later.
        if (cancel) clear();
        return;
      }
      shown = true;
      if ((built || cancel) && placed.equals(plane)) { group.visible = group.children.length > 0; return; }
      clear(); placed.copy(plane);
      run(build(placed.clone(), bodies), generation, false);
    },
    dispose() { clear(); solids.clear(); front.dispose(); back.dispose(); fill.dispose(); },
  };
}
