// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { CadDocument } from '@/domain/cad/cadDocument';
import type { CadFreshSketchInference } from '@/domain/cad/cadFreshSketchGraph';
import type { CadConstructionPoint } from '@/domain/cad/cadPathConstruction';
import { createCadDocument, parseCadDocument } from '@/domain/cad/cadSchema';
import { checkCadSketchGraph, parseCadSketchGraph, type CadSketchGraph } from '@/domain/cad/cadSketchGraph';
import { prepareCadEdits } from './cadEditPreparation';
import { createCadPathDraftGraph } from './cadPathDraftGraph';
import { createCadPathDraft, updateCadPathDraft, type CadPathDraftPick } from './cadPathDrawing';
import { CadSketchPreparationError } from './cadSketchConstraintFeedback';
import { appendCadSketchGraphWithInferences, cadSketchInferenceNote, submitCadSketchRelationsWithoutRepeats } from './cadSketchInferenceFallback';
import { createCadSketchTestSolver } from './sketch-solver/__tests__/cadSketchTestSolver';

let solves = 0;
const solver = createCadSketchTestSolver({ onSolve: () => { solves++; } });
const part = (graph: unknown) => parseCadDocument({ ...createCadDocument('Inference', 'inference'), schemaVersion: 2, features: [{
  id: 'sketch', kind: 'sketch', name: 'Sketch', suppressed: false, plane: 'XY', offset: 0, profiles: [], graph }] });
const join = (point: CadConstructionPoint, sourcePointId: string): CadPathDraftPick => ({ kind: 'coincident', point, sourcePointId, relationId: `join-${sourcePointId}` });
type Click = readonly [CadConstructionPoint, CadFreshSketchInference?, CadPathDraftPick?];
function drawing(document: CadDocument, [first, ...clicks]: readonly Click[]) {
  let draft = updateCadPathDraft(createCadPathDraft(), { kind: 'point', point: first[0], pick: first[2] });
  for (const [point, inferred, pick] of clicks) draft = updateCadPathDraft(draft, { kind: 'point', point, inferred, pick });
  const sketch = document.features[0];
  if (sketch.kind !== 'sketch' || !sketch.graph) throw new Error('Expected a point and edge sketch.');
  let next = 0;
  return { existing: sketch.graph, graph: createCadPathDraftGraph({ draft, closed: false, construction: false, createId: () => `drawn-${++next}`, existingGraph: sketch.graph }) };
}
function append(document: CadDocument, graph: CadSketchGraph, inferredIds: readonly string[], options: { signal?: AbortSignal; current?: () => boolean; abortAfterFailure?: AbortController } = {}) {
  const attempts: CadSketchGraph[] = [], failures: unknown[] = [], onDropped = vi.fn();
  const result = appendCadSketchGraphWithInferences({ graph, inferredIds, signal: options.signal, current: options.current ?? (() => true), onDropped,
    submit: async next => {
      attempts.push(next);
      try { return await prepareCadEdits(document, [{ kind: 'append-sketch-entities', sketchId: 'sketch', geometry: next }], solver, options.signal); }
      catch (error) { failures.push(error); options.abortAfterFailure?.abort(); throw error; }
    } });
  return { result, attempts, failures, onDropped };
}
const relations = (document: CadDocument) => { const sketch = document.features[0]; return sketch.kind === 'sketch' ? sketch.graph?.relations ?? [] : []; };
const horizontal = (relationId: string) => ({ kind: 'horizontal', relationId }) as const, vertical = (relationId: string) => ({ kind: 'vertical', relationId }) as const;
// A drawn line from p to q whose ends attach to points already kept level, then a free vertical line.
const levelPart = () => part({ points: [{ id: 'p', position: [0, 0] }, { id: 'q', position: [20, 0] }], entities: [], relations: [{ id: 'level', kind: 'horizontal', pointIds: ['p', 'q'] }] });
const repeated: readonly Click[] = [[[0, 0], undefined, join([0, 0], 'p')], [[20, 0], horizontal('repeat'), join([20, 0], 'q')], [[20, 10], vertical('plumb')]];

