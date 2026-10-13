import type { CadDocument, CadSketchFeature } from '@/domain/cad/cadDocument';
import { cadLoftOffsetTolerance, inspectCadLoftSketch } from '@/domain/cad/cadLoft';

export interface CadLoftCandidate {
  readonly sketch: CadSketchFeature;
  readonly inspection: ReturnType<typeof inspectCadLoftSketch>;
}

export function inspectCadLoftCandidates(document: CadDocument, featureId?: string): readonly CadLoftCandidate[] {
  const index = featureId ? document.features.findIndex(feature => feature.id === featureId) : -1;
  const preceding = index < 0 ? document.features : document.features.slice(0, index);
  return preceding.flatMap(sketch => sketch.kind === 'sketch' ? [{ sketch, inspection: inspectCadLoftSketch(sketch, document.parameters) }] : []);
}

/** Choose defaults in history order; never reorder sections by geometric offset. */
export function initialCadLoftSketchIds(candidates: readonly CadLoftCandidate[], selectedId?: string): readonly string[] {
  const eligible = candidates.flatMap(candidate => candidate.inspection.eligible ? [{ id: candidate.sketch.id, plane: candidate.inspection.section.plane, offset: candidate.inspection.section.offset }] : []);
  const selected = eligible.find(section => section.id === selectedId) ?? eligible[0];
  if (!selected) return [];
  const compatible = eligible.filter(section => section.plane === selected.plane);
  const index = compatible.findIndex(section => section.id === selected.id);
  const separated = (offset: number) => Math.abs(offset - selected.offset) > cadLoftOffsetTolerance([offset, selected.offset]);
  const other = compatible.slice(index + 1).find(section => separated(section.offset))
    ?? compatible.slice(0, index).reverse().find(section => separated(section.offset));
  return eligible.filter(section => section.id === selected.id || section.id === other?.id).map(section => section.id);
}
