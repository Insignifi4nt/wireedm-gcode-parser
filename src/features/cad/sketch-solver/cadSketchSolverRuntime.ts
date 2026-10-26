import { GcsWrapper } from '@salusoft89/planegcs/dist/sketch/gcs_wrapper.js';
import { SolveStatus } from '@salusoft89/planegcs/dist/planegcs_dist/enums.js';
import { property_offsets } from '@salusoft89/planegcs/dist/sketch/geom_params.js';
import type { SketchPrimitive } from '@salusoft89/planegcs/dist/sketch/sketch_primitive.js';
import { cadSketchGraphWithSolvedValues, cadSketchSolvedSlots, checkCadSketchGraph } from '../../../domain/cad/cadSketchGraph';
import { evaluateCadScalar } from '../../../domain/cad/cadExpression';
import type { CadSketchSolverModule } from './cadSketchSolverModule';
import type { CadSketchSolveDiagnostics, CadSketchSolveInput, CadSketchSolveResult } from './cadSketchSolverTypes';
import { parseCadSketchSolveInput } from './cadSketchSolverProtocol';
import { cadSketchExternalReferenceComponents } from '../../../domain/cad/cadSketchExternalReferences';
import { compileCadSketchCornerConstraints } from './cadSketchCornerConstraints';
import { cadSketchLineDirection, resolveCadSketchLinePair } from '../../../domain/cad/cadSketchLineRelations';
import type { Point2 } from '../../../domain/path-intel/types';
import { cadSketchRadialTarget, resolveCadSketchRadialEntity } from '../../../domain/cad/cadSketchRadialRelations';
import { resolveCadSketchRadiusPair } from '../../../domain/cad/cadSketchEqualRelations';
import { cadSketchAngleTarget, resolveCadSketchAngleRays } from '../../../domain/cad/cadSketchAngleRelations';
import { resolveCadSketchMidpointOperands } from '../../../domain/cad/cadSketchMidpointRelations';
import { resolveCadSketchSymmetryOperands } from '../../../domain/cad/cadSketchSymmetryRelations';
import { resolveCadSketchPointOnLineOperands } from '../../../domain/cad/cadSketchPointOnLineRelations';
import { resolveCadSketchTangentJoint } from '../../../domain/cad/cadSketchTangentRelations';
import { cadSketchLinearPatternInstances } from '../../../domain/cad/cadSketchLinearPattern';
import type { CadSketchSolverTimingStage } from './cadSketchSolverStages';

function nativeStatus(status: SolveStatus): CadSketchSolveDiagnostics['status'] {
  switch (status) {
    case SolveStatus.Success: return 'success';
    case SolveStatus.Converged: return 'converged';
    case SolveStatus.Failed: return 'failed';
    case SolveStatus.SuccessfulSolutionInvalid: return 'invalid';
    default: throw new Error('Unexpected native sketch solver status.');
  }
}

