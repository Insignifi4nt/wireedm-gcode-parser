import type { CadDatumPlaneFeature, CadFeature, CadPlane, CadSketchFeature, CadSketchPlane } from '@/domain/cad/cadDocument';
import { cadFeatureActive, type CadFeatureScope } from '@/domain/cad/features/cadFeatureActivity';
import { CAD_DATUM_NATIVE_PLACEMENT_PRECISION_MM, CAD_DATUM_ORTHONORMAL_RESIDUAL, prepareCadDatumFrames, resolveCadSketchPlacement } from '@/domain/cad/cadDatumPlanes';

/**
 * A reference picked in the model view: an origin plane or datum plane, an origin axis, or the origin point. Documents cannot name these
 * yet, so each command takes the selection through the fields it has today. This file is the one place that maps a selection onto them.
 */
export type CadOriginAxis = 'x' | 'y' | 'z';
export type CadReferenceSelection =
  | { readonly kind: 'plane'; readonly plane: CadSketchPlane }
  | { readonly kind: 'axis'; readonly axis: CadOriginAxis }
  | { readonly kind: 'point' };
/** The origin geometry that is not a plane: an origin axis or the origin point. */
export type CadOriginSelection = Exclude<CadReferenceSelection, { readonly kind: 'plane' }>;
/** The commands a selected reference can feed. */
export type CadReferenceCommand = 'sketch' | 'curve' | 'section' | 'datum-plane' | 'mirror' | 'revolve' | 'circular-pattern';
export type CadReferenceInput =
  /** The selection is not an input of this command, which starts as it always has. */
  | { readonly kind: 'none' }
  /** The selection is the kind of input this command takes, but this command cannot use this one; `reason` says why. */
  | { readonly kind: 'unavailable'; readonly reason: string }
  | { readonly kind: 'plane'; readonly plane: CadSketchPlane }
  | { readonly kind: 'datum-definition'; readonly definition: CadDatumPlaneFeature['definition'] }
  | { readonly kind: 'mirror-plane'; readonly plane: CadPlane }
  | { readonly kind: 'revolve-axis'; readonly axis: 'x' | 'y' }
  | { readonly kind: 'pattern-axis'; readonly axis: CadOriginAxis; readonly center: readonly [0, 0, 0] };

export const CAD_ORIGIN_AXES: readonly CadOriginAxis[] = Object.freeze(['x', 'y', 'z']);
const AXIS_DIRECTIONS: Readonly<Record<CadOriginAxis, readonly [number, number, number]>> = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
const NONE: CadReferenceInput = Object.freeze({ kind: 'none' });
const ORIGIN: readonly [0, 0, 0] = Object.freeze([0, 0, 0] as const);
const planeName = (plane: CadSketchPlane, features: readonly CadFeature[]) => typeof plane === 'string' ? `the ${plane} plane`
  : `"${features.find(feature => feature.id === plane.featureId)?.name ?? plane.featureId}"`;

export function cadReferenceSelectionName(selection: CadReferenceSelection, features: readonly CadFeature[]): string {
  return selection.kind === 'plane' ? planeName(selection.plane, features) : selection.kind === 'axis' ? `the ${selection.axis.toUpperCase()} axis` : 'the origin point';
}

const activeDatum = (plane: CadSketchPlane, scope: CadFeatureScope & { readonly features: readonly CadFeature[] }): CadDatumPlaneFeature | null => {
  if (typeof plane === 'string') return null;
  const feature = scope.features.find(entry => entry.id === plane.featureId);
  return feature?.kind === 'datum-plane' && cadFeatureActive(feature, scope) ? feature : null;
};

