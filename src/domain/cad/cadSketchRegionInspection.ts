import type { CadDocument, CadProfile, CadSketchFeature } from './cadDocument';
import type { DxfPoint } from '../dxf/types';
import { CadError } from './cadError';
import { CadDocumentSchema, CadSketchFeatureSchema, isAcceptedCadSketchSource, parseCadDocument } from './cadSchema';
import { Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { isCadImportData } from './cadImportData';
import { measureCadResolvedProfile, type CadBounds2 } from './cadMeasurements';
import { resolveCadSketchContours, type CadResolvedSketchContour, type CadSketchRegion } from './cadSketchGeometry';
import { createCadSketchCellIndex, selectCadSketchRegions, type CadSketchCellReference } from './cadSketchRegionSelection';
import { cadScalarParameterNames, mapCadFeatureScalars } from './cadParameters';
import { CadSketchSplitTargetSchema, splitCadSketchEntity, type CadSketchSplitTarget } from './cadSketchSplit';

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

const preparations = new WeakMap<CadSketchFeature, { names: readonly string[]; values: readonly (number | undefined)[]; cells: CadPreparedSketchCells }>();

/** Reuse source geometry only; placement and complete history still validate separately. */
export function prepareCadSketchCells(sketch: CadSketchFeature, parameters: CadDocument['parameters']): CadPreparedSketchCells {
  if (!isAcceptedCadSketchSource(sketch)) return resolveCells(sketch, parameters);
  const previous = preparations.get(sketch);
  let names = previous?.names;
  if (!names) {
    const used = new Set<string>();
    mapCadFeatureScalars(sketch, (value, path) => {
      if (path.startsWith('profiles.') || path.startsWith('graph.')) for (const name of cadScalarParameterNames(value)) used.add(name);
      return value;
    });
    names = [...used];
  }
  const values: (number | undefined)[] = [], environment: Record<string, number> = Object.create(null);
  for (const name of names) {
    const field = Object.getOwnPropertyDescriptor(parameters, name);
    if (!field) { values.push(undefined); continue; }
    // Preserve the ordinary evaluator for accessors/invalid values without ever
    // adopting their result. Own data is captured once for both key and geometry.
    if (!('value' in field) || typeof field.value !== 'number' || !Number.isFinite(field.value)) return resolveCells(sketch, parameters);
    values.push(field.value); environment[name] = field.value;
  }
  if (previous && values.every((value, index) => Object.is(value, previous.values[index]))) return previous.cells;
  const cells = resolveCells(sketch, environment);
  function freezeGeometry(value: unknown): void {
    if (value === null || typeof value !== 'object') return;
    for (const child of Object.values(value)) freezeGeometry(child);
    Object.freeze(value);
  }
  for (const cell of cells.cells) {
    // Only newly resolved objects are frozen here. The profile is borrowed from
    // the already deeply frozen parser source; raw caller inputs stay untouched.
    freezeGeometry(cell.boundary.geometry); Object.freeze(cell.boundary.point); Object.freeze(cell.boundary);
  }
  preparations.set(sketch, { names, values, cells });
  return cells;
}

/** One complete candidate preparation serves shading, hover, selection and union. */
function resolveCells(sketch: CadSketchFeature, parameters: CadDocument['parameters']): CadPreparedSketchCells {
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

/** Numeric additions/overrides keep existing semantics; split never accepts a replacement sketch. */
export type CadSketchRegionProposal =
  | { readonly sketch?: CadSketchFeature; readonly split?: never; readonly parameterValues?: CadDocument['parameters'] }
  | { readonly split: CadSketchSplitTarget; readonly sketch?: never; readonly parameterValues?: CadDocument['parameters'] };
export const CadSketchRegionProposalSchema = Type.Union([
  Type.Object({ sketch: Type.Optional(CadSketchFeatureSchema), parameterValues: Type.Optional(CadDocumentSchema.properties.parameters) }, { additionalProperties: false, minProperties: 1 }),
  Type.Object({ split: CadSketchSplitTargetSchema, parameterValues: Type.Optional(CadDocumentSchema.properties.parameters) }, { additionalProperties: false })
]);
export function validateCadSketchRegionProposal(proposal: CadSketchRegionProposal): void {
  if (!isCadImportData(proposal) || !Value.Check(CadSketchRegionProposalSchema, proposal))
    throw new CadError('invalid-region-proposal', 'Propose a complete same-ID sketch or one exact split, with optional numeric parameter values; parameter-only proposals are also supported.');
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
    const parameters = { ...validated.parameters, ...proposal.parameterValues };
    let source = proposal.sketch ?? sketch;
    if (proposal.split !== undefined) {
      if (!sketch.graph) throw new CadError('missing-sketch-graph', 'Choose an existing entity-based sketch.');
      source = { ...sketch, graph: splitCadSketchEntity({ graph: sketch.graph, parameters, split: proposal.split }).graph };
    }
    const sourcePlane = source.plane;
    const requiredDatums = typeof sourcePlane === 'string' ? [] : validated.features.slice(0, index)
      .filter(feature => feature.kind === 'datum-plane' && feature.id === sourcePlane.featureId);
    const candidate = parseCadDocument({ ...validated, parameters, features: [...requiredDatums, source] });
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
