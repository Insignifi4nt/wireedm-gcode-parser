import type { CadCurveFeature, CadDocument, CadFeature, CadSketchFeature } from '@/domain/cad/cadDocument';
import { inspectCadCurve } from '@/domain/cad/cadCurve';
import { inspectCadSweepSketch } from '@/domain/cad/cadSweep';

export interface CadSweepCandidates {
  readonly precedingFeatures: ReadonlyMap<string, CadFeature>;
  readonly sketches: readonly { readonly sketch: CadSketchFeature; readonly inspection: ReturnType<typeof inspectCadSweepSketch> }[];
  readonly curves: readonly { readonly curve: CadCurveFeature; readonly inspection: ReturnType<typeof inspectCadCurve> }[];
}

/** Inspect source geometry once per immutable document snapshot, not per draft field. */
export function inspectCadSweepCandidates(document: CadDocument, featureId?: string): CadSweepCandidates {
  const index = featureId ? document.features.findIndex(feature => feature.id === featureId) : -1;
  const preceding = index < 0 ? document.features : document.features.slice(0, index);
  return {
    precedingFeatures: new Map(preceding.map(feature => [feature.id, feature])),
    sketches: preceding.flatMap(sketch => sketch.kind === 'sketch' ? [{ sketch, inspection: inspectCadSweepSketch(sketch, document.parameters) }] : []),
    curves: preceding.flatMap(curve => curve.kind === 'curve' ? [{ curve, inspection: inspectCadCurve(curve, document.parameters) }] : []),
  };
}

/** Honor a selected eligible source; do not search pairs or alter world placement. */
export function initialCadSweepSourceIds(candidates: CadSweepCandidates, selectedId?: string): { readonly sketchId: string; readonly curveId: string } {
  const sketches = candidates.sketches.filter(candidate => candidate.inspection.eligible);
  const curves = candidates.curves.filter(candidate => candidate.inspection.eligible);
  return {
    sketchId: (sketches.find(candidate => candidate.sketch.id === selectedId) ?? sketches.at(-1))?.sketch.id ?? '',
    curveId: (curves.find(candidate => candidate.curve.id === selectedId) ?? curves.at(-1))?.curve.id ?? '',
  };
}
