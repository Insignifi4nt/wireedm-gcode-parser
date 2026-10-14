import { Type, type Static } from '@sinclair/typebox';
import type { CadPoint2, CadProfile, CadScalar, CadSketchProfile } from './cadDocument';
import { CadError } from './cadError';
import { evaluateCadScalar } from './cadExpression';
import { CadIdentifierSchema } from './cadPrimitives';

const quantities = ['width', 'height', 'length', 'radius', 'diameter', 'angle'] as const;
export const CadSketchDimensionQuantitySchema = Type.Union(quantities.map(quantity => Type.Literal(quantity)));
export const CadSketchDimensionConstraintSchema = Type.Object({
  id: CadIdentifierSchema, kind: Type.Literal('dimension'), quantity: CadSketchDimensionQuantitySchema
}, { additionalProperties: false });
export type CadSketchDimensionQuantity = Static<typeof CadSketchDimensionQuantitySchema>;
/** The geometry scalar is the single driving value. This record stores explicit dimension intent. */
export type CadSketchDimensionConstraint = Static<typeof CadSketchDimensionConstraintSchema>;
type DimensionField = Exclude<CadSketchDimensionQuantity, 'diameter'>;

export interface CadSketchDimension {
  readonly id: string | null;
  readonly quantity: CadSketchDimensionQuantity;
  readonly field: DimensionField;
  readonly expression: CadScalar;
  readonly value: number;
  readonly scale: number;
  readonly source: 'constraint' | 'expression';
  readonly units: 'mm' | 'deg';
}

export function cadSketchDimensionQuantities(geometry: CadProfile): readonly CadSketchDimensionQuantity[] {
  switch (geometry.kind) {
    case 'rectangle': return ['width', 'height'];
    case 'circle': return ['diameter', 'radius'];
    case 'slot': return ['length', 'width', 'angle'];
    case 'plugin': case 'polygon': case 'path': return [];
    default: { const exhaustive: never = geometry; return exhaustive; }
  }
}
const fieldFor = (quantity: CadSketchDimensionQuantity): DimensionField => quantity === 'diameter' ? 'radius' : quantity;

/** Read the authoritative construction scalar without evaluating or rewriting its expression. */
export function cadSketchDimensionScalar(profile: CadSketchProfile, quantity: CadSketchDimensionQuantity): CadScalar {
  const geometry = profile.geometry;
  switch (geometry.kind) {
    case 'rectangle': if (quantity === 'width' || quantity === 'height') return geometry[quantity]; break;
    case 'circle': if (quantity === 'diameter' || quantity === 'radius') return geometry.radius; break;
    case 'slot': if (quantity === 'length' || quantity === 'width' || quantity === 'angle') return geometry[quantity]; break;
    case 'plugin': case 'polygon': case 'path': break;
  }
  throw new CadError('unsupported-sketch-dimension', `A ${geometry.kind} contour does not support a ${quantity} dimension.`);
}

export function validateCadSketchConstraints(profile: CadSketchProfile): void {
  const ids = new Set<string>(), fields = new Set<DimensionField>();
  for (const constraint of profile.constraints ?? []) {
    cadSketchDimensionScalar(profile, constraint.quantity);
    if (ids.has(constraint.id)) throw new CadError('duplicate-sketch-constraint', 'Sketch dimension IDs must be unique.');
    const field = fieldFor(constraint.quantity);
    if (fields.has(field)) throw new CadError('overconstrained-sketch-dimension', 'Only one driving dimension can constrain each contour quantity. Radius and diameter constrain the same circle size.');
    ids.add(constraint.id); fields.add(field);
  }
}

/** Existing arithmetic/parameter expressions remain driven, but numeric draw values are free. */
export function isCadSketchExpressionDriven(scalar: CadScalar): boolean {
  return typeof scalar === 'string' && !Number.isFinite(Number(scalar));
}

export function inspectCadSketchDimensions(profile: CadSketchProfile, parameters: Readonly<Record<string, number>>): readonly CadSketchDimension[] {
  const dimensions: CadSketchDimension[] = [];
  const explicit = new Map((profile.constraints ?? []).map(constraint => [fieldFor(constraint.quantity), constraint]));
  const visited = new Set<DimensionField>();
  for (const quantity of cadSketchDimensionQuantities(profile.geometry)) {
    const field = fieldFor(quantity);
    if (visited.has(field)) continue;
    visited.add(field);
    const constraint = explicit.get(field), expression = cadSketchDimensionScalar(profile, quantity);
    if (!constraint && !isCadSketchExpressionDriven(expression)) continue;
    const selected = constraint?.quantity ?? quantity, scale = selected === 'diameter' ? 2 : 1;
    dimensions.push({ id: constraint?.id ?? null, quantity: selected, field, expression,
      value: evaluateCadScalar(expression, parameters) * scale, scale, source: constraint ? 'constraint' : 'expression', units: selected === 'angle' ? 'deg' : 'mm' });
  }
  return dimensions;
}

