import { describe, expect, it } from 'vitest';
import { Value } from '@sinclair/typebox/value';
import { createCadDocument, parseCadDocument } from '../cadSchema';
import { applyCadEdits, CadEditSchema, reduceCadEditIntents } from '../cadOperations';
import type { CadDocument, CadFeature, CadSketchFeature } from '../cadDocument';
import { assertCadSketchExternalReferences, cadSketchExternalReferenceComponents, cadSketchExternalReferenceForSelection,
  cadSketchExternalReferenceLockReason, cadSketchReferenceSources, prepareCadSketchUseEntity, refreshCadSketchExternalReferences } from '../cadSketchExternalReferences';
import { checkCadSketchGraph, parseCadSketchGraph } from '../cadSketchGraph';
import { cadFeatureDependencies } from '../cadFeatureInputs';
import { mapCadFeatureScalars } from '../cadParameters';
import { translateCadSketchGraph } from '../cadSketchTranslation';
import { splitCadSketchEntity } from '../cadSketchSplit';
import { prepareCadSketchExtend, prepareCadSketchTrim } from '../cadSketchTrimExtend';
import { inspectCadSketchCornerTarget } from '../cadSketchCornerTreatment';

function part() {
  return { ...createCadDocument('Linked layout', 'linked-layout'), schemaVersion: 2, parameters: { span: 40 }, features: [
    { id: 'layout', name: 'Layout', kind: 'sketch', plane: 'XY', offset: ' 0 ', suppressed: false, profiles: [], graph: {
      points: [{ id: 'a', position: ['0.000', '10.000'] }, { id: 'b', position: [' span ', '10.000'] }],
      entities: [{ id: 'guide', kind: 'line', construction: true, startPointId: 'a', endPointId: 'b' }], relations: [] } },
    { id: 'plate', name: 'Plate', kind: 'sketch', plane: 'XY', offset: '5.00', suppressed: false, profiles: [], graph: {
      points: [{ id: 'use_p0', position: [0, 10] }, { id: 'use_p1', position: [40, 10] }],
      entities: [{ id: 'use_e0', kind: 'line', construction: true, startPointId: 'use_p0', endPointId: 'use_p1' }],
      relations: [{ id: 'use_reference', kind: 'external-reference', entityId: 'use_e0', sourceSketchId: 'layout',
        source: { kind: 'line', entityId: 'guide', startPointId: 'a', endPointId: 'b' } }] } }
  ] };
}
function sketchOf(document: CadDocument, id = 'plate'): CadSketchFeature {
  const feature = document.features.find(feature => feature.id === id);
  if (feature?.kind !== 'sketch') throw new Error('Missing fixture sketch.');
  return feature;
}
function graphOf(sketch: CadSketchFeature) { if (!sketch.graph) throw new Error('Missing fixture graph.'); return sketch.graph; }
const use = { kind: 'use-sketch-entity', sketchId: 'plate', sourceSketchId: 'layout', sourceEntityId: 'guide', idPrefix: 'use' } as const;
function withoutReference() {
  const raw = part(); raw.features[1].graph = { points: [], entities: [], relations: [] };
  return parseCadDocument(raw);
}

