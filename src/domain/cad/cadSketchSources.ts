import type { CadFeature, CadSketchFeature } from './cadDocument';
import { cadFeatureActive } from './features/cadFeatureActivity';
import { compileCadSketchGeometry } from './compileCadSketchGeometry';
import { prepareCadSketchCells } from './cadSketchRegionInspection';

export type CadSketchSourcePurpose = 'extrude' | 'pocket' | 'revolve';
export type CadSketchSourceIssue = 'suppressed' | 'no-material' | 'principal-plane-required';
export type CadSketchSourceAvailability = { readonly kind: 'default-material' | 'choose-areas' }
  | { readonly kind: 'unavailable'; readonly issue: CadSketchSourceIssue; readonly message: string };

export function cadSketchSupportsThroughAll(sketch: CadSketchFeature): boolean {
  return typeof sketch.plane === 'string';
}

/** Opening Pad/Pocket may invite explicit areas; default-only consumers keep their existing eligibility. */
export function cadSketchSourceAvailability(sketch: CadSketchFeature, purpose: CadSketchSourcePurpose, parameters: Readonly<Record<string, number>> = {}): CadSketchSourceAvailability {
  const issue = !cadFeatureActive(sketch, { parameters }) ? 'suppressed' : purpose === 'pocket' && !cadSketchSupportsThroughAll(sketch)
    ? 'principal-plane-required' : cadSketchSourceIssue(sketch, purpose, parameters);
  if (issue === null) return { kind: 'default-material' };
  if (issue === 'no-material' && purpose !== 'revolve') {
    try { if (prepareCadSketchCells(sketch, parameters, 'graph-cells').cells.length) return { kind: 'choose-areas' }; }
    catch { /* Unsupported graph arrangements do not change default material eligibility. */ }
  }
  return { kind: 'unavailable', issue, message: sourceIssueMessage(sketch, issue) };
}

/** Accepted analytic sketch geometry is already closed and validated by the document boundary. */
export function cadSketchSourceIssue(sketch: CadSketchFeature, purpose: CadSketchSourcePurpose, parameters: Readonly<Record<string, number>> = {}): CadSketchSourceIssue | null {
  if (!cadFeatureActive(sketch, { parameters })) return 'suppressed';
  if (!sketch.profiles.some(profile => !profile.construction)) {
    try { if (!compileCadSketchGeometry(sketch, parameters).profiles.some(profile => !profile.construction)) return 'no-material'; }
    catch { return 'no-material'; }
  }
  if (purpose === 'pocket' && !cadSketchSupportsThroughAll(sketch)) return 'principal-plane-required';
  return null;
}

export function cadSketchSourceIssueMessage(sketch: CadSketchFeature, purpose: CadSketchSourcePurpose, parameters: Readonly<Record<string, number>> = {}): string | null {
  const issue = cadSketchSourceIssue(sketch, purpose, parameters);
  return issue === null ? null : sourceIssueMessage(sketch, issue);
}
function sourceIssueMessage(sketch: CadSketchFeature, issue: CadSketchSourceIssue): string {
  switch (issue) {
    case 'suppressed': return `Selected sketch "${sketch.name}" is suppressed. Resume it or choose an active sketch.`;
    case 'no-material': return `Selected sketch "${sketch.name}" has no closed material contours. Add material geometry or choose another sketch.`;
    case 'principal-plane-required': return `Selected sketch "${sketch.name}" uses a datum plane. Use Distance or choose an XY, XZ or YZ sketch for Through-all Pocket.`;
    default: { const exhaustive: never = issue; return exhaustive; }
  }
}

/** Keep explicit source choice; Pad/Pocket may open with a deliberate area-selection requirement. */
export function pickCadSketchSource(input: { features: readonly CadFeature[]; selectedId: string | null; purpose: CadSketchSourcePurpose; parameters?: Readonly<Record<string, number>> }): CadSketchFeature | undefined {
  const selected = input.features.find(feature => feature.id === input.selectedId);
  if (selected?.kind === 'sketch') return cadSketchSourceAvailability(selected, input.purpose, input.parameters).kind !== 'unavailable' ? selected : undefined;
  for (let index = input.features.length - 1; index >= 0; index--) {
    const feature = input.features[index];
    if (feature.kind === 'sketch' && cadSketchSourceAvailability(feature, input.purpose, input.parameters).kind !== 'unavailable') return feature;
  }
  return undefined;
}
