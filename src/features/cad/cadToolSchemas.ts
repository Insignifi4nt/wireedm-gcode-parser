import { Type } from '@sinclair/typebox';
import { CadEditSchema, type CadEdit } from '@/domain/cad/cadOperations';
import { CadDocumentSchema, CadFeatureSchema } from '@/domain/cad/cadSchema';
import { CadPluginPackageSchema } from '@/domain/cad/plugins/cadPlugins';

// Registration carries only the common feature envelope. Complete definitions
// are discoverable per kind, while execution still validates the full schemas.
// This avoids repeating every profile/topology/source definition in add, update
// and import arguments on every agent connection.
// The kind catalog belongs to cad_describe_features; execution still checks it.
const featureBase = CadFeatureSchema.anyOf[0].properties;
const featureEnvelope = Type.Object({
  id: featureBase.id, name: featureBase.name, suppressed: featureBase.suppressed,
  kind: Type.String()
}, { additionalProperties: true });
export const CadToolSketchEnvelope = Type.Object({ ...featureEnvelope.properties, kind: Type.Literal('sketch') },
  { additionalProperties: true, description: 'Full sketch: cad_describe_features(kind=sketch).' });

const pluginBase = CadPluginPackageSchema.anyOf[0].properties;
export const CadToolPluginPackageEnvelope = Type.Object({
  format: pluginBase.format, id: pluginBase.id, version: pluginBase.version, name: pluginBase.name,
  apiVersion: Type.Union(CadPluginPackageSchema.anyOf.map(plugin => plugin.properties.apiVersion))
}, { additionalProperties: true,
  description: 'Complete package from cad_describe_plugin_api(apiVersion).' });

const editDescriptions: Partial<Record<CadEdit['kind'], string>> = {
  'add-sketch-dimension': 'Driving dimension intent; keeps current size. Radius/diameter share circle size.',
  'set-sketch-dimension': 'Set displayed quantity (mm/deg); diameter halves to radius. Named bindings update parameters; compound drivers reject.',
  'remove-sketch-dimension': 'Remove explicit intent; retains the geometry scalar, including any driving expression.',
  'translate-sketch-profiles': 'Move contours in local XY mm; rejects nonzero motion on an expression-driven position axis.',
  'move-sketch-handle': 'Use a revision-scoped grip from cad_inspect_sketch_handles. Local-mm delta; projects onto free components, preserves drivers.',
  'move-sketch-point': 'Move a stable graph point by local-mm delta. Solves temporary drag intent, retaining relations and exact expression drivers. No saved drag constraint.',
  'set-sketch-relation': 'Add or replace a stable sketch-owned graph relation. Solve and validate atomically; conflicting/redundant relations reject the batch.',
  'remove-sketch-relation': 'Remove one graph relation by exact ID, retaining its current geometry. Missing IDs reject.',
};
export const CadToolEditDefinitions = CadEditSchema.anyOf.map(edit => 'feature' in edit.properties
  ? Type.Object({ ...edit.properties, feature: featureEnvelope }, { additionalProperties: false })
  : 'package' in edit.properties ? Type.Object({ ...edit.properties, package: CadToolPluginPackageEnvelope }, { additionalProperties: false })
    : editDescriptions[edit.properties.kind.const] ? { ...edit, description: editDescriptions[edit.properties.kind.const] } : edit);
/** Discover an edit's fields on demand instead of repeating every contract on each connection. */
export const CadToolEditEnvelope = Type.Union(CadEditSchema.anyOf.map(edit => Type.Object({ kind: edit.properties.kind }, {
  additionalProperties: true, description: 'Fields: cad_describe_edits(kind). Execution validates the complete contract.'
})));

export const CadToolDocumentEnvelope = Type.Object({ ...CadDocumentSchema.properties,
  features: Type.Array(featureEnvelope, { maxItems: CadDocumentSchema.properties.features.maxItems })
}, { additionalProperties: false });
