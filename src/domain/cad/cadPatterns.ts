import type { CadFeature } from './cadDocument';
import { CadError } from './cadError';
import { evaluateCadScalar } from './cadExpression';

export const MIN_CAD_PATTERN_COUNT = 2;
export const MAX_CAD_PATTERN_COUNT = 100;
export const MAX_CAD_PATTERN_INSTANCES = 1000;
export type CadCircularPatternFeature = Extract<CadFeature, { kind: 'circular-pattern' }>;

/** World-space rotation placements, including the unchanged seed at index zero. */
export function resolveCadCircularPattern(feature: Pick<CadCircularPatternFeature, 'count' | 'axis' | 'center' | 'angle'>, parameters: Readonly<Record<string, number>>) {
  if (!Number.isInteger(feature.count) || feature.count < MIN_CAD_PATTERN_COUNT || feature.count > MAX_CAD_PATTERN_COUNT) {
    throw new CadError('pattern-limit', 'Patterns require 2–100 instances including the original.');
  }
  // Do not reduce modulo 360: a full turn is an extent, not a zero rotation.
  const angle = evaluateCadScalar(feature.angle, parameters);
  if (Math.abs(angle) <= 1e-7 || Math.abs(angle) > 360) {
    throw new CadError('invalid-dimension', 'Circular pattern extent must be nonzero and at most 360 degrees in either direction.');
  }
  const center: readonly [number, number, number] = Object.freeze([
    evaluateCadScalar(feature.center[0], parameters), evaluateCadScalar(feature.center[1], parameters), evaluateCadScalar(feature.center[2], parameters)
  ]);
  let direction: readonly [number, number, number];
  switch (feature.axis) {
    case 'x': direction = [1, 0, 0]; break;
    case 'y': direction = [0, 1, 0]; break;
    case 'z': direction = [0, 0, 1]; break;
    default: { const exhaustive: never = feature.axis; throw new CadError('invalid-pattern', `Unsupported circular pattern axis: ${exhaustive}`); }
  }
  const fullTurn = Math.abs(angle) === 360;
  const divisions = fullTurn ? feature.count : feature.count - 1;
  // Rotate each copy from the seed, rather than accumulating rounded rotations.
  const angles = Object.freeze(Array.from({ length: feature.count }, (_, index) => index === 0 ? 0
    : !fullTurn && index === feature.count - 1 ? angle : angle * index / divisions));
  return Object.freeze({ count: feature.count, center, direction: Object.freeze(direction), angle, fullTurn, angles });
}
