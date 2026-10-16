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
import { CadSketchHandleSchema, moveCadSketchHandle, type CadSketchHandle } from './cadSketchHandles';
import { CadSketchGraphSchema, type CadSketchGraph, type CadSketchGraphRelation } from './cadSketchGraph';
import { appendCadSketchEntities, deleteCadSketchElements, setCadSketchConstruction } from './cadSketchGraphEdits';
import { CadSketchCornerCommandTreatmentSchema, createCadSketchCornerTreatmentFromIds, type CadSketchCornerCommandTreatment } from './cadSketchCornerTreatment';
import { CadSketchGraphSelectionSchema, type CadSketchGraphSelection } from './cadSketchGraphSelection';
import { translateCadSketchGraph } from './cadSketchTranslation';
import { CadSketchSplitTargetSchema, splitCadSketchEntity, type CadSketchSplitTarget } from './cadSketchSplit';
import { CadSketchTrimTargetSchema, trimCadSketchEntity, type CadSketchTrimTarget, CadSketchExtendTargetSchema, extendCadSketchEntity, type CadSketchExtendTarget } from './cadSketchTrimExtend';
import { CadSketchOffsetRequestSchema, prepareCadSketchOffset, type CadSketchOffsetRequest } from './cadSketchOffset';
import { CadSketchMirrorRequestSchema, prepareCadSketchMirror, type CadSketchMirrorRequest } from './cadSketchMirror';
import { CadSketchProfileCopyRequestSchema, prepareCadSketchProfileCopy, type CadSketchProfileCopyRequest } from './cadSketchProfileCopy';

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
  | { readonly kind: 'translate-sketch-geometry'; readonly sketchId: string; readonly selections: readonly CadSketchGraphSelection[]; readonly translation: CadPoint2 }
  | { readonly kind: 'move-sketch-handle'; readonly sketchId: string; readonly profileId: string; readonly handle: CadSketchHandle; readonly translation: CadPoint2 }
  | { readonly kind: 'append-sketch-entities'; readonly sketchId: string; readonly geometry: CadSketchGraph }
  | { readonly kind: 'create-sketch-corner'; readonly sketchId: string; readonly pointId: string; readonly treatment: CadSketchCornerCommandTreatment }
  | { readonly kind: 'split-sketch-entity'; readonly sketchId: string; readonly split: CadSketchSplitTarget }
  | { readonly kind: 'trim-sketch-entity'; readonly sketchId: string; readonly trim: CadSketchTrimTarget }
  | { readonly kind: 'extend-sketch-entity'; readonly sketchId: string; readonly extend: CadSketchExtendTarget }
  | ({ readonly kind: 'offset-sketch-loop'; readonly sketchId: string } & CadSketchOffsetRequest)
  | ({ readonly kind: 'mirror-sketch-geometry'; readonly sketchId: string } & CadSketchMirrorRequest)
  | ({ readonly kind: 'copy-sketch-profile' } & CadSketchProfileCopyRequest)
  | { readonly kind: 'delete-sketch-elements'; readonly sketchId: string; readonly pointIds: readonly string[]; readonly entityIds: readonly string[]; readonly relationIds: readonly string[]; readonly cascade: boolean }
  | { readonly kind: 'set-sketch-construction'; readonly sketchId: string; readonly entityIds: readonly string[]; readonly construction: boolean }
  | { readonly kind: 'move-sketch-point'; readonly sketchId: string; readonly pointId: string; readonly translation: CadPoint2 }
  | { readonly kind: 'set-sketch-relation'; readonly sketchId: string; readonly relation: CadSketchGraphRelation }
  | { readonly kind: 'remove-sketch-relation'; readonly sketchId: string; readonly relationId: string }
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
  Type.Object({ kind: Type.Literal('translate-sketch-geometry'), sketchId: identifier, selections: Type.Array(CadSketchGraphSelectionSchema, { minItems: 1, maxItems: 64, uniqueItems: true }), translation: CadPoint2Schema }, strict),
  Type.Object({ kind: Type.Literal('move-sketch-handle'), sketchId: identifier, profileId: identifier, handle: CadSketchHandleSchema, translation: CadPoint2Schema }, strict),
  Type.Object({ kind: Type.Literal('append-sketch-entities'), sketchId: identifier, geometry: CadSketchGraphSchema }, strict),
  Type.Object({ kind: Type.Literal('create-sketch-corner'), sketchId: identifier, pointId: identifier, treatment: CadSketchCornerCommandTreatmentSchema }, strict),
  Type.Object({ kind: Type.Literal('split-sketch-entity'), sketchId: identifier, split: CadSketchSplitTargetSchema }, strict),
  Type.Object({ kind: Type.Literal('trim-sketch-entity'), sketchId: identifier, trim: CadSketchTrimTargetSchema }, strict),
  Type.Object({ kind: Type.Literal('extend-sketch-entity'), sketchId: identifier, extend: CadSketchExtendTargetSchema }, strict),
  Type.Object({ kind: Type.Literal('offset-sketch-loop'), sketchId: identifier, ...CadSketchOffsetRequestSchema.properties }, strict),
  Type.Object({ kind: Type.Literal('mirror-sketch-geometry'), sketchId: identifier, ...CadSketchMirrorRequestSchema.properties }, strict),
  Type.Object({ kind: Type.Literal('copy-sketch-profile'), ...CadSketchProfileCopyRequestSchema.properties }, strict),
  Type.Object({ kind: Type.Literal('delete-sketch-elements'), sketchId: identifier, pointIds: Type.Array(identifier, { uniqueItems: true }), entityIds: Type.Array(identifier, { uniqueItems: true }), relationIds: Type.Array(identifier, { uniqueItems: true }), cascade: Type.Boolean() }, strict),
  Type.Object({ kind: Type.Literal('set-sketch-construction'), sketchId: identifier, entityIds: Type.Array(identifier, { uniqueItems: true }), construction: Type.Boolean() }, strict),
  Type.Object({ kind: Type.Literal('move-sketch-point'), sketchId: identifier, pointId: identifier, translation: CadPoint2Schema }, strict),
  Type.Object({ kind: Type.Literal('set-sketch-relation'), sketchId: identifier, relation: CadSketchGraphSchema.properties.relations.items }, strict),
  Type.Object({ kind: Type.Literal('remove-sketch-relation'), sketchId: identifier, relationId: identifier }, strict),
  Type.Object({ kind: Type.Literal('rename-document'), name: Type.String({ minLength: 1, maxLength: 160, pattern: '\\S' }) }, strict)
]);

