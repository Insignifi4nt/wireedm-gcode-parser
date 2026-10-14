import type { CadDocument, CadProfile, CadSketchFeature } from './cadDocument';
import type { DxfPoint } from '../dxf/types';
import { CadError } from './cadError';
import { CadDocumentSchema, CadSketchFeatureSchema, parseCadDocument } from './cadSchema';
import { Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { isCadImportData } from './cadImportData';
import { measureCadResolvedProfile, type CadBounds2 } from './cadMeasurements';
import { resolveCadSketchContours, type CadResolvedSketchContour, type CadSketchRegion } from './cadSketchGeometry';
import { createCadSketchCellIndex, selectCadSketchRegions, type CadSketchCellReference } from './cadSketchRegionSelection';

export interface CadPreparedSketchCell {
  readonly reference: CadSketchCellReference;
  readonly boundary: CadResolvedSketchContour;
  readonly voids: readonly CadResolvedSketchContour[];
  readonly areaMm2: number;
  readonly boundaryLengthMm: number;
  readonly boundsMm: CadBounds2;
  readonly defaultMaterial: boolean;
}
export interface CadPreparedSketchCells {
  readonly cells: readonly CadPreparedSketchCell[];
  pick(point: DxfPoint): CadPreparedSketchCell | null;
  resolve(selection?: readonly CadSketchCellReference[]): readonly CadSketchRegion[];
}

/** One immutable candidate preparation serves shading, hover, selection and union. */
export function prepareCadSketchCells(sketch: CadSketchFeature, parameters: CadDocument['parameters']): CadPreparedSketchCells {
  if (sketch.suppressed) throw new CadError('suppressed-sketch', `Sketch "${sketch.name}" is suppressed. Resume it before choosing its areas.`);
  const contours = resolveCadSketchContours(sketch, parameters);
  const index = createCadSketchCellIndex(contours);
  const measurements = new Map<string, ReturnType<typeof measureCadResolvedProfile>>();
  function measurement(contour: CadResolvedSketchContour) {
    let value = measurements.get(contour.profile.id);
    if (!value) { value = measureCadResolvedProfile(contour.geometry); measurements.set(contour.profile.id, value); }
    return value;
  }
  const cells = contours.map(boundary => {
    const outer = measurement(boundary);
    const voids = index.children.get(boundary.profile.id) ?? [];
    let areaMm2 = outer.areaMm2, boundaryLengthMm = outer.perimeterMm;
    for (const child of voids) { const inside = measurement(child); areaMm2 -= inside.areaMm2; boundaryLengthMm += inside.perimeterMm; }
    return Object.freeze({ reference: index.reference(boundary.profile.id), boundary, voids: Object.freeze([...voids]),
      areaMm2, boundaryLengthMm, boundsMm: Object.freeze({ ...outer.boundsMm }), defaultMaterial: boundary.depth % 2 === 0 });
  }).sort((a, b) => a.reference.boundaryProfileId < b.reference.boundaryProfileId ? -1 : a.reference.boundaryProfileId > b.reference.boundaryProfileId ? 1 : 0);
  const pickOrder = [...cells].sort((a, b) => b.boundary.depth - a.boundary.depth);
  return Object.freeze({ cells: Object.freeze(cells),
    pick(point: DxfPoint) {
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
      for (const cell of pickOrder) {
        const bounds = cell.boundsMm;
        if (point.x >= bounds.minX && point.x <= bounds.maxX && point.y >= bounds.minY && point.y <= bounds.maxY
            && cell.boundary.containsPoint(point)) return cell;
      }
      return null;
    },
    resolve: (selection?: readonly CadSketchCellReference[]) => selectCadSketchRegions(contours, selection),
  });
}

export interface CadSketchRegionProposal {
  readonly sketch?: CadSketchFeature;
  /** Numeric additions/overrides, not a replacement of the accepted parameter map. */
  readonly parameterValues?: CadDocument['parameters'];
}
export const CadSketchRegionProposalSchema = Type.Object({ sketch: Type.Optional(CadSketchFeatureSchema),
  parameterValues: Type.Optional(CadDocumentSchema.properties.parameters) }, { additionalProperties: false, minProperties: 1 });
export function validateCadSketchRegionProposal(proposal: CadSketchRegionProposal): void {
  if (!isCadImportData(proposal) || !Value.Check(CadSketchRegionProposalSchema, proposal))
    throw new CadError('invalid-region-proposal', 'Propose a complete same-ID sketch, numeric parameter values, or both.');
}

function activeSketch(document: CadDocument, sketchId: string, proposal?: CadSketchRegionProposal) {
  const validated = parseCadDocument(document);
  const index = validated.features.findIndex(feature => feature.id === sketchId);
  const sketch = validated.features[index];
  if (sketch?.kind !== 'sketch') throw new CadError('missing-sketch', 'Choose an existing sketch to inspect its closed regions.');
  if (sketch.suppressed) throw new CadError('suppressed-sketch', `Sketch "${sketch.name}" is suppressed. Resume it before choosing its areas.`);
  if (proposal !== undefined) {
    validateCadSketchRegionProposal(proposal);
    if (proposal.sketch !== undefined && proposal.sketch.id !== sketchId)
      throw new CadError('invalid-region-proposal', 'The proposed sketch must keep the same requested sketch identity.');
    // Read only this complete source and its actual preceding datum dependency.
    // Other selected solids may intentionally need repair in the same later
    // atomic batch; validating them here would prevent inspecting fresh cells.
    const source = proposal.sketch ?? sketch, sourcePlane = source.plane;
    const requiredDatums = typeof sourcePlane === 'string' ? [] : validated.features.slice(0, index)
      .filter(feature => feature.kind === 'datum-plane' && feature.id === sourcePlane.featureId);
    const candidate = parseCadDocument({ ...validated, parameters: { ...validated.parameters, ...proposal.parameterValues }, features: [...requiredDatums, source] });
    const effective = candidate.features[candidate.features.length - 1];
    if (effective.kind !== 'sketch') throw new CadError('invalid-region-proposal', 'The proposed source must remain a sketch.');
    if (effective.suppressed) throw new CadError('suppressed-sketch', `Sketch "${effective.name}" is suppressed. Resume it before choosing its areas.`);
    return { sketch: effective, parameters: candidate.parameters };
  }
  return { sketch, parameters: validated.parameters };
}

export interface CadSketchCellInspection {
  readonly boundaryProfileId: string;
  readonly name: string;
  readonly kind: CadProfile['kind'];
  readonly depth: number;
  readonly defaultMaterial: boolean;
  readonly areaMm2: number;
  readonly boundaryLengthMm: number;
  readonly boundsMm: CadBounds2;
  readonly reference: CadSketchCellReference;
}

/** The requested window is a read boundary, not an authored cell-count ceiling. */
export function inspectCadSketchRegions(document: CadDocument, sketchId: string, input: { offset?: number; limit?: number; proposal?: CadSketchRegionProposal } = {}) {
  const offset = input.offset ?? 0, limit = input.limit ?? 10;
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1)
    throw new CadError('invalid-region-page', 'Region offset must be nonnegative and limit must be a positive integer.');
  const { sketch, parameters } = activeSketch(document, sketchId, input.proposal);
  const prepared = prepareCadSketchCells(sketch, parameters);
  const start = Math.min(offset, prepared.cells.length), end = start + Math.min(limit, prepared.cells.length - start);
  const items: CadSketchCellInspection[] = prepared.cells.slice(start, end).map(cell => ({ boundaryProfileId: cell.reference.boundaryProfileId,
    name: cell.boundary.profile.name, kind: cell.boundary.profile.geometry.kind, depth: cell.boundary.depth,
    defaultMaterial: cell.defaultMaterial, areaMm2: cell.areaMm2, boundaryLengthMm: cell.boundaryLengthMm, boundsMm: cell.boundsMm, reference: cell.reference }));
  return { sketchId, ...(input.proposal === undefined ? {} : { proposed: true as const }), coordinateSystem: 'sketch-local' as const, units: 'mm' as const, items,
    total: prepared.cells.length, nextOffset: end < prepared.cells.length ? end : null };
}

/** Obtain only one complete signature for exact chunked tool reads. */
export function readCadSketchRegionReference(document: CadDocument, sketchId: string, boundaryProfileId: string, proposal?: CadSketchRegionProposal): CadSketchCellReference {
  const { sketch, parameters } = activeSketch(document, sketchId, proposal);
  return createCadSketchCellIndex(resolveCadSketchContours(sketch, parameters)).reference(boundaryProfileId);
}
