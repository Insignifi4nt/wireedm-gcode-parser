// @vitest-environment node
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createCadDocument, parseCadDocument } from '@/domain/cad/cadSchema';
import type { CadDocument } from '@/domain/cad/cadDocument';
import type { CadEdit } from '@/domain/cad/cadOperations';
import { CadSession } from './cadSession';
import { prepareCadEdits } from './cadEditPreparation';
import { CadSketchPreparationError } from './cadSketchConstraintFeedback';
import { createCadSketchSolverRuntime } from './sketch-solver/cadSketchSolverRuntime';
import { initializeCadSketchSolverModule } from './sketch-solver/cadSketchSolverModule';

const require = createRequire(import.meta.url);
const runtime = createCadSketchSolverRuntime(() => initializeCadSketchSolverModule(pathToFileURL(
  require.resolve('@salusoft89/planegcs/dist/planegcs_dist/planegcs.wasm')).href));
const midpoint: CadEdit = { kind: 'set-sketch-relation', sketchId: 'sketch', relation: { id: 'mid', kind: 'midpoint', pointId: 'm', lineId: 'line' } };
function part(fixed = false) {
  return parseCadDocument({ ...createCadDocument('Midpoint propagation', 'midpoint'), schemaVersion: 2, parameters: { width: 40, retained: 7 }, features: [{
    id: 'sketch', name: 'Bore center', kind: 'sketch', plane: 'XY', offset: 0, suppressed: false, profiles: [], graph: {
      points: [{ id: 'a', position: ['0', ' 0 '] }, { id: 'b', position: [' width ', '0'] }, { id: 'm', position: fixed ? ['0', '4'] : [14, 3] }],
      entities: [{ id: 'line', kind: 'line', construction: true, startPointId: 'a', endPointId: 'b' },
        { id: 'bore', kind: 'circle', construction: false, centerPointId: 'm', radius: fixed ? ' 2 ' : 2 }], relations: []
    }
  }] });
}
function graph(document: CadDocument) {
  const sketch = document.features[0]; if (sketch.kind !== 'sketch' || !sketch.graph) throw Error('Expected graph'); return sketch.graph;
}
describe('prepared persistent midpoint edits', () => {
  it('commits parameter following and explicit detachment through one shared source/history path', async () => {
    const session = new CadSession(part()), initial = session.getSnapshot();
    const accept = (edits: readonly CadEdit[]) => session.editPrepared(session.getSnapshot().version,
      async document => (await prepareCadEdits(document, edits, runtime)).document);
    const added = await accept([midpoint]);
    expect(graph(added.document).points[2].position).toEqual([20, 0]);
    const grown = await accept([{ kind: 'set-parameter', name: 'width', value: 60 }]);
    expect(graph(grown.document).points[2].position).toEqual([30, 0]);
    expect(graph(grown.document).points.slice(0, 2)).toEqual(graph(initial.document).points.slice(0, 2));
    expect(graph(grown.document).entities).toEqual(graph(initial.document).entities);
    const detached = await accept([{ kind: 'remove-sketch-relation', sketchId: 'sketch', relationId: 'mid' },
      { kind: 'set-parameter', name: 'width', value: 80 }]);
    expect(graph(detached.document).points[2].position).toEqual([30, 0]);
    expect(graph(detached.document).relations).toEqual([]);
    session.undo(); expect(session.getSnapshot().document).toBe(grown.document);
    session.undo(); expect(session.getSnapshot().document).toBe(added.document);
    session.redo(); expect(session.getSnapshot().document).toBe(grown.document);
  });

  it('rejects incompatible exact drivers with a candidate-owned structured subject and no accepted batch advance', async () => {
    const session = new CadSession(part(true)), before = session.getSnapshot();
    let failure: unknown;
    try {
      await session.editPrepared(before.version, async document => (await prepareCadEdits(document,
        [{ kind: 'set-parameter', name: 'retained', value: 99 }, midpoint], runtime)).document);
    } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(CadSketchPreparationError);
    if (!(failure instanceof CadSketchPreparationError)) throw Error('Expected structured rejection');
    expect(failure.feedback).toMatchObject({ sketchId: 'sketch', reason: 'invalid-solution', subjects: [expect.objectContaining({
      category: 'issue', source: { kind: 'relation', id: 'mid' }, pointIds: ['m', 'a', 'b'], entityIds: ['line']
    })] });
    expect(failure.diagnostics).toMatchObject({ status: 'success', conflictingIds: [], redundantIds: [] });
    expect(session.getSnapshot()).toBe(before);
    expect(graph(before.document).points[2].position).toEqual(['0', '4']);
  });
});
