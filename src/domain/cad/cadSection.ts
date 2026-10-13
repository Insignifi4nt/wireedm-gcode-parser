import { Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import type { DxfEntity } from '../dxf/types';
import type { CadPlane, CadScalar } from './cadDocument';
import { CadError } from './cadError';

export interface CadSectionRequest { readonly bodyId: string; readonly plane: CadPlane; readonly offset: CadScalar }
export interface CadSectionResult { readonly bodyId: string; readonly plane: CadPlane; readonly offset: number; readonly entities: readonly DxfEntity[]; readonly contourCount: number }
const strict = { additionalProperties: false };
const plane = Type.Union([Type.Literal('XY'), Type.Literal('XZ'), Type.Literal('YZ')]);
const scalarNumber = Type.Number({ minimum: -1e9, maximum: 1e9 });
const bodyId = Type.String({ pattern: '^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$' });
export const CadSectionRequestSchema = Type.Object({ bodyId, plane, offset: Type.Union([scalarNumber, Type.String({ minLength: 1, maxLength: 512 })]) }, strict);
const point = Type.Object({ x: scalarNumber, y: scalarNumber }, strict);
const layer = Type.String();
const radius = Type.Number({ exclusiveMinimum: 0, maximum: 1e9 });
const entity = Type.Union([
  Type.Object({ type: Type.Literal('line'), layer, start: point, end: point }, strict),
  Type.Object({ type: Type.Literal('circle'), layer, center: point, radius }, strict),
  Type.Object({ type: Type.Literal('arc'), layer, center: point, radius, startAngle: scalarNumber, endAngle: scalarNumber,
    sweepRadians: scalarNumber, clockwise: Type.Boolean(), start: point, end: point }, strict)
]);
export const CadSectionResultSchema = Type.Object({ bodyId, plane, offset: scalarNumber, entities: Type.Array(entity, { minItems: 1, maxItems: 8192 }), contourCount: Type.Integer({ minimum: 1, maximum: 8192 }) }, strict);
export function parseCadSectionRequest(value: unknown): CadSectionRequest {
  if (!Value.Check(CadSectionRequestSchema, value)) throw new CadError('invalid-section', 'A section needs one current body, an XY/XZ/YZ plane and a finite offset in millimetres.');
  return value;
}
export function isCadSectionResult(value: unknown): value is CadSectionResult { return Value.Check(CadSectionResultSchema, value); }
