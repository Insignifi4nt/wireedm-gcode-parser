import { Type } from '@sinclair/typebox';
import type { CadDatumPlaneFeature, CadPathSegment, CadSketchPlane, CadSketchProfile } from '../../cadDocument';
import { CadError } from '../../cadError';
import { CadPluginProfileSchema } from '../../plugins/cadPlugins';
import { CadIdentifierSchema, CadLabelSchema, CadPathSegmentSchema, CadPlaneSchema, CadPoint2Schema, CadScalarSchema, CadSketchPlaneSchema } from '../../cadPrimitives';
import { CadDxfImportSourceSchema, parseCadDxfImportSource } from '../../cadDxfSource';
import { CadSketchDimensionConstraintSchema, validateCadSketchConstraints } from '../../cadSketchConstraints';
import { CadSketchDimensionAnnotationSchema, CadSketchGraphSchema, parseCadSketchGraph, type CadSketchGraph } from '../../cadSketchGraph';
import { assertCadSketchExternalReferences } from '../../cadSketchExternalReferences';
import { resolveCadSketchPlacement, resolveCadWorldDatum } from '../../cadDatumPlanes';
import { resolveCadCurveGeometry } from '../../cadCurve';
import type { CadFeatureDefinition } from '../cadFeatureDefinitionTypes';
import { cadFeatureField, cadFeatureScalarField, cadFeatureShape } from '../cadFeatureFields';
import { mapCadPathSegments, mapCadPoint3, mapCadProfileScalars, mapCadSketchGraphScalars } from '../cadFeatureScalarMaps';

const strict = { additionalProperties: false };
const scalar = CadScalarSchema;
const point2 = CadPoint2Schema;

export const CadProfileSchema = Type.Union([
  CadPluginProfileSchema,
  Type.Object({ kind: Type.Literal('rectangle'), x: scalar, y: scalar, width: scalar, height: scalar, cornerRadius: scalar }, strict),
  Type.Object({ kind: Type.Literal('circle'), x: scalar, y: scalar, radius: scalar }, strict),
  Type.Object({ kind: Type.Literal('polygon'), points: Type.Array(point2, { minItems: 3 }) }, strict),
  Type.Object({ kind: Type.Literal('path'), segments: Type.Array(CadPathSegmentSchema, { minItems: 1 }) }, strict),
  Type.Object({ kind: Type.Literal('slot'), x: scalar, y: scalar, length: scalar, width: scalar, angle: scalar }, strict)
]);
export const CadSketchProfileSchema = Type.Object({ id: CadIdentifierSchema, name: CadLabelSchema, construction: Type.Boolean(),
  role: Type.Optional(Type.Union([Type.Literal('outer'), Type.Literal('hole')])), geometry: CadProfileSchema,
  constraints: Type.Optional(Type.Array(CadSketchDimensionConstraintSchema, { maxItems: 6 })) }, strict);

/** The plane a sketch or curve is drawn on: a principal plane, or a preceding datum plane it names. */
const support = cadFeatureField<typeof CadSketchPlaneSchema, CadSketchPlane>(CadSketchPlaneSchema, {
  slot: { role: 'support', accepts: ['plane'], count: 'optional', ids: plane => typeof plane === 'string' ? [] : [plane.featureId] } });
const offset = cadFeatureScalarField({ quantity: 'length' });
const importSource = cadFeatureField(Type.Optional(CadDxfImportSourceSchema));
const point3 = Type.Tuple([CadScalarSchema, CadScalarSchema, CadScalarSchema]);

const worldDefinition = Type.Object({ kind: Type.Literal('world'), basePlane: CadPlaneSchema, origin: point3, rotation: point3 }, strict);
const datumPlaneShape = cadFeatureShape(Type.Literal('datum-plane'), {
  // World origin in millimetres and rotation in degrees.
  definition: cadFeatureField<typeof worldDefinition, CadDatumPlaneFeature['definition']>(worldDefinition, {
    scalars: (definition, path, map) => ({ ...definition, origin: mapCadPoint3(definition.origin, `${path}.origin`, map), rotation: mapCadPoint3(definition.rotation, `${path}.rotation`, map) }) })
});
export const CadDatumPlaneFeatureSchema = datumPlaneShape.schema;

