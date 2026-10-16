// @vitest-environment node
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createCadDocument, parseCadDocument } from '@/domain/cad/cadSchema';
import { parseCadSketchGraph } from '@/domain/cad/cadSketchGraph';
import { prepareCadSketchTrim, trimCadSketchEntity } from '@/domain/cad/cadSketchTrimExtend';
import { prepareCadEdits } from './cadEditPreparation';
import { createCadSketchSolverRuntime } from './sketch-solver/cadSketchSolverRuntime';
import { initializeCadSketchSolverModule } from './sketch-solver/cadSketchSolverModule';
import { middleTrim, middleTrimPart } from '@/domain/cad/__tests__/cadSketchTrimFixtures';
import { circleTrimPart } from '@/domain/cad/__tests__/cadSketchCircleTrimFixtures';
import { CadSession } from './cadSession';
import { CadSketchPreparationError } from './cadSketchConstraintFeedback';
import { middleArcTrimPart, middleArcTrimTarget } from '@/domain/cad/__tests__/cadSketchMiddleArcTrimFixtures';
import { compileCadSketchGraph } from '@/domain/cad/cadSketchGraphGeometry';
import { prepareCadSketchCells } from '@/domain/cad/cadSketchRegionInspection';

const require = createRequire(import.meta.url);
const runtime = createCadSketchSolverRuntime(() => initializeCadSketchSolverModule(pathToFileURL(
  require.resolve('@salusoft89/planegcs/dist/planegcs_dist/planegcs.wasm')).href));

