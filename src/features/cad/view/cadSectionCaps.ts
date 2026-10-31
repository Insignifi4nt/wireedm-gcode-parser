import * as THREE from 'three';
import type { CadMesh } from '../../../domain/cad/cadDocument';

/** The flat colour a section cap fills cut material with. */
export const CAD_SECTION_CAP_COLOR = 0xc98a5e;
/** The longest stretch of cap building before input and drawing get a turn, in milliseconds. */
export const CAD_SECTION_CAP_SLICE_MS = 6;
/** Caps draw after everything else that is opaque, each cut body's steps in a row from here. */
const CAP_RENDER_ORDER = 10;
/** How many vertices, triangles or segments a build handles between looks at the clock. */
const CHECK_EVERY = 8192;
/**
 * How many solids one count holds. Where k of a body's solids cover a point of the plane, the body's triangles wind k times round it,
 * since each solid's own triangles wind once round its material and not at all elsewhere. The stencil buffer's eight bits count modulo
 * 256, so a body of at most 255 solids counts at once, and its count is zero only where none of them is.
 */
export const CAD_SECTION_CAP_SOLIDS_AT_ONCE = 255;
/**
 * A body of more solids counts them in groups of at most 127, numbered as the kernel lists them, in the stencil's low seven bits, which
 * count modulo 128. A group's count lies between 0 and 127, so it is zero only where none of its solids is. After each group one pass
 * sets the top bit wherever the group's count is not zero and clears the count, so the next group starts from zero; the fill then
 * colours where the top bit is set. However many solids cover a point, no count goes past what one group holds.
 */
export const CAD_SECTION_CAP_GROUP_SOLIDS = 127;
const LOW_BITS = 0x7f, UNION_BIT = 0x80;

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
 * A body of more than 255 solids counts them in groups, as `CAD_SECTION_CAP_GROUP_SOLIDS` describes, so the count never wraps.
 *
 * Caps are built once for each plane and each upload of the model's meshes, never for a frame or a hover. A cut body draws three times,
 * twice to count and once to fill; a body counted in groups draws three times for each group the plane crosses, and once to fill. A body
 * whose box the plane misses is skipped without preparing its triangles. A large body builds in slices of a few milliseconds, so input
 * keeps its turn. A build that a new plane, upload or hiding replaces is dropped, and none of its caps is ever shown.
 *
 * A body gets no cap when some edge is not crossed as often one way as the other by the triangles on it: an open shell has no inside
 * to fill, and triangles that disagree about their outside cannot say where it is. Its cut stays open, as does the cut of a body of more
 * than 255 solids whose triangles are not told apart by solid.
 */
export interface CadSectionCaps {
  readonly group: THREE.Group;
  /**
   * The bodies to cap, and what the kernel says of each one's solids. Called with every upload of the model's meshes. A body with no
   * solid count counts at once.
   */
  setBodies(bodies: readonly THREE.Mesh[], solids?: (body: THREE.Mesh) => CadCapBodySolids | undefined): void;
  /** The plane the bodies are clipped by; with no plane the caps draw nothing. The caps are rebuilt only when the plane moves. */
  setPlane(plane: THREE.Plane | null): void;
  dispose(): void;
}

/** What the kernel says of a body's native solids. */
export interface CadCapBodySolids {
  /** How many solids the body has. */
  readonly count: number;
  /**
   * Runs of the body's index buffer, in corners, and the solid each run's triangles bound, numbered from 0 below `count`. Needed only
   * for a body of more than 255 solids.
   */
  readonly runs?: readonly { readonly start: number; readonly count: number; readonly solid: number }[];
}

/**
 * What a kernel mesh says of its body's solids, for `setBodies`: nothing for a mesh that gives no solid count, and the runs of each
 * solid's faces only for a body of more solids than count at once.
 */
