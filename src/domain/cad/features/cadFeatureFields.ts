import { Type, type TObject, type TProperties, type TSchema } from '@sinclair/typebox';
import type { CadPoint3, CadScalar } from '../cadDocument';
import { CadFeatureBaseSchemaFields, CadIdentifierSchema, CadScalarSchema } from '../cadPrimitives';
import type { CadFeatureCondition, CadFeatureField, CadFeatureFields, CadFeatureScalar, CadFeatureShape, CadFeatureSlot } from './cadFeatureDefinitionTypes';
import { mapCadPoint3 } from './cadFeatureScalarMaps';

const strict = { additionalProperties: false };
type FieldSchemas<F extends CadFeatureFields> = { -readonly [P in keyof F]: F[P]['schema'] };

/** A stored field of type `V` with its schema and what it means. */
export function cadFeatureField<S extends TSchema, V = unknown>(schema: S, meaning: Omit<CadFeatureField<S, V>, 'schema'> = {}): CadFeatureField<S, V> {
  return Object.freeze({ schema, ...meaning });
}

/** A field naming one feature by id. */
export function cadFeatureReference(slot: Omit<CadFeatureSlot<string>, 'count' | 'ids'>) {
  return cadFeatureField<typeof CadIdentifierSchema, string>(CadIdentifierSchema, { slot: Object.freeze({ ...slot, count: 'one', ids: (id: string) => [id] }) });
}
const nullableIdentifier = Type.Union([CadIdentifierSchema, Type.Null()]);
/** A field naming one feature by id, or null, as `condition` says. */
export function cadFeatureOptionalReference(slot: Omit<CadFeatureSlot<string>, 'count' | 'ids'>, condition: CadFeatureCondition) {
  return cadFeatureField<typeof nullableIdentifier, string>(nullableIdentifier, { slot: Object.freeze({ ...slot, count: 'optional', ids: (id: string) => [id] }), condition });
}

/** A field holding one dimension, which may be an expression. */
export function cadFeatureScalarField(scalar: CadFeatureScalar) {
  return cadFeatureField<typeof CadScalarSchema, CadScalar>(CadScalarSchema, { scalar: Object.freeze(scalar), scalars: (value, path, map) => map(value, path) });
}
const point3 = Type.Tuple([CadScalarSchema, CadScalarSchema, CadScalarSchema]);
/** A field holding three dimensions, which may be expressions. */
export function cadFeatureVectorField(scalar: Omit<CadFeatureScalar, 'components'>) {
  return cadFeatureField<typeof point3, CadPoint3>(point3, { scalar: Object.freeze({ ...scalar, components: 3 }), scalars: mapCadPoint3 });
}

/** A kind's schema built from its fields, after the shared id, name and suppression and the kind itself, keeping their order. */
export function cadFeatureShape<Kind extends TSchema, F extends CadFeatureFields>(kind: Kind, fields: F): CadFeatureShape<TObject<typeof CadFeatureBaseSchemaFields & { kind: Kind } & FieldSchemas<F>>> {
  const properties: TProperties = { ...CadFeatureBaseSchemaFields, kind };
  for (const [name, field] of Object.entries(fields)) properties[name] = field.schema;
  const schema = Type.Object(properties as typeof CadFeatureBaseSchemaFields & { kind: Kind } & FieldSchemas<F>, strict);
  return Object.freeze({ schema, fields: Object.freeze(fields) });
}