export const datumPlane = {
  kind: 'datum-plane', family: 'reference', ...datumPlaneShape,
  outputs: ['plane'], body: 'none', suppression: 'no-output', evaluator: { owner: 'domain', version: 1 },
  diagnostics: ['invalid-datum-plane', 'unsupported-datum-frame'],
  check(feature, context) {
    const resolved = resolveCadWorldDatum(feature, context.document.parameters);
    if (context.active) context.addDatumFrame(feature.id, resolved);
  },
  form: { editor: 'bespoke', title: 'Plane' },
  agent: { exposed: true, description: 'An independent world reference plane. definition.kind=world uses basePlane XY/XZ/YZ, world origin in mm and rotation in degrees around world X then Y then Z. Rotation turns its basis without rotating its origin. All coordinates accept parameter expressions. Sketch/Curve plane may reference this preceding active feature with {kind:datum-plane,featureId}; offset remains along its normal. No body, material or CAM role. cad_inspect_plane resolves the frame without loading the solid engine. Datum Pad/Revolve/Loft/Sweep require conservative placement precision. Loft sections must share oriented axes and normal; use cad_inspect_loft before adding one. Sweep preserves authored section and rail frames; its section normal must align with the first rail tangent. Datum Through-all Pocket is not yet supported and is rejected before editing.' }
} satisfies CadFeatureDefinition<'datum-plane'>;

const sketchProfiles = Type.Array(CadSketchProfileSchema);
const optionalGraph = Type.Optional(CadSketchGraphSchema);
const sketchShape = cadFeatureShape(Type.Literal('sketch'), {
  plane: support,
  offset,
  profiles: cadFeatureField<typeof sketchProfiles, readonly CadSketchProfile[]>(sketchProfiles, {
    scalars: (profiles, path, map) => profiles.map((profile, index) => ({ ...profile, geometry: mapCadProfileScalars(profile.geometry, `${path}.${index}.geometry`, map) })) }),
  source: importSource,
  graph: cadFeatureField<typeof optionalGraph, CadSketchGraph>(optionalGraph, {
    // Another sketch whose entities this one uses as read-only references.
    slot: { role: 'linked', accepts: ['sketch'], count: 'many',
      ids: graph => [...new Set(graph.relations.flatMap(relation => relation.kind === 'external-reference' ? [relation.sourceSketchId] : []))] },
    scalars: mapCadSketchGraphScalars })
});
export const CadSketchFeatureSchema = sketchShape.schema;

