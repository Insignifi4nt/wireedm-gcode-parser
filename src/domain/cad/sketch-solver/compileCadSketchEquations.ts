import { evaluateCadScalar } from '../cadExpression';
import { cadSketchExternalReferenceComponents } from '../cadSketchExternalReferences';
import type { CadSketchGraph } from '../cadSketchGraph';
import { CadSketchPositions } from '../sketch-relations/cadSketchVirtualElements';
import type { CadSketchEquationModel } from './cadSketchEquationModel';
import { CadSketchLowering, type CadSketchRadialHold, type CadSketchSquareHold } from './cadSketchLoweringContext';

/** What a sketch compiles from: its graph, the parameters its expressions read, and a drag target if any. */
export interface CadSketchEquationInput {
  readonly graph: CadSketchGraph;
  readonly parameters: Readonly<Record<string, number>>;
  readonly drag?: { readonly pointId: string; readonly position: readonly [number, number] };
}
/** A compiled sketch: its equation model, and the holds a failed solve retries from other starts, in relation order. */
export interface CadSketchCompiledSketch extends CadSketchEquationModel {
  /** A solve that fails retries the points sitting on their centre from off it. */
  readonly radialHolds: readonly CadSketchRadialHold[];
  /** Then the arms that start along the support they are held square to, from starts square to it. */
  readonly squareHolds: readonly CadSketchSquareHold[];
}

/**
 * The scalar equations of a parsed solve input: each arc's own equation, then each relation's in graph order as its definition
 * lowers it, with the same operand order, source identities and fixed values as the PlaneGCS compilation had, which the frozen
 * PlaneGCS corpus checks. A drag target becomes two temporary value equations on the dragged point, last, as PlaneGCS's temporary
 * coordinates were.
 */
export function compileCadSketchEquations(input: CadSketchEquationInput): CadSketchCompiledSketch {
  const graph = input.graph, scalar = (value: number | string) => evaluateCadScalar(value, input.parameters);
  const owned = cadSketchExternalReferenceComponents(graph);
  const values: number[] = [], fixed: boolean[] = [];
  const pointParameters = new Map<string, number>(), radiusParameters = new Map<string, number>(), numericPoints = new CadSketchPositions();
  for (const point of graph.points) {
    pointParameters.set(point.id, values.length);
    const position = { x: scalar(point.position[0]), y: scalar(point.position[1]) }; numericPoints.set(point.id, position);
    values.push(position.x, position.y);
    fixed.push(typeof point.position[0] === 'string' || owned.pointIds.has(point.id), typeof point.position[1] === 'string' || owned.pointIds.has(point.id));
  }
  for (const entity of graph.entities) if (entity.kind === 'circle') {
    radiusParameters.set(entity.id, values.length);
    values.push(scalar(entity.radius)); fixed.push(typeof entity.radius === 'string' || owned.circleIds.has(entity.id));
  }
  const lowering = new CadSketchLowering(graph, input.parameters, pointParameters, radiusParameters, numericPoints, values.length);
  for (const entity of graph.entities) lowering.structure(entity);
  for (const relation of graph.relations) lowering.lower(relation);
  // The origin's and the axes' fixed values where an equation keeps them, and the free radius an arc's relation makes, follow every
  // point and radius.
  for (const made of lowering.made) { values.push(made.value); fixed.push(made.fixed); }
  if (input.drag) {
    const { pointId, position } = input.drag;
    if (!pointParameters.has(pointId) || position.some(value => !Number.isFinite(value) || Math.abs(value) > 1e9)) throw new Error('Invalid sketch drag target.');
    lowering.target(pointId, 0, position[0]); lowering.target(pointId, 1, position[1]);
  }
  return { values, fixed, pointParameters, radiusParameters, equations: lowering.equations, radialHolds: lowering.radialHolds, squareHolds: lowering.squareHolds };
}
