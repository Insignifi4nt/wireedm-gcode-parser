import { Type, type Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import type { CadDiagnostic, CadDocument, CadFeature, CadProfile, CadSketchFeature, CadSketchProfile } from './cadDocument';
import { CadError } from './cadError';
import { evaluateCadScalar } from './cadExpression';
import { CadPluginProfileSchema } from './plugins/cadPlugins';
import { CadParameterGroupSchema, CadParameterMetadataSchema, CadParameterNameSchema, validateCadParameterMetadata } from './cadParameters';
import { resolveCadSketchRegions, validateCadSketchGeometry } from './cadSketchGeometry';
import { CadSketchRegionSelectionSchema, validateCadSketchRegionSelection } from './cadSketchRegionSelection';
import { CadEdgeSelectionSchema, CadFaceQuerySchema, resolveCadEdgeSelection, validateCadShellOpening } from './cadTopology';
import { CadSolidImportSourceSchema, parseCadSolidImportSource } from './cadImports';
import { CadDxfImportSourceSchema, parseCadDxfImportSource } from './cadDxfSource';
import { isCadImportData } from './cadImportData';
import { MAX_CAD_PATTERN_COUNT, MAX_CAD_PATTERN_INSTANCES, MIN_CAD_PATTERN_COUNT, resolveCadCircularPattern } from './cadPatterns';
import { MAX_CAD_LOFT_SECTIONS, MIN_CAD_LOFT_SECTIONS, resolveCadLoftSections } from './cadLoft';
import { CadCurveFeatureSchema, resolveCadCurveGeometry } from './cadCurve';
import { CadSweepFeatureSchema, resolveCadSweepInputs } from './cadSweep';
import { CadPocketFeatureSchema, resolveCadPocketInputs } from './cadPocket';
import { CadFeatureBaseSchemaFields, CadIdentifierSchema, CadLabelSchema, CadNumberSchema, CadPathSegmentSchema, CadPlaneSchema, CadPoint2Schema, CadScalarSchema, CadSketchPlaneSchema } from './cadPrimitives';
import { CadDatumPlaneFeatureSchema, resolveCadWorldDatum, resolveCadSketchPlacement, resolveCadExtrudeRevolvePlacement, type CadResolvedFrame } from './cadDatumPlanes';
import { cadConsumedBodyIds, cadFeatureInputs, cadFeatureProducesBody } from './cadFeatureInputs';
import { CadSketchDimensionConstraintSchema, validateCadSketchConstraints } from './cadSketchConstraints';
import { CadSketchGraphSchema, parseCadSketchGraph } from './cadSketchGraph';
import { assertCadSketchExternalReferences } from './cadSketchExternalReferences';
export { cadConsumedBodyIds, cadFeatureDependencies, cadFeatureInputs, cadFeatureProducesBody, cadVisibleBodyIds, type CadBodyFeature } from './cadFeatureInputs';
export { CadPathSegmentSchema } from './cadPrimitives';

const strict = { additionalProperties: false };
const identifier = CadIdentifierSchema;
const label = CadLabelSchema;
const number = CadNumberSchema;
const scalar = CadScalarSchema;
const plane = CadPlaneSchema;
const point2 = CadPoint2Schema;
const point3 = Type.Tuple([scalar, scalar, scalar]);
const solidOperation = Type.Union([Type.Literal('new'), Type.Literal('join'), Type.Literal('cut')]);
const base = CadFeatureBaseSchemaFields;
export const CadProfileSchema = Type.Union([
  CadPluginProfileSchema,
  Type.Object({ kind: Type.Literal('rectangle'), x: scalar, y: scalar, width: scalar, height: scalar, cornerRadius: scalar }, strict),
  Type.Object({ kind: Type.Literal('circle'), x: scalar, y: scalar, radius: scalar }, strict),
  Type.Object({ kind: Type.Literal('polygon'), points: Type.Array(point2, { minItems: 3 }) }, strict),
  Type.Object({ kind: Type.Literal('path'), segments: Type.Array(CadPathSegmentSchema, { minItems: 1 }) }, strict),
  Type.Object({ kind: Type.Literal('slot'), x: scalar, y: scalar, length: scalar, width: scalar, angle: scalar }, strict)
]);
export const CadSketchProfileSchema = Type.Object({ id: identifier, name: label, construction: Type.Boolean(),
  role: Type.Optional(Type.Union([Type.Literal('outer'), Type.Literal('hole')])), geometry: CadProfileSchema,
  constraints: Type.Optional(Type.Array(CadSketchDimensionConstraintSchema, { maxItems: 6 })) }, strict);
export const CadSketchFeatureSchema = Type.Object({ ...base, kind: Type.Literal('sketch'), plane: CadSketchPlaneSchema, offset: scalar,
  profiles: Type.Array(CadSketchProfileSchema), source: Type.Optional(CadDxfImportSourceSchema), graph: Type.Optional(CadSketchGraphSchema) }, strict);
export const CadFeatureSchema = Type.Union([
  CadDatumPlaneFeatureSchema,
  CadCurveFeatureSchema,
  CadSweepFeatureSchema,
  CadPocketFeatureSchema,
  Type.Object({ ...base, kind: Type.Literal('imported'), source: CadSolidImportSourceSchema }, strict),
  CadSketchFeatureSchema,
  Type.Object({ ...base, kind: Type.Literal('extrude'), sketchId: identifier, regionSelection: Type.Optional(CadSketchRegionSelectionSchema), distance: scalar, symmetric: Type.Boolean(), operation: solidOperation, targetId: Type.Union([identifier, Type.Null()]) }, strict),
  Type.Object({ ...base, kind: Type.Literal('revolve'), sketchId: identifier, angle: scalar, axis: Type.Union([Type.Literal('x'), Type.Literal('y')]), operation: solidOperation, targetId: Type.Union([identifier, Type.Null()]) }, strict),
  Type.Object({ ...base, kind: Type.Literal('loft'), sketchIds: Type.Array(identifier, { minItems: MIN_CAD_LOFT_SECTIONS, maxItems: MAX_CAD_LOFT_SECTIONS, uniqueItems: true }), ruled: Type.Boolean(), operation: solidOperation, targetId: Type.Union([identifier, Type.Null()]) }, strict),
  Type.Object({ ...base, kind: Type.Union([Type.Literal('fillet'), Type.Literal('chamfer')]), targetId: identifier, radius: scalar,
    selection: Type.Optional(Type.Union([CadEdgeSelectionSchema, Type.Null()])), tangentPropagation: Type.Optional(Type.Boolean()) }, strict),
  Type.Object({ ...base, kind: Type.Literal('shell'), targetId: identifier, thickness: scalar, opening: CadFaceQuerySchema }, strict),
  Type.Object({ ...base, kind: Type.Literal('boolean'), targetId: identifier, toolId: identifier, operation: Type.Union([Type.Literal('union'), Type.Literal('cut'), Type.Literal('intersect')]) }, strict),
  Type.Object({ ...base, kind: Type.Literal('transform'), sourceId: identifier, translation: point3, rotation: point3 }, strict),
  Type.Object({ ...base, kind: Type.Literal('linear-pattern'), sourceId: identifier, count: Type.Integer({ minimum: MIN_CAD_PATTERN_COUNT, maximum: MAX_CAD_PATTERN_COUNT }), spacing: point3 }, strict),
  Type.Object({ ...base, kind: Type.Literal('circular-pattern'), sourceId: identifier, count: Type.Integer({ minimum: MIN_CAD_PATTERN_COUNT, maximum: MAX_CAD_PATTERN_COUNT }), axis: Type.Union([Type.Literal('x'), Type.Literal('y'), Type.Literal('z')]), center: point3, angle: scalar }, strict),
  Type.Object({ ...base, kind: Type.Literal('mirror'), sourceId: identifier, plane }, strict)
]);
export const CadDocumentSchema = Type.Object({
  format: Type.Literal('wireedm-cad'), schemaVersion: Type.Union([Type.Literal(1), Type.Literal(2)]),
  id: Type.String({ pattern: '^[a-z0-9][a-z0-9_-]{0,95}$' }), name: label, units: Type.Literal('mm'),
  parameters: Type.Record(Type.String({ pattern: '^[A-Za-z_][A-Za-z0-9_]{0,63}$' }), number, { additionalProperties: false }),
  parameterGroups: Type.Optional(Type.Array(CadParameterGroupSchema)),
  parameterMetadata: Type.Optional(Type.Record(CadParameterNameSchema, CadParameterMetadataSchema, { additionalProperties: false })),
  features: Type.Array(CadFeatureSchema)
}, strict);

// Only this parser's detached, deeply frozen successful outputs are trusted.
// Mutable inputs, lookalikes and structured clones still cross the full boundary.
const acceptedDocuments = new WeakSet<CadDocument>();
const acceptedSketchSources = new WeakSet<CadSketchFeature>();

/** Provenance for internal geometry reuse; a caller's frozen lookalike is not accepted. */
export function isAcceptedCadSketchSource(sketch: CadSketchFeature): boolean {
  return acceptedSketchSources.has(sketch);
}

/** Strict boundary parser. Never rewrites IDs, geometry, units or saved expressions. */
export function parseCadDocument(value: unknown): CadDocument {
  if (typeof value === 'object' && value !== null && acceptedDocuments.has(value as CadDocument)) return value as CadDocument;
  if (!isCadImportData(value)) throw new CadError('invalid-document', 'CAD documents must contain their own complete JSON data fields.');
  if (!Value.Check(CadDocumentSchema, value)) {
    const error = Value.Errors(CadDocumentSchema, value).First();
    throw new CadError('invalid-document', `Invalid CAD document${error ? ` at ${error.path || '/'}: ${error.message}` : '.'}`);
  }
  // A boundary input may have inherited fields or accessors. Validate semantics
  // against its detached own-data snapshot, never against changing getters.
  let snapshot: Static<typeof CadDocumentSchema>;
  try { snapshot = structuredClone(value); }
  catch { throw new CadError('invalid-document', 'CAD document must contain portable declarative data.'); }
  if (!Value.Check(CadDocumentSchema, snapshot)) throw new CadError('invalid-document', 'CAD document must contain its own complete JSON fields.');
  const document: CadDocument = snapshot;
  validateCadParameterMetadata(document);
  if (/^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/.test(document.id)) throw new CadError('invalid-document-id', 'Document ID is a reserved filesystem name.');
  for (const name of Object.keys(document.parameters)) {
    if (['__proto__', 'prototype', 'constructor'].includes(name)) throw new CadError('invalid-parameter', `Parameter name "${name}" is reserved.`);
  }
  const previous = new Map<string, CadFeature>();
  const datumFrames = new Map<string, CadResolvedFrame>();
  const datumLookup = Object.freeze({ get: (id: string) => datumFrames.get(id) });
  const visibleBodies = new Set<string>();
  const expandedInstances = new Map<string, number>();
  let instanceBudget = 0;
  const e = (value: number | string) => evaluateCadScalar(value, document.parameters);
  for (const feature of document.features) {
    if (previous.has(feature.id)) throw new CadError('duplicate-id', `Duplicate feature ID "${feature.id}".`);
    const inputs = cadFeatureInputs(feature);
    for (const id of inputs.datumIds) {
      if (previous.get(id)?.kind !== 'datum-plane') throw new CadError('invalid-reference', `Feature "${feature.name}" needs a preceding datum plane "${id}".`);
    }
    for (const id of inputs.sketchIds) {
      if (previous.get(id)?.kind !== 'sketch') throw new CadError('invalid-reference', `Feature "${feature.name}" needs a preceding sketch "${id}".`);
    }
    for (const id of inputs.curveIds) {
      if (previous.get(id)?.kind !== 'curve') throw new CadError('invalid-reference', `Feature "${feature.name}" needs a preceding reference curve "${id}".`);
    }
    for (const id of inputs.bodyIds) {
      const referenced = previous.get(id);
      if (!referenced) throw new CadError('invalid-reference', `Feature "${feature.name}" references missing or later feature "${id}".`);
      if (!cadFeatureProducesBody(referenced)) throw new CadError('invalid-reference', `A solid operation cannot target ${referenced.kind === 'sketch' ? 'a sketch' : referenced.kind === 'curve' ? 'a reference curve' : 'a datum plane'}.`);
    }
    const solidDependencies = inputs.bodyIds;
    if (!feature.suppressed) for (const id of solidDependencies) {
      if (!visibleBodies.has(id)) throw new CadError('unavailable-body', `Feature "${feature.name}" references suppressed or already consumed body "${id}". Select its current successor.`);
    }
    const operandInstances = solidDependencies.reduce((total, id) => total + (expandedInstances.get(id) ?? 1), 0);
    if ((feature.kind === 'extrude' || feature.kind === 'pocket') && feature.regionSelection !== undefined) {
      validateCadSketchRegionSelection(feature.regionSelection);
      if (!Array.isArray(feature.regionSelection) && document.schemaVersion !== 2)
        throw new CadError('unsupported-sketch-format', 'Graph cell area selections require CAD schema 2. Preserve the schema 1 original when saving an upgrade.');
    }
    const pocket = feature.kind === 'pocket' && !feature.suppressed ? resolveCadPocketInputs(feature, previous, document.parameters) : null;
    // New section generators add one operand before join/cut. Keep the existing
    // Pad/Revolve preflight counts unchanged for saved-history compatibility.
    let instances = feature.kind === 'curve' || feature.kind === 'datum-plane' ? 0 : feature.kind === 'pocket' ? operandInstances + (pocket?.regionCount ?? 1)
      : feature.kind === 'loft' || feature.kind === 'sweep' ? operandInstances + 1 : operandInstances || 1;
    if (feature.kind === 'linear-pattern' || feature.kind === 'circular-pattern') instances *= feature.count;
    if (instances > MAX_CAD_PATTERN_INSTANCES) throw new CadError('feature-limit', 'Nested pattern expansion exceeds 1000 solid instances.');
    switch (feature.kind) {
      case 'datum-plane': {
        const resolved = resolveCadWorldDatum(feature, document.parameters);
        if (!feature.suppressed) datumFrames.set(feature.id, resolved);
        break;
      }
      case 'imported': parseCadSolidImportSource(feature.source); break;
      case 'curve': {
        resolveCadCurveGeometry(feature, document.parameters);
        if (!feature.suppressed) resolveCadSketchPlacement(feature, document.parameters, datumLookup);
        break;
      }
      case 'sketch': {
        e(feature.offset);
        if (feature.graph) {
          if (document.schemaVersion !== 2) throw new CadError('unsupported-sketch-format', 'Stable sketch entities require CAD schema 2. Preserve the schema 1 original when saving an upgrade.');
          parseCadSketchGraph(feature.graph);
          assertCadSketchExternalReferences({ sketch: feature, parameters: document.parameters, previous });
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
        validateCadSketchGeometry(feature, document.parameters);
        if (!feature.suppressed) resolveCadSketchPlacement(feature, document.parameters, datumLookup);
        break;
      }
      case 'extrude': case 'revolve': {
        const sketch = previous.get(feature.sketchId);
        if (sketch?.kind !== 'sketch') throw new CadError('invalid-reference', `Feature "${feature.name}" needs a preceding sketch.`);
        if (feature.operation === 'new' && feature.targetId !== null || feature.operation !== 'new' && feature.targetId === null) throw new CadError('invalid-operation', 'New bodies have no target; join and cut require a target body.');
        if (!feature.suppressed && (sketch.suppressed || !resolveCadSketchRegions(sketch, document.parameters,
          feature.kind === 'extrude' ? feature.regionSelection : undefined).length)) throw new CadError('empty-sketch', `Feature "${feature.name}" needs an active nonempty sketch.`);
        if (feature.kind === 'extrude') {
          const distance = e(feature.distance);
          if (Math.abs(distance) <= 1e-7 || Math.abs(distance) > 1e6) throw new CadError('invalid-dimension', 'Extrusion distance must be nonzero and within one million millimetres.');
        } else {
          const angle = e(feature.angle);
          if (angle <= 1e-7 || angle > 360) throw new CadError('invalid-dimension', 'Revolve angle must be greater than zero and at most 360 degrees.');
        }
        if (!feature.suppressed) resolveCadExtrudeRevolvePlacement(feature, sketch, document.parameters, datumLookup);
        break;
      }
      case 'loft': {
        if (feature.operation === 'new' && feature.targetId !== null || feature.operation !== 'new' && feature.targetId === null) throw new CadError('invalid-operation', 'New bodies have no target; join and cut require a target body.');
        if (!feature.suppressed) resolveCadLoftSections(feature, previous, document.parameters, datumLookup);
        break;
      }
      case 'sweep': {
        if (feature.operation === 'new' && feature.targetId !== null || feature.operation !== 'new' && feature.targetId === null) throw new CadError('invalid-operation', 'New bodies have no target; join and cut require a target body.');
        if (!feature.suppressed) resolveCadSweepInputs(feature, previous, document.parameters, datumLookup);
        break;
      }
      case 'pocket': break; // Active region checks already supplied the operand budget.
      case 'fillet': case 'chamfer': {
        if (e(feature.radius) <= 1e-7 || e(feature.radius) > 1e6) throw new CadError('invalid-dimension', 'Edge radius must be positive and within one million millimetres.');
        if (feature.selection) resolveCadEdgeSelection(feature.selection, document.parameters);
        break;
      }
      case 'shell': {
        if (e(feature.thickness) <= 1e-7 || e(feature.thickness) > 1e6) throw new CadError('invalid-dimension', 'Inward shell thickness must be positive and within one million millimetres.');
        validateCadShellOpening(feature.opening, document.parameters);
        break;
      }
      case 'boolean': if (feature.targetId === feature.toolId) throw new CadError('invalid-operation', 'Boolean target and tool must be different bodies.'); break;
      case 'transform': feature.translation.forEach(e); feature.rotation.forEach(e); break;
      case 'linear-pattern': {
        const spacing = feature.spacing.map(e);
        if (spacing.every(value => Math.abs(value) <= 1e-7)) throw new CadError('invalid-dimension', 'Pattern spacing must be nonzero.');
        break;
      }
      case 'circular-pattern': resolveCadCircularPattern(feature, document.parameters); break;
      case 'mirror': break;
      default: { const exhaustive: never = feature; throw exhaustive; }
    }
    if (feature.kind === 'linear-pattern' || feature.kind === 'circular-pattern') {
      instanceBudget += feature.count;
      if (instanceBudget > MAX_CAD_PATTERN_INSTANCES) throw new CadError('feature-limit', 'Document has too many pattern instances.');
    }
    previous.set(feature.id, feature);
    expandedInstances.set(feature.id, instances);
    cadConsumedBodyIds(feature).forEach(id => visibleBodies.delete(id));
    if (cadFeatureProducesBody(feature) && !feature.suppressed) visibleBodies.add(feature.id);
  }
  // Detach from callers, then freeze the complete history so neither a caller's
  // edit payload nor a UI/tool snapshot can mutate an accepted revision later.
  function freeze(value: unknown): void {
    if (value === null || typeof value !== 'object') return;
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  freeze(document);
  for (const feature of document.features) if (feature.kind === 'sketch') acceptedSketchSources.add(feature);
  acceptedDocuments.add(document);
  return document;
}

export function createCadDocument(name = 'Untitled part', id = `cad_${crypto.randomUUID()}`): CadDocument {
  return parseCadDocument({ format: 'wireedm-cad', schemaVersion: 1, id, name, units: 'mm', parameters: {}, features: [] });
}

/** Shared contour default for drawing and declarative authoring: nesting is automatic. */
export function createCadSketchProfile(input: { readonly geometry: CadProfile; readonly id?: string; readonly name?: string; readonly construction?: boolean; readonly constraints?: CadSketchProfile['constraints'] }): CadSketchProfile {
  const value = { id: input.id ?? `contour_${crypto.randomUUID()}`, name: input.name ?? 'Contour', construction: input.construction ?? false, geometry: input.geometry,
    ...(input.constraints ? { constraints: input.constraints } : {}) };
  if (!Value.Check(CadSketchProfileSchema, value)) throw new CadError('invalid-profile', 'Malformed sketch contour.');
  let profile: CadSketchProfile;
  try { profile = structuredClone(value); }
  catch { throw new CadError('invalid-profile', 'Sketch contours must contain portable declarative data.'); }
  if (!Value.Check(CadSketchProfileSchema, profile)) throw new CadError('invalid-profile', 'Sketch contours must contain their own complete fields.');
  validateCadSketchConstraints(profile);
  function freeze(item: unknown): void {
    if (!item || typeof item !== 'object') return;
    Object.values(item).forEach(freeze); Object.freeze(item);
  }
  freeze(profile); return profile;
}

export function validateCadDocument(document: CadDocument): readonly CadDiagnostic[] {
  try { parseCadDocument(document); return []; }
  catch (error) { if (error instanceof CadError) return [{ code: error.code, message: error.message }]; throw error; }
}