export function cadCapBodySolids(mesh: Pick<CadMesh, 'solidCount' | 'faceGroups' | 'faceSolids'>): CadCapBodySolids | undefined {
  const { solidCount, faceGroups, faceSolids } = mesh;
  if (solidCount === undefined) return undefined;
  if (solidCount <= CAD_SECTION_CAP_SOLIDS_AT_ONCE || !faceSolids) return { count: solidCount };
  return { count: solidCount, runs: faceGroups.map((group, index) => ({ start: group.start, count: group.count, solid: faceSolids[index] })) };
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
  /**
   * Every edge is crossed as often one way as the other by the triangles on it, within each count group, so the triangles bound solids
   * and their cavities. False too for a body of more than 255 solids whose triangles are not told apart by solid.
   */
  readonly closed: boolean;
  /** For a body counted in groups, the group of each triangle; `null` when the body counts at once. */
  readonly groups: Uint16Array | null;
}

/**
 * What one body's cap draws, in the body's own coordinates: the counting fans and the quad that fills where the count is not zero. A
 * body counted in groups lists each group's fans as a run of `fans`' vertices, in the order they count.
 */
export interface CadSectionCap {
  readonly fans: THREE.BufferGeometry;
  readonly fill: THREE.BufferGeometry;
  readonly groups: readonly { readonly start: number; readonly count: number }[] | null;
}

/** Runs a build to its end at once. */
function finish<T>(steps: Generator<void, T>): T {
  for (;;) { const step = steps.next(); if (step.done) return step.value; }
}

/**
 * The count group of each of a body's `triangles`: `null` when the body counts at once, `undefined` when it has too many solids to
 * count at once and its triangles are not told apart by solid.
 */
function countGroups(solids: CadCapBodySolids | undefined, triangles: number): Uint16Array | null | undefined {
  if (!solids || solids.count <= CAD_SECTION_CAP_SOLIDS_AT_ONCE) return null;
  if (!solids.runs || Math.ceil(solids.count / CAD_SECTION_CAP_GROUP_SOLIDS) > 0xffff) return undefined;
  const groups = new Uint16Array(triangles), seen = new Uint8Array(triangles);
  for (const { start, count, solid } of solids.runs) {
    if (start % 3 || count % 3 || start < 0 || start + count > 3 * triangles || !Number.isSafeInteger(solid) || solid < 0 || solid >= solids.count) return undefined;
    for (let triangle = start / 3; triangle < (start + count) / 3; triangle++) {
      if (seen[triangle]) return undefined;
      seen[triangle] = 1; groups[triangle] = Math.floor(solid / CAD_SECTION_CAP_GROUP_SOLIDS);
    }
  }
  return seen.every(Boolean) ? groups : undefined;
}

/**
 * Joins the vertices `geometry` repeats at exactly the same place, as a tessellation repeats the points on an edge two faces share, and
 * checks that the triangles close. Costs O(vertices + triangles), once for each upload.
 */
export function cadCapSolid(geometry: THREE.BufferGeometry, solids?: CadCapBodySolids): CadCapSolid {
  return finish(cadCapSolidSteps(geometry, solids));
}

