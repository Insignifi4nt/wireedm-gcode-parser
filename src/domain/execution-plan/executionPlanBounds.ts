import { arcBounds, boundsFromPoints, emptyBounds, mergeBounds } from '@/domain/path-intel/segments';

import type { WireEdmExecutionPlan } from './executionPlan';

export function executionPlanBounds(plan: WireEdmExecutionPlan) {
  let bounds = emptyBounds();
  for (const event of plan.events) {
    if (event.kind === 'program-start') {
      bounds = mergeBounds(bounds, boundsFromPoints([event.initialWirePosition]));
    } else if (event.kind === 'position') {
      bounds = mergeBounds(bounds, boundsFromPoints([event.from, event.to]));
    } else if (event.kind === 'motion') {
      let motionBounds = boundsFromPoints([event.start, event.end]);
      if (event.motion === 'circular' && event.center && event.clockwise !== undefined) {
        const radius = Math.hypot(event.start.x - event.center.x, event.start.y - event.center.y);
        if (event.fullCircle) {
          motionBounds = {
            minX: event.center.x - radius, maxX: event.center.x + radius,
            minY: event.center.y - radius, maxY: event.center.y + radius
          };
        } else {
          const startAngle = Math.atan2(event.start.y - event.center.y, event.start.x - event.center.x);
          const endAngle = Math.atan2(event.end.y - event.center.y, event.end.x - event.center.x);
          const fullTurn = 2 * Math.PI;
          const delta = event.clockwise ? startAngle - endAngle : endAngle - startAngle;
          const remainder = delta % fullTurn;
          const sweep = remainder < 0 ? remainder + fullTurn : remainder;
          motionBounds = arcBounds(
            event.center, radius, startAngle, event.clockwise ? -sweep : sweep, event.start, event.end
          );
        }
      }
      bounds = mergeBounds(bounds, motionBounds);
    }
  }
  return bounds;
}
