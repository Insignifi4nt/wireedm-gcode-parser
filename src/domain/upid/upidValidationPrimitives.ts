import type { PathDiagnostic, Point2 } from '@/domain/path-intel/types';

export interface UpidValidationContext {
  schemaVersion: unknown;
  allowLegacyV1Extensions: boolean;
  add: (
    code: Extract<
      PathDiagnostic['code'],
      | 'upid-duplicate-id'
      | 'upid-invalid-value'
      | 'upid-missing-reference'
      | 'upid-identity-mismatch'
      | 'upid-discontinuity'
      | 'upid-broken-closure'
    >,
    message: string,
    refs?: Pick<
      PathDiagnostic,
      'relatedSegmentIds' | 'relatedClusterIds' | 'relatedChainIds' | 'relatedContourIds'
    >
  ) => void;
  structuralDiagnostics: PathDiagnostic[];
}

export function finitePoint(
  value: unknown,
  path: string,
  context: UpidValidationContext,
  refs: Parameters<UpidValidationContext['add']>[2] = {}
) {
  if (!finitePointOnly(value)) {
    context.add('upid-invalid-value', `${path} must contain finite X/Y coordinates.`, refs);
    return false;
  }
  return true;
}

export function finitePointOnly(value: unknown): value is Point2 {
  const point = readUpidRecord(value);
  return !!point && Number.isFinite(point.x) && Number.isFinite(point.y);
}

export function finiteNumber(
  value: unknown,
  path: string,
  context: UpidValidationContext,
  options: { nonNegative?: boolean; positive?: boolean; maximum?: number } = {},
  refs: Parameters<UpidValidationContext['add']>[2] = {}
) {
  const valid =
    typeof value === 'number' &&
    Number.isFinite(value) &&
    (!options.nonNegative || value >= 0) &&
    (!options.positive || value > 0) &&
    (options.maximum == null || value <= options.maximum);
  if (!valid) context.add('upid-invalid-value', `${path} is invalid or non-finite.`, refs);
  return valid;
}

export function finiteInteger(
  value: unknown,
  path: string,
  context: UpidValidationContext,
  minimum: number
) {
  const valid = typeof value === 'number' && Number.isInteger(value) && value >= minimum;
  if (!valid) context.add('upid-invalid-value', `${path} must be an integer of at least ${minimum}.`);
  return valid;
}

export function optionalString(
  value: unknown,
  path: string,
  context: UpidValidationContext,
  nonEmpty = false
) {
  if (value == null) return;
  if (typeof value !== 'string' || (nonEmpty && value.length === 0)) {
    context.add('upid-invalid-value', `${path} must be ${nonEmpty ? 'a non-empty ' : 'a '}string when present.`);
  }
}

export function readUpidRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
