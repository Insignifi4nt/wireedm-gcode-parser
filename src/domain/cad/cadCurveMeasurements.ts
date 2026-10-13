import type { CadDocument, CadPlane } from './cadDocument';
import { CadError } from './cadError';
import { parseCadDocument } from './cadSchema';
import { resolveCadCurve, type CadBounds3 } from './cadCurve';
import type { CadNumericPoint2, CadNumericPoint3 } from './cadPlanes';
import type { Bounds2 } from '@/domain/path-intel/types';

export interface CadCurveMeasurement {
  readonly curveId: string; readonly name: string; readonly plane: CadPlane; readonly offsetMm: number;
  readonly suppressed: boolean; readonly coordinateSystem: 'curve-local'; readonly segmentCount: number;
  readonly lengthMm: number; readonly startMm: CadNumericPoint2; readonly endMm: CadNumericPoint2;
  readonly startWorldMm: CadNumericPoint3; readonly endWorldMm: CadNumericPoint3;
  readonly boundsMm: Readonly<Bounds2>; readonly worldBoundsMm: CadBounds3;
}
/** Exact open-curve measurements contain no material area, contour role or CAM state. */
export function measureCadCurve(document: CadDocument, curveId: string): CadCurveMeasurement {
  const validated = parseCadDocument(document);
  const curve = validated.features.find(feature => feature.id === curveId);
  if (curve?.kind !== 'curve') throw new CadError('missing-curve', 'Choose an existing reference curve to measure.');
  const resolved = resolveCadCurve(curve, validated.parameters);
  return Object.freeze({ curveId, name: curve.name, plane: curve.plane, offsetMm: resolved.offset, suppressed: curve.suppressed,
    coordinateSystem: 'curve-local', segmentCount: resolved.segments.length, lengthMm: resolved.length,
    startMm: resolved.start, endMm: resolved.end, startWorldMm: resolved.startWorld, endWorldMm: resolved.endWorld,
    boundsMm: resolved.bounds, worldBoundsMm: resolved.worldBounds });
}
