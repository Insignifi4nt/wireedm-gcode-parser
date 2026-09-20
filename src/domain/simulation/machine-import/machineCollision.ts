import type { Bounds3, MachineMesh, MachineModel, Vec3 } from './model';
import { boundsForPositions, unionBounds } from './validateMachineModel';
import {
  GEOMETRY_TOLERANCE_MM, dot3, intersectSegmentTriangle, subtract3,
  type Segment3, type Triangle3
} from './triangleIntersection';

interface CollisionNode { readonly bounds: Bounds3; readonly mesh: MachineMesh; readonly first: number; readonly last: number; readonly children: readonly CollisionNode[] }
export interface MachineCollisionIndex { readonly modelId: string; readonly roots: readonly CollisionNode[] }
export interface MachineSurfaceHit { readonly meshId: string; readonly meshName: string; readonly triangleIndex: number; readonly point: Vec3; readonly travelFraction: number; readonly approximate: boolean }
export interface MachineCollisionOptions {
  readonly maxTriangleTests?: number;
  readonly maxHits?: number;
  readonly signal?: AbortSignal;
  /** Certified upper bound of the curve's deviation from this straight chord, not wire radius. */
  readonly curveDeviationMm?: number;
}
export interface MachineCollisionResult {
  readonly status: 'intersections' | 'no-intersections' | 'incomplete';
  readonly complete: boolean;
  readonly hits: readonly MachineSurfaceHit[];
  readonly testedTriangles: number;
  readonly message: string;
}
export interface WireSweep { readonly from: Segment3; readonly to: Segment3 }
export const MACHINE_COLLISION_LIMITATION = 'Checks the zero-radius wire against imported triangle surfaces only. A missing intersection does not verify wire, guide or machine clearance, solid containment, or the completeness of the STEP model.';

function triangle(mesh: MachineMesh, index: number): Triangle3 {
  const vertex = (offset: number): Vec3 => {
    const position = mesh.indices[index * 3 + offset] * 3;
    return [mesh.positions[position], mesh.positions[position + 1], mesh.positions[position + 2]];
  };
  return [vertex(0), vertex(1), vertex(2)];
}

/** Small contiguous leaves retain OCCT's face locality without copying mesh buffers. */
export function createMachineCollisionIndex(model: MachineModel): MachineCollisionIndex {
  const build = (mesh: MachineMesh, first: number, last: number): CollisionNode => {
    if (last - first <= 16) {
      const points: number[] = [];
      for (let index = first; index < last; index++) for (const vertex of triangle(mesh, index)) points.push(...vertex);
      return { bounds: boundsForPositions(points), mesh, first, last, children: [] };
    }
    const middle = Math.floor((first + last) / 2);
    const children = [build(mesh, first, middle), build(mesh, middle, last)];
    return { bounds: unionBounds(children.map((child) => child.bounds)), mesh, first, last, children };
  };
  return { modelId: model.id, roots: model.meshes.map((mesh) => build(mesh, 0, mesh.indices.length / 3)) };
}

const overlaps = (a: Bounds3, b: Bounds3) => a.min.every((value, axis) => value <= b.max[axis] + GEOMETRY_TOLERANCE_MM
  && a.max[axis] + GEOMETRY_TOLERANCE_MM >= b.min[axis]);
const validSegment = (segment: Segment3) => [segment.start, segment.end].every((point) => point.length === 3 && point.every(Number.isFinite));
function incomplete(message: string): MachineCollisionResult { return { status: 'incomplete', complete: false, hits: [], testedTriangles: 0, message }; }

function query(
  index: MachineCollisionIndex, bounds: Bounds3, intersect: (shape: Triangle3) => { point: Vec3; travelFraction: number; approximate: boolean } | null,
  options: MachineCollisionOptions
): MachineCollisionResult {
  const maxTests = options.maxTriangleTests ?? 100_000;
  const maxHits = options.maxHits ?? 100;
  if (!Number.isSafeInteger(maxTests) || maxTests < 1 || !Number.isSafeInteger(maxHits) || maxHits < 1) return incomplete('Collision query limits must be positive integers.');
  let testedTriangles = 0;
  const hits: MachineSurfaceHit[] = [];
  const stack = [...index.roots].reverse();
  let complete = true;
  let message = 'No imported machine surface intersections found.';
  outer: while (stack.length) {
    if (options.signal?.aborted) { complete = false; message = 'Machine surface checking was cancelled.'; break; }
    const node = stack.pop()!;
    if (!overlaps(node.bounds, bounds)) continue;
    if (node.children.length) { stack.push(...[...node.children].reverse()); continue; }
    for (let triangleIndex = node.first; triangleIndex < node.last; triangleIndex++) {
      if (testedTriangles >= maxTests || hits.length >= maxHits) {
        complete = false; message = 'Machine surface checking reached its geometry budget.'; break outer;
      }
      testedTriangles++;
      const hit = intersect(triangle(node.mesh, triangleIndex));
      if (hit) hits.push({ meshId: node.mesh.id, meshName: node.mesh.name, triangleIndex, ...hit });
    }
  }
  if (hits.length && complete) message = 'The wire intersects imported machine triangle surfaces.';
  return { status: hits.length ? 'intersections' : complete ? 'no-intersections' : 'incomplete', complete, hits, testedTriangles, message };
}

