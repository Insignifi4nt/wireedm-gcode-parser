import { Type } from '@sinclair/typebox';

export const CadNumberSchema = Type.Number({ minimum: -1e9, maximum: 1e9 });
export const CadScalarSchema = Type.Union([CadNumberSchema, Type.String({ minLength: 1, maxLength: 512 })]);
export const CadPlaneSchema = Type.Union([Type.Literal('XY'), Type.Literal('XZ'), Type.Literal('YZ')]);
export const CadPoint2Schema = Type.Tuple([CadScalarSchema, CadScalarSchema]);
export const CadIdentifierSchema = Type.String({ pattern: '^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$' });
export const CadSketchPlaneSchema = Type.Union([CadPlaneSchema, Type.Object({ kind: Type.Literal('datum-plane'), featureId: CadIdentifierSchema }, { additionalProperties: false })]);
export const CadLabelSchema = Type.String({ minLength: 1, maxLength: 160, pattern: '\\S' });
export const CadFeatureBaseSchemaFields = { id: CadIdentifierSchema, name: CadLabelSchema, suppressed: Type.Boolean() };
export const CadPathSegmentSchema = Type.Union([
  Type.Object({ kind: Type.Literal('line'), start: CadPoint2Schema, end: CadPoint2Schema }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal('arc'), center: CadPoint2Schema, radius: CadScalarSchema, startAngle: CadScalarSchema, sweep: CadScalarSchema }, { additionalProperties: false })
]);
