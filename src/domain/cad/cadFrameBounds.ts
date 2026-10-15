import type { CadAnalyticBoundary } from './cadSketchGeometry';
import type { CadBounds3 } from './cadCurve';
import { cadFramePointToWorld, type CadResolvedFrame } from './cadDatumPlanes';
import { angleIsOnSweep, nextDown, nextUp } from '../path-intel/segments';
import { CadError } from './cadError';

/** Analytic extrema in each world component; display tessellation never defines bounds. */
export function cadFrameEntityBounds(entities: readonly CadAnalyticBoundary[], frame: CadResolvedFrame, offsetMm: number): CadBounds3 {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  let entityMin: number[];
  let entityMax: number[];
  const include = (point: readonly number[]) =>
    point.forEach((value, index) => {
      entityMin[index] = Math.min(entityMin[index], value);
      entityMax[index] = Math.max(entityMax[index], value);
    });
  for (const entity of entities) {
    entityMin = [Infinity, Infinity, Infinity];
    entityMax = [-Infinity, -Infinity, -Infinity];
    if (entity.type === 'line') {
      for (const endpoint of [entity.start, entity.end]) {
        const world = cadFramePointToWorld(frame, offsetMm, [endpoint.x, endpoint.y]);
        for (let index = 0; index < 3; index++) {
          // Absolute-term arithmetic envelopes are convex along a line.
          const reserve =
            frame.u[index] === 0 && frame.v[index] === 0
              ? 0
              : 16 *
                Number.EPSILON *
                (Math.abs(frame.origin[index]) +
                  Math.abs(frame.normal[index] * offsetMm) +
                  Math.abs(frame.u[index] * endpoint.x) +
                  Math.abs(frame.v[index] * endpoint.y));
          entityMin[index] = Math.min(entityMin[index], reserve === 0 ? world[index] : nextDown(nextDown(world[index] - reserve)));
          entityMax[index] = Math.max(entityMax[index], reserve === 0 ? world[index] : nextUp(nextUp(world[index] + reserve)));
        }
      }
      for (let index = 0; index < 3; index++) {
        min[index] = Math.min(min[index], entityMin[index]);
        max[index] = Math.max(max[index], entityMax[index]);
      }
      continue;
    }
    const center = cadFramePointToWorld(frame, offsetMm, [entity.center.x, entity.center.y]);
    const start = entity.type === 'circle' ? 0 : entity.startAngle;
    const sweep = entity.type === 'circle' ? 2 * Math.PI : (entity.sweepRadians ?? entity.endAngle - entity.startAngle);
    if (entity.type === 'arc') {
      include(cadFramePointToWorld(frame, offsetMm, [entity.start.x, entity.start.y]));
      include(cadFramePointToWorld(frame, offsetMm, [entity.end.x, entity.end.y]));
    }
    const angularError = 16 * Number.EPSILON * Math.max(1, Math.abs(start), Math.abs(sweep));
    for (let index = 0; index < 3; index++) {
      const extent = entity.radius * Math.hypot(frame.u[index], frame.v[index]);
      if (extent === 0) {
        min[index] = Math.min(min[index], center[index]);
        max[index] = Math.max(max[index], center[index]);
        continue;
      }
      const positive = Math.atan2(frame.v[index], frame.u[index]);
      // Final-center ULPs alone are insufficient when origin and local center
      // cancel. Cover the earlier local-point and world-mapping arithmetic.
      const reserve =
        16 *
        Number.EPSILON *
        (Math.abs(frame.origin[index]) +
          Math.abs(frame.normal[index] * offsetMm) +
          Math.abs(frame.u[index]) * (Math.abs(entity.center.x) + entity.radius) +
          Math.abs(frame.v[index]) * (Math.abs(entity.center.y) + entity.radius));
      if (entity.type === 'circle' || angleIsOnSweep(positive, start, sweep, angularError))
        entityMax[index] = Math.max(entityMax[index], center[index] + extent);
      if (entity.type === 'circle' || angleIsOnSweep(positive + Math.PI, start, sweep, angularError))
        entityMin[index] = Math.min(entityMin[index], center[index] - extent);
      // Endpoint-bounded short arcs need the same reserve as interior extrema.
      // Inflate this entity once, without repeatedly widening earlier geometry.
      max[index] = Math.max(max[index], nextUp(nextUp(entityMax[index] + reserve)));
      min[index] = Math.min(min[index], nextDown(nextDown(entityMin[index] - reserve)));
    }
  }
  if (![...min, ...max].every(Number.isFinite))
    throw new CadError('empty-reference', 'World bounds require nonempty finite analytic geometry.');
  return Object.freeze({
    min: Object.freeze([min[0], min[1], min[2]] as const),
    max: Object.freeze([max[0], max[1], max[2]] as const),
  });
}
