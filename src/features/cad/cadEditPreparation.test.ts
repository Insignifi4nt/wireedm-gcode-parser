// @vitest-environment node
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createCadDocument, parseCadDocument } from '@/domain/cad/cadSchema';
import { createCadSketchSolverRuntime } from './sketch-solver/cadSketchSolverRuntime';
import { initializeCadSketchSolverModule } from './sketch-solver/cadSketchSolverModule';
import { needsCadSketchPreparation, prepareCadEdits } from './cadEditPreparation';
import { CadSession } from './cadSession';
import type { CadEdit } from '@/domain/cad/cadOperations';

const require = createRequire(import.meta.url);
const solver = createCadSketchSolverRuntime(() => initializeCadSketchSolverModule(pathToFileURL(require.resolve('@salusoft89/planegcs/dist/planegcs_dist/planegcs.wasm')).href));
const source = () => parseCadDocument({ ...createCadDocument('Line', 'line'), schemaVersion: 2, parameters: { length: 20 }, features: [{
  id: 'sketch', kind: 'sketch', name: 'Sketch', suppressed: false, plane: 'XY', offset: 0, profiles: [], graph: {
    points: [{ id: 'a', position: ['0', '0'] }, { id: 'b', position: [20, 0] }],
    entities: [{ id: 'ab', kind: 'line', construction: false, startPointId: 'a', endPointId: 'b' }],
    relations: [{ id: 'horizontal', kind: 'horizontal', pointIds: ['a', 'b'] }, { id: 'distance', kind: 'distance', pointIds: ['a', 'b'], value: ' length ' }]
  }
}] });

describe('shared CAD edit preparation with the real sketch solver', () => {
  it('prepares the first appended graph before accepting its initially unsolved relations', async () => {
    const document = parseCadDocument({ ...createCadDocument('First line', 'first-line'), features: [{ id: 'sketch', name: 'Sketch', kind: 'sketch', suppressed: false, plane: 'XY', offset: 0, profiles: [] }] });
    const edits: readonly CadEdit[] = [{ kind: 'append-sketch-entities', sketchId: 'sketch', geometry: {
      points: [{ id: 'a', position: ['0', '0'] }, { id: 'b', position: [10, 2] }],
      entities: [{ id: 'ab', kind: 'line', construction: false, startPointId: 'a', endPointId: 'b' }],
      relations: [{ id: 'horizontal', kind: 'horizontal', pointIds: ['a', 'b'] }]
    } }];
    expect(needsCadSketchPreparation(document, edits)).toBe(true);
    const prepared = await prepareCadEdits(document, edits, solver);
    expect(prepared.document.schemaVersion).toBe(2); expect(document.schemaVersion).toBe(1);
    expect(prepared.document.features[0]).toMatchObject({ graph: { points: [{ position: ['0', '0'] }, { position: [10, 0] }] } });
  });

  it('solves a parameter change before acceptance, preserves expressions and commits exactly one undo step', async () => {
    const session = new CadSession(source()), before = session.getSnapshot();
    const accepted = await session.editPrepared(before.version, async document => (await prepareCadEdits(document, [{ kind: 'set-parameter', name: 'length', value: 30 }], solver)).document);
    expect(accepted.document.features[0]).toMatchObject({ graph: {
      points: [{ position: ['0', '0'] }, { position: [30, 0] }], relations: [{ id: 'horizontal' }, { value: ' length ' }]
    } });
    session.undo(); expect(session.getSnapshot().document).toBe(before.document); expect(session.getSnapshot().canUndo).toBe(false);
  });

  it('solves ordered point drags against the preceding candidate and leaves fixed dimensions in control', async () => {
    const document = source();
    const result = await prepareCadEdits(document, [
      { kind: 'remove-sketch-relation', sketchId: 'sketch', relationId: 'distance' },
      { kind: 'move-sketch-point', sketchId: 'sketch', pointId: 'b', translation: [5, 7] },
      { kind: 'move-sketch-point', sketchId: 'sketch', pointId: 'b', translation: [5, 0] }
    ], solver);
    expect(result.document.features[0]).toMatchObject({ graph: { points: [{ position: ['0', '0'] }, { position: [30, 0] }] } });
    const constrained = await prepareCadEdits(document, [{ kind: 'move-sketch-point', sketchId: 'sketch', pointId: 'b', translation: [5, 7] }], solver);
    expect(constrained.document).toEqual(document);
  });

  it('rejects a conflicting relation batch without changing accepted geometry, parameters or history', async () => {
    const session = new CadSession(source()), before = session.getSnapshot();
    await expect(session.editPrepared(before.version, async document => (await prepareCadEdits(document, [
      { kind: 'rename-document', name: 'Unaccepted' },
      { kind: 'set-sketch-relation', sketchId: 'sketch', relation: { id: 'otherLength', kind: 'distance', pointIds: ['a', 'b'], value: 10 } }
    ], solver)).document)).rejects.toThrow('conflict');
    expect(session.getSnapshot()).toBe(before);
  });

  it('captures the complete ordered edit intent before awaiting a solver response', async () => {
    let release: () => void = () => { throw new Error('No pending solve.'); };
    const gate = new Promise<void>(resolve => { release = resolve; });
    const rename = { kind: 'rename-document' as const, name: 'Captured' };
    const edits: CadEdit[] = [{ kind: 'move-sketch-point', sketchId: 'sketch', pointId: 'b', translation: [5, 0] }, rename];
    const prepared = prepareCadEdits(source(), edits, { solve: async input => { await gate; return solver.solve(input); } });
    rename.name = 'Changed outside'; edits.push({ kind: 'rename-document', name: 'Inserted later' });
    release();
    expect((await prepared).document.name).toBe('Captured');
  });
});
