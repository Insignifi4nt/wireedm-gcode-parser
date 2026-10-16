import { Type, type Static } from '@sinclair/typebox';
import type { CadDocument, CadFeature, CadPathSegment, CadPoint2, CadPoint3, CadProfile, CadScalar } from './cadDocument';
import type { CadEdgePredicate, CadFacePredicate } from './cadTopology';
import { CadError } from './cadError';
import { cadFeatureDependencies } from './cadFeatureInputs';
import { evaluateCadScalar } from './cadExpression';
import { createCadPluginProfile, inspectCadPluginProfile, type CadPluginPackage } from './plugins/cadPlugins';
import type { CadSketchGraph } from './cadSketchGraph';

const strict = { additionalProperties: false };
export const CadParameterNameSchema = Type.String({ pattern: '^[A-Za-z_][A-Za-z0-9_]{0,63}$' });
const id = Type.String({ pattern: '^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$' });
export const CadParameterGroupSchema = Type.Object({ id, name: Type.String({ minLength: 1, maxLength: 160, pattern: '\\S' }) }, strict);
export const CadParameterSourceSchema = Type.Union([
  Type.Object({ kind: Type.Literal('manual') }, strict),
  Type.Object({ kind: Type.Literal('plugin'), featureId: id, profileId: id, inputName: CadParameterNameSchema,
    packageId: Type.String({ pattern: '^[a-z][a-z0-9.-]{0,79}$' }), packageVersion: Type.String({ pattern: '^\\d+\\.\\d+\\.\\d+$', maxLength: 32 }) }, strict)
]);
export const CadParameterMetadataSchema = Type.Object({ groupId: Type.Optional(id), source: CadParameterSourceSchema }, strict);
export type CadParameterGroup = Static<typeof CadParameterGroupSchema>;
export type CadParameterSource = Static<typeof CadParameterSourceSchema>;
export type CadParameterMetadata = Static<typeof CadParameterMetadataSchema>;

export function validateCadParameterMetadata(document: CadDocument) {
  const ids = new Set<string>(), names = new Set<string>();
  for (const group of document.parameterGroups ?? []) {
    if (ids.has(group.id) || names.has(group.name.trim().toLocaleLowerCase('en'))) throw new CadError('duplicate-parameter-group', 'Parameter group IDs and names must be unique.');
    ids.add(group.id); names.add(group.name.trim().toLocaleLowerCase('en'));
  }
  for (const [name, metadata] of Object.entries(document.parameterMetadata ?? {})) {
    if (!Object.hasOwn(document.parameters, name)) throw new CadError('invalid-parameter-metadata', `Parameter metadata refers to missing parameter "${name}".`);
    if (metadata.groupId !== undefined && !ids.has(metadata.groupId)) throw new CadError('missing-parameter-group', `Parameter "${name}" refers to a missing group.`);
    // Source is historical provenance. Deleting its original profile must not
    // delete shared dimensions or invalidate a document that still uses them.
  }
}

