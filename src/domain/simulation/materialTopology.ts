import type { Point2 } from '@/domain/path-intel/types';

interface Polygon { readonly id: string; readonly polygon: readonly Point2[] }
interface Edge {
  readonly polygon: Polygon; readonly index: number; readonly a: Point2; readonly b: Point2;
  readonly minX: number; readonly minY: number; readonly maxX: number; readonly maxY: number;
}
const EPSILON = 1e-8;

/** Exact source curves may be disjoint while their rendering chords cross. Never extrude those rings. */
export function unsupportedMaterialPolygons(polygons: readonly Polygon[]): { ids: ReadonlySet<string>; budgetExceeded: boolean } {
  const ids = new Set<string>();
  const edges: Edge[] = [];
  const allUnsupported = () => ({ ids: new Set(polygons.map(polygon => polygon.id)), budgetExceeded: true });
  for (const polygon of polygons) {
    if (edges.length + polygon.polygon.length > 100_000) return allUnsupported();
    polygon.polygon.forEach((a, index) => {
      const b = polygon.polygon[(index + 1) % polygon.polygon.length];
      edges.push({ polygon, index, a, b, minX: Math.min(a.x, b.x), minY: Math.min(a.y, b.y),
        maxX: Math.max(a.x, b.x), maxY: Math.max(a.y, b.y) });
    });
  }
  edges.sort((a, b) => a.minX - b.minX);
  let active: Edge[] = [];
  let comparisons = 0;
  for (const edge of edges) {
    active = active.filter(other => other.maxX + EPSILON >= edge.minX);
    for (const other of active) {
      if (++comparisons > 2_000_000) return allUnsupported();
      if (edge.minY > other.maxY + EPSILON || edge.maxY + EPSILON < other.minY) continue;
      if (edge.polygon === other.polygon) {
        const separation = Math.abs(edge.index - other.index);
        if (separation === 1 || separation === edge.polygon.polygon.length - 1) continue;
      }
      if (edgesTouch(edge, other)) { ids.add(edge.polygon.id); ids.add(other.polygon.id); }
    }
    active.push(edge);
  }
  return { ids, budgetExceeded: false };
}

function edgesTouch(first: Edge, second: Edge): boolean {
  const side = (a: Point2, b: Point2, point: Point2) => {
    const cross = (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x);
    const tolerance = EPSILON * Math.hypot(b.x - a.x, b.y - a.y);
    return Math.abs(cross) <= tolerance ? 0 : Math.sign(cross);
  };
  const onEdge = (point: Point2, edge: Edge) => point.x >= edge.minX - EPSILON && point.x <= edge.maxX + EPSILON
    && point.y >= edge.minY - EPSILON && point.y <= edge.maxY + EPSILON;
  const a = side(first.a, first.b, second.a), b = side(first.a, first.b, second.b);
  const c = side(second.a, second.b, first.a), d = side(second.a, second.b, first.b);
  return a * b < 0 && c * d < 0
    || a === 0 && onEdge(second.a, first) || b === 0 && onEdge(second.b, first)
    || c === 0 && onEdge(first.a, second) || d === 0 && onEdge(first.b, second);
}