/** Input already parsed by the solve boundary. Exported as the oracle for the native equation compiler. */
export function compileCadSketchPlaneGcs(input: CadSketchSolveInput) {
  const graph = input.graph, objects: SketchPrimitive[] = [];
  const sourceIds = new Map<string, string>();
  const numericPoints = new Map<string, Point2>();
  const scalar = (value: number | string) => evaluateCadScalar(value, input.parameters);
  for (const point of graph.points) {
    const position = { x: scalar(point.position[0]), y: scalar(point.position[1]) }; numericPoints.set(point.id, position);
    objects.push({ id: point.id, type: 'point', ...position, fixed: false });
  }
  for (const entity of graph.entities) {
    switch (entity.kind) {
      case 'line': objects.push({ id: entity.id, type: 'line', p1_id: entity.startPointId, p2_id: entity.endPointId }); break;
      case 'circle': objects.push({ id: entity.id, type: 'circle', c_id: entity.centerPointId, radius: scalar(entity.radius) }); break;
      case 'arc': {
        // The graph owns endpoints and direction, with no independent radius/angle
        // scalars. Its sole structural equation is equal center-to-endpoint radii.
        const start = `$arc-start:${entity.id}`, end = `$arc-end:${entity.id}`;
        objects.push({ id: start, type: 'line', p1_id: entity.centerPointId, p2_id: entity.startPointId },
          { id: end, type: 'line', p1_id: entity.centerPointId, p2_id: entity.endPointId });
        constraint({ id: `$arc:${entity.id}`, type: 'equal_length', l1_id: start, l2_id: end }, entity.id);
        break;
      }
      default: { const exhaustive: never = entity; throw exhaustive; }
    }
  }
  function constraint(object: SketchPrimitive, sourceId: string) { objects.push(object); sourceIds.set(object.id, sourceId); }
  for (const relation of graph.relations) {
    const id = relation.id;
    switch (relation.kind) {
      case 'linear-pattern': {
        const axis = relation.direction.endsWith('x') ? 'x' : 'y', sign = relation.direction.startsWith('-') ? -1 : 1;
        for (const member of cadSketchLinearPatternInstances(relation).filter(member => member.active)) {
          for (const coordinate of ['x', 'y'] as const) constraint({ id: `$pattern-${coordinate}:${id}:${member.index}`, type: 'difference',
            param1: { o_id: relation.seed.centerPointId, prop: coordinate }, param2: { o_id: member.pointId, prop: coordinate },
            difference: coordinate === axis ? sign * member.index * scalar(relation.spacing) : 0 }, id);
          constraint({ id: `$pattern-radius:${id}:${member.index}`, type: 'equal_radius_cc', c1_id: relation.seed.entityId, c2_id: member.entityId }, id);
        }
        break;
      }
      case 'reference-dimension': break; // Saved measurement identity has no native equation or fixed variable.
      case 'external-reference': break; // Source authority is fixed numeric parameter ownership, not another equation.
      case 'coincident': constraint({ id, type: 'p2p_coincident', p1_id: relation.pointIds[0], p2_id: relation.pointIds[1] }, id); break;
      case 'horizontal': constraint({ id, type: 'horizontal_pp', p1_id: relation.pointIds[0], p2_id: relation.pointIds[1] }, id); break;
      case 'vertical': constraint({ id, type: 'vertical_pp', p1_id: relation.pointIds[0], p2_id: relation.pointIds[1] }, id); break;
      case 'midpoint': {
        const { line } = resolveCadSketchMidpointOperands(graph, relation);
        constraint({ id, type: 'p2p_symmetric_ppp', p1_id: line.startPointId, p2_id: line.endPointId, p_id: relation.pointId }, id); break;
      }
      case 'symmetric': {
        const { line } = resolveCadSketchSymmetryOperands(graph, relation);
        if (!cadSketchLineDirection(line, numericPoints)) throw new Error('A symmetry axis has no numeric endpoints.');
        constraint({ id, type: 'p2p_symmetric_ppl', p1_id: relation.pointIds[0], p2_id: relation.pointIds[1], l_id: line.id }, id); break;
      }
      case 'point-on-line': {
        const { line } = resolveCadSketchPointOnLineOperands(graph, relation);
        if (!cadSketchLineDirection(line, numericPoints)) throw new Error('A point-on-line guide has no numeric endpoints.');
        constraint({ id, type: 'point_on_line_pl', p_id: relation.pointId, l_id: line.id }, id); break;
      }
      case 'tangent-joint': {
        const { line, arc, linePointId, arcPointId, otherLineEndId } = resolveCadSketchTangentJoint(graph, relation);
        for (const support of [{ ...line, startPointId: linePointId, endPointId: otherLineEndId },
          { ...line, startPointId: arc.centerPointId, endPointId: arcPointId }])
          if (!cadSketchLineDirection(support, numericPoints)) throw new Error('A tangent support has no numeric endpoints.');
        constraint({ id, type: 'perpendicular_pppp', l1p1_id: linePointId, l1p2_id: otherLineEndId,
          l2p1_id: arc.centerPointId, l2p2_id: arcPointId }, id); break;
      }
      case 'line-angle': {
        const [a, b] = resolveCadSketchAngleRays(graph, relation.rays);
        for (const ray of [a, b]) if (!cadSketchLineDirection(ray.line, numericPoints)) throw new Error('A sketch ray has no numeric endpoints.');
        constraint({ id, type: 'l2l_angle_pppp', l1p1_id: a.fromPointId, l1p2_id: a.towardPointId,
          l2p1_id: b.fromPointId, l2p2_id: b.towardPointId, angle: cadSketchAngleTarget(relation, input.parameters).signedRadians }, id); break;
      }
      case 'collinear': {
        const [a, b] = resolveCadSketchLinePair(graph, relation.lineIds);
        for (const line of [a, b]) if (!cadSketchLineDirection(line, numericPoints)) throw new Error('A sketch line has no numeric endpoints.');
        constraint({ id, type: 'parallel', l1_id: a.id, l2_id: b.id }, id);
        // A shared authored endpoint already supplies incidence. Disjoint lines
        // need one additional scalar equation, with the same source diagnostic.
        if (![b.startPointId, b.endPointId].some(pointId => pointId === a.startPointId || pointId === a.endPointId))
          constraint({ id: `$collinear-on:${id}`, type: 'point_on_line_pl', p_id: b.startPointId, l_id: a.id }, id);
        break;
      }
      case 'parallel': case 'perpendicular': case 'equal-length':
        for (const line of resolveCadSketchLinePair(graph, relation.lineIds)) {
          if (!cadSketchLineDirection(line, numericPoints)) throw new Error('A sketch line has no numeric endpoints.');
        }
        constraint({ id, type: relation.kind === 'parallel' ? 'parallel' : relation.kind === 'perpendicular' ? 'perpendicular_ll' : 'equal_length', l1_id: relation.lineIds[0], l2_id: relation.lineIds[1] }, id); break;
      case 'equal-radius': {
        const [a, b] = resolveCadSketchRadiusPair(graph, relation.curveIds);
        if (a.kind === 'circle') {
          constraint(b.kind === 'circle' ? { id, type: 'equal_radius_cc', c1_id: a.id, c2_id: b.id }
            : { id, type: 'p2p_distance', p1_id: b.centerPointId, p2_id: b.startPointId, distance: { o_id: a.id, prop: 'radius' } }, id);
        } else {
          constraint(b.kind === 'circle' ? { id, type: 'p2p_distance', p1_id: a.centerPointId, p2_id: a.startPointId, distance: { o_id: b.id, prop: 'radius' } }
            : { id, type: 'equal_length', l1_id: `$arc-start:${a.id}`, l2_id: `$arc-start:${b.id}` }, id);
        }
        break;
      }
      case 'distance': constraint({ id, type: 'p2p_distance', p1_id: relation.pointIds[0], p2_id: relation.pointIds[1], distance: scalar(relation.value) }, id); break;
      case 'axis-distance': constraint({ id, type: 'difference', param1: { o_id: relation.pointIds[0], prop: relation.axis },
        param2: { o_id: relation.pointIds[1], prop: relation.axis }, difference: scalar(relation.value) }, id); break;
      case 'radial-size': {
        const entity = resolveCadSketchRadialEntity(graph, relation.entityId), radius = cadSketchRadialTarget(relation, input.parameters);
        constraint(entity.kind === 'arc' ? { id, type: 'p2p_distance', p1_id: entity.centerPointId, p2_id: entity.startPointId, distance: radius }
          : relation.quantity === 'radius' ? { id, type: 'circle_radius', c_id: entity.id, radius }
            : { id, type: 'circle_diameter', c_id: entity.id, diameter: radius * 2 }, id); break;
      }
      case 'fixed-point':
        constraint({ id: `$fixed-x:${id}`, type: 'coordinate_x', p_id: relation.pointId, x: scalar(relation.position[0]) }, id);
        constraint({ id: `$fixed-y:${id}`, type: 'coordinate_y', p_id: relation.pointId, y: scalar(relation.position[1]) }, id); break;
      case 'fixed-axis': constraint(relation.axis === 'x'
        ? { id, type: 'coordinate_x', p_id: relation.pointId, x: scalar(relation.value) }
        : { id, type: 'coordinate_y', p_id: relation.pointId, y: scalar(relation.value) }, id); break;
      case 'fillet-corner': case 'chamfer-corner':
        for (const object of compileCadSketchCornerConstraints(graph, relation, input.parameters)) constraint(object, id);
        break;
      default: { const exhaustive: never = relation; throw exhaustive; }
    }
  }
  if (input.drag) {
    if (!graph.points.some(point => point.id === input.drag?.pointId) || input.drag.position.some(value => !Number.isFinite(value) || Math.abs(value) > 1e9)) throw new Error('Invalid sketch drag target.');
    constraint({ id: '$drag-x', type: 'coordinate_x', p_id: input.drag.pointId, x: input.drag.position[0], temporary: true }, input.drag.pointId);
    constraint({ id: '$drag-y', type: 'coordinate_y', p_id: input.drag.pointId, y: input.drag.position[1], temporary: true }, input.drag.pointId);
  }
  return { graph, objects, sourceIds };
}


