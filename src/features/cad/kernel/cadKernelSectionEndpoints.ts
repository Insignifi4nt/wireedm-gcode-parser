import type { DxfEntity, DxfPoint } from '../../../domain/dxf/types';
import { CadError } from '../../../domain/cad/cadError';
import { SpatialHash } from '../../../domain/path-intel/spatialIndex';

/** First-representative geometric degrees; circles contribute no endpoints. */
export function assertCadSectionClosedEndpoints(entities: readonly DxfEntity[], tolerance: number): void {
  const vertices: { point: DxfPoint; degree: number }[] = [];
  const index = new SpatialHash<(typeof vertices)[number]>({ cellSize: tolerance });
  for (const entity of entities) if (entity.type === 'line' || entity.type === 'arc') {
    for (const point of [entity.start, entity.end]) {
      // Broadphase bounds include rounding at far coordinates. The ordered
      // candidates retain the original first representative and exact predicate.
      const margin = 2 * tolerance + 64 * Number.EPSILON * Math.max(1, Math.abs(point.x), Math.abs(point.y));
      const candidates = index.queryBounds({
        minX: Math.max(-Number.MAX_VALUE, point.x - margin), minY: Math.max(-Number.MAX_VALUE, point.y - margin),
        maxX: Math.min(Number.MAX_VALUE, point.x + margin), maxY: Math.min(Number.MAX_VALUE, point.y + margin)
      });
      const vertex = candidates.find(item => Math.hypot(point.x - item.point.x, point.y - item.point.y) <= tolerance);
      if (vertex) vertex.degree++;
      else {
        const representative = { point, degree: 1 };
        vertices.push(representative); index.insertPoint(point, representative);
      }
    }
  }
  if (vertices.some(vertex => vertex.degree !== 2)) throw new CadError('open-section', 'The section has open, touching or branching outlines. Choose an interior offset that produces closed contours.');
}