describe('persistent preceding graph references', () => {
  it('accepts exact numeric construction snapshots on the same base at independent offsets without rewriting source fields', () => {
    const raw = part(), before = JSON.stringify(raw), accepted = parseCadDocument(raw);
    expect(JSON.stringify(accepted)).toBe(before); expect(JSON.stringify(raw)).toBe(before);
    expect(accepted.features[1]).toMatchObject({ offset: '5.00', graph: { points: [{ id: 'use_p0', position: [0, 10] }, { id: 'use_p1', position: [40, 10] }] } });
    expect(Value.Check(CadEditSchema, { kind: 'use-sketch-entity', sketchId: 'plate', sourceSketchId: 'layout', sourceEntityId: 'guide', idPrefix: 'next' })).toBe(true);
  });

  it('constructs one stable qualified owner through the real edit, retains source strings and exposes readonly local identities', () => {
    const initial = withoutReference(), before = JSON.stringify(initial), accepted = applyCadEdits(initial, [use]), target = sketchOf(accepted), graph = graphOf(target);
    expect(target).toEqual(sketchOf(parseCadDocument(part()))); expect(sketchOf(accepted, 'layout')).toEqual(initial.features[0]);
    expect(cadFeatureDependencies(target)).toEqual(['layout']);
    expect(cadSketchReferenceSources(initial, 'plate').map(feature => feature.id)).toEqual(['layout']);
    expect(cadSketchReferenceSources(initial, 'layout')).toEqual([]);
    expect(cadSketchExternalReferenceForSelection(graph, { kind: 'point', id: 'use_p1' })).toEqual(graph.relations[0]);
    expect(cadSketchExternalReferenceLockReason(graph, { kind: 'entity', id: 'use_e0' })).toContain('Detach');
    expect(cadSketchExternalReferenceLockReason(graph, { kind: 'point', id: 'not-owned' })).toBeNull();
    const components = cadSketchExternalReferenceComponents(graph);
    expect([...components.pointIds]).toEqual(['use_p0', 'use_p1']); expect([...components.circleIds]).toEqual([]);
    expect(Object.isFrozen(components.pointIds)).toBe(true); expect('add' in components.pointIds).toBe(false);
    expect(Object.isFrozen(target.graph?.points[0].position)).toBe(true);
    expect(mapCadFeatureScalars(target, value => value)).toEqual(target); expect(JSON.stringify(initial)).toBe(before);
    expect(() => applyCadEdits(accepted, [use])).toThrow('Duplicate');
    expect(Value.Check(CadEditSchema, { ...use, source: 'calculated geometry' })).toBe(false);
  });

  it('rejects stale or forged snapshots in strict parse/direct edits and refreshes only through an explicit solved-prefix helper', () => {
    const initial = parseCadDocument(part()), before = JSON.stringify(initial);
    const intent = reduceCadEditIntents(initial, [{ kind: 'set-parameter', name: 'span', value: 60 }]);
    expect(() => parseCadDocument(intent)).toThrow('does not match');
    expect(() => applyCadEdits(initial, [{ kind: 'set-parameter', name: 'span', value: 60 }])).toThrow('does not match');
    const context = { sketch: sketchOf(intent), parameters: intent.parameters, previous: new Map([[intent.features[0].id, intent.features[0]]]) };
    expect(() => assertCadSketchExternalReferences(context)).toThrow('does not match');
    const refreshed = refreshCadSketchExternalReferences(context), accepted = parseCadDocument({ ...intent, features: [intent.features[0], refreshed] });
    expect(graphOf(sketchOf(accepted)).points[1].position).toEqual([60, 10]);
    expect(graphOf(sketchOf(accepted)).relations).toEqual(graphOf(sketchOf(initial)).relations);
    expect(sketchOf(accepted, 'layout')).toEqual(initial.features[0]); expect(JSON.stringify(initial)).toBe(before);
    const forged = { ...refreshed, graph: { ...graphOf(refreshed), points: graphOf(refreshed).points.map(point => point.id === 'use_p1' ? { ...point, position: [61, 10] } : point) } };
    expect(() => parseCadDocument({ ...accepted, features: [accepted.features[0], forged] })).toThrow('does not match');
    const shiftedSource = applyCadEdits(initial, [{ kind: 'update-feature', feature: { ...sketchOf(initial, 'layout'), offset: '2.000' } }]);
    expect(sketchOf(shiftedSource).offset).toBe('5.00'); expect(graphOf(sketchOf(shiftedSource)).points).toEqual(graphOf(sketchOf(initial)).points);
  });

  it('retains circle radius/center authority and exact shared datum identity while detach leaves an independent numeric construction circle', () => {
    const raw = part(), datum = { id: 'datum', name: 'Fixture', kind: 'datum-plane', suppressed: false,
      definition: { kind: 'world', basePlane: 'XY', origin: ['1.00', 2, 3], rotation: [0, 0, 30] } };
    const base = parseCadDocument({ ...raw, parameters: { ...raw.parameters, r: 3, cx: 12 }, features: [datum,
      { ...raw.features[0], plane: { kind: 'datum-plane', featureId: 'datum' }, graph: { points: [{ id: 'o', position: [' cx ', '10.000'] }],
        entities: [{ id: 'bore', kind: 'circle', centerPointId: 'o', radius: ' r ', construction: false }], relations: [] } },
      { ...raw.features[1], plane: { kind: 'datum-plane', featureId: 'datum' }, graph: { points: [], entities: [], relations: [] } }] });
    const created = applyCadEdits(base, [{ ...use, sourceEntityId: 'bore' }]), graph = graphOf(sketchOf(created));
    expect(graph.points).toEqual([{ id: 'use_c0', position: [12, 10] }]); expect(graph.entities[0]).toMatchObject({ kind: 'circle', radius: 3, construction: true });
    expect([...cadSketchExternalReferenceComponents(graph).circleIds]).toEqual(['use_e0']);
    expect(() => parseCadSketchGraph({ ...graph, entities: graph.entities.map(entity => entity.kind === 'circle' ? { ...entity, radius: '3.00' } : entity) })).toThrow('numeric');
    expect(() => applyCadEdits(created, [{ kind: 'set-sketch-relation', sketchId: 'plate', relation: { id: 'new-radius', kind: 'radial-size', entityId: 'use_e0', quantity: 'radius', value: 3 } }])).toThrow('Detach');
    const intent = reduceCadEditIntents(created, [{ kind: 'set-parameter', name: 'r', value: 4 }, { kind: 'set-parameter', name: 'cx', value: 16 }]);
    const refreshed = refreshCadSketchExternalReferences({ sketch: sketchOf(intent), parameters: intent.parameters, previous: new Map(intent.features.slice(0, 2).map(feature => [feature.id, feature])) });
    expect(graphOf(refreshed).points[0].position).toEqual([16, 10]); expect(graphOf(refreshed).entities[0]).toMatchObject({ radius: 4 });
    const ready = parseCadDocument({ ...intent, features: [...intent.features.slice(0, 2), refreshed] });
    const detached = applyCadEdits(ready, [{ kind: 'remove-sketch-relation', sketchId: 'plate', relationId: 'use_reference' }]);
    const later = applyCadEdits(detached, [{ kind: 'set-parameter', name: 'r', value: 5 }, { kind: 'set-parameter', name: 'cx', value: 20 }]);
    expect(graphOf(sketchOf(later)).points[0].position).toEqual([16, 10]); expect(graphOf(sketchOf(later)).entities[0]).toMatchObject({ id: 'use_e0', radius: 4 });
    expect(cadFeatureDependencies(sketchOf(later))).toEqual(['datum']);
    expect(() => parseCadDocument({ ...created, features: [datum, created.features[1], { ...sketchOf(created), plane: { kind: 'datum-plane', featureId: 'another' } }] })).toThrow();
  });

  it('keeps suppressed snapshots strict but permits suppress-target then suppress-source and dependency-aware cascade', () => {
    const initial = parseCadDocument(part()), source = sketchOf(initial, 'layout'), target = sketchOf(initial);
    expect(() => applyCadEdits(initial, [{ kind: 'update-feature', feature: { ...source, suppressed: true } }])).toThrow('suppressed');
    const dormant = applyCadEdits(initial, [{ kind: 'update-feature', feature: { ...target, suppressed: true } }, { kind: 'update-feature', feature: { ...source, suppressed: true } }]);
    expect(sketchOf(dormant).suppressed).toBe(true);
    expect(() => parseCadDocument({ ...dormant, parameters: { span: 60 } })).toThrow('does not match');
    expect(() => parseCadDocument({ ...dormant, features: [sketchOf(dormant)] })).toThrow('preceding');
    expect(() => applyCadEdits(initial, [{ kind: 'delete-feature', featureId: 'layout', cascade: false }])).toThrow('depends');
    expect(applyCadEdits(initial, [{ kind: 'delete-feature', featureId: 'layout', cascade: true }]).features).toEqual([]);
    expect(() => applyCadEdits(initial, [{ kind: 'move-feature', featureId: 'layout', beforeId: null }])).toThrow('preceding');
  });

  it('requires dedicated numeric construction supports and protects them from direct drivers and boundary edits until detach', () => {
    const document = parseCadDocument(part()), target = sketchOf(document), graph = graphOf(target);
    const invalidGraphs = [
      { ...graph, points: graph.points.map(point => ({ ...point, position: point.position.map(value => String(value)) })) },
      { ...graph, entities: graph.entities.map(entity => ({ ...entity, construction: false })) },
      { ...graph, entities: [...graph.entities, { id: 'other', kind: 'line', construction: true, startPointId: 'use_p0', endPointId: 'use_p1' }] },
      { ...graph, relations: [...graph.relations, { id: 'fixed', kind: 'fixed-axis', pointId: 'use_p0', axis: 'x', value: 0 }] },
      { ...graph, relations: [...graph.relations, { ...graph.relations[0], id: 'duplicate-owner' }] }
    ];
    for (const candidate of invalidGraphs) expect(() => parseCadSketchGraph(candidate)).toThrow();
    expect(checkCadSketchGraph({ ...graph, entities: graph.entities.map(entity => ({ ...entity, construction: false })) }, document.parameters))
      .toContainEqual(expect.objectContaining({ source: { kind: 'relation', id: 'use_reference' }, code: 'relation-residual' }));
    expect(() => applyCadEdits(document, [{ kind: 'move-sketch-point', sketchId: 'plate', pointId: 'use_p0', translation: [1, 0] }])).toThrow('Detach');
    expect(() => translateCadSketchGraph({ graph, parameters: document.parameters, selections: [{ kind: 'entity', id: 'use_e0' }], translation: [1, 0] })).toThrow('Detach');
    expect(() => applyCadEdits(document, [{ kind: 'set-sketch-construction', sketchId: 'plate', entityIds: ['use_e0'], construction: false }])).toThrow('construction');
    expect(() => splitCadSketchEntity({ graph, parameters: document.parameters, split: { kind: 'line', entityId: 'use_e0', parameter: 0.5, splitPointId: 'cut', newEntityId: 'child', supportRelationId: 'support' } })).toThrow('relations');
    const withCutters = parseCadSketchGraph({ ...graph, points: [...graph.points, { id: 'c0', position: [10, 0] }, { id: 'c1', position: [10, 20] }, { id: 'd0', position: [50, 0] }, { id: 'd1', position: [50, 20] }],
      entities: [...graph.entities, { id: 'cut', kind: 'line', construction: true, startPointId: 'c0', endPointId: 'c1' }, { id: 'boundary', kind: 'line', construction: true, startPointId: 'd0', endPointId: 'd1' }] });
    expect(() => prepareCadSketchTrim({ graph: withCutters, parameters: document.parameters, entityId: 'use_e0', parameter: 0.1 })).toThrow('relations');
    expect(() => prepareCadSketchExtend({ graph: withCutters, parameters: document.parameters, entityId: 'use_e0', end: 'end' })).toThrow('relations');
    expect(() => inspectCadSketchCornerTarget(graph, 'use_p0', document.parameters)).toThrow('nonconstruction');
    const detached = applyCadEdits(document, [{ kind: 'remove-sketch-relation', sketchId: 'plate', relationId: 'use_reference' }]);
    expect(applyCadEdits(detached, [{ kind: 'move-sketch-point', sketchId: 'plate', pointId: 'use_p0', translation: [1, 0] }]).features[1]).toMatchObject({ graph: { points: [{ id: 'use_p0', position: [1, 10] }, { id: 'use_p1', position: [40, 10] }] } });
  });

  it('rejects source support replacement and base changes while ordered transitive references follow exact local source identities', () => {
    const initial = parseCadDocument(part()), source = sketchOf(initial, 'layout');
    const changed = { ...source, graph: { ...graphOf(source), points: [...graphOf(source).points, { id: 'replacement', position: [' span ', '10.000'] }],
      entities: [{ id: 'guide', kind: 'line', construction: true, startPointId: 'a', endPointId: 'replacement' }] } };
    expect(() => parseCadDocument({ ...initial, features: [changed, sketchOf(initial)] })).toThrow('topology');
    expect(() => parseCadDocument({ ...initial, features: [{ ...source, plane: 'XZ' }, sketchOf(initial)] })).toThrow('base plane');
    const last: CadSketchFeature = { ...sketchOf(initial), id: 'last', name: 'Last', offset: 12, graph: { points: [], entities: [], relations: [] } };
    const third = prepareCadSketchUseEntity({ sketch: last, parameters: initial.parameters, previous: new Map(initial.features.map(feature => [feature.id, feature])),
      sketchId: 'last', sourceSketchId: 'plate', sourceEntityId: 'use_e0', idPrefix: 'third' });
    const chain = parseCadDocument({ ...initial, features: [...initial.features, third.sketch] });
    const intent = reduceCadEditIntents(chain, [{ kind: 'set-parameter', name: 'span', value: 60 }]), previous = new Map<string, CadFeature>();
    const features = intent.features.map(feature => {
      const refreshed = feature.kind === 'sketch' ? refreshCadSketchExternalReferences({ sketch: feature, parameters: intent.parameters, previous }) : feature;
      previous.set(refreshed.id, refreshed); return refreshed;
    });
    const accepted = parseCadDocument({ ...intent, features });
    expect(graphOf(sketchOf(accepted, 'last')).points[1].position).toEqual([60, 10]);
    expect(graphOf(sketchOf(accepted, 'last')).relations).toEqual(graphOf(third.sketch).relations);
    expect(sketchOf(accepted, 'layout')).toEqual(source);
  });
});