/**
 * Solver objects grouped into independent components. Geometry joins the points it is built
 * from and a constraint joins every object it references, so the native Jacobian is
 * block-diagonal across groups and each group solves and is diagnosed on its own.
 * Groups keep the compiled order.
 */
function components(objects: readonly SketchPrimitive[]): SketchPrimitive[][] {
  const parent = new Map(objects.map(object => [object.id, object.id]));
  const find = (id: string): string => {
    let root = id;
    for (let next = parent.get(root); next !== root; next = parent.get(root)) {
      if (next === undefined) throw new Error('A compiled sketch object references a missing object.');
      root = next;
    }
    for (let node = id; node !== root;) { const next = parent.get(node)!; parent.set(node, root); node = next; }
    return root;
  };
  // The same references PlaneGCS follows: `*_id` keys and `{ o_id }` parameter operands.
  for (const object of objects) for (const [key, value] of Object.entries(object)) {
    const reference = key !== 'id' && key.endsWith('_id') && typeof value === 'string' ? value
      : typeof value === 'object' && value !== null && 'o_id' in value && typeof value.o_id === 'string' ? value.o_id : undefined;
    if (reference !== undefined) parent.set(find(object.id), find(reference));
  }
  const groups = new Map<string, SketchPrimitive[]>();
  for (const object of objects) {
    const root = find(object.id), group = groups.get(root);
    if (group) group.push(object); else groups.set(root, [object]);
  }
  return [...groups.values()];
}

