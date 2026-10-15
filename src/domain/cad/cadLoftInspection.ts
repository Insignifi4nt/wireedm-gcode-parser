import type { CadDocument } from './cadDocument';
import { CadError } from './cadError';
import { isCadImportData } from './cadImportData';
import { parseCadDocument } from './cadSchema';
import { prepareCadDocumentFrames } from './cadDocumentFrames';
import { MAX_CAD_LOFT_SECTIONS, MIN_CAD_LOFT_SECTIONS, resolveCadLoftSections } from './cadLoft';

/** Inspect a proposed final feature, without retaining local geometry or original source files. */
export function inspectCadLoft(document: CadDocument, sketchIds: readonly string[]) {
  if (!isCadImportData(sketchIds) || !Array.isArray(sketchIds)
    || sketchIds.length < MIN_CAD_LOFT_SECTIONS || sketchIds.length > MAX_CAD_LOFT_SECTIONS
    || sketchIds.some(id => typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(id))) {
    throw new CadError('invalid-loft-selection', 'Choose 2–16 ordered sketch feature IDs.');
  }
  const validated = parseCadDocument(document);
  const ids = Object.freeze([...sketchIds]);
  const base = { scope: 'new-feature-at-end' as const, units: 'mm' as const, sketchIds: ids,
    limits: Object.freeze({ minSections: MIN_CAD_LOFT_SECTIONS, maxSections: MAX_CAD_LOFT_SECTIONS }) };
  try {
    const resolved = resolveCadLoftSections({ kind: 'loft', id: 'inspection_loft', name: 'Loft', suppressed: false,
      sketchIds: ids, ruled: false, operation: 'new', targetId: null },
    new Map(validated.features.map(feature => [feature.id, feature])), validated.parameters, prepareCadDocumentFrames(validated));
    return Object.freeze({ ...base, eligible: true as const, nativeBuildRequired: true as const,
      commonFrame: resolved.commonFrame,
      stationOrigin: resolved.legacyPrincipalPlane === null ? 'first-placed-section' as const : 'principal-origin' as const,
      offsetToleranceMm: resolved.offsetTolerance, placementUncertaintyMm: resolved.placementUncertaintyMm,
      sections: Object.freeze(resolved.sections.map(section => Object.freeze({ sketchId: section.sketchId,
        plane: section.plane, offsetMm: section.offset, stationMm: section.stationMm,
        tangentialOffsetMm: section.tangentialOffsetMm }))) });
  } catch (error) {
    if (!(error instanceof CadError)) throw error;
    return Object.freeze({ ...base, eligible: false as const, code: error.code, message: error.message });
  }
}
