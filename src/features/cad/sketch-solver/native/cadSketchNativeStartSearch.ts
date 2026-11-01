import { cadSketchEntityPointIds } from '../../../../domain/cad/cadSketchGraphReferences';
import type { CadSketchGraph, CadSketchGraphIssue } from '../../../../domain/cad/cadSketchGraph';
import type { CadSketchCompiledSketch } from '../../../../domain/cad/sketch-solver/compileCadSketchEquations';
import type { CadSketchEquationModel } from '../../../../domain/cad/sketch-solver/cadSketchEquationModel';
import type { CadSketchStartChoice } from '../../../../domain/cad/sketch-solver/cadSketchLoweringContext';
import { CAD_PRECISION } from '../../../../domain/precision/cadPrecision';
import { cadSketchEquationDiagnostics } from './cadSketchNativeProtocol';
import type { CadSketchNativeSolution } from './cadSketchNativeSolver';

// Which starts a failed solve tries next: relations offering several starts, as mirrors do, are searched one connected component at a
// time, since the solver solves each connected group of parameters alone and no start in one component moves another.

/** The relations offering several starts whose parameters are connected, in relation-id order. */
export interface CadSketchStartComponent { readonly choices: readonly CadSketchStartChoice[] }

/**
 * The most start combinations one component is tried in, its first included: every combination of two mirrors of two lines, which
 * offer at most four starts each.
 */
export const CAD_SKETCH_START_COMBINATIONS = 16;

/**
 * Connected parameters: each lasting equation joins its free operands, and every equation of one source joins with the others, so a
 * relation's parameters form one component whichever start it takes, as a mirror's pairs do about a fixed axis.
 */
function reach(model: CadSketchEquationModel) {
  const parent = model.values.map((_, index) => index), first = new Map<string, number>();
  const root = (index: number): number => { while (parent[index] !== index) index = parent[index] = parent[parent[index]]; return index; };
  for (const equation of model.equations) {
    if (equation.temporary) continue;
    for (const operand of equation.operands) {
      if (model.fixed[operand]) continue;
      const known = first.get(equation.sourceId);
      if (known === undefined) first.set(equation.sourceId, operand);
      else parent[root(operand)] = root(known);
    }
  }
  return { root, of: (sourceId: string) => { const at = first.get(sourceId); return at === undefined ? undefined : root(at); } };
}

const byId = (first: CadSketchStartChoice, second: CadSketchStartChoice) => first.relationId < second.relationId ? -1 : first.relationId > second.relationId ? 1 : 0;

/** The model's start choices grouped by the component of their parameters, each in relation-id order, ordered by their first relation id. */
export function cadSketchStartComponents(model: CadSketchCompiledSketch): readonly CadSketchStartComponent[] {
  const { of } = reach(model), components = new Map<number | string, CadSketchStartChoice[]>();
  for (const choice of [...model.startChoices].sort(byId)) {
    const key = of(choice.relationId) ?? choice.relationId, component = components.get(key);
    if (component) component.push(choice); else components.set(key, [choice]);
  }
  return [...components.values()].map(choices => ({ choices }));
}

/**
 * Up to `cap` combinations of the component's starts, by relation id, least moved first: by the summed movement of each relation's
 * start, then, where two tie within `mirrorPairingTieRelative`, by each relation's own order, the first relation's first. The first
 * is every relation's first start.
 */
export function cadSketchStartCombinations(component: CadSketchStartComponent, cap: number): readonly Readonly<Record<string, number>>[] {
  const { choices } = component, total = (combination: readonly number[]) => combination.reduce((sum, index, at) => sum + choices[at].costs[index], 0);
  const before = (first: readonly number[], second: readonly number[]) => {
    const [a, b] = [total(first), total(second)];
    if (Math.abs(a - b) > CAD_PRECISION.mirrorPairingTieRelative * Math.max(a, b)) return a < b;
    const at = first.findIndex((index, other) => index !== second[other]);
    return at >= 0 && first[at] < second[at];
  };
  // Best first: each combination taken offers the ones a step later in one relation, and starts are ordered least moved first.
  const found: (readonly number[])[] = [], frontier: (readonly number[])[] = [choices.map(() => 0)], seen = new Set([frontier[0].join()]);
  while (frontier.length && found.length < cap) {
    let next = 0;
    for (let at = 1; at < frontier.length; at++) if (before(frontier[at], frontier[next])) next = at;
    const [combination] = frontier.splice(next, 1);
    found.push(combination);
    choices.forEach((choice, at) => {
      if (combination[at] + 1 >= choice.costs.length) return;
      const step = combination.map((index, other) => other === at ? index + 1 : index), key = step.join();
      if (!seen.has(key)) { seen.add(key); frontier.push(step); }
    });
  }
  return found.map(combination => Object.fromEntries(choices.map((choice, at) => [choice.relationId, combination[at]])));
}

/**
 * The components, by their place in `components`, that a solution of `model` leaves failing: those holding a relation or edge the
 * diagnosis labels conflicting or redundant, or a point, edge or relation the graph checks of the solved graph (`issues`) report.
 * Failures outside every component name none.
 */
export function cadSketchFailingComponents(graph: CadSketchGraph, model: CadSketchCompiledSketch, solution: CadSketchNativeSolution,
  issues: readonly CadSketchGraphIssue[], components: readonly CadSketchStartComponent[]): ReadonlySet<number> {
  const { root, of } = reach(model), owner = new Map<number, number>(), failing = new Set<number>();
  components.forEach((component, at) => { for (const { relationId } of component.choices) { const found = of(relationId); if (found !== undefined) owner.set(found, at); } });
  const blame = (found: number | undefined) => { const at = found === undefined ? undefined : owner.get(found); if (at !== undefined) failing.add(at); };
  const parameter = (index: number | undefined) => { if (index !== undefined && !model.fixed[index]) blame(root(index)); };
  const point = (pointId: string) => { const x = model.pointParameters.get(pointId); if (x !== undefined) { parameter(x); parameter(x + 1); } };
  const { diagnosis } = solution;
  if ('labels' in diagnosis) {
    const ids = cadSketchEquationDiagnostics(model, diagnosis.labels);
    for (const id of [...ids.conflictingIds, ...ids.redundantIds, ...ids.partiallyRedundantIds]) blame(of(id));
  }
  for (const { source } of issues) {
    if (source.kind === 'point') { point(source.id); continue; }
    blame(of(source.id));
    const entity = source.kind === 'entity' ? graph.entities.find(item => item.id === source.id) : undefined;
    if (entity) { for (const pointId of cadSketchEntityPointIds(entity)) point(pointId); parameter(model.radiusParameters.get(entity.id)); }
  }
  return failing;
}
