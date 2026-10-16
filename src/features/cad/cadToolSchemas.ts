import { Type, type Static } from '@sinclair/typebox';
import { CadIdentifierSchema } from '@/domain/cad/cadPrimitives';
import { pageFields } from '@/features/webmcp/siteTools';
import { CadEditSchema, type CadEdit } from '@/domain/cad/cadOperations';
import { CadDocumentSchema, CadFeatureSchema } from '@/domain/cad/cadSchema';
import { CadPluginPackageSchema } from '@/domain/cad/plugins/cadPlugins';

export const CadToolSketchConstraintSectionSchema = Type.Union([Type.Literal('relations'), Type.Literal('points'), Type.Literal('entities')]);
export type CadSketchConstraintSection = Static<typeof CadToolSketchConstraintSectionSchema>;
export const CadToolSketchConstraintsQuerySchema = Type.Object({ expectedVersion: Type.String({ minLength: 1, maxLength: 160 }), sketchId: CadIdentifierSchema,
  section: Type.Optional(CadToolSketchConstraintSectionSchema), ...pageFields,
  offset: Type.Optional(Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })) }, { additionalProperties: false });

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
  'translate-sketch-geometry': 'Translate 1–64 exact graph point/entity selections together in local XY mm. Shared endpoints move once, including incident unselected edges; complete corner treatments include their owned reference corner. Retains sizes, relations, expression drivers and every outside coordinate. Rejects blocked, distorted, numerically unrepresentable or solver-repaired motion atomically. This is exact translation, separate from a soft point drag.',
  'move-sketch-handle': 'Use a revision-scoped grip from cad_inspect_sketch_handles. Local-mm delta; projects onto free components, preserves drivers.',
  'append-sketch-entities': 'Append new graph IDs, allowing references to existing points. Never replaces IDs or merges nearby points. Solves and validates the complete part before acceptance.',
  'create-sketch-corner': 'Round or bevel one shared degree-two line corner with explicit new topology IDs. Retains the original reference point and exact drivers. Fillets keep tangent minor arcs; chamfers keep two finite setbacks. Complete-part checks still apply.',
  'split-sketch-entity': 'Split an exact graph line or open arc at a numeric source-oriented parameter strictly inside (0,1). The original ID retains the start-side piece; fresh splitPointId/newEntityId name the shared joint and end-side piece. A line also requires supportRelationId for its ordinary parallel relation. Preserves existing points, expressions and construction flags. Whole-entity relation owners block with exact relation IDs. Native or precision failures reject without geometry repair. Existing explicit region selectors require deliberate replacement; inspect proposal.split with the same IDs before an atomic split-plus-consumer repair batch.',
  'trim-sketch-entity': 'Trim a clicked graph-line, open-arc or eligible numeric-circle span, at finite transverse boundaries; genuinely no intersection deletes the entity. Query cad_inspect_sketch_regions with trimAt:{entityId,parameter}, then reuse trimPreview.target. End requires cutPointId. Middle requires ordered cutPointIds plus fresh newEntityId/supportRelationId: the source-start survivor keeps the old ID, the other uses newEntityId, and ordinary Collinear keeps line supports, or shared center plus Equal radius keeps arc supports. For each cut use boundary.endpointPointId when present, otherwise a fresh point ID. Witness entity/index/position/source-parameter must stay exact. Middle retains both old outer points and their exact strings/point relations/HV; finite whole-edge size/ray/corner owners block. Surviving lines retain Parallel/Perpendicular/Collinear. End alone transfers uniquely owned original-endpoint-pair HV to its replacement; adjacent HV stays unchanged. Surviving arcs keep existing radius/diameter and Equal radius owners verbatim; explicit detached-point drivers and other owners still block. Whole deletion keeps strict ownership. No implicit cutter attachment, coordinate healing or dropped relations. Circle needs two distinct contacts; ordered cutPointIds complete its circle target, and its complementary CCW arc keeps the original entity/center. Circle string-radius/whole-curve owners block; center-only drivers remain. Circle parameter1 aliases0 but receipts retain the request. Middle arcs keep their direction and center; old radius/diameter and Equal radius owners stay on the retained-ID arc; other whole-arc owners block. Tangent/overlap/ambiguity, precision and native candidate drift reject. Inspect proposal.trim with the identical allocated target, then submit deliberate consumer repairs atomically.',
  'extend-sketch-entity': 'Extend one graph line or arc endpoint outward to its nearest unique transverse finite line/arc/circle boundary. Query cad_inspect_sketch_regions with extendAt:{entityId,end} first, reuse extendPreview.target and add endPointId: boundary.endpointPointId when present, otherwise a fresh ID. Boundary parameter is the normalized original-source t below0 or above1; for arcs it is not radians or a global phase, finite without an arbitrary magnitude cap; entity/index/position are an exact stale witness. Retains source ID, construction, other endpoint, old points and exact scalars. Keeps Parallel/Perpendicular/Collinear records and transfers only uniquely owned original-endpoint-pair H/V to the new endpoint; other H/V operands stay unchanged. Other affected dimensional/position/attachment/structural owners block with bounded relation/point IDs. Arcs retain center/direction and search only their unused angular gap, may become major, and must stay below a full turn. Existing radius/diameter and Equal radius owners naming that retained arc stay verbatim; other whole-arc owners block. Does not shorten, extend a circle source, join the opposite endpoint, move cutters or add an interior constraint. No-hit, ambiguous/tangent/overlap, precision and native-drift failures reject. Inspect proposal.extend with the identical full target before an atomic consumer repair.',
  'offset-sketch-loop': 'Create one detached numeric graph copy of a current simple closed material loop. source is a legacy profile ID or the exact complete reference.graphContours sourceRefs from cad_inspect_sketch_regions. Signed distance is local mm: positive outside the selected loop, negative inside, regardless of hole nesting. idPrefix names deterministic fresh identities and must remain identical for preview/proposal/Apply. Retains source records, expressions and relations exactly; creates no association or copied constraints. Zero is a true no-op. Supports circles, simple line polygons and smooth mixed line/arc loops; unsupported joins, collapse, crossing, identity conflicts, precision loss and native candidate drift reject. Inspect proposal.offset with this same request, then submit any deliberate consumer-area repairs atomically.',
  'mirror-sketch-geometry': 'Copy 1–64 distinct graph line/arc/circle entityIds about the infinite support of another current graph line axisLineId. idPrefix names deterministic fresh numeric support points and entities; reuse the identical prefix in proposal.mirror and the edit. Preserves all source records and expressions. Copies declared internal Coincident joints only, with no copied dimensions, expression links or ongoing mirror association. Construction state is retained. Overlap, invalid identities, precision loss or native candidate drift reject. Inspect the same proposal.mirror request for exact resulting area references and apply deliberate consumer repairs atomically.',
  'delete-sketch-elements': 'Delete exact graph point/entity/relation IDs. Without cascade, all dependent elements must be selected; cascade removes only incident entities/relations of selected points, retaining other points and CAD features.',
  'set-sketch-construction': 'Set construction on exact graph entity IDs while retaining their geometry and relations. Complete-part validation may reject loss of downstream material.',
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
