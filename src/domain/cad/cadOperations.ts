import { Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import type { CadDocument, CadFeature, CadPoint2, CadScalar } from './cadDocument';
import { CadError } from './cadError';
import { CadFeatureSchema, cadFeatureDependencies, parseCadDocument } from './cadSchema';
import { isCadImportData } from './cadImportData';
import { CadPluginPackageSchema, type CadPluginPackage } from './plugins/cadPlugins';
import { addCadPluginProfile, CadParameterGroupSchema, mapCadFeatureScalars, renameCadScalarParameter, type CadParameterGroup } from './cadParameters';
import { addCadSketchDimension, cadSketchDimensionScalar, CadSketchDimensionConstraintSchema, isCadSketchExpressionDriven, removeCadSketchDimension, setCadSketchDimensionValue, translateCadSketchProfile, type CadSketchDimensionConstraint } from './cadSketchConstraints';
import { CadPoint2Schema, CadScalarSchema } from './cadPrimitives';
import { evaluateCadScalar } from './cadExpression';

export type CadEdit =
  | { readonly kind: 'add-feature'; readonly feature: CadFeature; readonly beforeId?: string }
  | { readonly kind: 'update-feature'; readonly feature: CadFeature }
  | { readonly kind: 'delete-feature'; readonly featureId: string; readonly cascade: boolean }
  | { readonly kind: 'move-feature'; readonly featureId: string; readonly beforeId: string | null }
  | { readonly kind: 'set-parameter'; readonly name: string; readonly value: number }
  | { readonly kind: 'remove-parameter'; readonly name: string }
  | { readonly kind: 'rename-parameter'; readonly name: string; readonly newName: string }
  | { readonly kind: 'set-parameter-group'; readonly group: CadParameterGroup }
  | { readonly kind: 'remove-parameter-group'; readonly groupId: string }
  | { readonly kind: 'move-parameter'; readonly name: string; readonly groupId: string | null }
  | { readonly kind: 'add-plugin-profile'; readonly sketchId: string; readonly profileId: string; readonly name: string; readonly package: CadPluginPackage; readonly groupId: string }
  | { readonly kind: 'add-sketch-dimension'; readonly sketchId: string; readonly profileId: string; readonly constraint: CadSketchDimensionConstraint }
  | { readonly kind: 'set-sketch-dimension'; readonly sketchId: string; readonly profileId: string; readonly dimensionId: string; readonly value: CadScalar }
  | { readonly kind: 'remove-sketch-dimension'; readonly sketchId: string; readonly profileId: string; readonly dimensionId: string }
  | { readonly kind: 'translate-sketch-profiles'; readonly sketchId: string; readonly profileIds: readonly string[]; readonly translation: CadPoint2 }
  | { readonly kind: 'rename-document'; readonly name: string };

const identifier = Type.String({ pattern: '^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$' });
const parameterName = Type.String({ pattern: '^[A-Za-z_][A-Za-z0-9_]{0,63}$' });
const strict = { additionalProperties: false };
export const CadEditSchema = Type.Union([
  Type.Object({ kind: Type.Literal('add-feature'), feature: CadFeatureSchema, beforeId: Type.Optional(identifier) }, strict),
  Type.Object({ kind: Type.Literal('update-feature'), feature: CadFeatureSchema }, strict),
  Type.Object({ kind: Type.Literal('delete-feature'), featureId: identifier, cascade: Type.Boolean() }, strict),
  Type.Object({ kind: Type.Literal('move-feature'), featureId: identifier, beforeId: Type.Union([identifier, Type.Null()]) }, strict),
  Type.Object({ kind: Type.Literal('set-parameter'), name: parameterName, value: Type.Number({ minimum: -1e9, maximum: 1e9 }) }, strict),
  Type.Object({ kind: Type.Literal('remove-parameter'), name: parameterName }, strict),
  Type.Object({ kind: Type.Literal('rename-parameter'), name: parameterName, newName: parameterName }, strict),
  Type.Object({ kind: Type.Literal('set-parameter-group'), group: CadParameterGroupSchema }, strict),
  Type.Object({ kind: Type.Literal('remove-parameter-group'), groupId: identifier }, strict),
  Type.Object({ kind: Type.Literal('move-parameter'), name: parameterName, groupId: Type.Union([identifier, Type.Null()]) }, strict),
  Type.Object({ kind: Type.Literal('add-plugin-profile'), sketchId: identifier, profileId: identifier, name: Type.String({ minLength: 1, maxLength: 160, pattern: '\\S' }), package: CadPluginPackageSchema, groupId: identifier }, strict),
  Type.Object({ kind: Type.Literal('add-sketch-dimension'), sketchId: identifier, profileId: identifier, constraint: CadSketchDimensionConstraintSchema }, strict),
  Type.Object({ kind: Type.Literal('set-sketch-dimension'), sketchId: identifier, profileId: identifier, dimensionId: identifier, value: CadScalarSchema }, strict),
  Type.Object({ kind: Type.Literal('remove-sketch-dimension'), sketchId: identifier, profileId: identifier, dimensionId: identifier }, strict),
  Type.Object({ kind: Type.Literal('translate-sketch-profiles'), sketchId: identifier, profileIds: Type.Array(identifier, { minItems: 1, maxItems: 256, uniqueItems: true }), translation: CadPoint2Schema }, strict),
  Type.Object({ kind: Type.Literal('rename-document'), name: Type.String({ minLength: 1, maxLength: 160, pattern: '\\S' }) }, strict)
]);

/** Validates the complete final document once; a failed batch never mutates the input. */
export function applyCadEdits(document: CadDocument, edits: readonly CadEdit[]): CadDocument {
  if (!isCadImportData(edits) || !Array.isArray(edits)) throw new CadError('invalid-edit', 'CAD edits must contain their own complete JSON data fields.');
  if (edits.length > 256) throw new CadError('edit-limit', 'An edit batch may contain at most 256 edits.');
  let features = [...document.features];
  let parameters = { ...document.parameters };
  let parameterGroups = document.parameterGroups ? [...document.parameterGroups] : undefined;
  let parameterMetadata = document.parameterMetadata ? { ...document.parameterMetadata } : undefined;
  let name = document.name;
  const indexOf = (id: string) => {
    const index = features.findIndex(feature => feature.id === id);
    if (index < 0) throw new CadError('missing-feature', `Feature "${id}" does not exist.`);
    return index;
  };
  for (const edit of edits) {
    if (!Value.Check(CadEditSchema, edit)) throw new CadError('invalid-edit', 'Malformed CAD edit.');
    switch (edit.kind) {
      case 'add-feature': {
        if (features.some(feature => feature.id === edit.feature.id)) throw new CadError('duplicate-id', `Feature "${edit.feature.id}" already exists.`);
        const index = edit.beforeId === undefined ? features.length : indexOf(edit.beforeId);
        features.splice(index, 0, edit.feature); break;
      }
      case 'update-feature': features[indexOf(edit.feature.id)] = edit.feature; break;
      case 'delete-feature': {
        indexOf(edit.featureId);
        const deleted = new Set([edit.featureId]);
        let changed = true;
        while (changed) {
          changed = false;
          for (const feature of features) if (!deleted.has(feature.id) && cadFeatureDependencies(feature).some(id => deleted.has(id))) {
            if (!edit.cascade) throw new CadError('dependent-feature', `Feature "${feature.name}" depends on the feature being deleted. Use explicit cascade deletion.`);
            deleted.add(feature.id); changed = true;
          }
        }
        features = features.filter(feature => !deleted.has(feature.id)); break;
      }
      case 'move-feature': {
        const previousIndex = indexOf(edit.featureId);
        if (edit.beforeId === edit.featureId) break;
        const [feature] = features.splice(previousIndex, 1);
        const index = edit.beforeId === null ? features.length : indexOf(edit.beforeId);
        features.splice(index, 0, feature); break;
      }
      case 'set-parameter':
        if (['__proto__', 'prototype', 'constructor'].includes(edit.name)) throw new CadError('invalid-parameter', `Parameter name "${edit.name}" is reserved.`);
        if (!Object.hasOwn(parameters, edit.name)) parameterMetadata = { ...parameterMetadata, [edit.name]: { source: { kind: 'manual' } } };
        parameters[edit.name] = edit.value; break;
      case 'remove-parameter': {
        if (!Object.hasOwn(parameters, edit.name)) throw new CadError('unknown-parameter', `Parameter "${edit.name}" does not exist.`);
        delete parameters[edit.name]; if (parameterMetadata) delete parameterMetadata[edit.name]; break;
      }
      case 'rename-parameter': {
        if (!Object.hasOwn(parameters, edit.name)) throw new CadError('unknown-parameter', `Parameter "${edit.name}" does not exist.`);
        if (edit.name === edit.newName) break;
        if (Object.hasOwn(parameters, edit.newName)) throw new CadError('duplicate-parameter', `Parameter "${edit.newName}" already exists.`);
        if (['__proto__', 'prototype', 'constructor'].includes(edit.newName)) throw new CadError('invalid-parameter', 'The new parameter name is reserved.');
        parameters[edit.newName] = parameters[edit.name]; delete parameters[edit.name];
        if (parameterMetadata?.[edit.name]) { parameterMetadata[edit.newName] = parameterMetadata[edit.name]; delete parameterMetadata[edit.name]; }
        features = features.map(feature => mapCadFeatureScalars(feature, value => renameCadScalarParameter(value, edit.name, edit.newName)));
        break;
      }
      case 'set-parameter-group': {
        parameterGroups ??= [];
        const index = parameterGroups.findIndex(group => group.id === edit.group.id);
        if (index === -1) parameterGroups.push(edit.group); else parameterGroups[index] = edit.group;
        break;
      }
      case 'remove-parameter-group': {
        if (!parameterGroups?.some(group => group.id === edit.groupId)) throw new CadError('missing-parameter-group', 'Parameter group does not exist.');
        parameterGroups = parameterGroups.filter(group => group.id !== edit.groupId);
        if (parameterMetadata) for (const [name, metadata] of Object.entries(parameterMetadata)) if (metadata.groupId === edit.groupId) parameterMetadata[name] = { source: metadata.source };
        break;
      }
      case 'move-parameter': {
        if (!Object.hasOwn(parameters, edit.name)) throw new CadError('unknown-parameter', 'Parameter does not exist.');
        if (edit.groupId !== null && !parameterGroups?.some(group => group.id === edit.groupId)) throw new CadError('missing-parameter-group', 'Parameter group does not exist.');
        parameterMetadata = { ...parameterMetadata, [edit.name]: { source: parameterMetadata?.[edit.name]?.source ?? { kind: 'manual' }, ...(edit.groupId !== null ? { groupId: edit.groupId } : {}) } };
        break;
      }
      case 'add-plugin-profile': {
        const result = addCadPluginProfile({ ...document, parameters, features, ...(parameterGroups ? { parameterGroups } : {}), ...(parameterMetadata ? { parameterMetadata } : {}) }, edit);
        parameters = { ...result.parameters }; features = [...result.features];
        parameterGroups = [...result.parameterGroups ?? []]; parameterMetadata = { ...result.parameterMetadata };
        break;
      }
      case 'rename-document': name = edit.name; break;
      case 'add-sketch-dimension': case 'set-sketch-dimension': case 'remove-sketch-dimension': {
        const index = indexOf(edit.sketchId), feature = features[index];
        if (feature.kind !== 'sketch') throw new CadError('missing-sketch', 'Choose an existing sketch for the dimension.');
        if (!feature.profiles.some(profile => profile.id === edit.profileId)) throw new CadError('missing-profile', 'The selected sketch contour no longer exists.');
        features[index] = { ...feature, profiles: feature.profiles.map(profile => {
          if (profile.id !== edit.profileId) return profile;
          if (edit.kind === 'add-sketch-dimension') return addCadSketchDimension({ profile, constraint: edit.constraint });
          if (edit.kind === 'remove-sketch-dimension') return removeCadSketchDimension({ profile, dimensionId: edit.dimensionId });
          const constraint = profile.constraints?.find(constraint => constraint.id === edit.dimensionId);
          if (!constraint) throw new CadError('missing-sketch-dimension', 'The selected sketch dimension no longer exists.');
          const scalar = cadSketchDimensionScalar(profile, constraint.quantity);
          if (typeof scalar === 'string' && isCadSketchExpressionDriven(scalar)) {
            const name = scalar.trim();
            if (!Object.hasOwn(parameters, name)) throw new CadError('driven-sketch-dimension', 'This dimension follows an expression. Edit its referenced parameters or explicitly unlink it before changing the value.');
            parameters[name] = evaluateCadScalar(edit.value, parameters) / (constraint.quantity === 'diameter' ? 2 : 1);
            return profile;
          }
          return setCadSketchDimensionValue({ profile, quantity: constraint.quantity, value: edit.value });
        }) };
        break;
      }
      case 'translate-sketch-profiles': {
        const index = indexOf(edit.sketchId), feature = features[index];
        if (feature.kind !== 'sketch') throw new CadError('missing-sketch', 'Choose an existing sketch for translation.');
        const selected = new Set(edit.profileIds);
        if (edit.profileIds.some(id => !feature.profiles.some(profile => profile.id === id))) throw new CadError('missing-profile', 'A selected sketch contour no longer exists.');
        const translation = [evaluateCadScalar(edit.translation[0], parameters), evaluateCadScalar(edit.translation[1], parameters)] satisfies readonly [number, number];
        features[index] = { ...feature, profiles: feature.profiles.map(profile => selected.has(profile.id) ? translateCadSketchProfile({ profile, translation, parameters }) : profile) };
        break;
      }
      default: { const exhaustive: never = edit; throw exhaustive; }
    }
  }
  return parseCadDocument({ ...document, name, parameters, features, ...(parameterGroups ? { parameterGroups } : {}), ...(parameterMetadata ? { parameterMetadata } : {}) });
}
