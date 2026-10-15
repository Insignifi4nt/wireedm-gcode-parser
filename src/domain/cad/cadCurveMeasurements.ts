import type { CadDocument, CadSketchPlane } from './cadDocument';
import { CadError } from './cadError';
import { parseCadDocument } from './cadSchema';
import { resolveCadCurveGeometry, placeCadCurveGeometry, type CadBounds3 } from './cadCurve';
import { prepareCadDocumentFrames } from './cadDocumentFrames';
import { resolveCadSketchPlacement, type CadResolvedFrame } from './cadDatumPlanes';
import type { CadNumericPoint2, CadNumericPoint3 } from './cadPlanes';
import type { Bounds2 } from '@/domain/path-intel/types';

export interface CadCurveMeasurement {
  readonly curveId: string; readonly name: string; readonly plane: CadSketchPlane; readonly offsetMm: number;
  readonly frame: CadResolvedFrame | null;
  readonly placementDiagnostic: { readonly code: string; readonly message: string } | null;
  readonly suppressed: boolean; readonly coordinateSystem: 'curve-local'; readonly segmentCount: number;
  readonly lengthMm: number; readonly startMm: CadNumericPoint2; readonly endMm: CadNumericPoint2;
  readonly startWorldMm: CadNumericPoint3 | null; readonly endWorldMm: CadNumericPoint3 | null;
  readonly boundsMm: Readonly<Bounds2>; readonly worldBoundsMm: CadBounds3 | null;
}
/** Exact open-curve measurements contain no material area, contour role or CAM state. */
export function measureCadCurve(document: CadDocument, curveId: string): CadCurveMeasurement {
  const validated = parseCadDocument(document);
  const curve = validated.features.find(feature => feature.id === curveId);
  if (curve?.kind !== 'curve') throw new CadError('missing-curve', 'Choose an existing reference curve to measure.');
  const local = resolveCadCurveGeometry(curve, validated.parameters);
  let resolved: ReturnType<typeof placeCadCurveGeometry> | null = null;
  let placementDiagnostic: CadCurveMeasurement['placementDiagnostic'] = null;
  try { resolved = placeCadCurveGeometry(local, resolveCadSketchPlacement(curve, validated.parameters, prepareCadDocumentFrames(validated))); }
  catch (error) {
    if (!(error instanceof CadError) || error.code !== 'unavailable-datum-plane' || !curve.suppressed) throw error;
    placementDiagnostic = Object.freeze({ code: error.code, message: error.message });
  }
  return Object.freeze({ curveId, name: curve.name, plane: curve.plane, offsetMm: local.offset, suppressed: curve.suppressed,
    frame: resolved?.frame ?? null, placementDiagnostic, coordinateSystem: 'curve-local', segmentCount: local.segments.length, lengthMm: local.length,
    startMm: local.start, endMm: local.end, startWorldMm: resolved?.startWorld ?? null, endWorldMm: resolved?.endWorld ?? null,
    boundsMm: local.bounds, worldBoundsMm: resolved?.worldBounds ?? null });
}