export const sketch = {
  kind: 'sketch', family: 'reference', ...sketchShape,
  outputs: ['sketch'], body: 'none', suppression: 'no-output', evaluator: { owner: 'domain', version: 1 },
  diagnostics: ['unsupported-sketch-format', 'duplicate-sketch-constraint', 'invalid-profile', 'open-profile', 'profile-intersection', 'self-intersection',
    'invalid-sketch-graph', 'invalid-sketch-reference', 'unavailable-sketch-reference', 'stale-sketch-reference', 'changed-sketch-reference', 'invalid-dxf-source', 'unsupported-datum-frame'],
  check(feature, context) {
    const { document } = context;
    context.scalar(feature, 'offset');
    if (feature.graph) {
      if (document.schemaVersion !== 2) throw new CadError('unsupported-sketch-format', 'Stable sketch entities require CAD schema 2. Preserve the schema 1 original when saving an upgrade.');
      // Keep the parser's accepted graph, so later parses of it are free. An accepted feature
      // is frozen and holds its accepted graph already.
      const graph = parseCadSketchGraph(feature.graph);
      if (graph !== feature.graph) (feature as { graph: CadSketchGraph }).graph = graph;
      assertCadSketchExternalReferences({ sketch: feature, parameters: document.parameters, previous: context.previous });
    }
    if (feature.source) parseCadDxfImportSource(feature.source);
    const ids = new Set<string>();
    const dimensionIds = new Set<string>();
    for (const profile of feature.profiles) {
      if (ids.has(profile.id)) throw new CadError('duplicate-id', `Duplicate profile ID "${profile.id}" in sketch "${feature.name}".`);
      ids.add(profile.id);
      validateCadSketchConstraints(profile);
      for (const constraint of profile.constraints ?? []) {
        if (dimensionIds.has(constraint.id)) throw new CadError('duplicate-sketch-constraint', 'Sketch dimension IDs must be unique within their sketch.');
        dimensionIds.add(constraint.id);
      }
    }
    context.checkSketchGeometry(feature);
    if (context.active) resolveCadSketchPlacement(feature, document.parameters, context.datums);
  },
  form: { editor: 'bespoke', title: 'Sketch' },
  agent: { exposed: true, description: 'Plane-local legacy closed profiles and optional schema-2 graph of stable open/closed line, arc and circle entities on XY/XZ/YZ or a preceding active datum-plane, with optional construction geometry. Offset follows the resolved plane normal; changing placement preserves local coordinates. Nesting automatically determines material, voids and islands. Dimensions accept finite arithmetic over document parameters. Use cad_inspect_plane for world placement.',
    // Saved legacy contour roles remain parseable, but new contours use nesting.
    authoringSchema: Type.Object({ ...CadSketchFeatureSchema.properties, profiles: Type.Array(Type.Omit(CadSketchProfileSchema, ['role'])) }, strict),
    // A sketch definition repeats its scalar, identifier and dimension placement schemas dozens of times.
    sharedDefinitions: {
      CadScalar: CadScalarSchema, CadIdentifier: CadIdentifierSchema,
      ...Object.fromEntries(CadSketchDimensionAnnotationSchema.anyOf.map(variant => [`CadSketch${variant.properties.kind.const[0].toUpperCase()}${variant.properties.kind.const.slice(1)}Annotation`, variant]))
    } }
} satisfies CadFeatureDefinition<'sketch'>;

const curveSegments = Type.Array(CadPathSegmentSchema, { minItems: 1 });
const curveShape = cadFeatureShape(Type.Literal('curve'), {
  plane: support,
  offset,
  segments: cadFeatureField<typeof curveSegments, readonly CadPathSegment[]>(curveSegments, { scalars: mapCadPathSegments }),
  source: importSource
});
export const CadCurveFeatureSchema = curveShape.schema;

export const curve = {
  kind: 'curve', family: 'reference', ...curveShape,
  outputs: ['curve'], body: 'none', suppression: 'no-output', evaluator: { owner: 'domain', version: 1 },
  diagnostics: ['invalid-curve', 'invalid-curve-placement', 'closed-curve', 'disconnected-curve', 'self-intersection', 'invalid-dxf-source', 'unsupported-datum-frame'],
  check(feature, context) {
    resolveCadCurveGeometry(feature, context.document.parameters);
    if (context.active) resolveCadSketchPlacement(feature, context.document.parameters, context.datums);
  },
  form: { editor: 'bespoke', title: 'Curve' },
  agent: { exposed: true, description: 'An ordered open reference chain of exact lines and circular arcs on XY, XZ, YZ or a preceding active datum-plane at a signed normal offset. Dimensions accept parameter expressions. Segments must connect within modeling precision without closing, crossing, touching nonadjacent segments or overlapping. Sharp corners are allowed. Curves are independent references, never solid bodies or closed material profiles. Retains original DXF source when imported; exact open DXF export preserves traversal in local millimeters.' }
} satisfies CadFeatureDefinition<'curve'>;
