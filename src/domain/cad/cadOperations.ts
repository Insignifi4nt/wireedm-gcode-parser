import { Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import type { CadDocument, CadFeature } from './cadDocument';
import { CadError } from './cadError';
import { CadFeatureSchema, cadFeatureDependencies, parseCadDocument } from './cadSchema';
import { isCadImportData } from './cadImportData';

export type CadEdit =
  | { readonly kind: 'add-feature'; readonly feature: CadFeature; readonly beforeId?: string }
  | { readonly kind: 'update-feature'; readonly feature: CadFeature }
  | { readonly kind: 'delete-feature'; readonly featureId: string; readonly cascade: boolean }
  | { readonly kind: 'move-feature'; readonly featureId: string; readonly beforeId: string | null }
  | { readonly kind: 'set-parameter'; readonly name: string; readonly value: number }
  | { readonly kind: 'remove-parameter'; readonly name: string }
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
  Type.Object({ kind: Type.Literal('rename-document'), name: Type.String({ minLength: 1, maxLength: 160, pattern: '\\S' }) }, strict)
]);

/** Validates the complete final document once; a failed batch never mutates the input. */
export function applyCadEdits(document: CadDocument, edits: readonly CadEdit[]): CadDocument {
  if (!isCadImportData(edits) || !Array.isArray(edits)) throw new CadError('invalid-edit', 'CAD edits must contain their own complete JSON data fields.');
  if (edits.length > 256) throw new CadError('edit-limit', 'An edit batch may contain at most 256 edits.');
  let features = [...document.features];
  const parameters = { ...document.parameters };
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
        parameters[edit.name] = edit.value; break;
      case 'remove-parameter': {
        if (!Object.hasOwn(parameters, edit.name)) throw new CadError('unknown-parameter', `Parameter "${edit.name}" does not exist.`);
        delete parameters[edit.name]; break;
      }
      case 'rename-document': name = edit.name; break;
      default: { const exhaustive: never = edit; throw exhaustive; }
    }
  }
  return parseCadDocument({ ...document, name, parameters, features });
}
