import { Type, type Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { CadError } from './cadError';
import { isCadImportData } from './cadImportData';
import type { CadSketchGraph } from './cadSketchGraph';
import { CAD_SKETCH_ELEMENT_ID_PATTERN, cadSketchFixedElementError, isCadSketchVirtualSelection } from './sketch-relations/cadSketchVirtualElements';

/** A picked point or edge: a stored one, or the origin as a point and an axis as an edge, by their reserved ids. */
export const CadSketchGraphSelectionSchema = Type.Object({
  kind: Type.Union([Type.Literal('point'), Type.Literal('entity')]), id: Type.String({ pattern: CAD_SKETCH_ELEMENT_ID_PATTERN }),
}, { additionalProperties: false });
export type CadSketchGraphSelection = Readonly<Static<typeof CadSketchGraphSelectionSchema>>;
/** Most points and edges one selection, or one geometry move, may name. */
export const CAD_SKETCH_SELECTION_LIMIT = 64;
export const CadSketchGraphSelectionSetSchema = Type.Array(CadSketchGraphSelectionSchema, { maxItems: CAD_SKETCH_SELECTION_LIMIT, uniqueItems: true });

/**
 * Validate the complete owned set; exact IDs never imply a nearby replacement. The origin and the axes are in every sketch, so they
 * may be selected, to relate geometry to them, but `editable` refuses them for edits that would move or change what is selected.
 */
export function cadSketchGraphSelectionSet(graph: CadSketchGraph | undefined, selections: unknown, editable = false): readonly CadSketchGraphSelection[] {
  if (!isCadImportData(selections) || !Value.Check(CadSketchGraphSelectionSetSchema, selections))
    throw new CadError('invalid-sketch-selection', 'Choose up to 64 distinct sketch points or edges.');
  for (const selection of selections) {
    if (isCadSketchVirtualSelection(selection)) {
      if (editable) throw cadSketchFixedElementError();
      if (graph) continue;
    }
    if (!(selection.kind === 'point' ? graph?.points : graph?.entities)?.some(item => item.id === selection.id))
      throw new CadError('missing-sketch-selection', 'The point or edge does not exist in the active sketch.');
  }
  return Object.freeze(selections.map(selection => Object.freeze({ kind: selection.kind, id: selection.id })));
}