function* cadCapSolidSteps(geometry: THREE.BufferGeometry, solids?: CadCapBodySolids): Generator<void, CadCapSolid> {
  const position = geometry.getAttribute('position'), index = geometry.index, total = position.count;
  const corners = index ? index.count - index.count % 3 : total - total % 3, given = countGroups(solids, corners / 3);
  if (given === undefined) return Object.freeze({ vertices: new Float64Array(0), triangles: new Uint32Array(0), closed: false, groups: null });
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
  const triangles = new Uint32Array(corners), groups = given ? new Uint16Array(corners / 3) : null;
  let kept = 0;
  for (let corner = 0; corner < corners; corner += 3) {
    const a = joined[index ? index.getX(corner) : corner], b = joined[index ? index.getX(corner + 1) : corner + 1], c = joined[index ? index.getX(corner + 2) : corner + 2];
    if (a !== b && b !== c && c !== a) {
      if (groups) groups[kept / 3] = given![corner / 3];
      triangles[kept++] = a; triangles[kept++] = b; triangles[kept++] = c;
    }
    if (corner % (3 * CHECK_EVERY) === 3 * CHECK_EVERY - 3) yield;
  }
  // Each triangle runs along its edges in its winding. Closed solids run along every edge as often one way as the other: once each for
  // an edge of one solid, twice each where two solids touch. A body counted in groups must close within each group, so each group's
  // count is a winding of its own. The table has more slots than corners, so a free slot always ends a probe.
  const edgeSlots = tableSize(kept), low = new Int32Array(edgeSlots).fill(-1), high = new Uint32Array(edgeSlots), balance = new Int32Array(edgeSlots);
  const edgeGroups = groups ? new Uint16Array(edgeSlots) : null;
  for (let corner = 0; corner < kept; corner++) {
    const from = triangles[corner], to = triangles[corner % 3 === 2 ? corner - 2 : corner + 1], a = Math.min(from, to), b = Math.max(from, to);
    const group = groups ? groups[(corner / 3) | 0] : 0;
    let slot = mix(Math.imul(a, 0x9e3779b1) ^ Math.imul(b, 0x85ebca77) ^ Math.imul(group, 0xc2b2ae3d)) & (edgeSlots - 1);
    while (low[slot] >= 0 && !(low[slot] === a && high[slot] === b && (!edgeGroups || edgeGroups[slot] === group))) slot = (slot + 1) & (edgeSlots - 1);
    low[slot] = a; high[slot] = b; balance[slot] += from < to ? 1 : -1;
    if (edgeGroups) edgeGroups[slot] = group;
    if (corner % CHECK_EVERY === CHECK_EVERY - 1) yield;
  }
  let closed = kept > 0;
  for (let slot = 0; closed && slot < edgeSlots; slot++) closed = balance[slot] === 0;
  return Object.freeze({ vertices: vertices.slice(0, 3 * count), triangles: triangles.slice(0, kept), closed, groups: groups && groups.slice(0, kept / 3) });
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
  const { vertices, triangles, groups } = solid, count = vertices.length / 3, { normal, constant } = plane;
  const side = new Float64Array(count);
  for (let vertex = 0; vertex < count; vertex++) {
    side[vertex] = normal.x * vertices[3 * vertex] + normal.y * vertices[3 * vertex + 1] + normal.z * vertices[3 * vertex + 2] + constant;
    if (vertex % CHECK_EVERY === CHECK_EVERY - 1) yield;
  }
  // Each segment's start and end, x, y and z each, and for a body counted in groups the group of each segment.
  const ends: number[] = [], owners: number[] = [], at = new Float64Array(6);
  let lastGroup = 0;
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
    if (at[0] === at[3] && at[1] === at[4] && at[2] === at[5]) continue;
    for (let item = 0; item < 6; item++) ends.push(at[item]);
    if (groups) { const group = groups[corner / 3]; owners.push(group); lastGroup = Math.max(lastGroup, group); }
  }
  const segments = ends.length / 6;
  if (!segments) return null;
  // The fans start from the middle of the cut, so they overlap little; any point of the plane would count the same.
  let ox = 0, oy = 0, oz = 0;
  for (let point = 0; point < 2 * segments; point++) {
    ox += ends[3 * point]; oy += ends[3 * point + 1]; oz += ends[3 * point + 2];
  }
  ox /= 2 * segments; oy /= 2 * segments; oz /= 2 * segments;
  // Snap the start onto the plane, which rounding in the average may have left a hair off.
  const off = normal.x * ox + normal.y * oy + normal.z * oz + constant;
  ox -= off * normal.x; oy -= off * normal.y; oz -= off * normal.z;
  // A body counted in groups lays each group's fans together, in group order. Only groups the plane crosses count; when that is one
  // group, its count of at most 127 solids fits the whole stencil, and the body counts at once.
  let next: Uint32Array | null = null, runs: { start: number; count: number }[] | null = null;
  if (groups) {
    const sizes = new Uint32Array(lastGroup + 1);
    for (const group of owners) sizes[group]++;
    if (sizes.filter(size => size > 0).length > 1) {
      next = new Uint32Array(lastGroup + 1); runs = [];
      for (let group = 0, start = 0; group <= lastGroup; start += sizes[group++]) {
        next[group] = start;
        if (sizes[group]) runs.push({ start: 3 * start, count: 3 * sizes[group] });
      }
    }
  }
  const fans = new Float32Array(9 * segments);
  for (let segment = 0; segment < segments; segment++) {
    const place = 9 * (next ? next[owners[segment]]++ : segment);
    fans[place] = ox; fans[place + 1] = oy; fans[place + 2] = oz;
    for (let item = 0; item < 6; item++) fans[place + 3 + item] = ends[6 * segment + item];
  }
  // The quad covers every fan, with a margin so that no counted pixel on its border is missed.
  const across = new THREE.Vector3(), up = new THREE.Vector3();
  const least = Math.abs(normal.x) <= Math.abs(normal.y) && Math.abs(normal.x) <= Math.abs(normal.z) ? new THREE.Vector3(1, 0, 0) : Math.abs(normal.y) <= Math.abs(normal.z) ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1);
  across.crossVectors(least, normal).normalize(); up.crossVectors(normal, across);
  let minU = 0, maxU = 0, minV = 0, maxV = 0;
  for (let point = 0; point < 2 * segments; point++) {
    const x = ends[3 * point] - ox, y = ends[3 * point + 1] - oy, z = ends[3 * point + 2] - oz, u = x * across.x + y * across.y + z * across.z, v = x * up.x + y * up.y + z * up.z;
    minU = Math.min(minU, u); maxU = Math.max(maxU, u); minV = Math.min(minV, v); maxV = Math.max(maxV, v);
  }
  const margin = 0.01 * Math.max(maxU - minU, maxV - minV) + 1e-6, quad = new Float32Array(12);
  [[minU - margin, minV - margin], [maxU + margin, minV - margin], [maxU + margin, maxV + margin], [minU - margin, maxV + margin]].forEach(([u, v], corner) => {
    quad[3 * corner] = ox + u * across.x + v * up.x; quad[3 * corner + 1] = oy + u * across.y + v * up.y; quad[3 * corner + 2] = oz + u * across.z + v * up.z;
  });
  const fanGeometry = new THREE.BufferGeometry(), fillGeometry = new THREE.BufferGeometry();
  fanGeometry.setAttribute('position', new THREE.BufferAttribute(fans, 3));
  fillGeometry.setAttribute('position', new THREE.BufferAttribute(quad, 3)); fillGeometry.setIndex([0, 1, 2, 0, 2, 3]);
  return { fans: fanGeometry, fill: fillGeometry, groups: runs };
}