/** A line through `point` along the unit `direction`, known to the frame's angular uncertainty. */
export interface CadReferenceLine {
  readonly point: readonly number[];
  readonly direction: readonly number[];
  readonly angularUncertainty: number;
}
const dot3 = (a: readonly number[], b: readonly number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/**
 * Whether two lines are the same line, at the precision every other CAD placement check uses. Their directions, either way round, may
 * differ only by the frames' angular uncertainty, as loft sections' axes may, and the lines may lie apart only by native placement
 * precision, counting what that angle opens up between their points. A line a hair off in angle or position is another line however
 * small the difference, so a command never builds on a line the user did not pick.
 */
export function cadSameLine(a: CadReferenceLine, b: CadReferenceLine): boolean {
  const sine = Math.hypot(a.direction[1] * b.direction[2] - a.direction[2] * b.direction[1], a.direction[2] * b.direction[0] - a.direction[0] * b.direction[2],
    a.direction[0] * b.direction[1] - a.direction[1] * b.direction[0]);
  if (!(sine <= Math.max(CAD_DATUM_ORTHONORMAL_RESIDUAL, a.angularUncertainty + b.angularUncertainty))) return false;
  const delta = [0, 1, 2].map(index => b.point[index] - a.point[index]), along = dot3(delta, a.direction);
  const apart = Math.hypot(...delta.map((value, index) => value - along * a.direction[index]));
  return apart + sine * Math.abs(along) <= CAD_DATUM_NATIVE_PLACEMENT_PRECISION_MM;
}

/**
 * Which of the sketch's own axes, through the sketch origin, is the selected origin axis. Revolve turns about the sketch's X or Y axis,
 * so the origin axis must be the same line by `cadSameLine`.
 */
function sketchAxisFor(axis: CadOriginAxis, sketch: CadSketchFeature, features: readonly CadFeature[], parameters: Readonly<Record<string, number>>): 'x' | 'y' | null {
  let placement;
  try { placement = resolveCadSketchPlacement(sketch, parameters, prepareCadDatumFrames(features, parameters)); } catch { return null; }
  const { frame, offsetMm } = placement;
  const origin = frame.origin.map((value, index) => value + frame.normal[index] * offsetMm);
  const world: CadReferenceLine = { point: ORIGIN, direction: AXIS_DIRECTIONS[axis], angularUncertainty: 0 };
  const own = (direction: readonly number[]): CadReferenceLine => ({ point: origin, direction, angularUncertainty: frame.precision.angularUncertainty });
  return cadSameLine(world, own(frame.u)) ? 'x' : cadSameLine(world, own(frame.v)) ? 'y' : null;
}

/**
 * The input a selected reference gives a command, mapped onto the command's present fields:
 * - Sketch, Curve and Section view take any origin or active datum plane.
 * - A new datum plane starts on the selected plane: on an origin plane as its base, or with a datum plane's own placement.
 * - Mirror takes an origin plane.
 * - Revolve takes an origin axis that is one of its sketch's own axes.
 * - Circular pattern takes an origin axis, about the origin.
 * Planes are matched by identity, an origin plane's name or a datum plane's feature, never by where they lie, so two planes are never
 * mistaken for each other; the only geometric match is Revolve's, by `cadSameLine`.
 */
export function cadReferenceInput(selection: CadReferenceSelection | null, command: CadReferenceCommand, context: {
  readonly features: readonly CadFeature[]; readonly parameters: Readonly<Record<string, number>>;
  /** The sketch a Revolve turns, needed to read an axis in that sketch's plane. */
  readonly sketch?: CadSketchFeature | null;
}): CadReferenceInput {
  if (!selection) return NONE;
  const { features } = context;
  if (selection.kind === 'plane') {
    const plane = selection.plane, datum = activeDatum(plane, context);
    if (typeof plane !== 'string' && !datum) return Object.freeze({ kind: 'unavailable', reason: 'The selected datum plane is missing or suppressed.' });
    switch (command) {
      case 'sketch':
      case 'curve':
      case 'section':
        return Object.freeze({ kind: 'plane', plane });
      case 'datum-plane':
        return Object.freeze({ kind: 'datum-definition', definition: typeof plane === 'string'
          ? Object.freeze({ kind: 'world', basePlane: plane, origin: ORIGIN, rotation: ORIGIN }) : datum!.definition });
      case 'mirror':
        return typeof plane === 'string' ? Object.freeze({ kind: 'mirror-plane', plane })
          : Object.freeze({ kind: 'unavailable', reason: `Mirror takes the XY, XZ or YZ plane; it cannot mirror about ${planeName(plane, features)} yet.` });
      default:
        return NONE;
    }
  }
  if (selection.kind === 'point') return NONE;
  const axisName = `the ${selection.axis.toUpperCase()} axis`;
  switch (command) {
    case 'circular-pattern':
      return Object.freeze({ kind: 'pattern-axis', axis: selection.axis, center: ORIGIN });
    case 'revolve': {
      const sketch = context.sketch;
      if (!sketch) return NONE;
      const axis = sketchAxisFor(selection.axis, sketch, features, context.parameters);
      return axis ? Object.freeze({ kind: 'revolve-axis', axis })
        : Object.freeze({ kind: 'unavailable', reason: `Revolve turns "${sketch.name}" about its own X or Y axis, and ${axisName} is not one of them.` });
    }
    default:
      return NONE;
  }
}

const FEATURE_COMMANDS: Partial<Record<CadFeature['kind'], CadReferenceCommand>> = { sketch: 'sketch', curve: 'curve', 'datum-plane': 'datum-plane', mirror: 'mirror', revolve: 'revolve', 'circular-pattern': 'circular-pattern' };

/**
 * A new feature draft started while a reference is selected, with that reference in the field it feeds. A draft whose command takes no
 * reference, or nothing selected, comes back unchanged. A reference the command cannot use throws its reason, so the command does not
 * start on a default the user did not choose.
 */
export function cadFeatureWithReference<T extends CadFeature>(feature: T, selection: CadReferenceSelection | null, context: {
  readonly features: readonly CadFeature[]; readonly parameters: Readonly<Record<string, number>> }): T {
  const command = FEATURE_COMMANDS[feature.kind];
  if (!command || !selection) return feature;
  const draft = feature as CadFeature;
  const sketch = draft.kind === 'revolve' ? context.features.find((entry): entry is CadSketchFeature => entry.kind === 'sketch' && entry.id === draft.sketchId) ?? null : null;
  const input = cadReferenceInput(selection, command, { ...context, sketch });
  let next: CadFeature = draft;
  switch (input.kind) {
    case 'unavailable': throw new Error(input.reason);
    case 'plane': if (draft.kind === 'sketch' || draft.kind === 'curve') next = { ...draft, plane: input.plane }; break;
    case 'datum-definition': if (draft.kind === 'datum-plane') next = { ...draft, definition: input.definition }; break;
    case 'mirror-plane': if (draft.kind === 'mirror') next = { ...draft, plane: input.plane }; break;
    case 'revolve-axis': if (draft.kind === 'revolve') next = { ...draft, axis: input.axis }; break;
    case 'pattern-axis': if (draft.kind === 'circular-pattern') next = { ...draft, axis: input.axis, center: [input.center[0], input.center[1], input.center[2]] }; break;
    case 'none': break;
  }
  return next as T;
}
