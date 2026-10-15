import type { CadDocument, CadSketchPlane } from './cadDocument';
import { CadError } from './cadError';
import { parseCadDocument } from './cadSchema';
import { prepareCadDocumentFrames } from './cadDocumentFrames';
import { cadFramePointToWorld, resolveCadSketchPlacement, type CadResolvedFrame } from './cadDatumPlanes';

export interface CadPlaneInspection {
  readonly featureId: string;
  readonly featureKind: 'datum-plane' | 'sketch' | 'curve';
  readonly units: 'mm';
  readonly plane: CadSketchPlane;
  readonly datumId: string | null;
  readonly offsetMm: number;
  /** Base frame origin excludes the Sketch/Curve's signed normal offset. */
  readonly frame: CadResolvedFrame;
  readonly placedOriginMm: ReturnType<typeof cadFramePointToWorld>;
}

/** A bounded placement receipt; resolving a frame does not certify a native solid. */
export function inspectCadPlane(document: CadDocument, featureId: string): CadPlaneInspection {
  const validated = parseCadDocument(document);
  const feature = validated.features.find(candidate => candidate.id === featureId);
  if (!feature || feature.kind !== 'datum-plane' && feature.kind !== 'sketch' && feature.kind !== 'curve') {
    throw new CadError('invalid-plane-reference', 'Choose an existing datum plane, Sketch or Curve to inspect.');
  }
  if (feature.suppressed) throw new CadError('suppressed-plane-reference', 'Unsuppress this reference and its datum before inspecting its placement.');
  const frames = prepareCadDocumentFrames(validated);
  if (feature.kind === 'datum-plane') {
    const frame = frames.get(feature.id);
    if (!frame) throw new CadError('unavailable-datum-plane', 'The selected datum plane has no active resolved frame.');
    return Object.freeze({ featureId, featureKind: feature.kind, units: 'mm',
      plane: Object.freeze({ kind: 'datum-plane', featureId }), datumId: featureId, offsetMm: 0,
      frame, placedOriginMm: cadFramePointToWorld(frame, 0, [0, 0]) });
  }
  const placement = resolveCadSketchPlacement(feature, validated.parameters, frames);
  return Object.freeze({ featureId, featureKind: feature.kind, units: 'mm', plane: placement.plane,
    datumId: placement.datumId, offsetMm: placement.offsetMm, frame: placement.frame,
    placedOriginMm: cadFramePointToWorld(placement.frame, placement.offsetMm, [0, 0]) });
}
