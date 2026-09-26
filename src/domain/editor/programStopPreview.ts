import { deriveActiveMachiningOperations } from '@/domain/path-intel/machiningParticipation';
import { resolveInitialWirePosition } from '@/domain/path-intel/initialWirePosition';
import { operationEntryPoint } from '@/domain/path-intel/operationTransitions';
import { resolveProgramStopPoints } from '@/domain/path-intel/programStops';
import { afterContourTravelPath, pointAlongAfterContourTravel, travelDistanceError } from '@/domain/path-intel/afterContourTravel';
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
  for (const [index, operation] of machining.operations.entries()) {
    const resolved = resolveProgramStopPoints(effective, operation.id);
    const distances = new Map(resolved.status === 'ready' ? resolved.stops.map((stop) => [stop.id, stop.point]) : []);
    const exit = operation.transitions?.exit;
    const end = exit && exit.strategy !== 'none' ? exit.to : operation.endPoint;
    for (const stop of operation.programStops ?? []) {
      if (!stop.enabled) continue;
      if (stop.placement.kind === 'after-contour-distance') {
        const sourceId = operation.machiningIntent?.sourceOperationId ?? operation.id;
        if (machining.operations.filter((candidate) => (candidate.machiningIntent?.sourceOperationId ?? candidate.id) === sourceId).length !== 1) continue;
        const path = afterContourTravelPath(document, operation, machining.operations[index + 1]);
        if (!travelDistanceError(path, stop.placement.travelLengthMm)) markers.push({
          operationId: sourceId, stopId: stop.id,
          point: pointAlongAfterContourTravel(path, stop.placement.travelLengthMm).point
        });
        continue;
      }
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
