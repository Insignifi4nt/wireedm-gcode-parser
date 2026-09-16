import { deriveActiveMachiningOperations } from '@/domain/path-intel/machiningParticipation';
import { resolveInitialWirePosition } from '@/domain/path-intel/initialWirePosition';
import { operationEntryPoint } from '@/domain/path-intel/operationTransitions';
import { resolveProgramStopPoints } from '@/domain/path-intel/programStops';
import type { PathPlanningDocument, Point2 } from '@/domain/path-intel/types';

export interface ProgramStopMarker {
  operationId: string;
  stopId: string;
  point: Point2;
}

/** Geometry-only stop positions, available before export prerequisites are complete. */
export function programStopPreview(document: PathPlanningDocument): ProgramStopMarker[] {
  const machining = deriveActiveMachiningOperations(document);
  if (machining.status !== 'ready') return [];
  const effective = { ...document, segments: machining.segments, plan: { ...document.plan, operations: machining.operations } };
  const initial = resolveInitialWirePosition(document);
  let current: Point2 | null = initial.status === 'ready' ? initial.point : null;
  const markers: ProgramStopMarker[] = [];
  for (const operation of machining.operations) {
    const resolved = resolveProgramStopPoints(effective, operation.id);
    const distances = new Map(resolved.status === 'ready' ? resolved.stops.map((stop) => [stop.id, stop.point]) : []);
    const exit = operation.transitions?.exit;
    const end = exit && exit.strategy !== 'none' ? exit.to : operation.endPoint;
    for (const stop of operation.programStops ?? []) {
      if (!stop.enabled) continue;
      const point = stop.placement.kind === 'before-entry' ? current
        : stop.placement.kind === 'after-positioning' ? operationEntryPoint(operation)
        : stop.placement.kind === 'after-contour' ? operation.endPoint
          : stop.placement.kind === 'after-exit' ? end : distances.get(stop.id);
      if (point) markers.push({
        operationId: operation.machiningIntent?.kind === 'partial-contour' ? operation.machiningIntent.sourceOperationId : operation.id,
        stopId: stop.id, point
      });
    }
    current = end;
  }
  return markers;
}
