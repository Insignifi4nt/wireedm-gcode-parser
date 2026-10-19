import { Type, type Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { CadError } from './cadError';
import { CadIdentifierSchema } from './cadPrimitives';
import { isCadImportData } from './cadImportData';
import type { CadSketchGraph } from './cadSketchGraph';

export const CadSketchGraphSelectionSchema = Type.Object({
  kind: Type.Union([Type.Literal('point'), Type.Literal('entity')]), id: CadIdentifierSchema,
}, { additionalProperties: false });
export type CadSketchGraphSelection = Readonly<Static<typeof CadSketchGraphSelectionSchema>>;
/** Most points and edges one selection, or one geometry move, may name. */
export const CAD_SKETCH_SELECTION_LIMIT = 64;
export const CadSketchGraphSelectionSetSchema = Type.Array(CadSketchGraphSelectionSchema, { maxItems: CAD_SKETCH_SELECTION_LIMIT, uniqueItems: true });

/** Validate the complete owned set; exact IDs never imply a nearby replacement. */
export function cadSketchGraphSelectionSet(graph: CadSketchGraph | undefined, selections: unknown): readonly CadSketchGraphSelection[] {
  if (!isCadImportData(selections) || !Value.Check(CadSketchGraphSelectionSetSchema, selections))
    throw new CadError('invalid-sketch-selection', 'Choose up to 64 distinct sketch points or edges.');
  for (const selection of selections) {
    if (!(selection.kind === 'point' ? graph?.points : graph?.entities)?.some(item => item.id === selection.id))
      throw new CadError('missing-sketch-selection', 'The point or edge does not exist in the active sketch.');
  }
  return Object.freeze(selections.map(selection => Object.freeze({ kind: selection.kind, id: selection.id })));
}
