import { cadSketchGraphWithSolvedValues, cadSketchSolvedSlots, type CadSketchGraph } from '../../../../domain/cad/cadSketchGraph';

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
  /** The compiled constraint this equation belongs to, one per PlaneGCS constraint. Equations of one
   * constraint share it, and tags never decrease. */
  readonly tag: number;
  /** Solved but left out of diagnosis, as a drag target is. */
  readonly temporary?: boolean;
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

export const CAD_SKETCH_NATIVE_PROTOCOL_VERSION = 3;

export function encodeCadSketchEquationModel(model: CadSketchEquationModel): Float64Array {
  const length = 3 + 2 * model.values.length + model.equations.reduce((total, equation) => total + 4 + equation.operands.length, 0);
  const buffer = new Float64Array(length);
  buffer.set([CAD_SKETCH_NATIVE_PROTOCOL_VERSION, model.values.length, model.equations.length]);
  buffer.set(model.values, 3);
  buffer.set(model.fixed.map(Number), 3 + model.values.length);
  let cursor = 3 + 2 * model.values.length;
  for (const equation of model.equations) {
    if (equation.operands.length !== cadSketchEquationArity[equation.kind]) throw new Error(`A ${equation.kind} equation needs ${cadSketchEquationArity[equation.kind]} operands.`);
    buffer.set([cadSketchEquationKinds.indexOf(equation.kind), equation.value, equation.tag, Number(equation.temporary ?? false), ...equation.operands], cursor);
    cursor += 4 + equation.operands.length;
  }
  return buffer;
}

/**
 * The graph with every solved slot taken from `values`, or undefined when the solver moved a fixed
 * value: only solved slots reach the graph, so a moved fixed value would otherwise be dropped silently.
 */
export function applyCadSketchEquationSolution(graph: CadSketchGraph, model: CadSketchEquationModel, values: readonly number[]): CadSketchGraph | undefined {
  if (values.length !== model.values.length || model.fixed.some((fixed, index) => fixed && values[index] !== model.values[index])) return undefined;
  return cadSketchGraphWithSolvedValues(graph, cadSketchSolvedSlots(graph).map(slot => {
    const source = slot.kind === 'point' ? graph.points[slot.index].position[slot.axis] : (graph.entities[slot.index] as { readonly radius: number | string }).radius;
    const index = slot.kind === 'point' ? model.pointParameters.get(graph.points[slot.index].id) : model.radiusParameters.get(graph.entities[slot.index].id);
    const parameter = index === undefined ? undefined : slot.kind === 'point' ? index + slot.axis : index;
    return parameter === undefined || model.fixed[parameter] ? source : values[parameter];
  }));
}

/** The residual of `equation` at `values`, as the Rust `equations::residual` computes it. */
export function cadSketchEquationResidual(equation: CadSketchEquation, values: readonly number[]): number {
  const o = equation.operands.map(operand => values[operand]), value = equation.value;
  const cross = (ax: number, ay: number, bx: number, by: number) => ax * by - ay * bx, dot = (ax: number, ay: number, bx: number, by: number) => ax * bx + ay * by;
  switch (equation.kind) {
    case 'difference': return o[1] - o[0] - value;
    case 'value': return o[0] - value;
    case 'midpoint': return (o[0] + o[1]) * 0.5 - o[2];
    case 'distance': return Math.hypot(o[2] - o[0], o[3] - o[1]) - value;
    case 'distance-to-parameter': return Math.hypot(o[2] - o[0], o[3] - o[1]) - o[4];
    case 'point-on-line': {
      const dx = o[4] - o[2], dy = o[5] - o[3];
      return cross(dx, dy, o[0] - o[2], o[1] - o[3]) / Math.hypot(dx, dy);
    }
    case 'parallel': case 'perpendicular': case 'angle': case 'equal-length': {
      const ax = o[2] - o[0], ay = o[3] - o[1], bx = o[6] - o[4], by = o[7] - o[5];
      if (equation.kind === 'parallel') return cross(ax, ay, bx, by) / (Math.hypot(ax, ay) * Math.hypot(bx, by));
      if (equation.kind === 'perpendicular') return dot(ax, ay, bx, by) / (Math.hypot(ax, ay) * Math.hypot(bx, by));
      if (equation.kind === 'equal-length') return Math.hypot(ax, ay) - Math.hypot(bx, by);
      const raw = Math.atan2(cross(ax, ay, bx, by), dot(ax, ay, bx, by)) - value;
      return raw - Math.floor((raw + Math.PI) / (2 * Math.PI)) * 2 * Math.PI;
    }
    case 'symmetric-midpoint': case 'symmetric-perpendicular': {
      const dx = o[6] - o[4], dy = o[7] - o[5];
      return equation.kind === 'symmetric-midpoint'
        ? cross(dx, dy, (o[0] + o[2]) * 0.5 - o[4], (o[1] + o[3]) * 0.5 - o[5]) / Math.hypot(dx, dy)
        : dot(dx, dy, o[2] - o[0], o[3] - o[1]) / Math.hypot(dx, dy);
    }
  }
}

/** Label bits of one diagnosed equation, as the Rust `diagnose` module sets them. */
export const CAD_SKETCH_EQUATION_REDUNDANT = 1, CAD_SKETCH_EQUATION_CONFLICTING = 2;

/**
 * Source identities of the constraints that equation `labels` make conflicting, redundant or
 * partially redundant (redundant through some but not all of its equations), each in compiled
 * order and listed once, as the PlaneGCS runtime reports them.
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
  return { conflictingIds: [...conflicting], redundantIds: [...redundant], partiallyRedundantIds: [...partiallyRedundant] };
}
