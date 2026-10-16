import type { CadDocument, CadFeature, CadSketchFeature } from '@/domain/cad/cadDocument';
import { cadFramePointToWorld, prepareCadDatumFrames, resolveCadSketchPlacement, type CadResolvedPlacement } from '@/domain/cad/cadDatumPlanes';
import { cadScalarParameterNames } from '@/domain/cad/cadParameters';
import type { CadNumericPoint3 } from '@/domain/cad/cadPlanes';
import { inspectCadScalarValue, type CadScalarValueBinding } from '@/domain/cad/cadScalarValueIntent';
import { cadSketchSourceIssue } from '@/domain/cad/cadSketchSources';
import { prepareCadSketchCells, type CadPreparedSketchCells } from '@/domain/cad/cadSketchRegionInspection';
import { measureCadResolvedProfile, type CadBounds2 } from '@/domain/cad/cadMeasurements';
import type { CadSketchCellReference } from '@/domain/cad/cadSketchRegionSelection';

export type CadExtrudeDepthCapability = { readonly kind: 'editable' } | { readonly kind: 'locked'; readonly reason: string };
export interface CadExtrudeDepthModel {
  readonly featureId: string;
  readonly sketchId: string;
  readonly quantityMm: number;
  readonly symmetric: boolean;
  readonly placement: CadResolvedPlacement;
  readonly materialBoundsMm: CadBounds2;
  readonly originMm: CadNumericPoint3;
  readonly normalWorld: CadNumericPoint3;
  readonly startMm: CadNumericPoint3;
  readonly endMm: CadNumericPoint3;
  readonly binding: Exclude<CadScalarValueBinding, { kind: 'invalid' }>;
  readonly capability: CadExtrudeDepthCapability;
}
export interface CadExtrudeDepthState {
  readonly model: CadExtrudeDepthModel;
  readonly definitionKey: string;
  readonly gestureActive: boolean;
  readonly capability: CadExtrudeDepthCapability;
}
/** Internal editor-owned interaction; every quantity remains provisional until Apply. */
export interface CadExtrudeDepthControl {
  readonly owner: string;
  readonly featureId: string;
  readonly baseVersion: string;
  subscribe(listener: () => void): () => void;
  getState(): CadExtrudeDepthState | null;
  begin(expectedDefinitionKey: string): string | null;
  setQuantity(token: string, quantityMm: number): boolean;
  release(token: string): boolean;
  cancel(token: string): boolean;
}

// The domain owns source preparation. Each prepared result keeps only its latest
// selected material bounds, so a changed source/driver cannot reuse old bounds.
const selectedBounds = new WeakMap<CadPreparedSketchCells, { selectionKey: string; bounds: CadBounds2 | null }>();
function materialBounds(sketch: CadSketchFeature, parameters: CadDocument['parameters'], selection?: readonly CadSketchCellReference[]): CadBounds2 | null {
  const cells = prepareCadSketchCells(sketch, parameters), entry = selectedBounds.get(cells);
  const selectionKey = JSON.stringify(selection ?? null);
  if (entry && selectionKey === entry.selectionKey) return entry.bounds;
  let bounds: CadBounds2 | null = null;
  for (const region of cells.resolve(selection)) {
    const next = measureCadResolvedProfile(region.boundary.geometry).boundsMm;
    bounds = bounds ? { minX: Math.min(bounds.minX, next.minX), minY: Math.min(bounds.minY, next.minY),
      maxX: Math.max(bounds.maxX, next.maxX), maxY: Math.max(bounds.maxY, next.maxY) } : next;
  }
  selectedBounds.set(cells, { selectionKey, bounds: bounds ? Object.freeze(bounds) : null });
  return bounds;
}

/** Resolve the real candidate frame even when its driver cannot safely be dragged. */
export function inspectCadExtrudeDepth(document: CadDocument, feature: CadFeature): CadExtrudeDepthModel | null {
  if (feature.kind !== 'extrude' || feature.suppressed) return null;
  const index = document.features.findIndex(entry => entry.id === feature.id);
  const preceding = index < 0 ? document.features : document.features.slice(0, index);
  const sketch = preceding.find(entry => entry.id === feature.sketchId);
  if (sketch?.kind !== 'sketch' || cadSketchSourceIssue(sketch, 'extrude', document.parameters)) return null;
  const binding = inspectCadScalarValue(feature.distance, document.parameters);
  if (binding.kind === 'invalid') return null;
  const materialBoundsMm = materialBounds(sketch, document.parameters, feature.regionSelection);
  if (!materialBoundsMm) return null;
  const sketchIndex = preceding.indexOf(sketch);
  const plane = sketch.plane;
  const datum = typeof plane === 'string' ? null : preceding.slice(0, sketchIndex).find(entry => entry.id === plane.featureId);
  const placement = resolveCadSketchPlacement(sketch, document.parameters, prepareCadDatumFrames(datum?.kind === 'datum-plane' ? [datum] : [], document.parameters));
  const { frame, offsetMm } = placement, quantityMm = binding.quantity;
  let capability: CadExtrudeDepthCapability = { kind: 'editable' };
  if (binding.kind === 'formula') capability = { kind: 'locked', reason: 'Length follows a formula. Edit its relation with fx.' };
  else if (binding.kind === 'parameter') {
    const placementScalars = [sketch.offset, ...(datum?.kind === 'datum-plane' ? [...datum.definition.origin, ...datum.definition.rotation] : [])];
    if (placementScalars.some(value => cadScalarParameterNames(value).includes(binding.name))) {
      capability = { kind: 'locked', reason: `Length and source placement both reference "${binding.name}". Edit Length to preserve the relation.` };
    }
  }
  if (quantityMm === 0) capability = { kind: 'locked', reason: 'Enter a nonzero Length before dragging.' };
  return { featureId: feature.id, sketchId: feature.sketchId, quantityMm, symmetric: feature.symmetric, placement, materialBoundsMm,
    originMm: cadFramePointToWorld(frame, offsetMm, [0, 0]), normalWorld: frame.normal,
    startMm: cadFramePointToWorld(frame, offsetMm - (feature.symmetric ? quantityMm / 2 : 0), [0, 0]),
    endMm: cadFramePointToWorld(frame, offsetMm + (feature.symmetric ? quantityMm / 2 : quantityMm), [0, 0]), binding, capability };
}
