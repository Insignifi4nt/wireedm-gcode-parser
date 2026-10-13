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
      const xs = profile.points.map((point) => point[0]);
      const ys = profile.points.map((point) => point[1]);
      return Math.min(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
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
