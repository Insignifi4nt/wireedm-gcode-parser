import type { CadDocument, CadSketchFeature } from '@/domain/cad/cadDocument';
import { inspectCadLoftSketch, resolveCadLoftSectionPlacements } from '@/domain/cad/cadLoft';
import { prepareCadDatumFrames } from '@/domain/cad/cadDatumPlanes';
import { CadError } from '@/domain/cad/cadError';

export interface CadLoftCandidate {
  readonly sketch: CadSketchFeature;
  readonly inspection: ReturnType<typeof inspectCadLoftSketch>;
}

export function inspectCadLoftCandidates(document: CadDocument, featureId?: string): readonly CadLoftCandidate[] {
  const index = featureId ? document.features.findIndex(feature => feature.id === featureId) : -1;
  const preceding = index < 0 ? document.features : document.features.slice(0, index);
  const frames = prepareCadDatumFrames(preceding, document.parameters);
  return Object.freeze(preceding.flatMap(sketch => sketch.kind === 'sketch' ? [{ sketch, inspection: inspectCadLoftSketch(sketch, document.parameters, frames) }] : []));
}

/** Choose defaults in history order; never reorder sections by geometric offset. */
export function initialCadLoftSketchIds(candidates: readonly CadLoftCandidate[], selectedId?: string): readonly string[] {
  const eligible = candidates.flatMap(candidate => candidate.inspection.eligible ? [candidate.inspection.section] : []);
  const selected = eligible.find(section => section.sketchId === selectedId) ?? eligible[0];
  if (!selected) return [];
  const index = eligible.indexOf(selected);
  const compatible = (section: typeof selected) => {
    try { resolveCadLoftSectionPlacements([selected, section]); return true; }
    catch (error) { if (error instanceof CadError) return false; throw error; }
  };
  const other = eligible.slice(index + 1).find(compatible) ?? eligible.slice(0, index).reverse().find(compatible);
  return Object.freeze(eligible.filter(section => section === selected || section === other).map(section => section.sketchId));
}
