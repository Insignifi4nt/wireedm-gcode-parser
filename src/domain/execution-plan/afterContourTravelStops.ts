import { afterContourTravelPath, pointAlongAfterContourTravel, travelDistanceError } from '@/domain/path-intel/afterContourTravel';
import type { PathOperation, PathPlanningDocument } from '@/domain/path-intel/types';
import type { ExecutionPlanResult, WireEdmExecutionEvent } from './executionPlan';

type Motion = Extract<WireEdmExecutionEvent, { kind: 'motion' | 'position' }>;
type Stop = Extract<WireEdmExecutionEvent, { kind: 'program-stop' }>;

/** Split only existing travel, retaining every threading/compensation event at its original boundary. */
export function interleaveAfterContourTravelStops(
  document: PathPlanningDocument, operations: readonly PathOperation[], events: readonly WireEdmExecutionEvent[]
): { ok: true; events: readonly WireEdmExecutionEvent[] } | Extract<ExecutionPlanResult, { ok: false }> {
  const insertions = new Map<string, Array<{ distanceMm: number; stop: Stop }>>();
  for (const [index, operation] of operations.entries()) {
    const requested = (operation.programStops ?? []).filter((stop) => stop.enabled && stop.placement.kind === 'after-contour-distance');
    if (!requested.length) continue;
    const sourceId = operation.machiningIntent?.sourceOperationId ?? operation.id;
    const fail = (message: string): Extract<ExecutionPlanResult, { ok: false }> => ({ ok: false,
      diagnostics: [{ code: 'EXECUTION_PLAN_PROGRAM_STOP_INVALID', message, operationId: sourceId }] });
    if (operations.filter((candidate) => (candidate.machiningIntent?.sourceOperationId ?? candidate.id) === sourceId).length !== 1) {
      return fail('A travel-distance stop requires one active contour run. Review split or inactive contours separately.');
    }
    const next = operations[index + 1];
    const path = afterContourTravelPath(document, operation, next);
    for (const stop of requested) {
      if (stop.placement.kind !== 'after-contour-distance') continue;
      const error = travelDistanceError(path, stop.placement.travelLengthMm);
      if (error) return fail(error);
      const resolved = pointAlongAfterContourTravel(path, stop.placement.travelLengthMm);
      if (resolved.phase === 'exit' && resolved.distanceMm === path.exitLengthMm &&
        operation.programStops?.some((other) => other.enabled && other.placement.kind === 'after-exit')) {
        return fail('The travel-distance stop coincides with an enabled After exit stop. Keep one pause at that boundary.');
      }
      const motion = events.find((event): event is Motion => resolved.phase === 'exit'
        ? event.kind === 'motion' && event.role === 'exit' && event.operationId === operation.id
        : event.kind === 'position' && event.operationId === next?.id);
      if (!motion) return fail('The requested travel-distance stop has no executable travel. Review the exit and next positioning move.');
      const items = insertions.get(motion.id) ?? [];
      items.push({ distanceMm: resolved.distanceMm, stop: {
        kind: 'program-stop', id: '', ordinal: 0, operationId: operation.id,
        trace: [{ kind: 'program-stop', operationId: sourceId, stopId: stop.id }],
        stopId: stop.id, placement: 'after-contour-distance', reason: stop.reason,
        note: stop.note ?? null, point: resolved.point
      } });
      insertions.set(motion.id, items);
    }
  }
  if (!insertions.size) return { ok: true, events };
  const result: WireEdmExecutionEvent[] = [];
  for (const event of events) {
    const items = insertions.get(event.id);
    if (!items || (event.kind !== 'motion' && event.kind !== 'position')) { result.push(event); continue; }
    let from = event.kind === 'motion' ? event.start : event.from;
    const end = event.kind === 'motion' ? event.end : event.to;
    const slice = (to: typeof from): Motion => event.kind === 'motion'
      ? { ...event, start: { ...from }, end: { ...to } }
      : { ...event, from: { ...from }, to: { ...to } };
    for (const item of items.sort((a, b) => a.distanceMm - b.distanceMm)) {
      result.push(slice(item.stop.point), item.stop);
      from = item.stop.point;
    }
    if (from.x !== end.x || from.y !== end.y) result.push(slice(end));
  }
  return { ok: true, events: result.map((event, index) => ({ ...event,
    id: `event-${String(index + 1).padStart(6, '0')}`, ordinal: index + 1 })) };
}
