import type { CadSketchGraph } from '../../../../domain/cad/cadSketchGraph';
import { cadSketchEquationArity, cadSketchEquationKinds, type CadSketchEquationModel } from '../../../../domain/cad/sketch-solver/cadSketchEquationModel';
import type { CadSketchDefinition } from '../cadSketchSolverTypes';

// The native solver's buffer protocol: how an equation model is encoded for it, and how its labels and definition codes read back.

export const CAD_SKETCH_NATIVE_PROTOCOL_VERSION = 7;
/** Option bit of the Rust `problem::DEFINE`: also analyse each parameter's definition. */
export const CAD_SKETCH_NATIVE_DEFINE = 1;

export interface CadSketchNativeOptions {
  /** Report each parameter's definition code; a model with drag targets cannot ask. */
  readonly analyseDefinition?: boolean;
}

export function encodeCadSketchEquationModel(model: CadSketchEquationModel, options: CadSketchNativeOptions = {}): Float64Array {
  const length = 4 + 2 * model.values.length + model.equations.reduce((total, equation) => total + 4 + equation.operands.length, 0);
  const buffer = new Float64Array(length);
  buffer.set([CAD_SKETCH_NATIVE_PROTOCOL_VERSION, model.values.length, model.equations.length, options.analyseDefinition ? CAD_SKETCH_NATIVE_DEFINE : 0]);
  buffer.set(model.values, 4);
  buffer.set(model.fixed.map(Number), 4 + model.values.length);
  let cursor = 4 + 2 * model.values.length;
  for (const equation of model.equations) {
    if (equation.operands.length !== cadSketchEquationArity[equation.kind]) throw new Error(`A ${equation.kind} equation needs ${cadSketchEquationArity[equation.kind]} operands.`);
    buffer.set([cadSketchEquationKinds.indexOf(equation.kind), equation.value, equation.tag, Number(equation.temporary ?? false), ...equation.operands], cursor);
    cursor += 4 + equation.operands.length;
  }
  return buffer;
}

/** Label bits of one diagnosed equation, as the Rust `diagnose` module sets them. */
export const CAD_SKETCH_EQUATION_REDUNDANT = 1, CAD_SKETCH_EQUATION_CONFLICTING = 2;

/**
 * Source identities of the constraints that equation `labels` make conflicting, redundant or
 * partially redundant (redundant through some but not all of its equations), each in compiled
 * order and listed once, as the PlaneGCS runtime reported them. A source whose constraints are
 * labelled apart, as a fixed point's two axes, is only conflicting when any of them conflicts.
 */
export function cadSketchEquationDiagnostics(model: CadSketchEquationModel, labels: readonly number[]) {
  const conflicting = new Set<string>(), redundant = new Set<string>(), partiallyRedundant = new Set<string>();
  for (let start = 0; start < model.equations.length;) {
    let end = start + 1;
    while (end < model.equations.length && model.equations[end].tag === model.equations[start].tag) end++;
    const bits = labels.slice(start, end), sourceId = model.equations[start].sourceId;
    if (bits.some(bit => bit & CAD_SKETCH_EQUATION_CONFLICTING)) conflicting.add(sourceId);
    else if (bits.every(bit => bit & CAD_SKETCH_EQUATION_REDUNDANT)) redundant.add(sourceId);
    else if (bits.some(bit => bit & CAD_SKETCH_EQUATION_REDUNDANT)) partiallyRedundant.add(sourceId);
    start = end;
  }
  const settled = (ids: Set<string>) => [...ids].filter(id => !conflicting.has(id));
  return { conflictingIds: [...conflicting], redundantIds: settled(redundant), partiallyRedundantIds: settled(partiallyRedundant) };
}

/** Definition codes of one parameter, as the Rust `diagnose` module sets them. */
export const CAD_SKETCH_PARAMETER_NOT_ANALYSED = 0, CAD_SKETCH_PARAMETER_FREE = 1, CAD_SKETCH_PARAMETER_DETERMINED = 2;

type Definition = 'defined' | 'under-defined' | 'unknown';
/** Defined when every part is, under-defined when any part is, unknown otherwise. */
const combined = (parts: readonly Definition[]): Definition =>
  parts.includes('under-defined') ? 'under-defined' : parts.every(part => part === 'defined') ? 'defined' : 'unknown';

/**
 * The points and entities that parameter definition `codes` fully define, and those they leave
 * free to move, in graph order (see `CadSketchDefinition`). An arc needs its center and both ends,
 * a circle its center and radius, a line both ends.
 */
export function cadSketchEquationDefinition(graph: CadSketchGraph, model: CadSketchEquationModel, codes: readonly number[]): CadSketchDefinition {
  const parameter = (index: number | undefined): Definition => index === undefined ? 'unknown'
    : codes[index] === CAD_SKETCH_PARAMETER_DETERMINED ? 'defined' : codes[index] === CAD_SKETCH_PARAMETER_FREE ? 'under-defined' : 'unknown';
  const point = (id: string) => { const x = model.pointParameters.get(id); return combined([parameter(x), parameter(x === undefined ? undefined : x + 1)]); };
  const points = graph.points.map(source => [source.id, point(source.id)] as const);
  const entities = graph.entities.map(entity => [entity.id, combined(entity.kind === 'line' ? [point(entity.startPointId), point(entity.endPointId)]
    : entity.kind === 'arc' ? [point(entity.centerPointId), point(entity.startPointId), point(entity.endPointId)]
    : [point(entity.centerPointId), parameter(model.radiusParameters.get(entity.id))])] as const);
  const ids = (rows: readonly (readonly [string, Definition])[], state: Definition) => rows.filter(row => row[1] === state).map(row => row[0]);
  return { definedPointIds: ids(points, 'defined'), underDefinedPointIds: ids(points, 'under-defined'),
    definedEntityIds: ids(entities, 'defined'), underDefinedEntityIds: ids(entities, 'under-defined') };
}
