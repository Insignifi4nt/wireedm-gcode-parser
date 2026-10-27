// @vitest-environment node
// Seeded sketches built so that every relation holds, each solved natively from that start, from a
// perturbed start, dragged, and with a contradiction added. Here are the properties any answer must
// have; how each answer compares with PlaneGCS's is reviewed in the frozen corpus, which records them.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cadSketchSolvedValues, checkCadSketchGraph } from '@/domain/cad/cadSketchGraph';
import type { CadSketchSolveInput, CadSketchSolveResult } from './cadSketchSolverTypes';
import {
  CAD_SKETCH_FUZZ_VERSION, cadSketchFuzzFamilies, createCadSketchFuzzCase, minimizeCadSketchInput, type CadSketchFuzzCase
} from './__tests__/cadSketchFuzz';
import { corpusDragAllowance, corpusDragDistance, corpusHash, corpusInput, decodeCorpusJson, encodeCorpusJson } from './__tests__/planeGcsCorpus';
import { createCadSketchTestSolver } from './__tests__/cadSketchTestSolver';

const SEEDS = 150;
/** Every input the generator makes for these seeds, hashed: a change needs a new generator version and a corpus update. */
const GENERATED = { version: 1, hash: '5a91d8083a8e7992' };

/** The smallest inputs of failures the fuzz found, kept whatever later generators make. */
const regressions = decodeCorpusJson(readFileSync(new URL('./__tests__/fixtures/sketch-fuzz-regressions.json', import.meta.url), 'utf8')) as readonly {
  readonly seed: number; readonly version: number; readonly conflicting: readonly string[]; readonly input: CadSketchSolveInput }[];

type Role = 'witness' | 'perturbed' | 'drag' | 'reachable' | 'contradiction';
const roles: readonly Role[] = ['witness', 'perturbed', 'drag', 'reachable', 'contradiction'];
const inputOf = (fuzz: CadSketchFuzzCase, role: Role) => role === 'contradiction' ? fuzz.contradiction.input : fuzz[role];
const summary = (result: CadSketchSolveResult) => JSON.stringify([result.kind === 'solved' ? 'solved' : result.reason, result.diagnostics.degreesOfFreedom,
  result.diagnostics.conflictingIds, result.diagnostics.redundantIds, result.diagnostics.partiallyRedundantIds]);

/** What is wrong with one answer, if anything. */
function violation(fuzz: CadSketchFuzzCase, role: Role, input: CadSketchSolveInput, result: CadSketchSolveResult): string | undefined {
  const { conflictingIds, redundantIds, partiallyRedundantIds } = result.diagnostics;
  if ([...redundantIds, ...partiallyRedundantIds].some(id => conflictingIds.includes(id))) return `a relation named both conflicting and redundant in ${summary(result)}`;
  if (role === 'contradiction') {
    if (result.kind === 'solved') return 'a contradiction solved';
    if (result.reason !== 'conflicting' || !fuzz.contradiction.relationIds.some(id => result.diagnostics.conflictingIds.includes(id)))
      return `a contradiction of ${fuzz.contradiction.relationIds.join(' and ')} answered ${summary(result)}`;
    return;
  }
  // The witness meets every relation, so none of these can be conflicting.
  if (result.kind !== 'solved') return result.reason === 'redundant' ? undefined : `a consistent sketch answered ${summary(result)}`;
  const issues = checkCadSketchGraph(result.graph, input.parameters);
  if (issues.length) return `a solution fails the graph check: ${issues.map(issue => issue.message).join('; ')}`;
  if (encodeCorpusJson(result.graph.relations) !== encodeCorpusJson(input.graph.relations)) return 'a solution changed its relations';
  const expression = input.graph.points.findIndex((point, index) => point.position.some((value, axis) => typeof value === 'string' && result.graph.points[index].position[axis] !== value));
  if (expression >= 0) return `a solution moved the expression point ${input.graph.points[expression].id}`;
  if (role === 'witness') {
    const start = cadSketchSolvedValues(input.graph), moved = cadSketchSolvedValues(result.graph).findIndex((value, index) => Math.abs(value - start[index]) > 1e-12 * Math.max(1, Math.abs(start[index])));
    if (moved >= 0) return `a witness moved its value ${moved} from ${start[moved]}`;
  }
  if (role === 'drag') {
    const from = corpusDragDistance(input, input.graph), to = corpusDragDistance(input, result.graph);
    if (to > from + corpusDragAllowance(input, input.graph)) return `a drag ended ${to} from its target, further than its start ${from}`;
  }
  if (role === 'reachable') {
    const to = corpusDragDistance(input, result.graph);
    if (to > corpusDragAllowance(input, result.graph)) return `a drag ended ${to} from a target it can reach`;
  }
}

