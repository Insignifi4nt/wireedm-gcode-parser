import type { CadDocument } from './cadDocument';
import { CadError } from './cadError';
import { parseCadDocument } from './cadSchema';
import { prepareCadDocumentFrames } from './cadDocumentFrames';
import { cadFramePointToWorld } from './cadDatumPlanes';
import { inspectCadSweepInputs, MAX_CAD_SWEEP_SEGMENTS, MAX_CAD_SWEEP_WORK } from './cadSweep';

/** Bounded proposed-feature preflight; source geometry stays in the accepted document. */
export function inspectCadSweep(document: CadDocument, sketchId: string, curveId: string) {
  if (![sketchId, curveId].every(id => typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(id))) {
    throw new CadError('invalid-sweep-selection', 'Choose one sketch feature ID and one Curve feature ID.');
  }
  const accepted = parseCadDocument(document);
  const inspection = inspectCadSweepInputs({ kind: 'sweep', id: 'inspection_sweep', name: 'Sweep', suppressed: false,
    sketchId, curveId, operation: 'new', targetId: null }, new Map(accepted.features.map(feature => [feature.id, feature])),
  accepted.parameters, prepareCadDocumentFrames(accepted));
  const receipt = { sketchId, curveId, scope: 'new-feature-at-end' as const, units: 'mm' as const,
    limits: Object.freeze({ curveSegments: MAX_CAD_SWEEP_SEGMENTS, sectionEdgesTimesCurveSegments: MAX_CAD_SWEEP_WORK }) };
  if (!inspection.eligible) return Object.freeze({ ...receipt, eligible: false as const, code: inspection.code, message: inspection.message });
  const { section, curve, clearance, sectionEdgeCount, nativeWork } = inspection.inputs;
  return Object.freeze({ ...receipt, eligible: true as const, nativeBuildRequired: true, transport: 'fixed-binormal' as const,
    section: Object.freeze({ plane: section.plane, offsetMm: section.offset, edgeCount: sectionEdgeCount,
      originWorldMm: cadFramePointToWorld(section.placement.frame, section.offset, [0, 0]), normalWorld: section.placement.frame.normal }),
    curve: Object.freeze({ plane: curve.plane, offsetMm: curve.offset, segmentCount: curve.segments.length,
      lengthMm: curve.length, startWorldMm: curve.startWorld, endWorldMm: curve.endWorld, startTangentWorld: curve.startTangentWorld }),
    clearance, nativeWork });
}