/**
 * Largest group sent to native code, as unfixed parameters times scalar equations. PlaneGCS
 * diagnoses each system with dense matrices in a fixed 21 MiB heap and aborts the whole
 * module when they do not fit. The benchmark saw the smallest abort at 800 x 800 and
 * success at 760 x 760; the limit stays about a fifth below that.
 */
export const MAX_CAD_SKETCH_SOLVER_GROUP_SIZE = 500_000;
/** Compiled ids from the graph never start with '$'. */
const auxiliaryPointId = '$fixed-diagnosis';
/** Native constraints that add two scalar equations; every other compiled constraint adds one. */
const twoEquationConstraints = new Set<SketchPrimitive['type']>(['p2p_coincident', 'p2p_symmetric_ppp', 'p2p_symmetric_ppl']);

type NativeStatus = NonNullable<CadSketchSolveDiagnostics['status']>;
const statusRank: Record<NativeStatus, number> = { success: 0, converged: 1, invalid: 2, failed: 3 };
const noDiagnostics = (): CadSketchSolveDiagnostics => ({ status: null, degreesOfFreedom: null, conflictingIds: [], redundantIds: [], partiallyRedundantIds: [], issues: [] });

/**
 * Each call owns and deletes its C++ systems; caller objects are never handed to the package.
 * A native abort leaves the module unusable, so the next solve first discards it through
 * `discard`, which must make `initialize` create a fresh module.
 */
