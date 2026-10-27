// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { CadEdit } from '@/domain/cad/cadOperations';
import { compileCadSketchGeometry } from '@/domain/cad/compileCadSketchGeometry';
import { prepareCadSketchOffset, type CadSketchOffsetSource } from '@/domain/cad/cadSketchOffset';
import { offsetCirclePart, offsetGraphPart, offsetSlotPart } from '@/domain/cad/__tests__/cadSketchOffsetFixtures';
import { parseCadDocument } from '@/domain/cad/cadSchema';
import { parseCadSketchGraph } from '@/domain/cad/cadSketchGraph';
import { needsCadSketchPreparation, prepareCadEdits } from './cadEditPreparation';
import { CadSession } from './cadSession';
import { createCadSketchTestSolver } from './sketch-solver/__tests__/cadSketchTestSolver';

const runtime = createCadSketchTestSolver();
const sketchOf = (document: ReturnType<typeof offsetGraphPart>) => {
  const sketch = document.features[0]; if (sketch.kind !== 'sketch') throw new Error('Offset sketch missing.'); return sketch;
};
function graphSource(document: ReturnType<typeof offsetGraphPart>): CadSketchOffsetSource {
  const graph = compileCadSketchGeometry(sketchOf(document), document.parameters).graph;
  if (!graph?.cycles[0]) throw new Error('Source cycle missing.'); return { kind: 'graph-cycle', sourceRefs: graph.cycles[0].sourceRefs };
}

describe('detached Offset preparation', () => {
  it.each([
    { name: 'graph lines', document: () => offsetGraphPart(), source: (document: ReturnType<typeof offsetGraphPart>) => graphSource(document) },
    { name: 'graph mixed arcs', document: () => offsetGraphPart(true), source: (document: ReturnType<typeof offsetGraphPart>) => graphSource(document) },
    { name: 'rotated legacy slot', document: offsetSlotPart, source: (): CadSketchOffsetSource => ({ kind: 'profile', profileId: 'slot' }) }
  ])('accepts the entire exact $name constructor candidate while retaining every original source record', async fixture => {
    const document = fixture.document(), sketch = sketchOf(document), before = JSON.stringify(document);
    const request = { source: fixture.source(document), distance: 1, idPrefix: 'copy' };
    const expected = prepareCadSketchOffset({ sketch, parameters: document.parameters, ...request });
    const edit = { kind: 'offset-sketch-loop', sketchId: 'sketch', ...request } satisfies CadEdit;
    expect(needsCadSketchPreparation(document, [edit])).toBe(true);
    const prepared = await prepareCadEdits(document, [edit], runtime), changed = sketchOf(prepared.document);
    expect(changed).toEqual(expected.sketch); expect(changed.profiles).toEqual(sketch.profiles);
    expect(changed.graph?.points.slice(0, sketch.graph?.points.length ?? 0)).toEqual(sketch.graph?.points ?? []);
    expect(changed.graph?.entities.slice(0, sketch.graph?.entities.length ?? 0)).toEqual(sketch.graph?.entities ?? []);
    expect(changed.graph?.relations).toEqual(sketch.graph?.relations ?? []);
    expect(prepared.sketchDiagnostics[0].diagnostics).toMatchObject({ status: 'success', conflictingIds: [], redundantIds: [], issues: [] });
    expect(JSON.stringify(document)).toBe(before);
  });

  it('uses the preceding solved source and distance, refuses projected copies atomically, and leaves zero without native work or history', async () => {
    const base = offsetGraphPart(), original = sketchOf(base); if (!original.graph) throw new Error('Source missing.');
    const document = parseCadDocument({ ...base, features: [{ ...original, graph: { ...original.graph,
      points: original.graph.points.map(point => point.id === 'b' || point.id === 'c' ? { ...point, position: [20, point.position[1]] } : point),
      relations: [{ id: 'bottom', kind: 'horizontal', pointIds: ['a', 'b'] }, { id: 'right', kind: 'vertical', pointIds: ['b', 'c'] },
        { id: 'top', kind: 'horizontal', pointIds: ['c', 'd'] }, { id: 'left', kind: 'vertical', pointIds: ['d', 'a'] },
        { id: 'width', kind: 'distance', pointIds: ['a', 'b'], value: ' span ' }] } }] });
    const source = graphSource(document), sketch = sketchOf(document);
    const offset = { kind: 'offset-sketch-loop', sketchId: 'sketch', source, distance: 'delta', idPrefix: 'copy' } satisfies CadEdit;
    const edits = [{ kind: 'set-parameter', name: 'span', value: 24 }, { kind: 'set-parameter', name: 'delta', value: 2 }, offset] satisfies readonly CadEdit[];
    const expectedSource = (await prepareCadEdits(document, edits.slice(0, 2), runtime)).document;
    expect(sketchOf(expectedSource).graph?.points.find(point => point.id === 'b')?.position[0]).toBeCloseTo(24, 10);
    const expected = prepareCadSketchOffset({ sketch: sketchOf(expectedSource), parameters: expectedSource.parameters, source, distance: 'delta', idPrefix: 'copy' });
    expect(sketchOf((await prepareCadEdits(document, edits, runtime)).document)).toEqual(expected.sketch);
    const session = new CadSession(document), before = session.getSnapshot();
    await expect(session.editPrepared(before.version, async input => (await prepareCadEdits(input, [{ ...offset, distance: 2 }], {
      solve: async request => {
        const solved = await runtime.solve(request); if (solved.kind !== 'solved') return solved;
        const originalIds = new Set(sketch.graph?.points.map(point => point.id));
        const first = solved.graph.points.find(point => !originalIds.has(point.id)); if (!first) throw new Error('Copy point missing.');
        return { ...solved, graph: parseCadSketchGraph({ ...solved.graph, points: solved.graph.points.map(point => point.id === first.id
          ? { ...point, position: [Number(point.position[0]) + .01, point.position[1]] } : point) }) };
      }
    })).document)).rejects.toMatchObject({ code: 'sketch-offset-intent' });
    expect(session.getSnapshot()).toBe(before);
    const circle = offsetCirclePart(), zeroSession = new CadSession(circle), initial = zeroSession.getSnapshot();
    const solve = vi.fn(runtime.solve);
    await zeroSession.editPrepared(initial.version, async input => (await prepareCadEdits(input, [{ kind: 'offset-sketch-loop', sketchId: 'sketch',
      source: { kind: 'profile', profileId: 'circle' }, distance: 'radius-radius', idPrefix: 'zero' }], { solve })).document);
    expect(solve).not.toHaveBeenCalled(); expect(zeroSession.getSnapshot()).toBe(initial);
  });
});