/** Validates the complete final document once; a failed batch never mutates the input. */
export function applyCadEdits(document: CadDocument, edits: readonly CadEdit[]): CadDocument {
  return parseCadDocument(reduceCadEditIntents(document, edits));
}

export function validateCadEditBatch(edits: readonly CadEdit[]): void {
  if (!isCadImportData(edits) || !Array.isArray(edits)) throw new CadError('invalid-edit', 'CAD edits must contain their own complete JSON data fields.');
  if (edits.length > 256) throw new CadError('edit-limit', 'An edit batch may contain at most 256 edits.');
  for (const edit of edits) if (!Value.Check(CadEditSchema, edit)) throw new CadError('invalid-edit', 'Malformed CAD edit.');
}

/** Internal unsolved intent stage. Only parseCadDocument may accept its result. */
export function reduceCadEditIntents(document: CadDocument, edits: readonly CadEdit[]): CadDocument {
  validateCadEditBatch(edits);
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
      case 'move-sketch-handle': {
        const index = indexOf(edit.sketchId), feature = features[index];
        if (feature.kind !== 'sketch') throw new CadError('missing-sketch', 'Choose an existing sketch to edit.');
        if (!feature.profiles.some(profile => profile.id === edit.profileId)) throw new CadError('missing-profile', 'The selected sketch contour no longer exists.');
        const translation = [evaluateCadScalar(edit.translation[0], parameters), evaluateCadScalar(edit.translation[1], parameters)] satisfies readonly [number, number];
        features[index] = { ...feature, profiles: feature.profiles.map(profile => profile.id === edit.profileId ? moveCadSketchHandle({ profile, handle: edit.handle, translation, parameters }) : profile) };
        break;
      }
      case 'offset-sketch-loop': {
        const index = indexOf(edit.sketchId), sketch = features[index];
        if (sketch.kind !== 'sketch') throw new CadError('missing-sketch', 'Choose an existing sketch to offset.');
        features[index] = prepareCadSketchOffset({ sketch, parameters, source: edit.source, distance: edit.distance, idPrefix: edit.idPrefix }).sketch;
        break;
      }
      case 'mirror-sketch-geometry': {
        const index = indexOf(edit.sketchId), sketch = features[index];
        if (sketch.kind !== 'sketch') throw new CadError('missing-sketch', 'Choose an existing sketch to mirror.');
        features[index] = prepareCadSketchMirror({ sketch, parameters, entityIds: edit.entityIds, axisLineId: edit.axisLineId, idPrefix: edit.idPrefix }).sketch;
        break;
      }
      case 'copy-sketch-profile': {
        if (features.some(feature => feature.id === edit.newSketchId)) throw new CadError('duplicate-id', 'The new sketch identity already belongs to another feature.');
        const source = features[indexOf(edit.sourceSketchId)];
        if (source.kind !== 'sketch') throw new CadError('missing-sketch', 'Choose an existing sketch profile to copy.');
        features.push(prepareCadSketchProfileCopy({ sketch: source, parameters, sourceSketchId: edit.sourceSketchId, profileId: edit.profileId,
          newSketchId: edit.newSketchId, name: edit.name, idPrefix: edit.idPrefix }).sketch);
        break;
      }
      case 'create-sketch-corner': case 'split-sketch-entity': case 'trim-sketch-entity': case 'extend-sketch-entity': {
        const index = indexOf(edit.sketchId), sketch = features[index];
        if (sketch.kind !== 'sketch' || !sketch.graph) throw new CadError('missing-sketch-graph', 'Choose an existing entity-based sketch.');
        const result = edit.kind === 'create-sketch-corner'
          ? createCadSketchCornerTreatmentFromIds({ graph: sketch.graph, parameters, pointId: edit.pointId, treatment: edit.treatment })
          : edit.kind === 'split-sketch-entity' ? splitCadSketchEntity({ graph: sketch.graph, parameters, split: edit.split })
            : edit.kind === 'trim-sketch-entity' ? trimCadSketchEntity({ graph: sketch.graph, parameters, trim: edit.trim })
              : extendCadSketchEntity({ graph: sketch.graph, parameters, extend: edit.extend });
        const profileIds = new Set(sketch.profiles.map(profile => profile.id));
        for (const item of [...result.graph.points, ...result.graph.entities, ...result.graph.relations])
          if (profileIds.has(item.id)) throw new CadError('duplicate-sketch-id', `Sketch identity "${item.id}" already belongs to a legacy profile.`);
        features[index] = { ...sketch, graph: result.graph }; break;
      }
      case 'append-sketch-entities': case 'delete-sketch-elements': case 'set-sketch-construction': {
        const index = indexOf(edit.sketchId), sketch = features[index];
        if (sketch.kind !== 'sketch') throw new CadError('missing-sketch', 'Choose an existing sketch to edit.');
        features[index] = edit.kind === 'append-sketch-entities' ? appendCadSketchEntities({ sketch, geometry: edit.geometry })
          : edit.kind === 'delete-sketch-elements' ? deleteCadSketchElements({ sketch, pointIds: edit.pointIds, entityIds: edit.entityIds, relationIds: edit.relationIds, cascade: edit.cascade })
            : setCadSketchConstruction({ sketch, entityIds: edit.entityIds, construction: edit.construction });
        break;
      }
      case 'translate-sketch-geometry': {
        const index = indexOf(edit.sketchId), feature = features[index];
        if (feature.kind !== 'sketch' || !feature.graph) throw new CadError('missing-sketch-graph', 'Choose an existing entity-based sketch.');
        features[index] = { ...feature, graph: translateCadSketchGraph({ graph: feature.graph, selections: edit.selections, translation: edit.translation, parameters }) };
        break;
      }
      case 'move-sketch-point': case 'set-sketch-relation': case 'remove-sketch-relation': {
        const index = indexOf(edit.sketchId), feature = features[index];
        if (feature.kind !== 'sketch' || !feature.graph) throw new CadError('missing-sketch-graph', 'Choose an existing entity-based sketch.');
        let graph = feature.graph;
        if (edit.kind === 'move-sketch-point') {
          if (!graph.points.some(point => point.id === edit.pointId)) throw new CadError('missing-sketch-point', 'The selected sketch point no longer exists.');
          const delta = edit.translation.map(value => evaluateCadScalar(value, parameters));
          graph = { ...graph, points: graph.points.map(point => point.id !== edit.pointId ? point : { ...point, position: [
            typeof point.position[0] === 'number' ? point.position[0] + delta[0] : point.position[0],
            typeof point.position[1] === 'number' ? point.position[1] + delta[1] : point.position[1]
          ] }) };
        } else if (edit.kind === 'set-sketch-relation') {
          graph = { ...graph, relations: graph.relations.some(relation => relation.id === edit.relation.id)
            ? graph.relations.map(relation => relation.id === edit.relation.id ? edit.relation : relation) : [...graph.relations, edit.relation] };
        } else {
          if (!graph.relations.some(relation => relation.id === edit.relationId)) throw new CadError('missing-sketch-relation', 'The selected sketch relation no longer exists.');
          graph = { ...graph, relations: graph.relations.filter(relation => relation.id !== edit.relationId) };
        }
        features[index] = { ...feature, graph }; break;
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
  const schemaVersion = features.some(feature => feature.kind === 'sketch' && feature.graph) ? 2 : document.schemaVersion;
  return { ...document, schemaVersion, name, parameters, features, ...(parameterGroups ? { parameterGroups } : {}), ...(parameterMetadata ? { parameterMetadata } : {}) };
}