export function createCadSketchSolverRuntime(initialize: () => Promise<CadSketchSolverModule>, options: {
  readonly discard?: () => void;
  /** Benchmark observer only. Native work includes diagnosis and destruction of each system. */
  readonly onStageTiming?: (stage: CadSketchSolverTimingStage, elapsedMs: number) => void;
} = {}) {
  let aborted = false, queue: Promise<unknown> = Promise.resolve();
  // Native work runs one solve at a time, so an abort is always discarded before the next native call.
  const exclusive = <T>(work: () => Promise<T>): Promise<T> => { const run = queue.then(work); queue = run.catch(() => undefined); return run; };
  return { async solve(input: CadSketchSolveInput): Promise<CadSketchSolveResult> {
    let stage: CadSketchSolverTimingStage = 'parseCompile', started = options.onStageTiming ? performance.now() : 0;
    const nextStage = (next: CadSketchSolverTimingStage) => {
      if (options.onStageTiming) { const now = performance.now(); options.onStageTiming(stage, now - started); started = now; }
      stage = next;
    };
    try {
      let compiled: ReturnType<typeof compileCadSketchPlaneGcs>;
      try { input = parseCadSketchSolveInput(input); compiled = compileCadSketchPlaneGcs(input); }
      catch (error) { return { kind: 'rejected', reason: 'invalid-input', message: error instanceof Error ? error.message : 'Invalid sketch input.', diagnostics: noDiagnostics() }; }
      const owned = cadSketchExternalReferenceComponents(compiled.graph), points = new Map(compiled.graph.points.map(point => [point.id, point]));
      const circles = new Map(compiled.graph.entities.flatMap(entity => entity.kind === 'circle' ? [[entity.id, entity] as const] : []));
      // Strings and evaluated external snapshots keep their exact source type.
      const fixedX = (id: string) => typeof points.get(id)!.position[0] === 'string' || owned.pointIds.has(id);
      const fixedY = (id: string) => typeof points.get(id)!.position[1] === 'string' || owned.pointIds.has(id);
      const fixedRadius = (id: string) => typeof circles.get(id)!.radius === 'string' || owned.circleIds.has(id);
      // Lines own no parameters; arcs compile to two lines and a constraint.
      const unfixed = (group: readonly SketchPrimitive[]) => group.reduce((total, object) => total + (object.type === 'point'
        ? Number(!fixedX(object.id)) + Number(!fixedY(object.id)) : object.type === 'circle' ? Number(!fixedRadius(object.id)) : 0), 0);
      const equations = (group: readonly SketchPrimitive[]) => group.reduce((total, object) => total
        + (!compiled.sourceIds.has(object.id) ? 0 : twoEquationConstraints.has(object.type) ? 2 : 1), 0);
      const split = components(compiled.objects), fixed = split.filter(group => equations(group) && !unfixed(group)).flat();
      const groups = split.filter(group => !equations(group) || unfixed(group)), constrained = groups.filter(group => equations(group) > 0);
      // PlaneGCS diagnoses nothing in a system without unknowns, and in a shared system a fixed
      // relation's diagnosis would follow that system's convergence. Relations on fully fixed
      // geometry are therefore diagnosed together beside one unconstrained auxiliary point:
      // satisfied ones as redundant and others as conflicting. Its freedom is not counted. As in
      // one sketch-wide system, a sketch without any unknowns is not diagnosed; the graph check
      // below still rejects an unsatisfied relation.
      const auxiliary: SketchPrimitive[] = fixed.length && groups.some(group => unfixed(group)) ? [{ id: auxiliaryPointId, type: 'point', x: 0, y: 0, fixed: false }, ...fixed] : [];
      if (constrained.some(group => unfixed(group) * equations(group) > MAX_CAD_SKETCH_SOLVER_GROUP_SIZE) || 2 * equations(auxiliary) > MAX_CAD_SKETCH_SOLVER_GROUP_SIZE) return { kind: 'rejected', reason: 'too-large',
        message: 'A connected group of sketch relations is too large to solve. Split it into separate groups or remove relations.', diagnostics: noDiagnostics() };
      // Diagnostics keep the sketch-wide compiled order a single native system reported.
      const position = new Map(compiled.objects.map((object, index) => [object.id, index]));
      const mapped = (ids: readonly string[]) => [...new Set([...ids].sort((a, b) => position.get(a)! - position.get(b)!).map(id => {
        const source = compiled.sourceIds.get(id);
        if (!source) throw new Error('A native sketch diagnostic has no source identity.');
        return source;
      }))];
      // A group without relations keeps its values and each unfixed parameter stays free.
      let degreesOfFreedom = groups.filter(group => !equations(group)).reduce((total, group) => total + unfixed(group), 0), status: NativeStatus = 'success';
      const conflicting: string[] = [], redundant: string[] = [], partiallyRedundant: string[] = [];
      const solvedPoints = new Map<string, Point2>(), solvedRadii = new Map<string, number>();
      nextStage('nativeCall');
      if (constrained.length || auxiliary.length) await exclusive(async () => {
        if (aborted) {
          if (!options.discard) throw new Error('The sketch solver stopped after a native failure and cannot restart.');
          options.discard(); aborted = false;
        }
        const module = await initialize();
        for (const group of auxiliary.length ? [...constrained, auxiliary] : constrained) {
          let wrapper: GcsWrapper | undefined;
          try {
            wrapper = new GcsWrapper(new module.GcsSystem(), module);
            wrapper.push_primitives_and_params(group);
            for (const object of group) {
              if (object.type !== 'point' && object.type !== 'circle' || object.id === auxiliaryPointId) continue;
              const start = wrapper.p_param_index.get(object.id);
              if (start === undefined) throw new Error(`A compiled sketch ${object.type} has no native parameters.`);
              if (object.type === 'point') {
                const point = points.get(object.id)!;
                if (fixedX(object.id)) wrapper.gcs.set_p_param(start + property_offsets.point.x, evaluateCadScalar(point.position[0], input.parameters), true);
                if (fixedY(object.id)) wrapper.gcs.set_p_param(start + property_offsets.point.y, evaluateCadScalar(point.position[1], input.parameters), true);
              } else if (fixedRadius(object.id)) wrapper.gcs.set_p_param(start + property_offsets.circle.radius, evaluateCadScalar(circles.get(object.id)!.radius, input.parameters), true);
            }
            const groupStatus = nativeStatus(wrapper.solve())!;
            if (statusRank[groupStatus] > statusRank[status]) status = groupStatus;
            if (group !== auxiliary) degreesOfFreedom += wrapper.gcs.dof();
            conflicting.push(...wrapper.get_gcs_conflicting_constraints()); redundant.push(...wrapper.get_gcs_redundant_constraints());
            partiallyRedundant.push(...wrapper.get_gcs_partially_redundant_constraints());
            wrapper.apply_solution();
            nextStage('mapping');
            for (const object of group) {
              if (object.id === auxiliaryPointId) continue;
              if (object.type === 'point') { const solved = wrapper.sketch_index.get_sketch_point(object.id); solvedPoints.set(object.id, { x: solved.x, y: solved.y }); }
              else if (object.type === 'circle') solvedRadii.set(object.id, wrapper.sketch_index.get_sketch_circle(object.id).radius);
            }
            nextStage('nativeCall');
          } catch (error) {
            // An Emscripten abort (for example out of memory) is a RuntimeError; anything else is an ordinary check.
            if (!(error instanceof WebAssembly.RuntimeError)) throw error;
            aborted = true;
            throw new Error('The sketch solver ran out of native memory and will restart on the next solve.', { cause: error });
          } finally { if (!aborted) wrapper?.destroy_gcs_module(); }
        }
      });
      // Without conflicts PlaneGCS counts unknowns minus Jacobian rank, which adds up across groups.
      // A conflicting system can count unknowns minus equations instead, so the sum would depend on
      // grouping; freedom is then reported as unknown.
      nextStage('mapping');
      const diagnostics: CadSketchSolveDiagnostics = { status, degreesOfFreedom: conflicting.length ? null : degreesOfFreedom, conflictingIds: mapped(conflicting),
        redundantIds: mapped(redundant), partiallyRedundantIds: mapped(partiallyRedundant), issues: [] };
      if (diagnostics.conflictingIds.length) return { kind: 'rejected', reason: 'conflicting', message: 'Sketch constraints conflict.', diagnostics };
      if (diagnostics.redundantIds.length || diagnostics.partiallyRedundantIds.length) return { kind: 'rejected', reason: 'redundant', message: 'Sketch constraints are redundant.', diagnostics };
      if (status !== 'success' && status !== 'converged') return { kind: 'rejected', reason: 'failed', message: 'The sketch solver did not produce a valid solution.', diagnostics };
      // Fixed values are checked here because only solved slots reach the graph: a moved owned
      // snapshot that kept the solution's local equations satisfied would otherwise be dropped silently.
      if ([...owned.pointIds].some(id => { const solved = solvedPoints.get(id), position = points.get(id)!.position; return solved && (solved.x !== position[0] || solved.y !== position[1]); })
        || [...owned.circleIds].some(id => { const radius = solvedRadii.get(id); return radius !== undefined && radius !== circles.get(id)!.radius; }))
        return { kind: 'rejected', reason: 'invalid-solution', message: 'The sketch solution changed fixed source geometry.', diagnostics };
      const graph = cadSketchGraphWithSolvedValues(compiled.graph, cadSketchSolvedSlots(compiled.graph).map(slot => {
        if (slot.kind === 'radius') { const entity = compiled.graph.entities[slot.index]; return solvedRadii.get(entity.id) ?? (entity as { radius: number }).radius; }
        const point = compiled.graph.points[slot.index], solved = solvedPoints.get(point.id);
        return solved ? (slot.axis ? solved.y : solved.x) : point.position[slot.axis];
      }));
      nextStage('validation');
      const issues = checkCadSketchGraph(graph, input.parameters);
      if (issues.length) return { kind: 'rejected', reason: 'invalid-solution', message: 'The sketch solution does not satisfy its geometry and relations.', diagnostics: { ...diagnostics, issues } };
      return { kind: 'solved', graph, diagnostics };
    } finally { if (options.onStageTiming) options.onStageTiming(stage, performance.now() - started); }
  } };
}
