import { Type, type Static } from '@sinclair/typebox';
import { CadError } from '@/domain/cad/cadError';
import type { CadSketchGraph, CadSketchGraphRelation } from '@/domain/cad/cadSketchGraph';
import type { CadSketchGraphSelection } from '@/domain/cad/cadSketchGraphSelection';
import { cadSketchZeroScalar } from '@/domain/cad/sketch-relations/cadSketchRelationPlanning';
import type { CadContextMenuItem } from './CadContextMenu';
import type { CadSketchDimensionPlan } from './cadSketchDimensionPlacement';
import type { CadSketchPointerStore } from './CadSketchDimensionPreview';

export { CadSketchGraphSelectionSchema, CadSketchGraphSelectionSetSchema, cadSketchGraphSelectionSet } from '@/domain/cad/cadSketchGraphSelection';
export type { CadSketchGraphSelection } from '@/domain/cad/cadSketchGraphSelection';
export { cadSketchZeroScalar };

export const CadSketchGraphPickFilterSchema = Type.Union([Type.Literal('auto'), Type.Literal('points'), Type.Literal('edges')]);
export type CadSketchGraphPickFilter = Static<typeof CadSketchGraphPickFilterSchema>;

/** A command borrows selection without enabling geometry edits or changing its frozen operands. */
/** The sketch plane's own references: its origin and the two axes through it. */
export const CAD_SKETCH_DATUMS = ['origin', 'x-axis', 'y-axis'] as const;
export type CadSketchDatum = typeof CAD_SKETCH_DATUMS[number];
export const cadSketchDatumLabels: Readonly<Record<CadSketchDatum, string>> = { origin: 'Origin', 'x-axis': 'X axis', 'y-axis': 'Y axis' };
/** A datum named inside a sentence: the origin in lower case, an axis with its capital. */
export const cadSketchDatumName = (datum: CadSketchDatum): string => datum === 'origin' ? 'origin' : cadSketchDatumLabels[datum];

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
  onConfirm?(source: 'pointer' | 'key'): void;
  onCancel(): void;
  /** Takes the sketch position of every pointer move and press over the canvas while the pick lasts. */
  readonly pointer?: CadSketchPointerStore;
  /**
   * The dimension the picks would place, previewed at the pointer. While it is shown, pointer moves only update `pointer`, so they
   * render the preview and nothing else.
   */
  readonly dimensionPreview?: CadSketchDimensionPlan;
  /** Commands a right release or the menu key opens in place of the overlap chooser, for the pointer position given; null keeps the chooser. */
  contextMenu?(pointer: { readonly x: number; readonly y: number } | null): { readonly title: string; readonly items: readonly CadContextMenuItem[] } | null;
  /** Placed dimensions stay selectable, editable, deletable and keep their menus while the pick waits for its first geometry. */
  readonly dimensionsInteractive?: boolean;
  /**
   * The placement the label offers to edit, a new value each time one becomes the selection. Focus the picks left on sketch geometry then
   * moves to the canvas, as a click on empty space places, so Enter edits the placed dimension rather than picking that geometry again.
   */
  readonly placed?: object;
  /** What Escape does, after the label; `Escape cancels` without it. */
  readonly escapeLabel?: string;
}
/** Screen reach of a plane reference; the origin reaches a little further so it wins where the axes cross. */
export const CAD_SKETCH_DATUM_PICK_PIXELS = 6;
/** Screen length of the H and V arrows that mark each axis direction from the origin. The axes themselves cross the whole view. */
export const CAD_SKETCH_AXIS_PIXELS = 72;
/**
 * The eligible plane reference under a sketch-space point, nearest first, or null. As in CATIA the axes are whole lines
 * through the origin, so they are picked anywhere along their length; the check stays constant time.
 */
export function pickCadSketchDatum(point: readonly [number, number], millimetersPerPixel: number, eligible: readonly CadSketchDatum[]): CadSketchDatum | null {
  if (!eligible.length || !Number.isFinite(millimetersPerPixel) || millimetersPerPixel <= 0) return null;
  const reach = CAD_SKETCH_DATUM_PICK_PIXELS * millimetersPerPixel;
  if (eligible.includes('origin') && Math.hypot(point[0], point[1]) <= reach * 1.5) return 'origin';
  const axes = ([['x-axis', Math.abs(point[1])], ['y-axis', Math.abs(point[0])]] as const).filter(([datum, distance]) => eligible.includes(datum) && distance <= reach);
  return axes.length ? axes.reduce((best, next) => next[1] < best[1] ? next : best)[0] : null;
}

/**
 * The plane reference a fixed relation holds its point on, or null: a zero Y keeps the point on the X axis, a zero X on the
 * Y axis, and a fixed point at [0, 0] sits at the origin. A point at the origin through both coordinates has one of each.
 */
export function cadSketchRelationDatum(relation: CadSketchGraphRelation): CadSketchDatum | null {
  if (relation.kind === 'fixed-point') return relation.position.every(cadSketchZeroScalar) ? 'origin' : null;
  return relation.kind !== 'fixed-axis' || !cadSketchZeroScalar(relation.value) ? null : relation.axis === 'y' ? 'x-axis' : 'y-axis';
}
/** How a relations list or diagnostic names a relation that holds a point on the origin or an axis, or null for any other relation. */
export function cadSketchDatumRelationLabel(relation: CadSketchGraphRelation): string | null {
  const datum = cadSketchRelationDatum(relation);
  return datum === 'origin' ? 'Fixed at the origin' : datum ? `On the ${cadSketchDatumLabels[datum]}` : null;
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
