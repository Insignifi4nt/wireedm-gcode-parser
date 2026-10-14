import type { CadFeature, CadSketchFeature } from './cadDocument';

export type CadSketchSourcePurpose = 'extrude' | 'pocket' | 'revolve';
export type CadSketchSourceIssue = 'suppressed' | 'no-material' | 'principal-plane-required';

export function cadSketchSupportsThroughAll(sketch: CadSketchFeature): boolean {
  return typeof sketch.plane === 'string';
}

/** Accepted analytic sketch geometry is already closed and validated by the document boundary. */
export function cadSketchSourceIssue(sketch: CadSketchFeature, purpose: CadSketchSourcePurpose): CadSketchSourceIssue | null {
  if (sketch.suppressed) return 'suppressed';
  if (!sketch.profiles.some(profile => !profile.construction)) return 'no-material';
  if (purpose === 'pocket' && !cadSketchSupportsThroughAll(sketch)) return 'principal-plane-required';
  return null;
}

export function cadSketchSourceIssueMessage(sketch: CadSketchFeature, purpose: CadSketchSourcePurpose): string | null {
  const issue = cadSketchSourceIssue(sketch, purpose);
  switch (issue) {
    case null: return null;
    case 'suppressed': return `Selected sketch "${sketch.name}" is suppressed. Resume it or choose an active sketch.`;
    case 'no-material': return `Selected sketch "${sketch.name}" has no closed material contours. Add material geometry or choose another sketch.`;
    case 'principal-plane-required': return `Selected sketch "${sketch.name}" uses a datum plane. Use Distance or choose an XY, XZ or YZ sketch for Through-all Pocket.`;
    default: { const exhaustive: never = issue; return exhaustive; }
  }
}

/** An explicitly selected sketch must be eligible; otherwise default to the latest eligible material sketch. */
export function pickCadSketchSource(input: { features: readonly CadFeature[]; selectedId: string | null; purpose: CadSketchSourcePurpose }): CadSketchFeature | undefined {
  const selected = input.features.find(feature => feature.id === input.selectedId);
  if (selected?.kind === 'sketch') return cadSketchSourceIssue(selected, input.purpose) === null ? selected : undefined;
  for (let index = input.features.length - 1; index >= 0; index--) {
    const feature = input.features[index];
    if (feature.kind === 'sketch' && cadSketchSourceIssue(feature, input.purpose) === null) return feature;
  }
  return undefined;
}