export function addCadSketchDimension(input: { profile: CadSketchProfile; constraint: CadSketchDimensionConstraint }): CadSketchProfile {
  const profile = { ...input.profile, constraints: [...input.profile.constraints ?? [], input.constraint] };
  validateCadSketchConstraints(profile);
  return profile;
}

/** Values are expressed in the displayed quantity, so a diameter is converted to its radius scalar. */
export function setCadSketchDimensionValue(input: { profile: CadSketchProfile; quantity: CadSketchDimensionQuantity; value: CadScalar }): CadSketchProfile {
  const { profile, quantity } = input;
  cadSketchDimensionScalar(profile, quantity);
  const value = quantity === 'diameter' ? typeof input.value === 'number' ? input.value / 2 : `(${input.value}) / 2` : input.value;
  const geometry = profile.geometry;
  switch (geometry.kind) {
    case 'rectangle': if (quantity === 'width' || quantity === 'height') return { ...profile, geometry: { ...geometry, [quantity]: value } }; break;
    case 'circle': return { ...profile, geometry: { ...geometry, radius: value } };
    case 'slot': if (quantity === 'length' || quantity === 'width' || quantity === 'angle') return { ...profile, geometry: { ...geometry, [quantity]: value } }; break;
    case 'plugin': case 'polygon': case 'path': break;
  }
  throw new CadError('unsupported-sketch-dimension', 'This contour quantity cannot be changed.');
}

export function removeCadSketchDimension(input: { profile: CadSketchProfile; dimensionId: string }): CadSketchProfile {
  if (!input.profile.constraints?.some(constraint => constraint.id === input.dimensionId)) throw new CadError('missing-sketch-dimension', 'The selected sketch dimension no longer exists.');
  const { constraints, ...profile } = input.profile;
  const remaining = constraints.filter(constraint => constraint.id !== input.dimensionId);
  return remaining.length ? { ...profile, constraints: remaining } : profile;
}

/** Explicit unlink retains today's size while removing its expression and dimension intent. */
export function unlinkCadSketchDimension(input: { profile: CadSketchProfile; quantity: CadSketchDimensionQuantity; parameters: Readonly<Record<string, number>> }): CadSketchProfile {
  const scalar = cadSketchDimensionScalar(input.profile, input.quantity);
  const value = evaluateCadScalar(scalar, input.parameters), field = fieldFor(input.quantity);
  const constraint = input.profile.constraints?.find(constraint => fieldFor(constraint.quantity) === field);
  const profile = constraint ? removeCadSketchDimension({ profile: input.profile, dimensionId: constraint.id }) : input.profile;
  return setCadSketchDimensionValue({ profile, quantity: input.quantity, value: input.quantity === 'diameter' ? value * 2 : value });
}

/** Size constraints do not lock position. A named/arithmetic position remains driven per axis. */
export function translateCadSketchProfile(input: { profile: CadSketchProfile; translation: readonly [number, number]; parameters: Readonly<Record<string, number>> }): CadSketchProfile {
  const { profile, translation: [dx, dy], parameters } = input, geometry = profile.geometry;
  if (geometry.kind === 'plugin') throw new CadError('unsupported-sketch-translation', 'Move a generated plugin contour through its placement configuration.');
  if (dx === 0 && dy === 0) return profile;
  const translatedCoordinate = (scalar: CadScalar, delta: number): CadScalar => {
    if (delta === 0) return scalar;
    if (isCadSketchExpressionDriven(scalar)) throw new CadError('driven-sketch-position', 'This contour position follows an expression. Change or unlink its position parameter before moving that axis.');
    return evaluateCadScalar(scalar, parameters) + delta;
  };
  const point = ([x, y]: CadPoint2): CadPoint2 => [translatedCoordinate(x, dx), translatedCoordinate(y, dy)];
  if (geometry.kind === 'polygon') return { ...profile, geometry: { ...geometry, points: geometry.points.map(point) } };
  if (geometry.kind === 'path') return { ...profile, geometry: { ...geometry, segments: geometry.segments.map(segment => segment.kind === 'line'
    ? { ...segment, start: point(segment.start), end: point(segment.end) } : { ...segment, center: point(segment.center) }) } };
  return { ...profile, geometry: { ...geometry, x: translatedCoordinate(geometry.x, dx), y: translatedCoordinate(geometry.y, dy) } };
}
