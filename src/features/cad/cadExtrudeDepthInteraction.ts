import type { CadDocument, CadFeature, CadMesh, CadSketchFeature } from '@/domain/cad/cadDocument';
import { cadFeatureActive } from '@/domain/cad/features/cadFeatureActivity';
import { cadFeatureInputs } from '@/domain/cad/cadFeatureInputs';
import { cadScalarValueIntent } from '@/domain/cad/cadScalarValueIntent';
import { cadFeatureCandidateEdits, type CadFeatureCandidateEdits } from './cadFeaturePreview';
import { cadFramePointToWorld, prepareCadDatumFrames, resolveCadSketchPlacement, type CadResolvedPlacement } from '@/domain/cad/cadDatumPlanes';
import { cadScalarParameterNames } from '@/domain/cad/cadParameters';
import type { CadNumericPoint3 } from '@/domain/cad/cadPlanes';
import { inspectCadScalarValue, type CadScalarValueBinding } from '@/domain/cad/cadScalarValueIntent';
import { prepareCadSketchCells, type CadPreparedSketchCatalog } from '@/domain/cad/cadSketchRegionInspection';
import { measureCadResolvedProfile, type CadBounds2 } from '@/domain/cad/cadMeasurements';
import { isCadSketchGraphCellSelection, type CadSketchRegionSelection } from '@/domain/cad/cadSketchRegionSelection';

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
  /** Whether this face of a displayed body is this Pad's end cap, so pressing it drags this Length. Absent: only the arrow drags. */
  ownsEndFace?(mesh: CadMesh, faceKey: string): boolean;
}

