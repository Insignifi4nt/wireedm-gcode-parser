import { Type, type Static } from '@sinclair/typebox';
import { CadError } from '@/domain/cad/cadError';
import type { CadSketchGraph } from '@/domain/cad/cadSketchGraph';
import type { CadSketchGraphSelection } from '@/domain/cad/cadSketchGraphSelection';

export { CadSketchGraphSelectionSchema, CadSketchGraphSelectionSetSchema, cadSketchGraphSelectionSet } from '@/domain/cad/cadSketchGraphSelection';
export type { CadSketchGraphSelection } from '@/domain/cad/cadSketchGraphSelection';

export const CadSketchGraphPickFilterSchema = Type.Union([Type.Literal('auto'), Type.Literal('points'), Type.Literal('edges')]);
export type CadSketchGraphPickFilter = Static<typeof CadSketchGraphPickFilterSchema>;

/** A command borrows selection without enabling geometry edits or changing its frozen operands. */
/** The sketch plane's own references: its origin and the two axes through it. */
export const CAD_SKETCH_DATUMS = ['origin', 'x-axis', 'y-axis'] as const;
export type CadSketchDatum = typeof CAD_SKETCH_DATUMS[number];
export const cadSketchDatumLabels: Readonly<Record<CadSketchDatum, string>> = { origin: 'Origin', 'x-axis': 'X axis', 'y-axis': 'Y axis' };

export interface CadSketchGeometryPick {
  readonly eligibleEntityIds: readonly string[];
  readonly eligiblePointIds: readonly string[];
  /** Plane references that may complete this pick; omitted when the pick takes sketch geometry only. */
  readonly eligibleDatums?: readonly CadSketchDatum[];
  readonly pickedDatums?: readonly CadSketchDatum[];
  readonly label: string;
  onPick(selection: CadSketchGraphSelection): void;
  onPickDatum?(datum: CadSketchDatum): void;
  /** Finishes a pick that already has enough geometry, from Enter or a click on empty space. */
  onConfirm?(): void;
  onCancel(): void;
}
/** Screen reach of a plane reference; the origin reaches a little further so it wins where the axes cross. */
export const CAD_SKETCH_DATUM_PICK_PIXELS = 6;
/** Screen length of the drawn H and V axes. As in CATIA they mark the directions from the origin instead of crossing the whole view. */
export const CAD_SKETCH_AXIS_PIXELS = 72;
/** The eligible plane reference under a sketch-space point, nearest first, or null. Axes are picked along their drawn length only. */
export function pickCadSketchDatum(point: readonly [number, number], millimetersPerPixel: number, eligible: readonly CadSketchDatum[]): CadSketchDatum | null {
  if (!eligible.length || !Number.isFinite(millimetersPerPixel) || millimetersPerPixel <= 0) return null;
  const reach = CAD_SKETCH_DATUM_PICK_PIXELS * millimetersPerPixel, length = CAD_SKETCH_AXIS_PIXELS * millimetersPerPixel;
  if (eligible.includes('origin') && Math.hypot(point[0], point[1]) <= reach * 1.5) return 'origin';
  const along = (value: number) => value >= -reach && value <= length + reach;
  const axes = ([['x-axis', Math.abs(point[1]), along(point[0])], ['y-axis', Math.abs(point[0]), along(point[1])]] as const)
    .filter(([datum, distance, within]) => eligible.includes(datum) && within && distance <= reach);
  return axes.length ? axes.reduce((best, next) => next[1] < best[1] ? next : best)[0] : null;
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
