// @vitest-environment node
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseCadDocument } from '@/domain/cad/cadSchema';
import { placeCadSketchGraph } from '@/domain/cad/cadSketchPlacement';
import { dPlacement, placementPart, placementSketch, placementMixedGraph } from '@/domain/cad/__tests__/cadSketchPlacementFixtures';
import { lineReferencePart, lineUseReference, lineMidpoint } from '@/domain/cad/__tests__/cadSketchExternalReferenceFixtures';
import { applyCadEdits } from '@/domain/cad/cadOperations';
import type { CadSketchSolverClient } from './sketch-solver/cadSketchSolverTypes';
import { prepareCadEdits } from './cadEditPreparation';
import { CadSession } from './cadSession';
import { createCadSketchSolverRuntime } from './sketch-solver/cadSketchSolverRuntime';
import { initializeCadSketchSolverModule } from './sketch-solver/cadSketchSolverModule';
const require = createRequire(import.meta.url);
const solver = createCadSketchSolverRuntime(() => initializeCadSketchSolverModule(pathToFileURL(require.resolve('@salusoft89/planegcs/dist/planegcs_dist/planegcs.wasm')).href));
const edit = { kind: 'place-sketch-geometry', sketchId: 'sketch', ...dPlacement } as const;
describe('prepared exact rigid placement', () => {
  it('flushes preceding request parameters and retains the entire cardinal native candidate exactly', async () => {
    const source = placementPart();
    const result = await prepareCadEdits(source, [{ kind: 'set-parameter', name: 'angle', value: 90 }, { ...edit, target: [' targetX ', 20], angleDegrees: ' angle ' }], solver);
    expect(placementSketch(result.document).graph).toEqual(placeCadSketchGraph({ graph: placementSketch(source).graph, parameters: result.document.parameters, ...dPlacement }));
    expect(result.document.features[0]).toEqual(source.features[0]);
    expect(result.sketchDiagnostics[0].diagnostics).toMatchObject({ status: 'success', conflictingIds: [], redundantIds: [], issues: [] });
  });
  it('rejects a solver-adjusted world driver atomically rather than accepting a nearby pose', async () => {
    const original = placementPart(), sketch = placementSketch(original);
    const source = parseCadDocument({ ...original, features: original.features.map(feature => feature.id === 'sketch' ? { ...sketch, graph: {
      points: [{ id: 'a', position: [0, 0] }, { id: 'b', position: [10, 0] }], entities: [{ id: 'line', kind: 'line', startPointId: 'a', endPointId: 'b', construction: false }],
      relations: [{ id: 'horizontal', kind: 'horizontal', pointIds: ['a', 'b'] }] } } : feature) });
    const session = new CadSession(source), before = session.getSnapshot();
    await expect(session.editPrepared(before.version, async document => (await prepareCadEdits(document, [{ kind: 'set-parameter', name: 'angle', value: 37 },
      { ...edit, selections: [{ kind: 'entity', id: 'line' }], angleDegrees: 'angle' }], solver)).document)).rejects.toMatchObject({ code: 'sketch-placement-intent' });
    expect(session.getSnapshot()).toBe(before);
  });
  it('retains the actual oblique mixed native candidate, and rejects hostile motion anywhere else in that graph', async () => {
    const original = placementPart(), sketch = placementSketch(original), graph = placementMixedGraph();
    const source = parseCadDocument({ ...original, features: original.features.map(feature => feature.id === 'sketch' ? { ...sketch, graph } : feature) });
    const oblique = { ...edit, selections: graph.entities.map(entity => ({ kind: 'entity', id: entity.id } as const)), anchor: [0, 5], target: [12, -9], angleDegrees: 37 } as const;
    const expected = placeCadSketchGraph({ graph, parameters: source.parameters, ...oblique });
    expect(placementSketch((await prepareCadEdits(source, [oblique], solver)).document).graph).toEqual(expected);
    const semicircle = parseCadDocument({ ...original, features: original.features.map(feature => feature.id === 'sketch' ? { ...sketch, graph: {
      points: [{ id: 'o', position: [0, 0] }, { id: 's', position: [-10, 0] }, { id: 'e', position: [10, 0] }], entities: [
        { id: 'arc', kind: 'arc', construction: false, centerPointId: 'o', startPointId: 's', endPointId: 'e', direction: 'ccw' }], relations: [] } } : feature) });
    const semiEdit = { ...edit, selections: [{ kind: 'entity', id: 'arc' }], target: [13, 17], angleDegrees: 37 } as const;
    const semiExpected = placeCadSketchGraph({ graph: placementSketch(semicircle).graph, parameters: semicircle.parameters, ...semiEdit });
    expect(placementSketch((await prepareCadEdits(semicircle, [semiEdit], solver)).document).graph).toEqual(semiExpected);
    const hostile: Pick<CadSketchSolverClient, 'solve'> = { async solve(input) {
      const result = await solver.solve(input);
      return result.kind !== 'solved' ? result : { ...result, graph: { ...result.graph, points: result.graph.points.map(point => point.id === 'outside'
        ? { ...point, position: [Number(point.position[0]) + 1, point.position[1]] } : point) } };
    } };
    await expect(prepareCadEdits(original, [edit], hostile)).rejects.toMatchObject({ code: 'sketch-placement-intent' });
    const abort = new AbortController(), aborting: Pick<CadSketchSolverClient, 'solve'> = { async solve(input) {
      const result = await solver.solve(input); abort.abort(); return result;
    } };
    const session = new CadSession(original), before = session.getSnapshot();
    await expect(session.editPrepared(before.version, async document => (await prepareCadEdits(document, [edit], aborting, abort.signal)).document, abort.signal)).rejects.toThrow();
    expect(session.getSnapshot()).toBe(before);
  });
  it('certifies the edited source before refreshing only actual downstream linked numeric geometry', async () => {
    const original = lineReferencePart(), layout = original.features[0]; if (layout.kind !== 'sketch' || !layout.graph) throw new Error('Missing layout.');
    const numeric = parseCadDocument({ ...original, features: [{ ...layout, graph: { ...layout.graph,
      points: [{ id: 'a', position: [0, 10] }, { id: 'b', position: [40, 10] }] } }, ...original.features.slice(1)] });
    const source = applyCadEdits(numeric, [lineUseReference, lineMidpoint]);
    const result = await prepareCadEdits(source, [{ kind: 'place-sketch-geometry', sketchId: 'layout', selections: [{ kind: 'entity', id: 'line' }],
      anchor: [0, 10], target: [30, 20], angleDegrees: 90 }], solver);
    const changed = result.document.features[0], target = result.document.features[1];
    if (changed.kind !== 'sketch' || !changed.graph || target.kind !== 'sketch' || !target.graph) throw new Error('Missing linked sketches.');
    expect(changed.graph.points.map(point => point.position)).toEqual([[30, 20], [30, 60]]);
    expect(target.graph.points.find(point => point.id === 'hole-center')?.position).toEqual([30, 40]);
    expect(target.graph.relations).toEqual(source.features[1].kind === 'sketch' ? source.features[1].graph?.relations : undefined);
    expect(target.graph.points.slice(0, 4)).toEqual(numeric.features[1].kind === 'sketch' ? numeric.features[1].graph?.points.slice(0, 4) : undefined);
  });
});
