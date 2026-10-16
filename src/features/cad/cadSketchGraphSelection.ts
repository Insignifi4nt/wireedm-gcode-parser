import { Type, type Static } from '@sinclair/typebox';
import { CadError } from '@/domain/cad/cadError';
import type { CadSketchGraph } from '@/domain/cad/cadSketchGraph';
import type { CadSketchGraphSelection } from '@/domain/cad/cadSketchGraphSelection';

export { CadSketchGraphSelectionSchema, CadSketchGraphSelectionSetSchema, cadSketchGraphSelectionSet } from '@/domain/cad/cadSketchGraphSelection';
export type { CadSketchGraphSelection } from '@/domain/cad/cadSketchGraphSelection';

export const CadSketchGraphPickFilterSchema = Type.Union([Type.Literal('auto'), Type.Literal('points'), Type.Literal('edges')]);
export type CadSketchGraphPickFilter = Static<typeof CadSketchGraphPickFilterSchema>;

/** A command borrows selection without enabling geometry edits or changing its frozen operands. */
export interface CadSketchGeometryPick {
  readonly eligibleEntityIds: readonly string[];
  readonly eligiblePointIds: readonly string[];
  readonly label: string;
  onPick(selection: CadSketchGraphSelection): void;
  onCancel(): void;
}
export function cadSketchGeometryPickAllows(pick: CadSketchGeometryPick, selection: CadSketchGraphSelection): boolean {
  return (selection.kind === 'point' ? pick.eligiblePointIds : pick.eligibleEntityIds).includes(selection.id);
}

function freezeSelection(selections: readonly CadSketchGraphSelection[]): readonly CadSketchGraphSelection[] {
  return Object.freeze(selections.map(selection => Object.freeze({ kind: selection.kind, id: selection.id })));
}

function belongsToGraph(graph: CadSketchGraph | undefined, selection: CadSketchGraphSelection): boolean {
  return Boolean((selection.kind === 'point' ? graph?.points : graph?.entities)?.some(item => item.id === selection.id));
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