const later = (next: () => void) => { const timer = setTimeout(next, 0); return () => clearTimeout(timer); };

export function createCadSectionCaps({ onChange, sliceMs = CAD_SECTION_CAP_SLICE_MS, schedule = later }: CadSectionCapsOptions = {}): CadSectionCaps {
  const group = new THREE.Group();
  group.name = 'cad-section-caps';
  group.visible = false;
  // Not clipped: a cap lies on the plane by construction, and rounding must not cut it away. The counting passes write only the
  // stencil buffer, whatever is in front, so the count is whole; the fill is depth-tested like any surface.
  const counting = (side: THREE.Side, operation: THREE.StencilOp, mask: number) => new THREE.MeshBasicMaterial({ side, colorWrite: false, depthWrite: false, depthTest: false,
    stencilWrite: true, stencilWriteMask: mask, stencilFunc: THREE.AlwaysStencilFunc, stencilFail: operation, stencilZFail: operation, stencilZPass: operation });
  const front = counting(THREE.FrontSide, THREE.IncrementWrapStencilOp, 0xff), back = counting(THREE.BackSide, THREE.DecrementWrapStencilOp, 0xff);
  const fill = new THREE.MeshBasicMaterial({ color: CAD_SECTION_CAP_COLOR, side: THREE.DoubleSide, stencilWrite: true, stencilRef: 0, stencilFunc: THREE.NotEqualStencilFunc,
    stencilFail: THREE.ZeroStencilOp, stencilZFail: THREE.ZeroStencilOp, stencilZPass: THREE.ZeroStencilOp });
  // Counting in groups. Wrapping the whole value by one and writing the low seven bits leaves those bits counting modulo 128, whatever
  // the top bit holds. The fold replaces the value with the top bit wherever the low bits are not zero, and leaves it elsewhere.
  const groupFront = counting(THREE.FrontSide, THREE.IncrementWrapStencilOp, LOW_BITS), groupBack = counting(THREE.BackSide, THREE.DecrementWrapStencilOp, LOW_BITS);
  const fold = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, colorWrite: false, depthWrite: false, depthTest: false, stencilWrite: true, stencilRef: UNION_BIT,
    stencilFuncMask: LOW_BITS, stencilFunc: THREE.NotEqualStencilFunc, stencilFail: THREE.KeepStencilOp, stencilZFail: THREE.ReplaceStencilOp, stencilZPass: THREE.ReplaceStencilOp });
  const unionFill = new THREE.MeshBasicMaterial({ color: CAD_SECTION_CAP_COLOR, side: THREE.DoubleSide, stencilWrite: true, stencilRef: UNION_BIT, stencilFuncMask: UNION_BIT,
    stencilFunc: THREE.EqualStencilFunc, stencilFail: THREE.KeepStencilOp, stencilZFail: THREE.ZeroStencilOp, stencilZPass: THREE.ZeroStencilOp });
  let bodies: readonly THREE.Mesh[] = [], solidsOf: ((body: THREE.Mesh) => CadCapBodySolids | undefined) | undefined;
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
  /** The cap's draws for one body, in order from `order`. */
  const capObject = (cap: CadSectionCap, body: THREE.Mesh, order: number) => {
    const object = new THREE.Group();
    object.name = 'cad-section-cap';
    // In the body's own coordinates the cap is as precise as its vertices.
    object.position.copy(body.position); object.matrixAutoUpdate = false; object.updateMatrix();
    const draw = (geometry: THREE.BufferGeometry, material: THREE.Material, name: string) => {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = name; mesh.renderOrder = order + object.children.length; mesh.matrixAutoUpdate = false;
      object.add(mesh);
    };
    if (!cap.groups) {
      draw(cap.fans, front, 'cad-section-cap-count'); draw(cap.fans, back, 'cad-section-cap-count'); draw(cap.fill, fill, 'cad-section-cap-fill');
      return object;
    }
    for (const { start, count } of cap.groups) {
      // Each group draws its run of the shared fan vertices.
      const run = new THREE.BufferGeometry();
      run.setAttribute('position', cap.fans.getAttribute('position')); run.setDrawRange(start, count);
      draw(run, groupFront, 'cad-section-cap-count'); draw(run, groupBack, 'cad-section-cap-count'); draw(cap.fill, fold, 'cad-section-cap-fold');
    }
    draw(cap.fill, unionFill, 'cad-section-cap-fill');
    return object;
  };
  function* build(plane: THREE.Plane, of: readonly THREE.Mesh[], kernel: typeof solidsOf): Generator<void, void> {
    const local = new THREE.Plane();
    let order = CAP_RENDER_ORDER;
    for (const body of of) {
      // n · (p + o) + c = n · p + (n · o + c).
      local.normal.copy(plane.normal); local.constant = plane.constant + plane.normal.dot(body.position);
      const geometry = body.geometry;
      if (!geometry.boundingBox) geometry.computeBoundingBox();
      if (!geometry.boundingBox!.intersectsPlane(local)) continue;
      let solid = solids.get(body);
      if (!solid) { solid = yield* cadCapSolidSteps(geometry, kernel?.(body)); solids.set(body, solid); }
      const cap = yield* cadSectionCapSteps(solid, local);
      if (cap) { const object = capObject(cap, body, order); group.add(object); order += object.children.length; }
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
    setBodies(next, kernel) { clear(); solids.clear(); bodies = next; solidsOf = kernel; group.visible = false; },
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
      run(build(placed.clone(), bodies, solidsOf), generation, false);
    },
    dispose() { clear(); solids.clear(); for (const material of [front, back, fill, groupFront, groupBack, fold, unionFill]) material.dispose(); },
  };
}
