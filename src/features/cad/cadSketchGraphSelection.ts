import { Type, type Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { CadError } from '@/domain/cad/cadError';
import { CadIdentifierSchema } from '@/domain/cad/cadPrimitives';
import type { CadSketchGraph } from '@/domain/cad/cadSketchGraph';

export const CadSketchGraphPickFilterSchema = Type.Union([Type.Literal('auto'), Type.Literal('points'), Type.Literal('edges')]);
export type CadSketchGraphPickFilter = Static<typeof CadSketchGraphPickFilterSchema>;

export const CadSketchGraphSelectionSchema = Type.Object({
  kind: Type.Union([Type.Literal('point'), Type.Literal('entity')]), id: CadIdentifierSchema,
}, { additionalProperties: false });
export type CadSketchGraphSelection = Readonly<Static<typeof CadSketchGraphSelectionSchema>>;
export const CadSketchGraphSelectionSetSchema = Type.Array(CadSketchGraphSelectionSchema, { maxItems: 64, uniqueItems: true });

function freezeSelection(selections: readonly CadSketchGraphSelection[]): readonly CadSketchGraphSelection[] {
  return Object.freeze(selections.map(selection => Object.freeze({ kind: selection.kind, id: selection.id })));
}

function belongsToGraph(graph: CadSketchGraph | undefined, selection: CadSketchGraphSelection): boolean {
  return Boolean((selection.kind === 'point' ? graph?.points : graph?.entities)?.some(item => item.id === selection.id));
}

/** Validate the complete request before publishing any selection; never infer identities from geometry. */
export function cadSketchGraphSelectionSet(graph: CadSketchGraph | undefined, selections: unknown): readonly CadSketchGraphSelection[] {
  if (!Value.Check(CadSketchGraphSelectionSetSchema, selections)) throw new CadError('invalid-sketch-selection', 'Choose up to 64 distinct sketch points or edges.');
  for (const selection of selections) {
    if (!belongsToGraph(graph, selection)) {
      throw new CadError('missing-sketch-selection', 'The point or edge does not exist in the active sketch.');
    }
  }
  return freezeSelection(selections);
}

export function isCadSketchGraphSelected(current: readonly CadSketchGraphSelection[], atom: CadSketchGraphSelection): boolean {
  return current.some(selection => selection.kind === atom.kind && selection.id === atom.id);
}

export function cadSketchGraphSelectionsEqual(left: readonly CadSketchGraphSelection[], right: readonly CadSketchGraphSelection[]): boolean {
  return left.length === right.length && left.every((selection, index) => selection.kind === right[index].kind && selection.id === right[index].id);
}

/** Shift selection operates on already validated source identities; callers validate new targets against their active graph. */
export function toggleCadSketchGraphSelection(current: readonly CadSketchGraphSelection[], atom: CadSketchGraphSelection): readonly CadSketchGraphSelection[] {
  if (isCadSketchGraphSelected(current, atom)) return freezeSelection(current.filter(selection => selection.kind !== atom.kind || selection.id !== atom.id));
  if (current.length >= 64) throw new CadError('invalid-sketch-selection', 'Choose up to 64 distinct sketch points or edges.');
  return freezeSelection([...current, atom]);
}

/** Internal history/source reconciliation only. External requests must use strict whole-set validation. */
export function reconcileCadSketchGraphSelection(graph: CadSketchGraph | undefined, current: readonly CadSketchGraphSelection[]): readonly CadSketchGraphSelection[] {
  const retained = current.filter(selection => belongsToGraph(graph, selection));
  return retained.length === current.length ? current : freezeSelection(retained);
}