describe('real PlaneGCS exact end-Trim preparation', () => {
  it.each([false, true])('preserves the complete middle-arc candidate with fixed endpoint drivers=%s', async fixed => {
    const document = middleArcTrimPart(fixed), source = document.features[0];
    if (source.kind !== 'sketch' || !source.graph) throw new Error('Middle arc source missing.');
    const original = JSON.stringify(document), trim = middleArcTrimTarget(document);
    const expected = trimCadSketchEntity({ graph: source.graph, parameters: document.parameters, trim });
    const prepared = await prepareCadEdits(document, [{ kind: 'trim-sketch-entity', sketchId: 'sketch', trim }], runtime), sketch = prepared.document.features[0];
    if (sketch.kind !== 'sketch' || !sketch.graph) throw new Error('Prepared middle arc missing.');
    expect(sketch.graph).toEqual(expected.graph); expect(sketch.graph.points).toEqual(source.graph.points);
    expect(sketch.graph.entities.slice(0, 2)).toEqual([{ ...source.graph.entities[0], endPointId: 'p' },
      { ...source.graph.entities[0], id: 'after', startPointId: 'q' }]);
    expect(sketch.graph.entities.slice(2)).toEqual(source.graph.entities.slice(1));
    expect(sketch.graph.relations).toEqual([{ id: 'common-radius', kind: 'equal-radius', curveIds: ['arc', 'after'] }]);
    expect(prepared.sketchDiagnostics[0].diagnostics).toEqual({ status: 'success', degreesOfFreedom: fixed ? 0 : 5,
      conflictingIds: [], redundantIds: [], partiallyRedundantIds: [], issues: [] });
    expect(JSON.stringify(document)).toBe(original);
  });

  it('retains middle-arc radius owners, propagates an ordinary radius edit to both survivors and peer, and atomically rejects a contradiction', async () => {
    const source = middleArcTrimPart(), sketch = source.features[0];
    if (sketch.kind !== 'sketch' || !sketch.graph) throw new Error('Middle arc source missing.');
    const document = parseCadDocument({ ...source, parameters: { stockRadius: 10 }, features: [{ ...sketch, graph: { ...sketch.graph,
      points: [...sketch.graph.points, { id: 'peer-center', position: ['35.000', '0.000'] }],
      entities: [...sketch.graph.entities, { id: 'peer', kind: 'circle', centerPointId: 'peer-center', radius: 10, construction: true }],
      relations: [{ id: 'stock-radius', kind: 'radial-size', entityId: 'arc', quantity: 'radius', value: ' stockRadius ' },
        { id: 'peer-radius', kind: 'equal-radius', curveIds: ['peer', 'arc'] }] } }] });
    const owned = document.features[0]; if (owned.kind !== 'sketch' || !owned.graph) throw new Error('Owned arc missing.');
    const original = JSON.stringify(document), trim = middleArcTrimTarget(document);
    const expected = trimCadSketchEntity({ graph: owned.graph, parameters: document.parameters, trim });
    const prepared = await prepareCadEdits(document, [{ kind: 'trim-sketch-entity', sketchId: 'sketch', trim }], runtime), changed = prepared.document.features[0];
    if (changed.kind !== 'sketch' || !changed.graph) throw new Error('Middle survivors missing.');
    expect(prepared.document).toEqual({ ...document, features: [{ ...owned, graph: expected.graph }] });
    expect(changed.graph.points).toEqual(owned.graph.points);
    expect(changed.graph.relations).toEqual([...owned.graph.relations, { id: 'common-radius', kind: 'equal-radius', curveIds: ['arc', 'after'] }]);
    expect(prepared.sketchDiagnostics[0].diagnostics).toEqual({ status: 'success', degreesOfFreedom: 4,
      conflictingIds: [], redundantIds: [], partiallyRedundantIds: [], issues: [] });
    const cells = prepareCadSketchCells(changed, prepared.document.parameters, 'graph-cells'), selection = cells.pack(cells.cells.map(cell => cell.id));
    const part = parseCadDocument({ ...prepared.document, features: [...prepared.document.features, { id: 'pad', kind: 'extrude', name: 'Radius plate', sketchId: 'sketch',
      suppressed: false, distance: 5, symmetric: false, operation: 'new', targetId: null, regionSelection: selection }] });
    const resized = await prepareCadEdits(part, [{ kind: 'set-parameter', name: 'stockRadius', value: 12 }], runtime), resizedSketch = resized.document.features[0];
    if (resizedSketch.kind !== 'sketch' || !resizedSketch.graph) throw new Error('Resized survivors missing.');
    const arcs = compileCadSketchGraph(resizedSketch.graph, resized.document.parameters).segments.filter(segment => segment.kind === 'arc');
    expect(arcs).toHaveLength(2);
    for (const arc of arcs) { expect(arc.radius).toBeCloseTo(12, 12); expect(Math.hypot(arc.end.x - arc.center.x, arc.end.y - arc.center.y)).toBeCloseTo(12, 12); }
    expect(resizedSketch.graph.entities.find(entity => entity.id === 'peer')).toMatchObject({ radius: 12 });
    expect(resizedSketch.graph.relations).toEqual(changed.graph.relations);
    for (const point of changed.graph.points.filter(point => point.position.some(value => typeof value === 'string')))
      expect(resizedSketch.graph.points.find(candidate => candidate.id === point.id)).toEqual(point);
    expect(resized.document.features[1]).toEqual(part.features[1]);
    expect(resized.sketchDiagnostics[0].diagnostics).toMatchObject({ status: 'success', conflictingIds: [], redundantIds: [], issues: [] });
    const session = new CadSession(part), before = session.getSnapshot();
    const failure = await session.editPrepared(before.version, async accepted => (await prepareCadEdits(accepted, [
      { kind: 'set-sketch-relation', sketchId: 'sketch', relation: { id: 'fixed-radius-10', kind: 'fixed-point', pointId: 'a', position: [-8, 6] } },
      { kind: 'set-parameter', name: 'stockRadius', value: 12 }
    ], runtime)).document).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(CadSketchPreparationError);
    if (!(failure instanceof CadSketchPreparationError)) throw new Error('Expected native radius conflict.');
    expect(failure.diagnostics.conflictingIds).toEqual(expect.arrayContaining(['stock-radius', 'fixed-radius-10']));
    expect(failure.feedback.reason).toBe('conflicting'); expect(session.getSnapshot()).toBe(before); expect(JSON.stringify(document)).toBe(original);
  });

  it('preserves the complete circle-to-major-arc candidate and atomically rejects a later incompatible radius driver', async () => {
    const document = circleTrimPart(), source = document.features[0];
    if (source.kind !== 'sketch' || !source.graph) throw new Error('Circle source missing.');
    const original = JSON.stringify(document), query = prepareCadSketchTrim({ graph: source.graph, parameters: document.parameters, entityId: 'disk', parameter: .25 });
    if (query.target.kind !== 'circle') throw new Error('Expected circle span.');
    const trim = { ...query.target, cutPointIds: ['b', 'a'] as const }, expected = trimCadSketchEntity({ graph: source.graph, parameters: document.parameters, trim });
    const edit = { kind: 'trim-sketch-entity', sketchId: 'sketch', trim } as const;
    const prepared = await prepareCadEdits(document, [edit], runtime), sketch = prepared.document.features[0];
    if (sketch.kind !== 'sketch' || !sketch.graph) throw new Error('Trimmed sketch missing.');
    expect(sketch.graph).toEqual(expected.graph); expect(sketch.graph.points).toEqual(source.graph.points);
    expect(sketch.graph.entities[0]).toEqual({ id: 'disk', kind: 'arc', centerPointId: 'center', startPointId: 'a', endPointId: 'b', direction: 'ccw', construction: false });
    expect(sketch.graph.entities[1]).toEqual(source.graph.entities[1]); expect(sketch.graph.relations).toEqual([]);
    expect(prepared.sketchDiagnostics[0].diagnostics).toMatchObject({ status: 'success', conflictingIds: [], redundantIds: [], issues: [] });
    const session = new CadSession(document), before = session.getSnapshot();
    const failed = await session.editPrepared(before.version, async accepted => (await prepareCadEdits(accepted, [edit,
      { kind: 'set-sketch-relation', sketchId: 'sketch', relation: { id: 'incompatible-radius', kind: 'radial-size', entityId: 'disk', quantity: 'radius', value: 8 } }
    ], runtime)).document).catch((error: unknown) => error);
    expect(failed).toBeInstanceOf(CadSketchPreparationError);
    if (!(failed instanceof CadSketchPreparationError)) throw new Error('Expected structured radius rejection.');
    expect(failed.feedback).toMatchObject({ reason: 'invalid-solution', subjects: [expect.objectContaining({ source: { kind: 'relation', id: 'incompatible-radius' } })] });
    expect(session.getSnapshot()).toBe(before); expect(JSON.stringify(document)).toBe(original);
  });

  it('accepts an exact middle split with original outer drivers then trims a survivor without losing its Collinear support', async () => {
    const base = middleTrimPart(), feature = base.features[0];
    if (feature.kind !== 'sketch' || !feature.graph) throw new Error('Middle source missing.');
    const document = parseCadDocument({ ...base, features: [{ ...feature, graph: { ...feature.graph,
      points: [...feature.graph.points, { id: 'follow-a', position: [2, -5] }, { id: 'follow-b', position: [2, 0] }],
      entities: [...feature.graph.entities, { id: 'follow', kind: 'line', construction: true, startPointId: 'follow-a', endPointId: 'follow-b' }] } }] });
    const source = document.features[0]; if (source.kind !== 'sketch' || !source.graph) throw new Error('Source missing.');
    const before = JSON.stringify(document), expected = trimCadSketchEntity({ graph: source.graph, parameters: document.parameters, trim: middleTrim });
    const prepared = await prepareCadEdits(document, [{ kind: 'trim-sketch-entity', sketchId: 'sketch', trim: middleTrim }], runtime);
    const sketch = prepared.document.features[0]; if (sketch.kind !== 'sketch' || !sketch.graph) throw new Error('Prepared middle sketch missing.');
    expect(sketch.graph).toEqual(expected.graph); expect(sketch.graph.points).toEqual(source.graph.points);
    expect(sketch.graph.relations.slice(0, source.graph.relations.length)).toEqual(source.graph.relations);
    expect(prepared.sketchDiagnostics[0].diagnostics).toMatchObject({ status: 'success', conflictingIds: [], redundantIds: [], issues: [] });
    const follow = prepareCadSketchTrim({ graph: sketch.graph, parameters: prepared.document.parameters, entityId: 'ab', parameter: .9 });
    if (follow.target.kind !== 'end') throw new Error('Expected end follow-on.');
    const trim = { ...follow.target, cutPointId: 'follow-b' }, next = trimCadSketchEntity({ graph: sketch.graph, parameters: prepared.document.parameters, trim });
    const completed = await prepareCadEdits(prepared.document, [{ kind: 'trim-sketch-entity', sketchId: 'sketch', trim }], runtime);
    const changed = completed.document.features[0]; if (changed.kind !== 'sketch' || !changed.graph) throw new Error('Follow-on missing.');
    expect(changed.graph).toEqual(next.graph); expect(changed.graph.points).toEqual(sketch.graph.points);
    expect(changed.graph.relations).toEqual(sketch.graph.relations);
    expect(changed.graph.entities.find(entity => entity.id === 'ab-right')).toEqual(sketch.graph.entities.find(entity => entity.id === 'ab-right'));
    expect(JSON.stringify(document)).toBe(before);
  });

  it.each(['cw', 'ccw'] as const)('accepts the complete constructed %s arc candidate without solver projection or driver changes', async direction => {
    const major = direction === 'cw', parameters = { cx: 0, cy: 0, ten: 10 };
    const graph = parseCadSketchGraph({ points: [{ id: 'o', position: [' cx ', ' cy '] }, { id: 'a', position: [10, 0] },
      { id: 'b', position: [0, ' ten '] }, { id: 'c', position: major ? [0, -20] : [-20, -20] },
      { id: 'd', position: major ? [0, -5] : [20, 20] }], entities: [
      { id: 'arc', kind: 'arc', construction: false, centerPointId: 'o', startPointId: 'a', endPointId: 'b', direction },
      { id: 'fence', kind: 'line', construction: true, startPointId: 'c', endPointId: 'd' }], relations: [] });
    const document = parseCadDocument({ ...createCadDocument('Arc trim', 'arc-trim'), schemaVersion: 2, parameters,
      features: [{ id: 'sketch', name: 'Arc', kind: 'sketch', plane: 'XY', offset: 0, suppressed: false, profiles: [], graph }] });
    const before = JSON.stringify(document), preview = prepareCadSketchTrim({ graph, parameters, entityId: 'arc', parameter: 0.1 });
    if (preview.target.kind !== 'end') throw new Error('Expected an end trim.');
    const trim = { ...preview.target, cutPointId: 'cut' }, expected = trimCadSketchEntity({ graph, parameters, trim });
    const prepared = await prepareCadEdits(document, [{ kind: 'trim-sketch-entity', sketchId: 'sketch', trim }], runtime);
    const sketch = prepared.document.features[0];
    if (sketch.kind !== 'sketch') throw new Error('Expected the same sketch.');
    expect(sketch.graph).toEqual(expected.graph); expect(prepared.document.parameters).toEqual(parameters);
    expect(prepared.sketchDiagnostics).toEqual([{ sketchId: 'sketch', diagnostics: {
      status: 'success', degreesOfFreedom: 8, conflictingIds: [], redundantIds: [], partiallyRedundantIds: [], issues: []
    } }]);
    expect(JSON.stringify(document)).toBe(before);
  });
});
