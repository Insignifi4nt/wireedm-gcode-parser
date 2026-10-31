import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { compileCadSketchEquations } from '@/domain/cad/sketch-solver/compileCadSketchEquations';
import { equationBaselineInputs, equationBaselineNative, equationBaselinePaths, readEquationBaseline, recordEquationBaselineInput, sha256,
  type EquationBaselineAnswer, type EquationBaselineInput, type EquationBaselineModel, type EquationBaselineRecord } from './cadSketchEquationBaseline';

// Replays the equations the per-kind compiler gave, and native's answers to them, before relations compiled from their definitions. The
// fixture holds every graph of the relation baseline placed and given parameters, every input of the frozen solver corpus and every input
// the solver benchmarks solve, with each compiled model in full and hashes of the graph checks, the constraint inspection's relation rows
// and the solver's own attempt. Native is deterministic, so the same equations give the same answers. It is frozen:
// scripts/record-sketch-equation-baseline.ts recorded it at the commit its manifest names, never from this code, and the manifest gives
// its inputs, normalization and steps.

const paths = equationBaselinePaths(), bytes = readFileSync(paths.fixture);
const manifest = JSON.parse(readFileSync(paths.manifest, 'utf8')) as {
  readonly source: { readonly commit: string };
  readonly counts: { readonly inputs: number; readonly compiled: number; readonly refused: number; readonly equations: number; readonly temporary: number; readonly relations: number };
  readonly sha256: { readonly gzip: string };
};
const baseline = readEquationBaseline(paths.fixture);
const inputs = equationBaselineInputs(baseline.benchmark, paths);
let native: Awaited<ReturnType<typeof equationBaselineNative>>;
beforeAll(async () => { native = await equationBaselineNative(paths); });

type Model = Exclude<EquationBaselineModel, { readonly throws: string }>;
type Equation = Model['equations'][number];
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const parts = (equation: Equation) => ({ kind: equation[0], operands: equation.slice(5), value: equation[3], tag: [equation[2], equation[1], equation[4]] });

/** The first way two compiled models differ, in the order the checks read them, or undefined when they are the same. */
function modelDifference(recorded: EquationBaselineModel, current: EquationBaselineModel): string | undefined {
  if ('throws' in recorded || 'throws' in current) return same(recorded, current) ? undefined : `compiled ${JSON.stringify(current)}, recorded ${JSON.stringify(recorded)}`;
  if (recorded.equations.length !== current.equations.length) return `${current.equations.length} equations, recorded ${recorded.equations.length}`;
  const aspects: [string, (equation: Equation) => unknown][] = [['kind', e => parts(e).kind], ['operands', e => parts(e).operands], ['value', e => parts(e).value],
    ['tag, source and temporary', e => parts(e).tag]];
  for (const [aspect, read] of aspects) {
    const index = current.equations.findIndex((equation, at) => !same(read(equation), read(recorded.equations[at])));
    if (index >= 0) return `equation ${index} ${aspect} ${JSON.stringify(read(current.equations[index]))}, recorded ${JSON.stringify(read(recorded.equations[index]))}`;
  }
  if (!same(recorded.fixed, current.fixed)) return `fixed ${JSON.stringify(current.fixed)}, recorded ${JSON.stringify(recorded.fixed)}`;
  if (recorded.layout !== current.layout || recorded.values !== current.values) return 'parameter layout or start values';
  return undefined;
}
/** The first way two native answers differ: freedom and definition codes, then labels, then the rest. */
function answerDifference(recorded: EquationBaselineAnswer | null, current: EquationBaselineAnswer | null): string | undefined {
  if (same(recorded, current)) return undefined;
  if (!recorded || !current || 'throws' in recorded || 'throws' in current) return `answer ${JSON.stringify(current)}, recorded ${JSON.stringify(recorded)}`;
  if (!same([recorded[3], recorded[5]], [current[3], current[5]])) return `freedom ${current[3]} and definition codes ${current[5]}, recorded ${recorded[3]} and ${recorded[5]}`;
  if (!same(recorded[4], current[4])) return `redundancy and conflict labels ${JSON.stringify(current[4])}, recorded ${JSON.stringify(recorded[4])}`;
  return `answer ${JSON.stringify(current)}, recorded ${JSON.stringify(recorded)}`;
}
const RECORD_PARTS = ['source', 'input', 'model', 'answer', 'graph checks', 'inspection rows', 'solver attempt'] as const;

const group = (source: string) => source.startsWith('benchmark:') ? 'benchmark' : source.split(':')[0];
const totals = { inputs: 0, compiled: 0, refused: 0, equations: 0, temporary: 0, relations: 0 };
async function replay(items: readonly EquationBaselineInput[], records: readonly EquationBaselineRecord[]) {
  const differences: string[] = [];
  for (const [index, item] of items.entries()) {
    const recorded = records[index];
    const { compiled, record } = await recordEquationBaselineInput(compileCadSketchEquations, native, item);
    totals.inputs++; totals.relations += item.input.graph.relations.length;
    if (compiled.model) { totals.compiled++; totals.equations += compiled.model.equations.length; totals.temporary += compiled.model.equations.filter(equation => equation.temporary).length; }
    else totals.refused++;
    const model = modelDifference(baseline.models[recorded[2]], compiled.stored), answer = answerDifference(recorded[3], record[3]);
    const other = RECORD_PARTS.filter((_, at) => at !== 3 && record[at] !== recorded[at]);
    if (model || answer || other.length) differences.push(`${item.source}: ${model ?? answer ?? `${other.join(', ')} changed`}`);
  }
  return differences;
}

describe('sketch equation baseline', () => {
  it('replays the fixture its manifest names', () => {
    expect(sha256(bytes)).toBe(manifest.sha256.gzip);
    expect(baseline.records.map(record => record[0])).toEqual(inputs.map(item => item.source));
    expect(inputs.length).toBe(manifest.counts.inputs);
  });

  // Each group of inputs in its own test, in the fixture's order, so a difference names its group and the first ways inputs differ.
  for (const name of ['relation-baseline', 'corpus', 'benchmark']) {
    it(`compiles the same equations as before, which native answers the same way: ${name} inputs`, async () => {
      const at = inputs.flatMap((item, index) => group(item.source) === name ? [index] : []);
      expect(at.length).toBeGreaterThan(0);
      const differences = await replay(at.map(index => inputs[index]), at.map(index => baseline.records[index]));
      expect(differences.slice(0, 5), `${differences.length} of ${at.length} inputs differ`).toEqual([]);
    }, 300_000);
  }

  it('compiles as many inputs, refusals and equations as the recording', () => {
    expect(totals).toEqual({ inputs: manifest.counts.inputs, compiled: manifest.counts.compiled, refused: manifest.counts.refused,
      equations: manifest.counts.equations, temporary: manifest.counts.temporary, relations: manifest.counts.relations });
  });
});