/** Tokens match the scalar parser, including scientific notation as one token. */
export function cadScalarParameterNames(value: CadScalar): readonly string[] {
  if (typeof value === 'number') return [];
  return [...new Set((value.match(/(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|[A-Za-z_][A-Za-z_0-9]*|[^\s]/g) ?? []).filter(token => /^[A-Za-z_][A-Za-z_0-9]*$/.test(token)))];
}
type ScalarMapper = (value: CadScalar, path: string) => CadScalar;
function point2(point: CadPoint2, path: string, map: ScalarMapper): CadPoint2 { return [map(point[0], `${path}.0`), map(point[1], `${path}.1`)]; }
function point3(point: CadPoint3, path: string, map: ScalarMapper): CadPoint3 { return [map(point[0], `${path}.0`), map(point[1], `${path}.1`), map(point[2], `${path}.2`)]; }
function graphScalars(graph: CadSketchGraph, map: ScalarMapper): CadSketchGraph {
  return { ...graph,
    points: graph.points.map((point, index) => ({ ...point, position: point2(point.position, `graph.points.${index}.position`, map) })),
    entities: graph.entities.map((entity, index) => entity.kind === 'circle' ? { ...entity, radius: map(entity.radius, `graph.entities.${index}.radius`) } : entity),
    relations: graph.relations.map((relation, index) => relation.kind === 'fixed-point' ? { ...relation, position: point2(relation.position, `graph.relations.${index}.position`, map) }
      : relation.kind === 'fixed-axis' || relation.kind === 'distance' ? { ...relation, value: map(relation.value, `graph.relations.${index}.value`) } : relation)
  };
}
function segment(segment: CadPathSegment, path: string, map: ScalarMapper): CadPathSegment {
  return segment.kind === 'line' ? { ...segment, start: point2(segment.start, `${path}.start`, map), end: point2(segment.end, `${path}.end`, map) }
    : { ...segment, center: point2(segment.center, `${path}.center`, map), radius: map(segment.radius, `${path}.radius`), startAngle: map(segment.startAngle, `${path}.startAngle`), sweep: map(segment.sweep, `${path}.sweep`) };
}
function profileScalars(profile: CadProfile, path: string, map: ScalarMapper): CadProfile {
  const scalar = (value: CadScalar, key: string) => map(value, `${path}.${key}`);
  switch (profile.kind) {
    case 'plugin': return { ...profile, inputs: Object.fromEntries(Object.entries(profile.inputs).map(([name, value]) => [name, scalar(value, `inputs.${name}`)])) };
    case 'rectangle': return { ...profile, x: scalar(profile.x, 'x'), y: scalar(profile.y, 'y'), width: scalar(profile.width, 'width'), height: scalar(profile.height, 'height'), cornerRadius: scalar(profile.cornerRadius, 'cornerRadius') };
    case 'circle': return { ...profile, x: scalar(profile.x, 'x'), y: scalar(profile.y, 'y'), radius: scalar(profile.radius, 'radius') };
    case 'slot': return { ...profile, x: scalar(profile.x, 'x'), y: scalar(profile.y, 'y'), length: scalar(profile.length, 'length'), width: scalar(profile.width, 'width'), angle: scalar(profile.angle, 'angle') };
    case 'polygon': return { ...profile, points: profile.points.map((point, index) => point2(point, `${path}.points.${index}`, map)) };
    case 'path': return { ...profile, segments: profile.segments.map((entry, index) => segment(entry, `${path}.segments.${index}`, map)) };
    default: { const exhaustive: never = profile; return exhaustive; }
  }
}
function edgePredicate(predicate: CadEdgePredicate, path: string, map: ScalarMapper): CadEdgePredicate {
  switch (predicate.kind) {
    case 'length': return { ...predicate, value: map(predicate.value, `${path}.value`) };
    case 'on-plane': return { ...predicate, offset: map(predicate.offset, `${path}.offset`) };
    case 'line-endpoints': return { ...predicate, start: point3(predicate.start, `${path}.start`, map), end: point3(predicate.end, `${path}.end`, map) };
    case 'arc-points': return { ...predicate, start: point3(predicate.start, `${path}.start`, map), end: point3(predicate.end, `${path}.end`, map), midpoint: point3(predicate.midpoint, `${path}.midpoint`, map) };
    case 'circle': return { ...predicate, center: point3(predicate.center, `${path}.center`, map), radius: map(predicate.radius, `${path}.radius`) };
    case 'parallel': case 'curve-type': return predicate;
    default: { const exhaustive: never = predicate; return exhaustive; }
  }
}
function facePredicate(predicate: CadFacePredicate, path: string, map: ScalarMapper): CadFacePredicate {
  switch (predicate.kind) {
    case 'plane': return { ...predicate, offset: map(predicate.offset, `${path}.offset`) };
    case 'centroid': return { ...predicate, point: point3(predicate.point, `${path}.point`, map) };
    case 'cylinder': return { ...predicate, origin: point3(predicate.origin, `${path}.origin`, map), radius: map(predicate.radius, `${path}.radius`) };
    case 'area': case 'surface-type': return predicate;
    default: { const exhaustive: never = predicate; return exhaustive; }
  }
}

/** Visit only dimension-bearing fields; source text, IDs and pinned packages stay exact. */
export function mapCadFeatureScalars(feature: CadFeature, map: ScalarMapper): CadFeature {
  switch (feature.kind) {
    case 'datum-plane': return { ...feature, definition: { ...feature.definition, origin: point3(feature.definition.origin, 'definition.origin', map), rotation: point3(feature.definition.rotation, 'definition.rotation', map) } };
    case 'sketch': return { ...feature, offset: map(feature.offset, 'offset'), profiles: feature.profiles.map((profile, index) => ({ ...profile, geometry: profileScalars(profile.geometry, `profiles.${index}.geometry`, map) })), ...(feature.graph ? { graph: graphScalars(feature.graph, map) } : {}) };
    case 'curve': return { ...feature, offset: map(feature.offset, 'offset'), segments: feature.segments.map((entry, index) => segment(entry, `segments.${index}`, map)) };
    case 'extrude': return { ...feature, distance: map(feature.distance, 'distance') };
    case 'revolve': return { ...feature, angle: map(feature.angle, 'angle') };
    case 'fillet': case 'chamfer': return { ...feature, radius: map(feature.radius, 'radius'), ...(feature.selection ? { selection: { ...feature.selection, queries: feature.selection.queries.map((query, index) => ({ ...query,
      predicates: query.predicates.map((predicate, predicateIndex) => edgePredicate(predicate, `selection.queries.${index}.predicates.${predicateIndex}`, map)) })) } } : {}) };
    case 'shell': return { ...feature, thickness: map(feature.thickness, 'thickness'), opening: { ...feature.opening, predicates: feature.opening.predicates.map((predicate, index) => facePredicate(predicate, `opening.predicates.${index}`, map)) } };
    case 'transform': return { ...feature, translation: point3(feature.translation, 'translation', map), rotation: point3(feature.rotation, 'rotation', map) };
    case 'linear-pattern': return { ...feature, spacing: point3(feature.spacing, 'spacing', map) };
    case 'circular-pattern': return { ...feature, center: point3(feature.center, 'center', map), angle: map(feature.angle, 'angle') };
    case 'imported': case 'loft': case 'sweep': case 'pocket': case 'boolean': case 'mirror': return feature;
    default: { const exhaustive: never = feature; return exhaustive; }
  }
}

export function renameCadScalarParameter(value: CadScalar, name: string, newName: string): CadScalar {
  return typeof value === 'number' ? value : value.replace(/(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|[A-Za-z_][A-Za-z_0-9]*/g, token => token === name ? newName : token);
}

export interface CadParameterUsage {
  readonly featureId: string; readonly featureName: string; readonly profileId?: string; readonly inputName?: string;
  readonly path: string; readonly expression: string; readonly active: boolean; readonly reason?: string;
}
export interface CadPluginInputBinding {
  readonly featureId: string; readonly featureName: string; readonly profileId: string; readonly profileName: string;
  readonly inputName: string; readonly label: string; readonly expression: CadScalar; readonly value: number; readonly appliedValue: number;
  readonly parameterNames: readonly string[]; readonly linked: boolean; readonly effective: boolean; readonly editable: boolean;
}

/** Current expression links and downstream history; reads never attach metadata. */
export function inspectCadParameters(document: CadDocument) {
  const usages = new Map<string, CadParameterUsage[]>(Object.keys(document.parameters).map(name => [name, []]));
  const pluginInputs: CadPluginInputBinding[] = [];
  for (const feature of document.features) {
    if (feature.kind === 'sketch') for (const profile of feature.profiles) if (profile.geometry.kind === 'plugin') {
      const inspection = inspectCadPluginProfile(profile.geometry, document.parameters);
      for (const input of profile.geometry.package.inputs) {
        const field = inspection.fields.find(field => field.name === input.name), expression = profile.geometry.inputs[input.name];
        const parameterNames = cadScalarParameterNames(expression).filter(name => Object.hasOwn(document.parameters, name));
        // A conditional editing lock does not discard a generic recipe's stored
        // value. Only the built-in gear explicitly replaces these inputs in its
        // automatic modes; generic recipes still evaluate their pinned inputs.
        const generated = profile.geometry.package.generator.kind === 'builtin' && ['wireedm.spur-gear.v2', 'wireedm.spur-gear.v3'].includes(profile.geometry.package.generator.implementation);
        const automatic = generated && (input.name === 'profileShift' && inspection.values.shiftMode === 0
          || input.name === 'tolerance' && inspection.values.qualityMode === 0 || input.name === 'cutterTipRadius' && inspection.values.cutterTipMode === 0);
        const appliedValue = automatic ? inspection.values[input.name === 'profileShift' ? 'effectiveShift' : input.name === 'tolerance' ? 'effectiveTolerance' : 'effectiveCutterTipRadius'] : inspection.values[input.name];
        pluginInputs.push({ featureId: feature.id, featureName: feature.name, profileId: profile.id, profileName: profile.name,
          inputName: input.name, label: input.label, expression, value: inspection.values[input.name], appliedValue, parameterNames,
          linked: parameterNames.length > 0, effective: !feature.suppressed && !automatic, editable: field?.enabled !== false });
      }
    }
    mapCadFeatureScalars(feature, (value, path) => {
      if (typeof value !== 'string') return value;
      const match = feature.kind === 'sketch' ? /^profiles\.(\d+)\.geometry(?:\.inputs\.([A-Za-z_][A-Za-z_0-9]*))?/.exec(path) : null;
      const profile = match && feature.kind === 'sketch' ? feature.profiles[Number(match[1])] : undefined;
      const binding = match?.[2] ? pluginInputs.find(binding => binding.featureId === feature.id && binding.profileId === profile?.id && binding.inputName === match[2]) : undefined;
      const active = !feature.suppressed && binding?.effective !== false;
      for (const name of cadScalarParameterNames(value)) usages.get(name)?.push({ featureId: feature.id, featureName: feature.name,
        ...(profile ? { profileId: profile.id } : {}), ...(binding ? { inputName: binding.inputName } : {}), path, expression: value, active,
        ...(!active ? { reason: feature.suppressed ? 'Feature is suppressed.' : 'Input is controlled automatically; the stored expression is inactive.' } : {}) });
      return value;
    });
  }
  return { groups: document.parameterGroups ?? [], pluginInputs, parameters: Object.entries(document.parameters).map(([name, value]) => {
    const references = usages.get(name) ?? [], directlyUsed = new Set(references.filter(usage => usage.active).map(usage => usage.featureId));
    const affected = new Set(directlyUsed);
    for (const feature of document.features) if (!feature.suppressed && cadFeatureDependencies(feature).some(id => affected.has(id))) affected.add(feature.id);
    return { name, value, groupId: document.parameterMetadata?.[name]?.groupId ?? null,
      source: document.parameterMetadata?.[name]?.source ?? { kind: 'manual' satisfies CadParameterSource['kind'] },
      usages: references, downstreamFeatureIds: [...affected].filter(id => !directlyUsed.has(id)),
      pluginBindings: pluginInputs.filter(binding => binding.parameterNames.includes(name)) };
  }) };
}

/** New plugin instances get new dimensions, never similarly named existing values. */
export function addCadPluginProfile(document: CadDocument, input: { sketchId: string; profileId: string; name: string; package: CadPluginPackage; groupId: string }): CadDocument {
  const sketch = document.features.find(feature => feature.id === input.sketchId);
  if (sketch?.kind !== 'sketch') throw new CadError('missing-sketch', 'Choose an existing sketch for the plugin profile.');
  if (document.features.some(feature => feature.id === input.profileId || feature.kind === 'sketch' && feature.profiles.some(profile => profile.id === input.profileId))) throw new CadError('duplicate-id', 'Plugin profile ID already exists.');
  if (document.parameterGroups?.some(group => group.id === input.groupId)) throw new CadError('duplicate-parameter-group', 'New plugin parameter group ID already exists.');
  const geometry = createCadPluginProfile(input.package), inspected = inspectCadPluginProfile(geometry, document.parameters);
  const parameters = { ...document.parameters }, metadata = { ...document.parameterMetadata };
  let groupName = input.name.trim(), suffix = 2;
  const existingNames = new Set(document.parameterGroups?.map(group => group.name.trim().toLocaleLowerCase('en')));
  while (existingNames.has(groupName.toLocaleLowerCase('en'))) groupName = `${input.name.trim().slice(0, 150)} ${suffix++}`;
  const scope = groupName.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 28) || 'plugin';
  const prefix = `p_${scope}`;
  for (const field of inspected.fields) {
    if (!field.enabled || field.group === 'placement' || field.choices || geometry.package.generator.kind === 'builtin' && ['x', 'y', 'angle'].includes(field.name)) continue;
    const base = `${prefix}_${field.name}`.slice(0, 60);
    let name = base, suffix = 2;
    while (Object.hasOwn(parameters, name)) name = `${base.slice(0, 58)}_${suffix++}`;
    const value = evaluateCadScalar(geometry.inputs[field.name], document.parameters);
    parameters[name] = value; geometry.inputs[field.name] = name;
    metadata[name] = { groupId: input.groupId, source: { kind: 'plugin', featureId: sketch.id, profileId: input.profileId,
      inputName: field.name, packageId: geometry.package.id, packageVersion: geometry.package.version } };
  }
  const updated = { ...sketch, profiles: [...sketch.profiles, { id: input.profileId, name: input.name, construction: false, geometry }] };
  return { ...document, parameters, parameterMetadata: metadata, parameterGroups: [...document.parameterGroups ?? [], { id: input.groupId, name: groupName }],
    features: document.features.map(feature => feature.id === sketch.id ? updated : feature) };
}
