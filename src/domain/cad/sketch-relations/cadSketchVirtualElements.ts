import type { Point2 } from '@/domain/path-intel/types';
import { CadError } from '../cadError';

// The origin and the H and V axes of every sketch: fixed elements that relations name like stored points and lines, by reserved
// `@` ids. They are never stored, and stored ids can never start with `@`. Like the signatures, this module imports nothing that
// imports the sketch graph, so the parser and the resolvers can use it while the graph module is still loading.

export const CAD_SKETCH_ORIGIN_ID = '@origin';
export const CAD_SKETCH_H_AXIS_ID = '@h';
export const CAD_SKETCH_V_AXIS_ID = '@v';
export type CadSketchVirtualAxisId = typeof CAD_SKETCH_H_AXIS_ID | typeof CAD_SKETCH_V_AXIS_ID;
export type CadSketchVirtualId = typeof CAD_SKETCH_ORIGIN_ID | CadSketchVirtualAxisId;
export const CAD_SKETCH_VIRTUAL_IDS: readonly CadSketchVirtualId[] = Object.freeze([CAD_SKETCH_ORIGIN_ID, CAD_SKETCH_H_AXIS_ID, CAD_SKETCH_V_AXIS_ID]);

/** The origin, a point fixed at 0, 0. */
export interface CadSketchVirtualPoint { readonly id: typeof CAD_SKETCH_ORIGIN_ID; readonly position: readonly [0, 0] }
/**
 * An axis: an infinite fixed line through the origin. Its start is the origin and its end a sample one millimetre along it, named by
 * the axis's own id, which gives it a direction and a support. Neither is an operand of its own: an axis has no length, middle or ends.
 */
export interface CadSketchVirtualAxis {
  readonly id: CadSketchVirtualAxisId;
  readonly kind: 'axis';
  readonly construction: true;
  readonly startPointId: typeof CAD_SKETCH_ORIGIN_ID;
  readonly endPointId: CadSketchVirtualAxisId;
}

export const CAD_SKETCH_ORIGIN: CadSketchVirtualPoint = Object.freeze({ id: CAD_SKETCH_ORIGIN_ID, position: Object.freeze([0, 0] as const) });
const axis = (id: CadSketchVirtualAxisId): CadSketchVirtualAxis => Object.freeze({ id, kind: 'axis', construction: true, startPointId: CAD_SKETCH_ORIGIN_ID, endPointId: id });
export const CAD_SKETCH_H_AXIS = axis(CAD_SKETCH_H_AXIS_ID);
export const CAD_SKETCH_V_AXIS = axis(CAD_SKETCH_V_AXIS_ID);

/** Whether an id is reserved for the sketch's own elements: every id that starts with `@`. */
export const isCadSketchReservedId = (id: string): boolean => id.charCodeAt(0) === 64;
/** Whether an id names the origin or an axis. */
export const isCadSketchVirtualId = (id: string): id is CadSketchVirtualId => id === CAD_SKETCH_ORIGIN_ID || id === CAD_SKETCH_H_AXIS_ID || id === CAD_SKETCH_V_AXIS_ID;
export const isCadSketchVirtualAxisId = (id: string): id is CadSketchVirtualAxisId => id === CAD_SKETCH_H_AXIS_ID || id === CAD_SKETCH_V_AXIS_ID;

/** The origin, looked up by id in constant time, or undefined for any other id. */
export const cadSketchVirtualPoint = (id: string): CadSketchVirtualPoint | undefined => id === CAD_SKETCH_ORIGIN_ID ? CAD_SKETCH_ORIGIN : undefined;
/** An axis, looked up by id in constant time, or undefined for any other id. */
export const cadSketchVirtualAxis = (id: string): CadSketchVirtualAxis | undefined =>
  id === CAD_SKETCH_H_AXIS_ID ? CAD_SKETCH_H_AXIS : id === CAD_SKETCH_V_AXIS_ID ? CAD_SKETCH_V_AXIS : undefined;

const ORIGIN_POSITION: Point2 = Object.freeze({ x: 0, y: 0 }), H_SAMPLE: Point2 = Object.freeze({ x: 1, y: 0 }), V_SAMPLE: Point2 = Object.freeze({ x: 0, y: 1 });
/** Where the origin is, and each axis's sample end. */
export const cadSketchVirtualPosition = (id: string): Point2 | undefined =>
  id === CAD_SKETCH_ORIGIN_ID ? ORIGIN_POSITION : id === CAD_SKETCH_H_AXIS_ID ? H_SAMPLE : id === CAD_SKETCH_V_AXIS_ID ? V_SAMPLE : undefined;

/** The coordinate an axis holds at 0 for the points on it: Y for the H axis, X for the V axis. */
export const cadSketchAxisNormal = (id: CadSketchVirtualAxisId): 'x' | 'y' => id === CAD_SKETCH_H_AXIS_ID ? 'y' : 'x';
/** The axis on which a coordinate held at 0 keeps its point: a Y of 0 on the H axis, an X of 0 on the V axis. */
export const cadSketchAxisOfNormal = (coordinate: 'x' | 'y'): CadSketchVirtualAxisId => coordinate === 'y' ? CAD_SKETCH_H_AXIS_ID : CAD_SKETCH_V_AXIS_ID;

/** How people are told about each element, as the shared label table names it. */
export const CAD_SKETCH_VIRTUAL_LABELS: Readonly<Record<CadSketchVirtualId, string>> = Object.freeze({ '@origin': 'Origin', '@h': 'H axis', '@v': 'V axis' });
/** The element's name inside a sentence: "the origin", "the H axis". */
export const cadSketchVirtualSubject = (id: CadSketchVirtualId): string => id === CAD_SKETCH_ORIGIN_ID ? 'the origin' : `the ${CAD_SKETCH_VIRTUAL_LABELS[id]}`;

/**
 * Numeric positions read by id, where the origin and each axis's sample end are always present. Iterating gives only the positions
 * set, which are the sketch's own points.
 */
export class CadSketchPositions extends Map<string, Point2> {
  override get(id: string): Point2 | undefined { return super.get(id) ?? cadSketchVirtualPosition(id); }
  override has(id: string): boolean { return super.has(id) || isCadSketchVirtualId(id); }
}

/** The ids relations and selections name: a stored id, or the origin or an axis by its reserved id. */
export const CAD_SKETCH_ELEMENT_ID_PATTERN = '^(@(origin|h|v)|[A-Za-z0-9][A-Za-z0-9_-]{0,95})$';
/** Whether a selection names the sketch's own element of its kind: the origin as a point, an axis as an edge. */
export const isCadSketchVirtualSelection = <T extends { readonly kind: 'point' | 'entity'; readonly id: string }>(selection: T): selection is T & { readonly id: CadSketchVirtualId } =>
  selection.kind === 'point' ? selection.id === CAD_SKETCH_ORIGIN_ID : isCadSketchVirtualAxisId(selection.id);
/** The error every edit gives when it would move, trim, delete, rename or copy the origin or an axis. */
export const cadSketchFixedElementError = (): CadError =>
  new CadError('fixed-sketch-element', 'The origin and the H and V axes are fixed: they cannot be moved, trimmed, deleted, renamed or copied.');