describe('inferred line relations at commit', () => {
  it('keeps inferred horizontal, vertical and horizontal lines with one preparation', async () => {
    const document = part({ points: [], entities: [], relations: [] });
    const { existing, graph } = drawing(document, [[[0, 0]], [[20, 0], horizontal('h1')], [[20, 10], vertical('v')], [[-5, 10], horizontal('h2')]]);
    expect(checkCadSketchGraph(parseCadSketchGraph({ points: [...existing.points, ...graph.points], entities: [...existing.entities, ...graph.entities],
      relations: [...existing.relations, ...graph.relations] }), {})).toEqual([]);
    solves = 0;
    const { result, attempts, onDropped } = append(document, graph, ['h1', 'v', 'h2']);
    const accepted = (await result).document;
    expect(attempts).toEqual([graph]); expect(solves).toBe(1); expect(onDropped).not.toHaveBeenCalled();
    expect(relations(accepted).map(relation => [relation.id, relation.kind])).toEqual([['h1', 'horizontal'], ['v', 'vertical'], ['h2', 'horizontal']]);
  });

  it('drops only the inferred relation the solver names as repeated and keeps the rest of the drawing', async () => {
    const document = levelPart(), { graph } = drawing(document, repeated);
    const { result, attempts, failures, onDropped } = append(document, graph, ['repeat', 'plumb']);
    const accepted = (await result).document;
    expect(failures).toHaveLength(1);
    const [failure] = failures;
    if (!(failure instanceof CadSketchPreparationError)) throw failure;
    expect(failure.feedback.reason).toBe('redundant'); expect(failure.diagnostics.redundantIds).toContain('repeat');
    // Each attempt keeps the drawn identities; only the blamed relation is left out.
    expect(attempts.map(attempt => attempt.relations.map(relation => relation.id))).toEqual([['join-p', 'join-q', 'repeat', 'plumb'], ['join-p', 'join-q', 'plumb']]);
    expect(attempts[1].points).toBe(graph.points);
    expect(relations(accepted).map(relation => relation.id)).toEqual(['level', 'join-p', 'join-q', 'plumb']);
    expect(onDropped).toHaveBeenCalledExactlyOnceWith([{ id: 'repeat', kind: 'horizontal', pointIds: [graph.points[0].id, graph.points[1].id] }], 'redundant');
    expect(cadSketchInferenceNote(onDropped.mock.calls[0][0], 'redundant')).toBe('Horizontal not added: it repeats existing relations.');
  });

  it('reports a failure that names only other relations without retrying', async () => {
    // An older sketch whose own relations already repeat each other.
    const document = part({ points: [{ id: 'p', position: [0, 0] }, { id: 'q', position: [20, 0] }], entities: [], relations: [{ id: 'level', kind: 'horizontal', pointIds: ['p', 'q'] },
      { id: 'p-y', kind: 'fixed-axis', pointId: 'p', axis: 'y', value: 0 }, { id: 'q-y', kind: 'fixed-axis', pointId: 'q', axis: 'y', value: 0 }] });
    const { graph } = drawing(document, [[[40, 0]], [[40, 10], vertical('plumb')]]);
    const { result, attempts, failures, onDropped } = append(document, graph, ['plumb']);
    const reported = await Promise.resolve(result).then(() => null, (error: unknown) => error);
    expect(reported).toBeInstanceOf(CadSketchPreparationError); expect(reported).toBe(failures[0]);
    expect(attempts).toHaveLength(1); expect(onDropped).not.toHaveBeenCalled();
    expect((failures[0] as CadSketchPreparationError).diagnostics.redundantIds).not.toContain('plumb');
  });

  it('never retries after an abort or once the sketch it started on has changed', async () => {
    const document = levelPart(), { graph } = drawing(document, repeated);
    const owner = new AbortController(), aborted = append(document, graph, ['repeat', 'plumb'], { signal: owner.signal, abortAfterFailure: owner });
    await expect(aborted.result).rejects.toBeInstanceOf(CadSketchPreparationError); expect(aborted.attempts).toHaveLength(1);
    const stale = append(document, graph, ['repeat', 'plumb'], { current: () => false });
    await expect(stale.result).rejects.toBeInstanceOf(CadSketchPreparationError); expect(stale.attempts).toHaveLength(1);
    expect(aborted.onDropped).not.toHaveBeenCalled(); expect(stale.onDropped).not.toHaveBeenCalled();
  });

  it('retries constraint relations only without optional ones a redundancy names, on the same base and while not aborted', async () => {
    // p–q is level through Parallel with the horizontal r–s, so fixing both ends on the X axis repeats one of them.
    const document = part({ points: [{ id: 'p', position: [0, 3] }, { id: 'q', position: [10, 3] }, { id: 'r', position: [0, 7] }, { id: 's', position: [10, 7] }],
      entities: [{ id: 'pq', kind: 'line', construction: false, startPointId: 'p', endPointId: 'q' }, { id: 'rs', kind: 'line', construction: false, startPointId: 'r', endPointId: 's' }],
      relations: [{ id: 'level', kind: 'horizontal', pointIds: ['r', 's'] }, { id: 'along', kind: 'parallel', lineIds: ['pq', 'rs'] }] });
    const fixes = [{ id: 'p-y', kind: 'fixed-axis', pointId: 'p', axis: 'y', value: 0 }, { id: 'q-y', kind: 'fixed-axis', pointId: 'q', axis: 'y', value: 0 }] as const;
    const run = (optionalIds: readonly string[], options: { current?: () => boolean; owner?: AbortController } = {}) => {
      const attempts: string[][] = [];
      const result = submitCadSketchRelationsWithoutRepeats({ relations: fixes, optionalIds, signal: options.owner?.signal, current: options.current ?? (() => true), submit: async relations => {
        attempts.push(relations.map(relation => relation.id));
        try { return await prepareCadEdits(document, relations.map(relation => ({ kind: 'set-sketch-relation', sketchId: 'sketch', relation } as const)), solver); }
        catch (error) { options.owner?.abort(); throw error; }
      } });
      return { result, attempts };
    };
    const kept = run(['p-y', 'q-y']);
    expect(relations((await kept.result).document).slice(2)).toEqual([fixes[0]]); expect(kept.attempts).toEqual([['p-y', 'q-y'], ['p-y']]);
    // A required relation the redundancy names, an abort or a changed base reports the first failure.
    for (const attempt of [run(['p-y']), run(['p-y', 'q-y'], { owner: new AbortController() }), run(['p-y', 'q-y'], { current: () => false })]) {
      await expect(attempt.result).rejects.toSatisfy(error => error instanceof CadSketchPreparationError && error.feedback.reason === 'redundant');
      expect(attempt.attempts).toHaveLength(1);
    }
  });

  it('describes dropped relations neutrally', () => {
    const level = { id: 'h', kind: 'horizontal', pointIds: ['a', 'b'] } as const, plumb = { id: 'v', kind: 'vertical', pointIds: ['b', 'c'] } as const;
    expect(cadSketchInferenceNote([plumb], 'conflicting')).toBe('Vertical not added: it conflicts with existing relations.');
    expect(cadSketchInferenceNote([level, plumb], 'redundant')).toBe('Horizontal and vertical relations not added: they repeat existing relations.');
    expect(cadSketchInferenceNote([level, { ...level, id: 'h2' }], 'failed')).toBe('Horizontal relations not added: the sketch could not keep them.');
  });
});
