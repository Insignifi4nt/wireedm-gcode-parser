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

const require = createRequire(import.meta.url);
const runtime = createCadSketchSolverRuntime(() => initializeCadSketchSolverModule(pathToFileURL(
  require.resolve('@salusoft89/planegcs/dist/planegcs_dist/planegcs.wasm')).href));

describe('real PlaneGCS exact end-Trim preparation', () => {
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
