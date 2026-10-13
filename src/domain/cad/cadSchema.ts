import { Type, type Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import type { CadDiagnostic, CadDocument, CadFeature } from './cadDocument';
import { CadError } from './cadError';
import { evaluateCadScalar } from './cadExpression';
import { validateCadSketchGeometry } from './cadSketchGeometry';

const strict = { additionalProperties: false };
const identifier = Type.String({ pattern: '^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$' });
const label = Type.String({ minLength: 1, maxLength: 160, pattern: '\\S' });
const number = Type.Number({ minimum: -1e9, maximum: 1e9 });
const scalar = Type.Union([number, Type.String({ minLength: 1, maxLength: 512 })]);
const plane = Type.Union([Type.Literal('XY'), Type.Literal('XZ'), Type.Literal('YZ')]);
const point2 = Type.Tuple([scalar, scalar]);
const point3 = Type.Tuple([scalar, scalar, scalar]);
const solidOperation = Type.Union([Type.Literal('new'), Type.Literal('join'), Type.Literal('cut')]);
const base = { id: identifier, name: label, suppressed: Type.Boolean() };
export const CadProfileSchema = Type.Union([
  Type.Object({ kind: Type.Literal('rectangle'), x: scalar, y: scalar, width: scalar, height: scalar, cornerRadius: scalar }, strict),
  Type.Object({ kind: Type.Literal('circle'), x: scalar, y: scalar, radius: scalar }, strict),
  Type.Object({ kind: Type.Literal('polygon'), points: Type.Array(point2, { minItems: 3, maxItems: 2048 }) }, strict),
  Type.Object({ kind: Type.Literal('slot'), x: scalar, y: scalar, length: scalar, width: scalar, angle: scalar }, strict)
]);
export const CadFeatureSchema = Type.Union([
  Type.Object({ ...base, kind: Type.Literal('sketch'), plane, offset: scalar, profiles: Type.Array(Type.Object({ id: identifier, name: label, construction: Type.Boolean(), role: Type.Union([Type.Literal('outer'), Type.Literal('hole')]), geometry: CadProfileSchema }, strict), { maxItems: 256 }) }, strict),
  Type.Object({ ...base, kind: Type.Literal('extrude'), sketchId: identifier, distance: scalar, symmetric: Type.Boolean(), operation: solidOperation, targetId: Type.Union([identifier, Type.Null()]) }, strict),
  Type.Object({ ...base, kind: Type.Literal('revolve'), sketchId: identifier, angle: scalar, axis: Type.Union([Type.Literal('x'), Type.Literal('y')]), operation: solidOperation, targetId: Type.Union([identifier, Type.Null()]) }, strict),
  Type.Object({ ...base, kind: Type.Union([Type.Literal('fillet'), Type.Literal('chamfer')]), targetId: identifier, radius: scalar }, strict),
  Type.Object({ ...base, kind: Type.Literal('boolean'), targetId: identifier, toolId: identifier, operation: Type.Union([Type.Literal('union'), Type.Literal('cut'), Type.Literal('intersect')]) }, strict),
  Type.Object({ ...base, kind: Type.Literal('transform'), sourceId: identifier, translation: point3, rotation: point3 }, strict),
  Type.Object({ ...base, kind: Type.Literal('linear-pattern'), sourceId: identifier, count: Type.Integer({ minimum: 2, maximum: 100 }), spacing: point3 }, strict),
  Type.Object({ ...base, kind: Type.Literal('mirror'), sourceId: identifier, plane }, strict)
]);
export const CadDocumentSchema = Type.Object({
  format: Type.Literal('wireedm-cad'), schemaVersion: Type.Literal(1),
  id: Type.String({ pattern: '^[a-z0-9][a-z0-9_-]{0,95}$' }), name: label, units: Type.Literal('mm'),
  parameters: Type.Record(Type.String({ pattern: '^[A-Za-z_][A-Za-z0-9_]{0,63}$' }), number, { maxProperties: 128, additionalProperties: false }),
  features: Type.Array(CadFeatureSchema, { maxItems: 256 })
}, strict);

export function cadFeatureDependencies(feature: CadFeature): string[] {
  switch (feature.kind) {
    case 'sketch': return [];
    case 'extrude': case 'revolve': return feature.targetId === null ? [feature.sketchId] : [feature.sketchId, feature.targetId];
    case 'fillet': case 'chamfer': return [feature.targetId];
    case 'boolean': return [feature.targetId, feature.toolId];
    case 'transform': case 'linear-pattern': case 'mirror': return [feature.sourceId];
    default: { const exhaustive: never = feature; return exhaustive; }
  }
}
/** Successful active operations replace these history bodies; mirrors preserve their source. */
export function cadConsumedBodyIds(feature: CadFeature): readonly string[] {
  if (feature.suppressed) return [];
  switch (feature.kind) {
    case 'sketch': case 'mirror': return [];
    case 'extrude': case 'revolve': return feature.targetId === null ? [] : [feature.targetId];
    case 'fillet': case 'chamfer': return [feature.targetId];
    case 'boolean': return [feature.targetId, feature.toolId];
    case 'transform': case 'linear-pattern': return [feature.sourceId];
    default: { const exhaustive: never = feature; return exhaustive; }
  }
}
export function cadVisibleBodyIds(features: readonly CadFeature[]): readonly string[] {
  const visible = new Set<string>();
  for (const feature of features) {
    cadConsumedBodyIds(feature).forEach(id => visible.delete(id));
    if (feature.kind !== 'sketch' && !feature.suppressed) visible.add(feature.id);
  }
  return [...visible];
}

/** Strict boundary parser. Never rewrites IDs, geometry, units or saved expressions. */
export function parseCadDocument(value: unknown): CadDocument {
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
  if (/^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/.test(document.id)) throw new CadError('invalid-document-id', 'Document ID is a reserved filesystem name.');
  for (const name of Object.keys(document.parameters)) {
    if (['__proto__', 'prototype', 'constructor'].includes(name)) throw new CadError('invalid-parameter', `Parameter name "${name}" is reserved.`);
  }
  const previous = new Map<string, CadFeature>();
  const visibleBodies = new Set<string>();
  const expandedInstances = new Map<string, number>();
  let geometryBudget = 0;
  let instanceBudget = 0;
  const e = (value: number | string) => evaluateCadScalar(value, document.parameters);
  for (const feature of document.features) {
    if (previous.has(feature.id)) throw new CadError('duplicate-id', `Duplicate feature ID "${feature.id}".`);
    for (const id of cadFeatureDependencies(feature)) {
      const referenced = previous.get(id);
      if (!referenced) throw new CadError('invalid-reference', `Feature "${feature.name}" references missing or later feature "${id}".`);
      if (id !== ('sketchId' in feature ? feature.sketchId : null) && referenced.kind === 'sketch') throw new CadError('invalid-reference', 'A solid operation cannot target a sketch.');
    }
    const solidDependencies = feature.kind === 'extrude' || feature.kind === 'revolve'
      ? feature.targetId === null ? [] : [feature.targetId]
      : cadFeatureDependencies(feature);
    if (!feature.suppressed) for (const id of solidDependencies) {
      if (!visibleBodies.has(id)) throw new CadError('unavailable-body', `Feature "${feature.name}" references suppressed or already consumed body "${id}". Select its current successor.`);
    }
    let instances = solidDependencies.reduce((total, id) => total + (expandedInstances.get(id) ?? 1), 0) || 1;
    if (feature.kind === 'linear-pattern') instances *= feature.count;
    if (instances > 1000) throw new CadError('feature-limit', 'Nested pattern expansion exceeds 1000 solid instances.');
    switch (feature.kind) {
      case 'sketch': {
        e(feature.offset);
        const ids = new Set<string>();
        for (const profile of feature.profiles) {
          if (ids.has(profile.id)) throw new CadError('duplicate-id', `Duplicate profile ID "${profile.id}" in sketch "${feature.name}".`);
          ids.add(profile.id);
          geometryBudget += profile.geometry.kind === 'polygon' ? profile.geometry.points.length : 8;
        }
        if (geometryBudget > 8192) throw new CadError('geometry-limit', 'Document contains too many sketch edges.');
        validateCadSketchGeometry(feature, document.parameters);
        break;
      }
      case 'extrude': case 'revolve': {
        const sketch = previous.get(feature.sketchId);
        if (sketch?.kind !== 'sketch') throw new CadError('invalid-reference', `Feature "${feature.name}" needs a preceding sketch.`);
        if (feature.operation === 'new' && feature.targetId !== null || feature.operation !== 'new' && feature.targetId === null) throw new CadError('invalid-operation', 'New bodies have no target; join and cut require a target body.');
        if (!feature.suppressed && (sketch.suppressed || !sketch.profiles.some(profile => !profile.construction))) throw new CadError('empty-sketch', `Feature "${feature.name}" needs an active nonempty sketch.`);
        if (feature.kind === 'extrude') {
          const distance = e(feature.distance);
          if (Math.abs(distance) <= 1e-7 || Math.abs(distance) > 1e6) throw new CadError('invalid-dimension', 'Extrusion distance must be nonzero and within one million millimetres.');
        } else {
          const angle = e(feature.angle);
          if (angle <= 1e-7 || angle > 360) throw new CadError('invalid-dimension', 'Revolve angle must be greater than zero and at most 360 degrees.');
        }
        break;
      }
      case 'fillet': case 'chamfer': if (e(feature.radius) <= 1e-7 || e(feature.radius) > 1e6) throw new CadError('invalid-dimension', 'Edge radius must be positive and within one million millimetres.'); break;
      case 'boolean': if (feature.targetId === feature.toolId) throw new CadError('invalid-operation', 'Boolean target and tool must be different bodies.'); break;
      case 'transform': feature.translation.forEach(e); feature.rotation.forEach(e); break;
      case 'linear-pattern': {
        const spacing = feature.spacing.map(e);
        if (spacing.every(value => Math.abs(value) <= 1e-7)) throw new CadError('invalid-dimension', 'Pattern spacing must be nonzero.');
        instanceBudget += feature.count;
        if (instanceBudget > 1000) throw new CadError('feature-limit', 'Document has too many pattern instances.');
        break;
      }
      case 'mirror': break;
      default: { const exhaustive: never = feature; throw exhaustive; }
    }
    previous.set(feature.id, feature);
    expandedInstances.set(feature.id, instances);
    cadConsumedBodyIds(feature).forEach(id => visibleBodies.delete(id));
    if (feature.kind !== 'sketch' && !feature.suppressed) visibleBodies.add(feature.id);
  }
  // Detach from callers, then freeze the complete history so neither a caller's
  // edit payload nor a UI/tool snapshot can mutate an accepted revision later.
  function freeze(value: unknown): void {
    if (value === null || typeof value !== 'object') return;
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  freeze(document);
  return document;
}

export function createCadDocument(name = 'Untitled part', id = `cad_${crypto.randomUUID()}`): CadDocument {
  return parseCadDocument({ format: 'wireedm-cad', schemaVersion: 1, id, name, units: 'mm', parameters: {}, features: [] });
}

export function validateCadDocument(document: CadDocument): readonly CadDiagnostic[] {
  try { parseCadDocument(document); return []; }
  catch (error) { if (error instanceof CadError) return [{ code: error.code, message: error.message }]; throw error; }
}
