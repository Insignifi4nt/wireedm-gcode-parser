import { Type } from '@sinclair/typebox';
import { CadEditSchema } from '@/domain/cad/cadOperations';
import { CadDocumentSchema, CadFeatureSchema } from '@/domain/cad/cadSchema';

// Registration carries only the common feature envelope. Complete definitions
// are discoverable per kind, while execution still validates the full schemas.
// This avoids repeating every profile/topology/source definition in add, update
// and import arguments on every agent connection.
const featureBase = CadFeatureSchema.anyOf[0].properties;
const featureEnvelope = Type.Object({
  id: featureBase.id, name: featureBase.name, suppressed: featureBase.suppressed,
  kind: Type.Union(CadFeatureSchema.anyOf.map(feature => feature.properties.kind))
}, { additionalProperties: true,
  description: 'A complete CAD feature definition. Call cad_describe_features with this kind for all required fields and constraints. Every field is strictly validated before editing; this compact envelope is discovery metadata only.' });

export const CadToolEditEnvelope = Type.Union(CadEditSchema.anyOf.map(edit => 'feature' in edit.properties
  ? Type.Object({ ...edit.properties, feature: featureEnvelope }, { additionalProperties: false }) : edit));

export const CadToolDocumentEnvelope = Type.Object({ ...CadDocumentSchema.properties,
  features: Type.Array(featureEnvelope, { maxItems: CadDocumentSchema.properties.features.maxItems })
}, { additionalProperties: false });
