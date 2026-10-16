import { Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { CadError } from './cadError';
import { isCadImportData } from './cadImportData';
import { CadIdentifierSchema } from './cadPrimitives';
import type { CadResolvedSketchContour, CadSketchRegion } from './cadSketchGeometry';
import type { CadSketchGraphSourceRef } from './cadSketchGraphGeometry';

/** A bounded cell of the complete contour forest, not a profile or a native face key. */
export interface CadSketchCellReference {
  readonly boundaryProfileId: string;
  readonly voidProfileIds: readonly string[];
  /** Complete ordered path from outermost containing contour to direct parent. */
  readonly ancestorProfileIds: readonly string[];
  /** Exact graph cycles participating in this cell. Legacy-only references omit it. */
  readonly graphContours?: readonly { readonly profileId: string; readonly sourceRefs: readonly CadSketchGraphSourceRef[] }[];
}
export const CadSketchCellReferenceSchema = Type.Object({ boundaryProfileId: { ...CadIdentifierSchema, description: 'Stable boundary profile ID of one bounded cell from the complete validated sketch forest.' },
  voidProfileIds: Type.Array(CadIdentifierSchema, { uniqueItems: true, description: 'Every immediate nonconstruction child profile ID, sorted lexically. Use the exact inspected reference.' }),
  ancestorProfileIds: Type.Array(CadIdentifierSchema, { uniqueItems: true, description: 'Complete containing profile IDs in outermost-to-direct-parent order. Use the exact inspected reference.' }),
  graphContours: Type.Optional(Type.Array(Type.Object({ profileId: CadIdentifierSchema,
    sourceRefs: Type.Array(Type.Object({ entityId: CadIdentifierSchema, reversed: Type.Boolean() }, { additionalProperties: false }), { minItems: 1 })
  }, { additionalProperties: false }), { minItems: 1 })),
}, { additionalProperties: false });
export const CadSketchRegionSelectionSchema = Type.Array(CadSketchCellReferenceSchema, { minItems: 1, uniqueItems: true,
  description: 'Explicit bounded cells; obtain exact current references with cad_inspect_sketch_regions. Missing field retains whole-sketch automatic holes. Empty, duplicate or changed cell references reject.' });

/** Shape-valid dormant selectors stay saved; active resolution checks their exact topology. */
export function validateCadSketchRegionSelection(selection: readonly CadSketchCellReference[]): void {
  if (!isCadImportData(selection) || !Value.Check(CadSketchRegionSelectionSchema, selection))
    throw new CadError('invalid-region-selection', 'Choose one or more complete closed sketch region references.');
  const boundaries = new Set<string>();
  for (const cell of selection) {
    const ancestors = new Set(cell.ancestorProfileIds);
    if (boundaries.has(cell.boundaryProfileId) || cell.voidProfileIds.includes(cell.boundaryProfileId)
        || ancestors.has(cell.boundaryProfileId) || cell.voidProfileIds.some(id => ancestors.has(id))
        || cell.voidProfileIds.some((id, index) => index > 0 && cell.voidProfileIds[index - 1] >= id))
      throw new CadError('invalid-region-selection', 'Selected sketch regions need unique boundaries, sorted child IDs and a complete ordered ancestor path.');
    boundaries.add(cell.boundaryProfileId);
  }
}

/** Local indexes belong to this validated resolution; nothing is cached across parameter edits. */
export function createCadSketchCellIndex(contours: readonly CadResolvedSketchContour[]) {
  const byId = new Map(contours.map(contour => [contour.profile.id, contour]));
  const children = new Map<string, CadResolvedSketchContour[]>();
  for (const contour of contours) if (contour.parentId !== null) {
    const siblings = children.get(contour.parentId) ?? [];
    siblings.push(contour); children.set(contour.parentId, siblings);
  }
  function reference(boundaryProfileId: string): CadSketchCellReference {
    const contour = byId.get(boundaryProfileId);
    if (!contour) throw new CadError('stale-sketch-region', `Sketch region "${boundaryProfileId}" is missing or construction geometry. Choose its area again.`);
    const ancestors: string[] = [];
    let parentId = contour.parentId;
    while (parentId !== null) {
      ancestors.push(parentId);
      const parent = byId.get(parentId);
      if (!parent) throw new CadError('invalid-profile', 'The resolved sketch containment forest is incomplete.');
      parentId = parent.parentId;
    }
    const voidProfileIds = Object.freeze((children.get(boundaryProfileId) ?? []).map(child => child.profile.id).sort());
    const graphContours = [boundaryProfileId, ...voidProfileIds, ...ancestors].sort().flatMap(profileId => {
      const sourceRefs = byId.get(profileId)?.profile.graphSourceRefs;
      return sourceRefs ? [Object.freeze({ profileId, sourceRefs })] : [];
    });
    return Object.freeze({ boundaryProfileId, voidProfileIds, ancestorProfileIds: Object.freeze(ancestors.reverse()),
      ...(graphContours.length ? { graphContours: Object.freeze(graphContours) } : {}) });
  }
  return { byId, children, reference };
}

/** Union cells before native faces exist: adjoining selected cells cancel their shared contour. */
export function selectCadSketchRegions(contours: readonly CadResolvedSketchContour[], selection?: readonly CadSketchCellReference[]): readonly CadSketchRegion[] {
  const index = createCadSketchCellIndex(contours);
  if (selection === undefined) return contours.filter(contour => contour.depth % 2 === 0).map(boundary => ({ boundary,
    voids: index.children.get(boundary.profile.id) ?? [] }));
  validateCadSketchRegionSelection(selection);
  const selected = new Set<string>();
  for (const cell of selection) {
    const current = index.reference(cell.boundaryProfileId);
    if (JSON.stringify(current.voidProfileIds) !== JSON.stringify(cell.voidProfileIds)
        || JSON.stringify(current.ancestorProfileIds) !== JSON.stringify(cell.ancestorProfileIds)
        || JSON.stringify(current.graphContours) !== JSON.stringify(cell.graphContours))
      throw new CadError('stale-sketch-region', `Sketch region "${cell.boundaryProfileId}" changed its boundary, holes or nesting. Choose its area again.`);
    selected.add(cell.boundaryProfileId);
  }
  const additions = new Set<string>();
  const selectedOwner = new Map<string, string>();
  const holeOwner = new Map<string, string>();
  for (const contour of [...contours].sort((a, b) => a.depth - b.depth)) {
    const parentId = contour.parentId;
    const parentSelected = parentId !== null && selected.has(parentId);
    const parentOwner = parentId !== null ? selectedOwner.get(parentId) : undefined;
    if (selected.has(contour.profile.id)) {
      const owner = parentSelected ? parentOwner : contour.profile.id;
      if (!owner) throw new CadError('invalid-profile', 'The resolved sketch region has no material boundary.');
      selectedOwner.set(contour.profile.id, owner);
      if (!parentSelected) additions.add(contour.profile.id);
    } else if (parentSelected) {
      const owner = parentOwner;
      if (!owner) throw new CadError('invalid-profile', 'The resolved sketch void has no material boundary.');
      holeOwner.set(contour.profile.id, owner);
    }
  }
  const voids = new Map<string, CadResolvedSketchContour[]>();
  for (const contour of contours) {
    const owner = holeOwner.get(contour.profile.id);
    if (owner) { const list = voids.get(owner) ?? []; list.push(contour); voids.set(owner, list); }
  }
  return contours.filter(contour => additions.has(contour.profile.id)).map(boundary => ({ boundary, voids: voids.get(boundary.profile.id) ?? [] }));
}
