// @vitest-environment node
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Value } from '@sinclair/typebox/value';
import { CadEditSchema, type CadEdit } from '@/domain/cad/cadOperations';
import { parseCadDocument } from '@/domain/cad/cadSchema';
import { prepareCadSketchMirror } from '@/domain/cad/cadSketchMirror';
import { compileCadSketchGraph } from '@/domain/cad/cadSketchGraphGeometry';
import { pairedBoreMirrorPart, mirrorBoreRequest, mixedMirrorPart, mixedMirrorRequest } from '@/domain/cad/__tests__/cadSketchMirrorFixtures';
import { prepareCadEdits } from './cadEditPreparation';
import { CadSession } from './cadSession';
import { createCadSketchSolverRuntime } from './sketch-solver/cadSketchSolverRuntime';
import { initializeCadSketchSolverModule } from './sketch-solver/cadSketchSolverModule';

const require = createRequire(import.meta.url);
const runtime = createCadSketchSolverRuntime(() => initializeCadSketchSolverModule(pathToFileURL(
  require.resolve('@salusoft89/planegcs/dist/planegcs_dist/planegcs.wasm')).href));

describe('exact native Mirror copy preparation', () => {
  it.each([{ part: pairedBoreMirrorPart, request: mirrorBoreRequest }, { part: mixedMirrorPart, request: mixedMirrorRequest }])('accepts the complete independent copy from $part.name without projecting source or declared joints', async ({ part, request }) => {
    const document = part(), sketch = document.features[0]; if (sketch.kind !== 'sketch' || !sketch.graph) throw new Error('Mirror source missing.');
    const edit = { kind: 'mirror-sketch-geometry', sketchId: 'sketch', ...request } as const;
    expect(Value.Check(CadEditSchema, edit)).toBe(true);
    const original = JSON.stringify(document), expected = prepareCadSketchMirror({ sketch, parameters: document.parameters, ...request });
    const result = await prepareCadEdits(document, [edit], runtime);
    expect(result.document).toEqual({ ...document, features: [expected.sketch] });
    expect(expected.sketch.graph?.points.slice(0, sketch.graph.points.length)).toEqual(sketch.graph.points);
    expect(expected.sketch.graph?.entities.slice(0, sketch.graph.entities.length)).toEqual(sketch.graph.entities);
    expect(expected.sketch.graph?.relations.slice(0, sketch.graph.relations.length)).toEqual(sketch.graph.relations);
    expect(result.sketchDiagnostics[0].diagnostics).toMatchObject({ status: 'success', conflictingIds: [], redundantIds: [], partiallyRedundantIds: [], issues: [] });
    if (request.idPrefix === 'copy') expect(expected.sketch.graph?.relations.slice(sketch.graph.relations.length)).toEqual([
      { id: 'copy_j0', kind: 'coincident', pointIds: ['copy_p0', 'copy_p1'] }]);
    expect(JSON.stringify(document)).toBe(original);
  });

  it('keeps a copied bore independent when its new diameter and original expression driver change', async () => {
    const document = pairedBoreMirrorPart(), edit = { kind: 'mirror-sketch-geometry', sketchId: 'sketch', ...mirrorBoreRequest } as const;
    const copy = await prepareCadEdits(document, [edit], runtime), relation = { id: 'copy-diameter', kind: 'radial-size', entityId: 'mirror_e0', quantity: 'diameter', value: '8.000' } as const;
    const sized = await prepareCadEdits(copy.document, [{ kind: 'set-sketch-relation', sketchId: 'sketch', relation }], runtime);
    const resized = await prepareCadEdits(sized.document, [{ kind: 'set-parameter', name: 'boreDiameter', value: 10 }], runtime);
    const source = document.features[0], sketch = resized.document.features[0]; if (source.kind !== 'sketch' || !source.graph || sketch.kind !== 'sketch' || !sketch.graph) throw new Error('Bores missing.');
    expect(sketch.graph.points.slice(0, source.graph.points.length)).toEqual(source.graph.points);
    expect(sketch.graph.entities.slice(0, source.graph.entities.length)).toEqual(source.graph.entities);
    expect(sketch.graph.relations).toEqual([relation]);
    const geometry = compileCadSketchGraph(sketch.graph, resized.document.parameters);
    expect(geometry.segments.find(segment => segment.id === 'bore')).toMatchObject({ kind: 'circle', radius: 5 });
    expect(geometry.segments.find(segment => segment.id === 'mirror_e0')).toMatchObject({ kind: 'circle', center: { x: 45, y: 15 }, radius: 4 });
  });

  it('flushes preceding source and axis parameter solves before constructing the reflected numeric point', async () => {
    const base = pairedBoreMirrorPart(), sketch = base.features[0]; if (sketch.kind !== 'sketch' || !sketch.graph) throw new Error('Source missing.');
    const document = parseCadDocument({ ...base, parameters: { ...base.parameters, boreX: 15, axisX: 30 }, features: [{ ...sketch, graph: { ...sketch.graph,
      points: sketch.graph.points.map(point => point.id === 'bore-center' ? { ...point, position: [15, '15'] } : point.id.startsWith('axis-') ? { ...point, position: [30, point.position[1]] } : point),
      relations: [{ id: 'source-x', kind: 'fixed-axis', pointId: 'bore-center', axis: 'x', value: ' boreX ' },
        { id: 'axis-x-a', kind: 'fixed-axis', pointId: 'axis-a', axis: 'x', value: ' axisX ' }, { id: 'axis-x-b', kind: 'fixed-axis', pointId: 'axis-b', axis: 'x', value: ' axisX ' }] } }] });
    const result = await prepareCadEdits(document, [{ kind: 'set-parameter', name: 'boreX', value: 20 }, { kind: 'set-parameter', name: 'axisX', value: 35 },
      { kind: 'mirror-sketch-geometry', sketchId: 'sketch', ...mirrorBoreRequest }], runtime);
    const changed = result.document.features[0]; if (changed.kind !== 'sketch') throw new Error('Changed source missing.');
    expect(changed.graph?.points.find(point => point.id === 'bore-center')?.position).toEqual([20, '15']);
    expect(changed.graph?.points.find(point => point.id === 'mirror_p0')?.position).toEqual([50, 15]);
    expect(changed.graph?.relations).toEqual(document.features[0].kind === 'sketch' ? document.features[0].graph?.relations : []);
  });

  it('rejects a native projected copy and an aborted completion without committing either candidate', async () => {
    const document = pairedBoreMirrorPart(), session = new CadSession(document), before = session.getSnapshot();
    const edits = [{ kind: 'mirror-sketch-geometry', sketchId: 'sketch', ...mirrorBoreRequest }] as const satisfies readonly CadEdit[];
    const projected = { solve: async (...args: Parameters<typeof runtime.solve>) => {
      const result = await runtime.solve(...args); if (result.kind !== 'solved') return result;
      return { ...result, graph: { ...result.graph, points: result.graph.points.map(point => point.id === 'mirror_p0' ? { ...point, position: [46, 15] as const } : point) } };
    } };
    await expect(session.editPrepared(before.version, async source => (await prepareCadEdits(source, edits, projected)).document)).rejects.toMatchObject({ code: 'sketch-mirror-intent' });
    expect(session.getSnapshot()).toBe(before);
    const abort = new AbortController(), interrupted = { solve: async (...args: Parameters<typeof runtime.solve>) => { const result = await runtime.solve(...args); abort.abort(); return result; } };
    await expect(session.editPrepared(before.version, async source => (await prepareCadEdits(source, edits, interrupted, abort.signal)).document, abort.signal)).rejects.toThrow();
    expect(session.getSnapshot()).toBe(before);
  });
});
