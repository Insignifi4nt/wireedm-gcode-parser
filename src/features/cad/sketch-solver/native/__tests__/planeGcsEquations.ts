import type { SketchPrimitive } from '@salusoft89/planegcs/dist/sketch/sketch_primitive.js';
import type { compileCadSketchPlaneGcs } from '../../cadSketchSolverRuntime';
import type { CadSketchEquation, CadSketchEquationModel } from '../cadSketchEquationModel';

type Compiled = ReturnType<typeof compileCadSketchPlaneGcs>;

/**
 * Test oracle: the PlaneGCS compilation restated as native scalar equations, resolving lines
 * to their endpoints and parameter references to indices of `model`. Each PlaneGCS constraint is
 * one tag.
 */
export function planeGcsEquations(compiled: Compiled, model: CadSketchEquationModel): CadSketchEquation[] {
  const objects = new Map(compiled.objects.map(object => [object.id, object]));
  const point = (id: string) => { const x = model.pointParameters.get(id); if (x === undefined) throw new Error(`No point ${id}.`); return [x, x + 1]; };
  const radius = (id: string) => { const index = model.radiusParameters.get(id); if (index === undefined) throw new Error(`No circle ${id}.`); return index; };
  const line = (id: string) => {
    const object = objects.get(id);
    if (object?.type !== 'line') throw new Error(`No line ${id}.`);
    return [...point(object.p1_id), ...point(object.p2_id)];
  };
  const parameter = (reference: { o_id: string; prop: string }) => reference.prop === 'radius' ? radius(reference.o_id)
    : point(reference.o_id)[reference.prop === 'x' ? 0 : reference.prop === 'y' ? 1 : Number.NaN];
  const equations: CadSketchEquation[] = [];
  let tag = -1;
  for (const object of compiled.objects) {
    const sourceId = compiled.sourceIds.get(object.id);
    if (sourceId === undefined) continue;
    tag += 1;
    const add = (kind: CadSketchEquation['kind'], operands: number[], value = 0) => equations.push({ kind, operands, value, sourceId, tag, ...'temporary' in object && object.temporary ? { temporary: true } : {} });
    const o = object as SketchPrimitive & Record<string, unknown>;
    switch (object.type) {
      case 'p2p_coincident': for (const axis of [0, 1]) add('difference', [point(object.p1_id)[axis], point(object.p2_id)[axis]]); break;
      case 'horizontal_pp': add('difference', [point(object.p1_id)[1], point(object.p2_id)[1]]); break;
      case 'vertical_pp': add('difference', [point(object.p1_id)[0], point(object.p2_id)[0]]); break;
      case 'p2p_symmetric_ppp': for (const axis of [0, 1]) add('midpoint', [point(object.p1_id)[axis], point(object.p2_id)[axis], point(object.p_id)[axis]]); break;
      case 'p2p_symmetric_ppl': {
        const operands = [...point(object.p1_id), ...point(object.p2_id), ...line(object.l_id)];
        add('symmetric-midpoint', operands); add('symmetric-perpendicular', operands); break;
      }
      case 'point_on_line_pl': add('point-on-line', [...point(object.p_id), ...line(object.l_id)]); break;
      case 'point_on_line_ppp': add('point-on-line', [...point(object.p_id), ...point(object.lp1_id), ...point(object.lp2_id)]); break;
      case 'perpendicular_pppp': add('perpendicular', [...point(object.l1p1_id), ...point(object.l1p2_id), ...point(object.l2p1_id), ...point(object.l2p2_id)]); break;
      case 'l2l_angle_pppp': add('angle', [...point(object.l1p1_id), ...point(object.l1p2_id), ...point(object.l2p1_id), ...point(object.l2p2_id)], o.angle as number); break;
      case 'perpendicular_ll': add('perpendicular', [...line(object.l1_id), ...line(object.l2_id)]); break;
      case 'parallel': add('parallel', [...line(object.l1_id), ...line(object.l2_id)]); break;
      case 'equal_length': add('equal-length', [...line(object.l1_id), ...line(object.l2_id)]); break;
      case 'equal_radius_cc': add('difference', [radius(object.c1_id), radius(object.c2_id)]); break;
      case 'p2p_distance':
        if (typeof object.distance === 'number') add('distance', [...point(object.p1_id), ...point(object.p2_id)], object.distance);
        else add('distance-to-parameter', [...point(object.p1_id), ...point(object.p2_id), parameter(object.distance as { o_id: string; prop: string })]);
        break;
      case 'difference': add('difference', [parameter(o.param1 as { o_id: string; prop: string }), parameter(o.param2 as { o_id: string; prop: string })], o.difference as number); break;
      case 'circle_radius': add('value', [radius(object.c_id)], o.radius as number); break;
      case 'circle_diameter': add('value', [radius(object.c_id)], (o.diameter as number) / 2); break;
      case 'coordinate_x': add('value', [point(object.p_id)[0]], o.x as number); break;
      case 'coordinate_y': add('value', [point(object.p_id)[1]], o.y as number); break;
      default: throw new Error(`The oracle does not restate PlaneGCS ${object.type}.`);
    }
  }
  return equations;
}

/** PlaneGCS parameter values restated in `model` order. */
export function planeGcsValues(compiled: Compiled, model: CadSketchEquationModel): number[] {
  const values = [...model.values].fill(Number.NaN);
  for (const object of compiled.objects) {
    if (object.type === 'point') { const x = model.pointParameters.get(object.id)!; values[x] = object.x; values[x + 1] = object.y; }
    else if (object.type === 'circle') values[model.radiusParameters.get(object.id)!] = object.radius as number;
  }
  return values;
}
