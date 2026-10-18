import type { CadMesh } from '@/domain/cad/cadDocument';

// This is a display crease angle, never a geometry/chord tolerance. Exact native
// edges remain available in Edge mode, picking, highlights and exports.
const creaseDot = Math.cos(10 * Math.PI / 180);
const dot = (a: ArrayLike<number>, ai: number, b: ArrayLike<number>, bi: number) => a[ai] * b[bi] + a[ai + 1] * b[bi + 1] + a[ai + 2] * b[bi + 2];
const compare = (a: ArrayLike<number>, ai: number, b: ArrayLike<number>, bi: number) => a[ai] - b[bi] || a[ai + 1] - b[bi + 1] || a[ai + 2] - b[bi + 2];

/**
 * Presentation buffers only; native topology and model coordinates stay intact.
 * Coincident vertices are found by exact coordinates through one sort, without
 * rounding or string keys, so large meshes stay cheap to redraw on every rebuild.
 */
export function prepareCadMeshDisplay(mesh: CadMesh): { normals: readonly number[]; edges: readonly number[] } {
  const { positions, indices } = mesh, count = Math.floor(positions.length / 3);
  const unit = new Float64Array(count * 3);
  for (let vertex = 0, offset = 0; vertex < count; vertex++, offset += 3) {
    const x = mesh.normals[offset], y = mesh.normals[offset + 1], z = mesh.normals[offset + 2], length = Math.hypot(x, y, z);
    unit[offset] = length ? x / length : x; unit[offset + 1] = length ? y / length : y; unit[offset + 2] = length ? z / length : z;
  }
  // Exactly coincident positions share a group; groups are runs in the sorted order.
  const order = new Uint32Array(count).map((_, index) => index).sort((a, b) => compare(positions, a * 3, positions, b * 3));
  const group = new Uint32Array(count), starts: number[] = [];
  for (let rank = 0; rank < count; rank++) {
    if (rank === 0 || compare(positions, order[rank - 1] * 3, positions, order[rank] * 3) !== 0) starts.push(rank);
    group[order[rank]] = starts.length - 1;
  }
  starts.push(count);

  // Each vertex averages the distinct unit normals at its position that lie within the crease angle.
  const normals = new Array<number>(count * 3);
  const distinct: number[] = [];
  for (let id = 0; id + 1 < starts.length; id++) {
    distinct.length = 0;
    for (let rank = starts[id]; rank < starts[id + 1]; rank++) {
      const offset = order[rank] * 3;
      if (!distinct.some(other => unit[other] === unit[offset] && unit[other + 1] === unit[offset + 1] && unit[other + 2] === unit[offset + 2])) distinct.push(offset);
    }
    for (let rank = starts[id]; rank < starts[id + 1]; rank++) {
      const offset = order[rank] * 3; let x = 0, y = 0, z = 0;
      for (const other of distinct) if (dot(unit, offset, unit, other) >= creaseDot) { x += unit[other]; y += unit[other + 1]; z += unit[other + 2]; }
      const length = Math.hypot(x, y, z);
      normals[offset] = length ? x / length : unit[offset]; normals[offset + 1] = length ? y / length : unit[offset + 1]; normals[offset + 2] = length ? z / length : unit[offset + 2];
    }
  }

  // Classify only actual native line segments. A missing/ambiguous triangulation
  // match keeps the edge. No coordinate rounding or approximate welding is used.
  const groups = starts.length - 1;
  const locate = (values: readonly number[], offset: number) => {
    let low = 0, high = count - 1;
    while (low <= high) {
      const middle = (low + high) >> 1, order3 = order[middle] * 3, sign = compare(positions, order3, values, offset);
      if (sign === 0) return group[order[middle]];
      if (sign < 0) low = middle + 1; else high = middle - 1;
    }
    return -1;
  };
  const segment = (a: number, b: number) => a < b ? a * groups + b : b * groups + a;
  const ends: number[] = [];
  const adjacency = new Map<number, { count: number; normals: number[] }>();
  for (let offset = 0; offset < mesh.edges.length; offset += 6) {
    const a = locate(mesh.edges, offset), b = locate(mesh.edges, offset + 3);
    ends.push(a, b);
    if (a >= 0 && b >= 0) adjacency.set(segment(a, b), { count: 0, normals: [] });
  }
  for (let offset = 0; offset + 2 < indices.length; offset += 3) {
    for (let side = 0; side < 3; side++) {
      const a = indices[offset + side], b = indices[offset + (side + 1) % 3];
      const entry = adjacency.get(segment(group[a], group[b]));
      if (entry) { entry.count++; entry.normals.push(a * 3, b * 3); }
    }
  }
  const edges: number[] = [];
  for (let offset = 0, end = 0; offset < mesh.edges.length; offset += 6, end += 2) {
    const a = ends[end], b = ends[end + 1], entry = a >= 0 && b >= 0 ? adjacency.get(segment(a, b)) : undefined;
    const smooth = entry?.count === 2 && entry.normals.every((normal, i) => entry.normals.slice(i + 1).every(other => dot(unit, normal, unit, other) >= creaseDot));
    if (!smooth) for (let i = 0; i < 6; i++) edges.push(mesh.edges[offset + i]);
  }
  return { normals, edges };
}
