import { cadAnalyticPathMetrics, type ResolvedCadProfile } from './cadSketchGeometry';

/** Conservative precision-support heuristic, not minimum wall thickness. */
export function cadPocketSectionScale(profile: ResolvedCadProfile): number {
  switch (profile.kind) {
    case 'circle':
      return profile.radius;
    case 'slot':
      return profile.width / 2;
    case 'rectangle':
      return Math.min(profile.width, profile.height, profile.cornerRadius > 0 ? profile.cornerRadius : Infinity);
    case 'polygon': {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const [x, y] of profile.points) {
        minX = Math.min(minX, x); minY = Math.min(minY, y);
        maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
      }
      return Math.min(maxX - minX, maxY - minY);
    }
    case 'path': {
      const bounds = cadAnalyticPathMetrics(profile).bounds;
      let scale = Math.min(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
      // Splitting a circular arc into shorter segments does not change scale.
      for (const segment of profile.segments) if (segment.kind === 'arc') scale = Math.min(scale, segment.radius);
      return scale;
    }
    default: {
      const exhaustive: never = profile;
      return exhaustive;
    }
  }
}
