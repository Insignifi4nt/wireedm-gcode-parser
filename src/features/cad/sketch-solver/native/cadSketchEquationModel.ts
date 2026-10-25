import { parseCadSketchGraph, type CadSketchGraph } from '../../../../domain/cad/cadSketchGraph';

/**
 * Scalar equation kinds of the native solver, in wire-code order (the Rust `Kind::ALL`).
 * Each takes a fixed number of parameter operands:
 *
 * - `difference` [a, b]: b - a = value
 * - `value` [a]: a = value
 * - `midpoint` [a, b, m]: (a + b) / 2 = m on one axis
 * - `distance` [px, py, qx, qy]: |q - p| = value
 * - `distance-to-parameter` [px, py, qx, qy, r]: |q - p| = r
 * - `point-on-line` [px, py, ax, ay, bx, by]: p lies on the line through a and b
 * - `parallel`, `perpendicular`, `equal-length` [a1x, a1y, a2x, a2y, b1x, b1y, b2x, b2y]: a1 -> a2 against b1 -> b2
 * - `angle` (same operands): signed angle from a1 -> a2 to b1 -> b2 = value radians
 * - `symmetric-midpoint`, `symmetric-perpendicular` [px, py, qx, qy, ax, ay, bx, by]: the midpoint of p and q
 *   lies on the line through a and b, and q - p is perpendicular to it
 */
export const cadSketchEquationKinds = ['difference', 'value', 'midpoint', 'distance', 'distance-to-parameter', 'point-on-line',
  'parallel', 'perpendicular', 'angle', 'equal-length', 'symmetric-midpoint', 'symmetric-perpendicular'] as const;
export type CadSketchEquationKind = typeof cadSketchEquationKinds[number];

export const cadSketchEquationArity: Readonly<Record<CadSketchEquationKind, number>> = {
  difference: 2, value: 1, midpoint: 3, distance: 4, 'distance-to-parameter': 5, 'point-on-line': 6,
  parallel: 8, perpendicular: 8, angle: 8, 'equal-length': 8, 'symmetric-midpoint': 8, 'symmetric-perpendicular': 8
};

export interface CadSketchEquation {
  readonly kind: CadSketchEquationKind;
  /** Parameter indices. */
  readonly operands: readonly number[];
  readonly value: number;
  /** Graph identity reported for this equation; an entity ID for an arc's structural equation. */
  readonly sourceId: string;
}

/** A sketch as scalar parameters and the scalar equations between them. */
export interface CadSketchEquationModel {
  readonly values: readonly number[];
  /** Expression-driven and externally owned values never move. */
  readonly fixed: readonly boolean[];
  /** Index of each point's x; its y follows. */
  readonly pointParameters: ReadonlyMap<string, number>;
  readonly radiusParameters: ReadonlyMap<string, number>;
  readonly equations: readonly CadSketchEquation[];
}

export const CAD_SKETCH_NATIVE_PROTOCOL_VERSION = 1;

export function encodeCadSketchEquationModel(model: CadSketchEquationModel): Float64Array {
  const length = 3 + 2 * model.values.length + model.equations.reduce((total, equation) => total + 2 + equation.operands.length, 0);
  const buffer = new Float64Array(length);
  buffer.set([CAD_SKETCH_NATIVE_PROTOCOL_VERSION, model.values.length, model.equations.length]);
  buffer.set(model.values, 3);
  buffer.set(model.fixed.map(Number), 3 + model.values.length);
  let cursor = 3 + 2 * model.values.length;
  for (const equation of model.equations) {
    if (equation.operands.length !== cadSketchEquationArity[equation.kind]) throw new Error(`A ${equation.kind} equation needs ${cadSketchEquationArity[equation.kind]} operands.`);
    buffer.set([cadSketchEquationKinds.indexOf(equation.kind), equation.value, ...equation.operands], cursor);
    cursor += 2 + equation.operands.length;
  }
  return buffer;
}

/** The graph with every numeric, unfixed point coordinate and circle radius taken from `values`. */
export function applyCadSketchEquationSolution(graph: CadSketchGraph, model: CadSketchEquationModel, values: readonly number[]): CadSketchGraph {
  const solved = (index: number | undefined, source: number | string) => index === undefined || typeof source === 'string' || model.fixed[index] ? source : values[index];
  return parseCadSketchGraph({ ...graph, points: graph.points.map(point => {
    const x = model.pointParameters.get(point.id);
    return { ...point, position: [solved(x, point.position[0]), solved(x === undefined ? undefined : x + 1, point.position[1])] };
  }), entities: graph.entities.map(entity => entity.kind === 'circle' ? { ...entity, radius: solved(model.radiusParameters.get(entity.id), entity.radius) } : entity) });
}
