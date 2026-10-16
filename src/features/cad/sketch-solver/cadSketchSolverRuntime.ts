import { GcsWrapper } from '@salusoft89/planegcs/dist/sketch/gcs_wrapper.js';
import { SolveStatus } from '@salusoft89/planegcs/dist/planegcs_dist/enums.js';
import { property_offsets } from '@salusoft89/planegcs/dist/sketch/geom_params.js';
import type { SketchPrimitive } from '@salusoft89/planegcs/dist/sketch/sketch_primitive.js';
import { checkCadSketchGraph, parseCadSketchGraph, type CadSketchGraph } from '../../../domain/cad/cadSketchGraph';
import { evaluateCadScalar } from '../../../domain/cad/cadExpression';
import type { CadSketchSolverModule } from './cadSketchSolverModule';
import type { CadSketchSolveDiagnostics, CadSketchSolveInput, CadSketchSolveResult } from './cadSketchSolverTypes';
import { parseCadSketchSolveInput } from './cadSketchSolverProtocol';
import { compileCadSketchCornerConstraints } from './cadSketchCornerConstraints';
import { cadSketchLineDirection, resolveCadSketchLinePair } from '../../../domain/cad/cadSketchLineRelations';
import type { Point2 } from '../../../domain/path-intel/types';
import { cadSketchRadialTarget, resolveCadSketchRadialEntity } from '../../../domain/cad/cadSketchRadialRelations';
import { resolveCadSketchRadiusPair } from '../../../domain/cad/cadSketchEqualRelations';

function nativeStatus(status: SolveStatus): CadSketchSolveDiagnostics['status'] {
  switch (status) {
    case SolveStatus.Success: return 'success';
    case SolveStatus.Converged: return 'converged';
    case SolveStatus.Failed: return 'failed';
    case SolveStatus.SuccessfulSolutionInvalid: return 'invalid';
    default: throw new Error('Unexpected native sketch solver status.');
  }
}

function compile(input: CadSketchSolveInput) {
  const graph = parseCadSketchGraph(input.graph), objects: SketchPrimitive[] = [];
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
      case 'coincident': constraint({ id, type: 'p2p_coincident', p1_id: relation.pointIds[0], p2_id: relation.pointIds[1] }, id); break;
      case 'horizontal': constraint({ id, type: 'horizontal_pp', p1_id: relation.pointIds[0], p2_id: relation.pointIds[1] }, id); break;
      case 'vertical': constraint({ id, type: 'vertical_pp', p1_id: relation.pointIds[0], p2_id: relation.pointIds[1] }, id); break;
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

/** Each call owns and deletes its C++ system; caller objects are never handed to the package. */
export function createCadSketchSolverRuntime(initialize: () => Promise<CadSketchSolverModule>) {
  return { async solve(input: CadSketchSolveInput): Promise<CadSketchSolveResult> {
    let compiled: ReturnType<typeof compile>;
    try { input = parseCadSketchSolveInput(input); compiled = compile(input); }
    catch (error) { return { kind: 'rejected', reason: 'invalid-input', message: error instanceof Error ? error.message : 'Invalid sketch input.',
      diagnostics: { status: null, degreesOfFreedom: null, conflictingIds: [], redundantIds: [], partiallyRedundantIds: [], issues: [] } }; }
    const module = await initialize(), wrapper = new GcsWrapper(new module.GcsSystem(), module);
    try {
      wrapper.push_primitives_and_params(compiled.objects);
      // A string remains an exact driver even when its text happens to be numeric.
      for (const point of compiled.graph.points) {
        const start = wrapper.p_param_index.get(point.id);
        if (start === undefined) throw new Error('A compiled sketch point has no native parameters.');
        if (typeof point.position[0] === 'string') wrapper.gcs.set_p_param(start + property_offsets.point.x, evaluateCadScalar(point.position[0], input.parameters), true);
        if (typeof point.position[1] === 'string') wrapper.gcs.set_p_param(start + property_offsets.point.y, evaluateCadScalar(point.position[1], input.parameters), true);
      }
      for (const entity of compiled.graph.entities) if (entity.kind === 'circle' && typeof entity.radius === 'string') {
        const start = wrapper.p_param_index.get(entity.id);
        if (start === undefined) throw new Error('A compiled circle has no native parameters.');
        wrapper.gcs.set_p_param(start + property_offsets.circle.radius, evaluateCadScalar(entity.radius, input.parameters), true);
      }
      const status = wrapper.solve();
      const mapped = (ids: readonly string[]) => [...new Set(ids.map(id => {
        const source = compiled.sourceIds.get(id);
        if (!source) throw new Error('A native sketch diagnostic has no source identity.');
        return source;
      }))];
      const diagnostics: CadSketchSolveDiagnostics = {
        status: nativeStatus(status), degreesOfFreedom: wrapper.gcs.dof(),
        conflictingIds: mapped(wrapper.get_gcs_conflicting_constraints()), redundantIds: mapped(wrapper.get_gcs_redundant_constraints()),
        partiallyRedundantIds: mapped(wrapper.get_gcs_partially_redundant_constraints()), issues: []
      };
      if (diagnostics.conflictingIds.length) return { kind: 'rejected', reason: 'conflicting', message: 'Sketch constraints conflict.', diagnostics };
      if (diagnostics.redundantIds.length || diagnostics.partiallyRedundantIds.length) return { kind: 'rejected', reason: 'redundant', message: 'Sketch constraints are redundant.', diagnostics };
      if (status !== SolveStatus.Success && status !== SolveStatus.Converged) return { kind: 'rejected', reason: 'failed', message: 'The sketch solver did not produce a valid solution.', diagnostics };
      wrapper.apply_solution();
      const graph: CadSketchGraph = parseCadSketchGraph({ ...compiled.graph, points: compiled.graph.points.map(point => {
        const solved = wrapper.sketch_index.get_sketch_point(point.id);
        return { ...point, position: [typeof point.position[0] === 'number' ? solved.x : point.position[0], typeof point.position[1] === 'number' ? solved.y : point.position[1]] };
      }), entities: compiled.graph.entities.map(entity => entity.kind === 'circle' && typeof entity.radius === 'number'
        ? { ...entity, radius: wrapper.sketch_index.get_sketch_circle(entity.id).radius } : entity) });
      const issues = checkCadSketchGraph(graph, input.parameters);
      if (issues.length) return { kind: 'rejected', reason: 'invalid-solution', message: 'The sketch solution does not satisfy its geometry and relations.', diagnostics: { ...diagnostics, issues } };
      return { kind: 'solved', graph, diagnostics };
    } finally { wrapper.destroy_gcs_module(); }
  } };
}
