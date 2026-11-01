import { Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import type { CadPlane } from './cadDocument';
import type { CadBounds3 } from './cadCurve';
import { CadError } from './cadError';
import { isCadImportData } from './cadImportData';
import { CadPlaneSchema } from './cadPrimitives';
import { nextDown, nextUp } from '../path-intel/segments';
import { CAD_PRECISION, cadRoundoff } from '../precision/cadPrecision';

export const CAD_POCKET_NATIVE_PRECISION = CAD_PRECISION.kernelConfusionMm;
export const CAD_POCKET_CAP_MARGIN_FLOOR_MM = CAD_PRECISION.pocketCapMarginFloorMm;
export const MAX_CAD_POCKET_REQUIRED_SPAN_MM = CAD_PRECISION.modelExtentMm;
export const CAD_POCKET_CAP_RESERVE_FRACTION = 1 / 8;
export const CadPocketDirectionSchema = Type.Union([Type.Literal('positive'), Type.Literal('negative'), Type.Literal('both')]);
export type CadPocketDirection = 'positive' | 'negative' | 'both';
export interface CadPocketExtentInput {
  readonly plane: CadPlane;
  readonly offsetMm: number;
  readonly direction: CadPocketDirection;
  readonly targetBounds: CadBounds3;
  readonly nativeToleranceMm: number;
  readonly sectionScaleMm: number;
}
export interface CadPocketExtent {
  readonly plane: CadPlane;
  readonly direction: CadPocketDirection;
  readonly targetNormalIntervalMm: readonly [number, number];
  /** Absolute stations are authoritative for native placement; offsets are receipts. */
  readonly startStationMm: number;
  readonly endStationMm: number;
  readonly startOffsetMm: number;
  readonly endOffsetMm: number;
  readonly requiredSpanMm: number;
  readonly spanMm: number;
  readonly capMarginMm: number;
  readonly precisionMm: number;
}
const point3 = Type.Tuple([Type.Number(), Type.Number(), Type.Number()]);
const schema = Type.Object(
  {
    plane: CadPlaneSchema,
    offsetMm: Type.Number({ minimum: -1e9, maximum: 1e9 }),
    direction: CadPocketDirectionSchema,
    targetBounds: Type.Object({ min: point3, max: point3 }, { additionalProperties: false }),
    nativeToleranceMm: Type.Number({ minimum: 0 }),
    sectionScaleMm: Type.Number({ exclusiveMinimum: 0 }),
  },
  { additionalProperties: false },
);

/** Finite through-all extent over the complete selected native target shape. */
export function resolveCadPocketExtent(input: CadPocketExtentInput): CadPocketExtent {
  if (!isCadImportData(input) || !Value.Check(schema, input))
    throw new CadError('invalid-pocket-extent', 'Pocket extent requires complete finite native bounds, units and direction.');
  const { plane, offsetMm, direction, targetBounds, nativeToleranceMm, sectionScaleMm } = input;
  const values = [offsetMm, nativeToleranceMm, sectionScaleMm, ...targetBounds.min, ...targetBounds.max];
  if (!values.every(Number.isFinite) || targetBounds.min.some((value, index) => value >= targetBounds.max[index])) {
    throw new CadError('invalid-pocket-bounds', 'Pocket target bounds must be finite, ordered and contain a solid volume.');
  }
  const index = plane === 'XY' ? 2 : plane === 'XZ' ? 1 : 0;
  const minN = plane === 'XZ' ? -targetBounds.max[index] : targetBounds.min[index];
  const maxN = plane === 'XZ' ? -targetBounds.min[index] : targetBounds.max[index];
  // Both builds at target-derived absolute stations. A remote authored plane
  // does not enter its cap arithmetic or force another cancellation.
  const scale = Math.max(
    1,
    ...targetBounds.min.map(Math.abs),
    ...targetBounds.max.map(Math.abs),
    direction === 'both' ? 0 : Math.abs(offsetMm),
  );
  const arithmetic = cadRoundoff(64, scale);
  const precision = Math.max(CAD_POCKET_NATIVE_PRECISION, nativeToleranceMm, arithmetic);
  const margin = Math.max(CAD_POCKET_CAP_MARGIN_FLOOR_MM, 4 * nativeToleranceMm + arithmetic);
  const requiredSpan = direction === 'positive' ? maxN - offsetMm : direction === 'negative' ? offsetMm - minN : maxN - minN;
  if (!Number.isFinite(requiredSpan)) throw new CadError('unsupported-pocket-span', 'Pocket extent overflows the finite modeling range.');
  if (requiredSpan < -2 * precision)
    throw new CadError(
      'pocket-no-material',
      'The selected target has no material in this direction from the sketch plane. Choose the opposite direction or Both.',
    );
  if (requiredSpan <= 2 * precision)
    throw new CadError(
      'unsupported-pocket-precision',
      'The target is tangent to, or within native precision of, the requested Pocket extent. Move the sketch plane or choose Both.',
    );
  if (!Number.isFinite(margin) || margin >= CAD_POCKET_CAP_RESERVE_FRACTION * Math.min(requiredSpan, sectionScaleMm)) {
    throw new CadError(
      'unsupported-pocket-precision',
      'Pocket cap reserve is too large relative to its required span or section scale. Repair native target tolerance, enlarge the section, or move geometry nearer the origin.',
    );
  }
  // AddOptimal can include a native bound reserve on both ends. This allowance
  // covers that reserve without treating cap margins as authored tool length.
  const spanAllowance = 2 * Math.max(CAD_POCKET_NATIVE_PRECISION, nativeToleranceMm) + arithmetic;
  if (requiredSpan > MAX_CAD_POCKET_REQUIRED_SPAN_MM + spanAllowance)
    throw new CadError(
      'pocket-span-limit',
      'Through-all Pocket currently supports at most one million millimetres of required target span. Use a nearer sketch plane or a smaller target.',
    );
  const start = direction === 'positive' ? offsetMm : nextDown(minN - margin);
  const end = direction === 'negative' ? offsetMm : nextUp(maxN + margin);
  const span = end - start;
  const startOffset = start - offsetMm;
  const endOffset = end - offsetMm;
  if (
    ![start, end, span, startOffset, endOffset].every(Number.isFinite) ||
    span <= 2 * precision ||
    span > requiredSpan + 2 * margin + 4 * precision ||
    (start >= minN && direction !== 'positive') ||
    (end <= maxN && direction !== 'negative')
  ) {
    throw new CadError(
      'unsupported-pocket-precision',
      'Pocket cap stations cannot be represented as a finite separated tool at this scale.',
    );
  }
  return Object.freeze({
    plane,
    direction,
    targetNormalIntervalMm: Object.freeze([minN, maxN] as const),
    startStationMm: start,
    endStationMm: end,
    startOffsetMm: startOffset,
    endOffsetMm: endOffset,
    requiredSpanMm: requiredSpan,
    spanMm: span,
    capMarginMm: margin,
    precisionMm: precision,
  });
}
