import { describe, expect, it } from 'vitest';
import { Value } from '@sinclair/typebox/value';
import { createCadFreshSketchGraph } from '../cadFreshSketchGraph';
import { createCadSketchCornerTreatment, inspectCadSketchCornerTarget } from '../cadSketchCornerTreatment';
import { checkCadSketchGraph, parseCadSketchGraph } from '../cadSketchGraph';
import { createCadDocument, parseCadDocument } from '../cadSchema';
import { measureCadSketch } from '../cadMeasurements';
import { compileCadSketchGraph } from '../cadSketchGraphGeometry';
import { inspectCadParameters } from '../cadParameters';
import { applyCadEdits, CadEditSchema } from '../cadOperations';
import { deleteCadSketchElements } from '../cadSketchGraphEdits';
import { resolveCadSketchCornerTopology } from '../cadSketchCornerGeometry';
import { cadSketchRelationPointIds } from '../cadSketchGraphReferences';

function ids(prefix: string) { let n = 0; return () => `${prefix}_${++n}`; }
const rectangle = () => createCadFreshSketchGraph({ geometry: { kind: 'rectangle', x: 0, y: 0, width: 20, height: 10, cornerRadius: 0 }, construction: false, createId: ids('original') });
const documentFor = (graph: ReturnType<typeof rectangle>, parameters: Readonly<Record<string, number>> = {}) => parseCadDocument({ ...createCadDocument('Corner', 'corner'), schemaVersion: 2, parameters,
  features: [{ id: 'sketch', name: 'Sketch', kind: 'sketch', plane: 'XY', offset: 0, suppressed: false, profiles: [], graph }] });