// The domain owns source preparation. Each prepared result keeps only its latest
// selected material bounds, so a changed source/driver cannot reuse old bounds.
const selectedBounds = new WeakMap<CadPreparedSketchCatalog, { selectionKey: string; bounds: CadBounds2 | null }>();
function materialBounds(sketch: CadSketchFeature, parameters: CadDocument['parameters'], selection?: CadSketchRegionSelection): CadBounds2 | null {
  const cells = prepareCadSketchCells(sketch, parameters, isCadSketchGraphCellSelection(selection) ? 'graph-cells' : 'contours'), entry = selectedBounds.get(cells);
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
  if (feature.kind !== 'extrude' || !cadFeatureActive(feature, document)) return null;
  const index = document.features.findIndex(entry => entry.id === feature.id);
  const preceding = index < 0 ? document.features : document.features.slice(0, index);
  const sketch = preceding.find(entry => entry.id === feature.sketchId);
  if (sketch?.kind !== 'sketch' || !cadFeatureActive(sketch, document)) return null;
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

export type CadExtrudeDepthEditResult = { readonly kind: 'edits'; readonly edits: CadFeatureCandidateEdits }
  | { readonly kind: 'unchanged' } | { readonly kind: 'locked'; readonly reason: string };
/**
 * The accepted edits that give one Pad a new Length. A Length bound to a parameter
 * sets that parameter, like typing the value would; a formula or a placement
 * relation stays in charge and the drag is refused.
 */
export function cadExtrudeDepthEdits(document: CadDocument, featureId: string, quantityMm: number): CadExtrudeDepthEditResult {
  const feature = document.features.find(entry => entry.id === featureId);
  if (feature?.kind !== 'extrude') return { kind: 'locked', reason: 'Select a Pad to drag its Length.' };
  const model = inspectCadExtrudeDepth(document, feature);
  if (!model) return { kind: 'locked', reason: 'This Pad has no active source to drag.' };
  if (model.capability.kind === 'locked') return model.capability;
  if (!Number.isFinite(quantityMm) || quantityMm === 0) return { kind: 'locked', reason: 'Length must be a nonzero number.' };
  const intent = cadScalarValueIntent({ source: feature.distance, parameters: document.parameters, quantity: quantityMm });
  if (intent.kind === 'unchanged') return { kind: 'unchanged' };
  if (intent.kind === 'locked') return intent;
  return { kind: 'edits', edits: intent.kind === 'parameter'
    ? cadFeatureCandidateEdits({ feature, isNew: false, parameters: { [intent.name]: intent.value } })
    : cadFeatureCandidateEdits({ feature: { ...feature, distance: intent.source }, isNew: false }) };
}

// A face is the end cap when it lies flat on the end plane inside the source's material bounds.
const PARALLEL_COSINE = Math.cos(Math.PI / 180);
function endCapTolerance(model: CadExtrudeDepthModel, point: CadNumericPoint3) {
  return 1e-3 + model.placement.frame.precision.originUncertaintyMm + 1e-9 * Math.max(...point.map(Math.abs), ...model.endMm.map(Math.abs));
}
function onEndCap(model: CadExtrudeDepthModel, point: CadNumericPoint3, tolerance: number) {
  const { frame } = model.placement, bounds = model.materialBoundsMm;
  // Subtract first: far-origin parts keep their local displacement.
  const relative = [point[0] - model.endMm[0], point[1] - model.endMm[1], point[2] - model.endMm[2]];
  const dot = (axis: CadNumericPoint3) => relative[0] * axis[0] + relative[1] * axis[1] + relative[2] * axis[2];
  const x = dot(frame.u), y = dot(frame.v);
  return Math.abs(dot(frame.normal)) <= tolerance && x >= bounds.minX - tolerance && x <= bounds.maxX + tolerance && y >= bounds.minY - tolerance && y <= bounds.maxY + tolerance;
}
/** Whether a point picked on the model, with its face normal, lies on this Pad's end cap. */
export function cadExtrudeEndFaceAt(model: CadExtrudeDepthModel, point: CadNumericPoint3, faceNormal: CadNumericPoint3): boolean {
  const length = Math.hypot(...faceNormal);
  if (![...point, ...faceNormal].every(Number.isFinite) || length === 0) return false;
  const n = model.normalWorld, cosine = Math.abs(n[0] * faceNormal[0] + n[1] * faceNormal[1] + n[2] * faceNormal[2]) / length;
  return cosine >= PARALLEL_COSINE && onEndCap(model, point, endCapTolerance(model, point));
}

/**
 * The Pad whose end cap is this picked face, searched back from the body through
 * the features that built it. Moved or patterned copies are never traced.
 */
export function cadExtrudeForEndFace(document: CadDocument, mesh: CadMesh, faceKey: string): string | null {
  const group = mesh.faceGroups.find(entry => entry.key === faceKey);
  if (!group || group.count < 1) return null;
  const vertices = new Set<number>();
  // Group start and count address the index buffer, like three.js geometry groups.
  for (let offset = group.start; offset < group.start + group.count; offset++) {
    const index = mesh.indices[offset]; if (index === undefined) return null; vertices.add(index);
  }
  const points = [...vertices].map((index): CadNumericPoint3 => [mesh.positions[index * 3], mesh.positions[index * 3 + 1], mesh.positions[index * 3 + 2]]);
  if (!points.every(point => point.every(Number.isFinite))) return null;
  const first = mesh.indices[group.start], normal: CadNumericPoint3 = [mesh.normals[first * 3], mesh.normals[first * 3 + 1], mesh.normals[first * 3 + 2]];
  const byId = new Map(document.features.map(feature => [feature.id, feature]));
  const queue = [mesh.featureId], visited = new Set<string>();
  while (queue.length) {
    const id = queue.shift(); if (!id || visited.has(id)) continue; visited.add(id);
    const feature = byId.get(id); if (!feature || !cadFeatureActive(feature, document)) continue;
    if (feature.kind === 'transform' || feature.kind === 'linear-pattern' || feature.kind === 'circular-pattern' || feature.kind === 'mirror') continue;
    if (feature.kind === 'extrude') {
      let model: CadExtrudeDepthModel | null = null;
      try { model = inspectCadExtrudeDepth(document, feature); } catch { model = null; }
      if (model && points.every(point => cadExtrudeEndFaceAt(model, point, normal))) return feature.id;
    }
    queue.push(...cadFeatureInputs(feature).bodyIds);
  }
  return null;
}