export function checkMachineWireCollision(index: MachineCollisionIndex, wire: Segment3, options: MachineCollisionOptions = {}): MachineCollisionResult {
  if (!validSegment(wire)) return incomplete('The wire endpoints must be finite millimetre coordinates.');
  return query(index, boundsForPositions([...wire.start, ...wire.end]), (shape) => {
    const hit = intersectSegmentTriangle(wire, shape);
    return hit ? { point: hit.point, travelFraction: 0, approximate: false } : null;
  }, options);
}

/** Exact swept surface for a straight wire translated between two positions, with no finite radius. */
export function checkMachineWireSweep(index: MachineCollisionIndex, sweep: WireSweep, options: MachineCollisionOptions = {}): MachineCollisionResult {
  if (!validSegment(sweep.from) || !validSegment(sweep.to)) return incomplete('The wire endpoints must be finite millimetre coordinates.');
  const fromDirection = subtract3(sweep.from.end, sweep.from.start);
  const toDirection = subtract3(sweep.to.end, sweep.to.start);
  if (Math.hypot(...subtract3(fromDirection, toDirection)) > GEOMETRY_TOLERANCE_MM) {
    return incomplete('Machine surface checking supports translated straight wires; changing wire tilt or length requires another collision model.');
  }
  const travel = subtract3(sweep.to.start, sweep.from.start);
  const travelSquared = dot3(travel, travel);
  const wireSquared = dot3(fromDirection, fromDirection);
  const travelWire = dot3(travel, fromDirection);
  const determinant = travelSquared * wireSquared - travelWire * travelWire;
  const corners = [sweep.from.start, sweep.from.end, sweep.to.end, sweep.to.start] as const;
  const deviation = options.curveDeviationMm ?? 0;
  if (!Number.isFinite(deviation) || deviation < 0) return incomplete('Curve deviation must be a finite nonnegative millimetre distance.');
  const sweepBounds = boundsForPositions(corners.flat());
  const expandedBounds: Bounds3 = { min: sweepBounds.min.map((value) => value - deviation) as unknown as Vec3,
    max: sweepBounds.max.map((value) => value + deviation) as unknown as Vec3 };
  const travelFraction = (point: Vec3) => {
    const offset = subtract3(point, sweep.from.start);
    const fraction = determinant > Number.EPSILON * travelSquared * wireSquared
      ? (dot3(offset, travel) * wireSquared - dot3(offset, fromDirection) * travelWire) / determinant
      : travelSquared ? dot3(offset, travel) / travelSquared : 0;
    return Math.max(0, Math.min(1, fraction));
  };
  return query(index, expandedBounds, (shape) => {
    const contacts: Vec3[] = [];
    for (let edge = 0; edge < 4; edge++) {
      const hit = intersectSegmentTriangle({ start: corners[edge], end: corners[(edge + 1) % 4] }, shape);
      if (hit) contacts.push(hit.point);
    }
    for (const surface of [[corners[0], corners[1], corners[2]], [corners[0], corners[2], corners[3]]] as const) {
      for (const [source, target] of [[surface, shape], [shape, surface]] as const) {
        for (let edge = 0; edge < 3; edge++) {
          const hit = intersectSegmentTriangle({ start: source[edge], end: source[(edge + 1) % 3] }, target);
          if (hit) contacts.push(hit.point);
        }
      }
    }
    if (!contacts.length) {
      const shapeBounds = boundsForPositions(shape.flat());
      if (deviation === 0 || !overlaps(shapeBounds, expandedBounds)) return null;
      // Conservative arc envelope: never claim an exact contact from an AABB candidate.
      const point = shapeBounds.min.map((value, axis) => (Math.max(value, expandedBounds.min[axis])
        + Math.min(shapeBounds.max[axis], expandedBounds.max[axis])) / 2) as unknown as Vec3;
      return { point, travelFraction: travelFraction(point), approximate: true };
    }
    contacts.sort((a, b) => travelFraction(a) - travelFraction(b));
    return { point: contacts[0], travelFraction: travelFraction(contacts[0]), approximate: deviation > 0 };
  }, options);
}