describe('seeded native sketch solves', () => {
  const cases = Array.from({ length: SEEDS }, (_, index) => createCadSketchFuzzCase(index + 1));

  it('generates the frozen inputs, covering every relation family and kind of contradiction', () => {
    expect({ version: CAD_SKETCH_FUZZ_VERSION, hash: corpusHash(cases.map(fuzz => roles.map(role => corpusInput(inputOf(fuzz, role)).hash).join()).join()).slice(0, 16) }).toEqual(GENERATED);
    const families = new Map<string, number>(), contradictions = new Map<string, number>();
    for (const fuzz of cases) {
      expect(checkCadSketchGraph(fuzz.witness.graph, fuzz.witness.parameters), `seed ${fuzz.seed}`).toEqual([]);
      for (const relation of fuzz.witness.graph.relations) families.set(relation.kind, (families.get(relation.kind) ?? 0) + 1);
      const added = fuzz.contradiction.input.graph.relations.find(relation => relation.id === fuzz.contradiction.relationIds[1])!;
      contradictions.set(added.kind, (contradictions.get(added.kind) ?? 0) + 1);
    }
    for (const family of cadSketchFuzzFamilies) expect(families.get(family) ?? 0, family).toBeGreaterThanOrEqual(8);
    expect([...contradictions.keys()].sort()).toEqual(['axis-distance', 'distance', 'fixed-axis', 'line-angle', 'radial-size']);
  });

  it('never calls a consistent sketch conflicting, never solves a contradiction, and keeps its instance clean', async () => {
    const solver = createCadSketchTestSolver(), problems: string[] = [], outcomes = new Map<string, number>();
    for (const fuzz of cases) for (const role of roles) {
      const input = inputOf(fuzz, role), before = encodeCorpusJson(input);
      let found: string | undefined;
      try {
        const result = await solver.solve(input);
        outcomes.set(`${role} ${result.kind === 'solved' ? 'solved' : result.reason}`, (outcomes.get(`${role} ${result.kind === 'solved' ? 'solved' : result.reason}`) ?? 0) + 1);
        found = violation(fuzz, role, input, result);
      } catch (error) { found = String(error); }
      if (encodeCorpusJson(input) !== before) found ??= 'the solve changed its input';
      if (!found) continue;
      // Kept small enough to read, and to keep as a fixture.
      const fresh = createCadSketchTestSolver({ allowNativeFailure: true });
      const keep = new Set(role === 'contradiction' ? fuzz.contradiction.relationIds : []);
      const smallest = await minimizeCadSketchInput(input, async candidate => {
        try { return violation(fuzz, role, candidate, await fresh.solve(candidate)) !== undefined; } catch { return true; }
      }, keep);
      problems.push(`seed ${fuzz.seed} ${role}: ${found}; smallest failing input ${encodeCorpusJson(smallest)}`);
    }
    expect(problems).toEqual([]);
    // Each property is exercised, not passed vacuously.
    for (const outcome of ['witness solved', 'witness redundant', 'perturbed solved', 'perturbed redundant', 'drag solved', 'drag redundant', 'reachable solved', 'contradiction conflicting'])
      expect(outcomes.get(outcome) ?? 0, outcome).toBeGreaterThanOrEqual(10);

    const fresh = createCadSketchTestSolver();
    for (const fuzz of cases.slice(0, 4)) for (const role of roles) {
      const input = inputOf(fuzz, role);
      expect(encodeCorpusJson(await solver.solve(input)), `seed ${fuzz.seed} ${role}`).toBe(encodeCorpusJson(await fresh.solve(input)));
    }
  }, 120_000);

  // Two relations held the same coordinates to values that cannot agree, beside relations whose stall
  // native cannot diagnose; native once left them undiagnosed, where it now blames the repeats.
  it.each(regressions)('names only the contradiction of seed $seed from generator $version', async ({ input, conflicting }) => {
    expect(await createCadSketchTestSolver().solve(input)).toMatchObject({ kind: 'rejected', reason: 'conflicting',
      diagnostics: { conflictingIds: conflicting, redundantIds: [], partiallyRedundantIds: [] } });
  });

  it('minimizes a failure to the relations it needs, keeping those it must', async () => {
    const { witness } = cases.find(fuzz => fuzz.witness.graph.relations.length >= 6)!, ids = witness.graph.relations.map(relation => relation.id);
    const needs = async (input: CadSketchSolveInput) => [ids[1], ids[4]].every(id => input.graph.relations.some(relation => relation.id === id));
    expect((await minimizeCadSketchInput(witness, needs)).graph.relations.map(relation => relation.id)).toEqual([ids[1], ids[4]]);
    expect((await minimizeCadSketchInput(witness, needs, new Set([ids[5]]))).graph.relations.map(relation => relation.id)).toEqual([ids[1], ids[4], ids[5]]);
  });
});
