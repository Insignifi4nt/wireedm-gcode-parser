import type { CadDocument, CadPlane, CadProfile } from './cadDocument';
import { CadError } from './cadError';
import { evaluateCadScalar } from './cadExpression';
import { parseCadDocument } from './cadSchema';
import { cadAnalyticPathMetrics, resolveCadProfile, resolveCadSketchRegions, type ResolvedCadProfile } from './cadSketchGeometry';

export interface CadBounds2 {
  readonly minX: number; readonly minY: number; readonly maxX: number; readonly maxY: number;
}
export interface CadProfileMeasurement {
  readonly profileId: string; readonly name: string; readonly kind: CadProfile['kind'];
  readonly role: 'outer' | 'hole'; readonly construction: boolean;
  readonly areaMm2: number; readonly perimeterMm: number; readonly boundsMm: CadBounds2;
}
export interface CadSketchMeasurement {
  readonly sketchId: string; readonly name: string; readonly plane: CadPlane;
  readonly offsetMm: number; readonly suppressed: boolean;
  readonly coordinateSystem: 'sketch-local';
  readonly materialAreaMm2: number; readonly boundaryLengthMm: number;
  readonly cutContourCount: number; readonly boundsMm: CadBounds2 | null;
  readonly profiles: readonly CadProfileMeasurement[];
}

function profileMeasurement(profile: ResolvedCadProfile): Pick<CadProfileMeasurement, 'areaMm2' | 'perimeterMm' | 'boundsMm'> {
  switch (profile.kind) {
    case 'path': {
      const measured = cadAnalyticPathMetrics(profile);
      return { areaMm2: Math.abs(measured.signedArea), perimeterMm: measured.length, boundsMm: measured.bounds };
    }
    case 'rectangle': return {
      areaMm2: profile.width * profile.height - (4 - Math.PI) * profile.cornerRadius ** 2,
      perimeterMm: 2 * (profile.width + profile.height) - 8 * profile.cornerRadius + 2 * Math.PI * profile.cornerRadius,
      boundsMm: { minX: profile.x, minY: profile.y, maxX: profile.x + profile.width, maxY: profile.y + profile.height }
    };
    case 'circle': return {
      areaMm2: Math.PI * profile.radius ** 2, perimeterMm: 2 * Math.PI * profile.radius,
      boundsMm: { minX: profile.x - profile.radius, minY: profile.y - profile.radius, maxX: profile.x + profile.radius, maxY: profile.y + profile.radius }
    };
    case 'slot': {
      const straightLength = profile.length - profile.width;
      const angle = (profile.angle % 360) * Math.PI / 180;
      const xExtent = Math.abs(Math.cos(angle)) * straightLength / 2 + profile.width / 2;
      const yExtent = Math.abs(Math.sin(angle)) * straightLength / 2 + profile.width / 2;
      return {
        areaMm2: straightLength * profile.width + Math.PI * profile.width ** 2 / 4,
        perimeterMm: 2 * straightLength + Math.PI * profile.width,
        boundsMm: { minX: profile.x - xExtent, minY: profile.y - yExtent, maxX: profile.x + xExtent, maxY: profile.y + yExtent }
      };
    }
    case 'polygon': {
      const origin = profile.points[0];
      if (!origin) throw new CadError('invalid-profile', 'Polygon needs at least three vertices.');
      let doubleArea = 0; let perimeterMm = 0;
      const boundsMm = { minX: origin[0], minY: origin[1], maxX: origin[0], maxY: origin[1] };
      profile.points.forEach(([x, y], index) => {
        const [nx, ny] = profile.points[(index + 1) % profile.points.length];
        doubleArea += (x - origin[0]) * (ny - origin[1]) - (y - origin[1]) * (nx - origin[0]);
        perimeterMm += Math.hypot(nx - x, ny - y);
        boundsMm.minX = Math.min(boundsMm.minX, x); boundsMm.minY = Math.min(boundsMm.minY, y);
        boundsMm.maxX = Math.max(boundsMm.maxX, x); boundsMm.maxY = Math.max(boundsMm.maxY, y);
      });
      return { areaMm2: Math.abs(doubleArea) / 2, perimeterMm, boundsMm };
    }
    default: { const exhaustive: never = profile; return exhaustive; }
  }
}

/** Analytic measurements of the validated sketch, independent of tessellation and CAM sampling. */
export function measureCadSketch(document: CadDocument, sketchId: string): CadSketchMeasurement {
  const validated = parseCadDocument(document);
  const sketch = validated.features.find(feature => feature.id === sketchId);
  if (sketch?.kind !== 'sketch') throw new CadError('missing-sketch', 'Choose an existing sketch to measure.');
  const regions = resolveCadSketchRegions(sketch, validated.parameters);
  const depths = new Map(regions.flatMap(region => [region.boundary, ...region.voids]).map(contour => [contour.profile.id, contour.depth]));
  const profiles = sketch.profiles.map(profile => ({ profileId: profile.id, name: profile.name, kind: profile.geometry.kind,
    role: profile.construction && profile.role !== undefined ? profile.role
      : (depths.get(profile.id) ?? 0) % 2 === 0 ? 'outer' as const : 'hole' as const,
    construction: profile.construction, ...profileMeasurement(resolveCadProfile(profile.geometry, validated.parameters)) }));
  const cuts = profiles.filter(profile => !profile.construction);
  const boundsMm = cuts.reduce<CadBounds2 | null>((bounds, profile) => bounds === null ? profile.boundsMm : {
    minX: Math.min(bounds.minX, profile.boundsMm.minX), minY: Math.min(bounds.minY, profile.boundsMm.minY),
    maxX: Math.max(bounds.maxX, profile.boundsMm.maxX), maxY: Math.max(bounds.maxY, profile.boundsMm.maxY)
  }, null);
  return { sketchId: sketch.id, name: sketch.name, plane: sketch.plane, offsetMm: evaluateCadScalar(sketch.offset, validated.parameters),
    suppressed: sketch.suppressed, coordinateSystem: 'sketch-local', profiles, boundsMm,
    cutContourCount: cuts.length,
    materialAreaMm2: cuts.reduce((area, profile) => area + (profile.role === 'outer' ? profile.areaMm2 : -profile.areaMm2), 0),
    boundaryLengthMm: cuts.reduce((length, profile) => length + profile.perimeterMm, 0) };
}