const measure = (graph: ReturnType<typeof rectangle>, parameters: Readonly<Record<string, number>> = {}) => measureCadSketch(documentFor(graph, parameters), 'sketch');
describe('owned graph corner treatments', () => {
  it('rounds one rectangle corner and preserves every original point driver and relation', () => {
    const original = rectangle(), graph = parseCadSketchGraph({ ...original, points: original.points.map((point, index) => index ? point : { ...point, position: [' origin ', '0'] }) });
    const before = JSON.stringify(graph), pointId = graph.points[0].id;
    const result = createCadSketchCornerTreatment({ graph, parameters: { origin: 0 }, pointId, treatment: { kind: 'fillet', radius: ' 2 ' }, createId: ids('new') });
    expect(result.graph.points.slice(0, 4)).toEqual(graph.points); expect(result.graph.relations.slice(0, 4)).toEqual(graph.relations);
    expect(result.graph.relations.at(-1)).toMatchObject({ id: result.relationId, kind: 'fillet-corner', pointId, value: ' 2 ' });
    expect(result.graph.entities.filter(entity => entity.kind === 'arc')).toHaveLength(1);
    expect(checkCadSketchGraph(result.graph, { origin: 0 })).toEqual([]);
    expect(measure(result.graph, { origin: 0 }).materialAreaMm2).toBeCloseTo(196 + Math.PI, 11);
    expect(measure(result.graph, { origin: 0 }).boundaryLengthMm).toBeCloseTo(56 + Math.PI, 11);
    expect(JSON.stringify(graph)).toBe(before); expect(Object.isFrozen(result.graph)).toBe(true);
  });

  it('uses canonical side identities for two exact chamfer drivers independently of source ordering', () => {
    const graph = rectangle(), parameters = { first: 2, second: 2 };
    const make = (graph: ReturnType<typeof rectangle>) => createCadSketchCornerTreatment({ graph, parameters, pointId: 'original_1',
      treatment: { kind: 'chamfer', setbacks: [' first ', 'second + 1'] }, createId: ids('chamfer') });
    const result = make(graph), reordered = make(parseCadSketchGraph({ ...graph, points: [...graph.points].reverse(), entities: [...graph.entities].reverse() }));
    expect(result.graph.relations.at(-1)).toMatchObject({ kind: 'chamfer-corner', lineIds: ['original_5', 'original_8'], values: [' first ', 'second + 1'] });
    expect(compileCadSketchGraph(reordered.graph, parameters).cycles).toEqual(compileCadSketchGraph(result.graph, parameters).cycles);
    expect(measure(result.graph, parameters).materialAreaMm2).toBe(197);
    expect(measure(result.graph, parameters).boundaryLengthMm).toBeCloseTo(55 + Math.sqrt(13), 12);
  });

  it('rejects external-sector and major-arc candidates even when their radii and tangent equalities agree', () => {
    const result = createCadSketchCornerTreatment({ graph: rectangle(), parameters: {}, pointId: 'original_1', treatment: { kind: 'fillet', radius: 2 }, createId: ids('new') });
    const relation = result.graph.relations.at(-1); if (relation?.kind !== 'fillet-corner') throw new Error('Expected fillet.');
    const topology = resolveCadSketchCornerTopology(result.graph, relation);
    const derived = new Set([...topology.trimPointIds, topology.centerPointId]);
    const external = parseCadSketchGraph({ ...result.graph, points: result.graph.points.map(point => derived.has(point.id)
      ? { ...point, position: point.position.map(value => -Number(value)) } : point) });
    expect(checkCadSketchGraph(external, {}).filter(issue => issue.source.kind === 'entity')).toEqual([]);
    expect(checkCadSketchGraph(external, {}).some(issue => issue.source.id === relation.id && issue.message.includes('strictly between'))).toBe(true);
    const major = parseCadSketchGraph({ ...result.graph, entities: result.graph.entities.map(entity => entity.kind === 'arc' ? { ...entity, direction: entity.direction === 'cw' ? 'ccw' : 'cw' } : entity) });
    expect(checkCadSketchGraph(major, {}).some(issue => issue.source.id === relation.id && issue.message.includes('minor arc'))).toBe(true);
    expect(parseCadSketchGraph(result.graph)).toEqual(result.graph);
    const changedDriver = parseCadSketchGraph({ ...result.graph, relations: result.graph.relations.map(item => item.id === relation.id ? { ...item, value: 3 } : item) });
    expect(checkCadSketchGraph(changedDriver, {}).some(issue => issue.source.id === relation.id)).toBe(true);
    expect(() => documentFor(changedDriver)).toThrow();
  });

  it('rejects oversize, branch, construction and newly intersecting geometry without changing its source', () => {
    const graph = rectangle(), before = JSON.stringify(graph);
    for (const radius of [0, -1, 10, 1000001]) expect(() => createCadSketchCornerTreatment({ graph, parameters: {}, pointId: 'original_1', treatment: { kind: 'fillet', radius }, createId: ids('bad') })).toThrow();
    const branch = parseCadSketchGraph({ ...graph, points: [...graph.points, { id: 'tail', position: [-5, -5] }], entities: [...graph.entities, { id: 'extra', kind: 'line', construction: false, startPointId: 'original_1', endPointId: 'tail' }] });
    const construction = parseCadSketchGraph({ ...graph, entities: graph.entities.map((entity, index) => index ? entity : { ...entity, construction: true }) });
    const mixed = parseCadSketchGraph({ ...graph, points: [...graph.points, { id: 'arc-center', position: [10, 0] }], entities: graph.entities.map((entity, index) => index ? entity : { id: entity.id, kind: 'arc', centerPointId: 'arc-center', startPointId: 'original_1', endPointId: 'original_2', direction: 'ccw', construction: false }) });
    for (const source of [branch, construction, mixed]) expect(() => createCadSketchCornerTreatment({ graph: source, parameters: {}, pointId: 'original_1', treatment: { kind: 'chamfer', setbacks: [2, 2] }, createId: ids('bad') })).toThrow();
    const contact = parseCadSketchGraph({ ...graph, points: [...graph.points, { id: 'hole-center', position: [0.6, 0.6] }], entities: [...graph.entities, { id: 'hole', kind: 'circle', centerPointId: 'hole-center', radius: 0.2, construction: false }] });
    expect(() => createCadSketchCornerTreatment({ graph: contact, parameters: {}, pointId: 'original_1', treatment: { kind: 'fillet', radius: 2 }, createId: ids('bad') })).toThrowError(expect.objectContaining({ code: 'corner-intersection' }));
    expect(JSON.stringify(graph)).toBe(before);
  });

  it('keeps adjacent corner supports consistent and refuses a treatment that consumes the remaining edge', () => {
    const first = createCadSketchCornerTreatment({ graph: rectangle(), parameters: {}, pointId: 'original_1', treatment: { kind: 'fillet', radius: 2 }, createId: ids('first') });
    const second = createCadSketchCornerTreatment({ graph: first.graph, parameters: {}, pointId: 'original_2', treatment: { kind: 'fillet', radius: 2 }, createId: ids('second') });
    expect(measure(second.graph).materialAreaMm2).toBeCloseTo(192 + 2 * Math.PI, 11);
    expect(() => createCadSketchCornerTreatment({ graph: first.graph, parameters: {}, pointId: 'original_2', treatment: { kind: 'chamfer', setbacks: [18, 2] }, createId: ids('bad') })).toThrow();
  });

  it('shares target eligibility and the named-identity command without changing the accepted source', () => {
    const graph = rectangle(), document = documentFor(graph), before = JSON.stringify(document);
    expect(inspectCadSketchCornerTarget(graph, 'original_1', {}).lines.map(line => line.id)).toEqual(['original_5', 'original_8']);
    const treatment = { kind: 'fillet', radius: ' 2 ', trimPointIds: ['trim-a', 'trim-b'], centerPointId: 'center', entityId: 'fillet', relationId: 'corner' } as const;
    const result = applyCadEdits(document, [{ kind: 'create-sketch-corner', sketchId: 'sketch', pointId: 'original_1', treatment }]);
    expect(result.features[0]).toMatchObject({ graph: { relations: [...graph.relations, { id: 'corner', kind: 'fillet-corner', pointId: 'original_1', lineIds: ['original_5', 'original_8'], arcId: 'fillet', value: ' 2 ' }] } });
    expect(measureCadSketch(result, 'sketch').materialAreaMm2).toBeCloseTo(196 + Math.PI, 11);
    expect(Value.Check(CadEditSchema, { kind: 'create-sketch-corner', sketchId: 'sketch', pointId: 'original_1', treatment: { ...treatment, kind: 'chamfer' } })).toBe(false);
    expect(() => applyCadEdits(document, [{ kind: 'create-sketch-corner', sketchId: 'sketch', pointId: 'original_1', treatment: { ...treatment, trimPointIds: ['original_1', 'trim-b'] } }])).toThrow();
    const sketch = document.features[0]; if (sketch.kind !== 'sketch') throw new Error('Expected sketch.');
    const mixed = parseCadDocument({ ...document, features: [{ ...sketch, profiles: [{ id: 'fillet', name: 'Existing circle', construction: false, geometry: { kind: 'circle', x: 100, y: 100, radius: 2 } }] }] });
    expect(() => applyCadEdits(mixed, [{ kind: 'create-sketch-corner', sketchId: 'sketch', pointId: 'original_1', treatment }])).toThrowError(expect.objectContaining({ code: 'duplicate-sketch-id' }));
    expect(JSON.stringify(document)).toBe(before);
  });

  it('discovers and renames treatment drivers and protects entity-owned dependencies during deletion', () => {
    const result = createCadSketchCornerTreatment({ graph: rectangle(), parameters: { size: 2 }, pointId: 'original_1', treatment: { kind: 'fillet', radius: ' size ' }, createId: ids('new') });
    const document = documentFor(result.graph, { size: 2 });
    expect(inspectCadParameters(document).parameters[0].usages).toContainEqual(expect.objectContaining({ expression: ' size ', path: 'graph.relations.4.value' }));
    const renamed = applyCadEdits(document, [{ kind: 'rename-parameter', name: 'size', newName: 'radius' }]);
    expect(renamed.features[0]).toMatchObject({ graph: { relations: [...result.graph.relations.slice(0, 4), expect.objectContaining({ value: ' radius ' })] } });
    expect(() => applyCadEdits(document, [{ kind: 'remove-parameter', name: 'size' }])).toThrow();
    const sketch = document.features[0]; if (sketch.kind !== 'sketch') throw new Error('Expected sketch.');
    const request = { sketch, pointIds: [], entityIds: [result.entityId], relationIds: [], cascade: false };
    expect(() => deleteCadSketchElements(request)).toThrowError(expect.objectContaining({ code: 'dependent-sketch-element' }));
    const removed = deleteCadSketchElements({ ...request, cascade: true });
    expect(removed.graph?.relations).toEqual(result.graph.relations.slice(0, 4));
    expect(removed.graph?.points).toEqual(result.graph.points);
    const relation = result.graph.relations.at(-1); if (!relation) throw new Error('Expected corner.');
    expect(new Set(cadSketchRelationPointIds(result.graph, relation)).size).toBe(6);
  });

  it('rejects ambiguous supports and invalid treatment provenance instead of retargeting another corner', () => {
    const graph = rectangle();
    const collinear = parseCadSketchGraph({ points: [{ id: 'v', position: [0, 0] }, { id: 'a', position: [5, 0] }, { id: 'b', position: [-5, 0] }],
      entities: [{ id: 'a-line', kind: 'line', construction: false, startPointId: 'a', endPointId: 'v' }, { id: 'b-line', kind: 'line', construction: false, startPointId: 'v', endPointId: 'b' }], relations: [] });
    expect(() => inspectCadSketchCornerTarget(collinear, 'v', {})).toThrowError(expect.objectContaining({ code: 'invalid-corner-geometry' }));
    const result = createCadSketchCornerTreatment({ graph, parameters: {}, pointId: 'original_1', treatment: { kind: 'fillet', radius: 2 }, createId: ids('new') });
    const relation = result.graph.relations.at(-1); if (relation?.kind !== 'fillet-corner') throw new Error('Expected fillet.');
    for (const replacement of [{ ...relation, lineIds: [...relation.lineIds].reverse() }, { ...relation, arcId: 'missing-arc' }, { ...relation, pointId: result.graph.entities[0].kind === 'line' ? result.graph.entities[0].startPointId : 'original_1' }])
      expect(() => parseCadSketchGraph({ ...result.graph, relations: [...graph.relations, replacement] })).toThrow();
    expect(() => createCadSketchCornerTreatment({ graph, parameters: {}, pointId: 'original_1', treatment: { kind: 'chamfer', setbacks: [2, 3] }, createId: () => 'same' })).toThrowError(expect.objectContaining({ code: 'duplicate-sketch-id' }));
    expect(() => parseCadSketchGraph({ ...result.graph, entities: result.graph.entities.map(entity => entity.id === relation.arcId ? { ...entity, construction: true } : entity) })).toThrowError(expect.objectContaining({ code: 'invalid-corner-topology' }));
  });

  it('visits both chamfer drivers and treats the retained sharp vertex as an explicit dependency', () => {
    const result = createCadSketchCornerTreatment({ graph: rectangle(), parameters: { size: 2 }, pointId: 'original_1', treatment: { kind: 'chamfer', setbacks: [' size ', 'size + 1'] }, createId: ids('new') });
    const document = documentFor(result.graph, { size: 2 });
    expect(inspectCadParameters(document).parameters[0].usages.map(usage => usage.path)).toEqual(['graph.relations.4.values.0', 'graph.relations.4.values.1']);
    const renamed = applyCadEdits(document, [{ kind: 'rename-parameter', name: 'size', newName: 'setback' }]);
    expect(renamed.features[0]).toMatchObject({ graph: { relations: [...result.graph.relations.slice(0, 4), expect.objectContaining({ values: [' setback ', 'setback + 1'] })] } });
    const sketch = document.features[0]; if (sketch.kind !== 'sketch') throw new Error('Expected sketch.');
    const request = { sketch, pointIds: ['original_1'], entityIds: [], relationIds: [], cascade: false };
    expect(() => deleteCadSketchElements(request)).toThrowError(expect.objectContaining({ code: 'dependent-sketch-element' }));
    const deleted = deleteCadSketchElements({ ...request, cascade: true });
    expect(deleted.graph?.relations.some(relation => relation.id === result.relationId)).toBe(false);
    expect(deleted.graph?.entities).toEqual(result.graph.entities);
    expect(deleted.graph?.points).toEqual(result.graph.points.filter(point => point.id !== 'original_1'));
  });
});
