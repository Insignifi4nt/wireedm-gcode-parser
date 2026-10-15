import type { CadMesh } from '@/domain/cad/cadDocument';

// This is a display crease angle, never a geometry/chord tolerance. Exact native
// edges remain available in Edge mode, picking, highlights and exports.
const creaseDot = Math.cos(10 * Math.PI / 180);
const pointKey = (values: readonly number[], offset: number) => `${values[offset]},${values[offset + 1]},${values[offset + 2]}`;
const segmentKey = (a: string, b: string) => a < b ? `${a}|${b}` : `${b}|${a}`;
const dot = (a: readonly number[], b: readonly number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Presentation buffers only; native topology and model coordinates stay intact. */
export function prepareCadMeshDisplay(mesh: CadMesh): { normals: readonly number[]; edges: readonly number[] } {
  const keys: string[] = [], vertexNormals: number[][] = [];
  const coincident = new Map<string, Map<string, number[]>>();
  for (let offset = 0; offset < mesh.positions.length; offset += 3) {
    const key = pointKey(mesh.positions, offset), normal = mesh.normals.slice(offset, offset + 3);
    const length = Math.hypot(...normal);
    const unit = length ? normal.map(value => value / length) : normal;
    keys.push(key); vertexNormals.push(unit);
    const directions = coincident.get(key) ?? new Map<string, number[]>();
    directions.set(unit.join(','), unit); coincident.set(key, directions);
  }
  const normals = vertexNormals.flatMap((normal, vertex) => {
    const sum = [0, 0, 0];
    for (const neighbor of coincident.get(keys[vertex])?.values() ?? []) {
      if (dot(normal, neighbor) >= creaseDot) for (let axis = 0; axis < 3; axis++) sum[axis] += neighbor[axis];
    }
    const length = Math.hypot(...sum);
    return length ? sum.map(value => value / length) : normal;
  });

  // Classify only actual native line segments. A missing/ambiguous triangulation
  // match keeps the edge. No coordinate rounding or approximate welding is used.
  const adjacency = new Map<string, { count: number; normals: number[][] }>();
  for (let offset = 0; offset < mesh.edges.length; offset += 6) {
    adjacency.set(segmentKey(pointKey(mesh.edges, offset), pointKey(mesh.edges, offset + 3)), { count: 0, normals: [] });
  }
  for (let offset = 0; offset < mesh.indices.length; offset += 3) {
    for (let side = 0; side < 3; side++) {
      const a = mesh.indices[offset + side], b = mesh.indices[offset + (side + 1) % 3];
      const entry = adjacency.get(segmentKey(keys[a], keys[b]));
      if (entry) { entry.count++; entry.normals.push(vertexNormals[a], vertexNormals[b]); }
    }
  }
  const edges: number[] = [];
  for (let offset = 0; offset < mesh.edges.length; offset += 6) {
    const entry = adjacency.get(segmentKey(pointKey(mesh.edges, offset), pointKey(mesh.edges, offset + 3)));
    const smooth = entry?.count === 2 && entry.normals.every((normal, i) => entry.normals.slice(i + 1).every(other => dot(normal, other) >= creaseDot));
    if (!smooth) edges.push(...mesh.edges.slice(offset, offset + 6));
  }
  return { normals, edges };
}
