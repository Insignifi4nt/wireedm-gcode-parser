import { deriveActiveMachiningOperations } from './machiningParticipation';
import { operationEntryPoint } from './operationTransitions';
import { distance } from './segments';
import type { PathOperation, PathPlanningDocument, Point2 } from './types';

export interface AfterContourTravelPath {
  contourEnd: Point2;
  exitEnd: Point2;
  positioningEnd: Point2;
  exitLengthMm: number;
  positioningLengthMm: number;
  totalLengthMm: number;
  separatingPosition: boolean;
}

/** The existing exit lead followed by the next positioning move; never creates travel. */
export function afterContourTravelPath(
  document: PathPlanningDocument, operation: PathOperation, next: PathOperation | undefined
): AfterContourTravelPath {
  const exit = operation.transitions?.exit;
  const contourEnd = operation.endPoint;
  const exitEnd = exit && exit.strategy !== 'none' ? exit.to : contourEnd;
  const positioningEnd = next ? operationEntryPoint(next) : exitEnd;
  const tolerance = Math.max(0, document.options.coincidenceEpsilon);
  const exitLengthMm = distance(contourEnd, exitEnd);
  const positioningDistance = distance(exitEnd, positioningEnd);
  const positioningLengthMm = positioningDistance <= tolerance ? 0 : positioningDistance;
  const threading = next?.threadingTransition ?? document.setup?.threadingDefault;
  return { contourEnd, exitEnd, positioningEnd, exitLengthMm, positioningLengthMm,
    totalLengthMm: exitLengthMm + positioningLengthMm,
    separatingPosition: threading?.wireSeparation === 'automatic-during-positioning' };
}

export function resolveSourceAfterContourTravel(document: PathPlanningDocument, operationId: string):
  | { status: 'ready'; path: AfterContourTravelPath }
  | { status: 'blocked'; message: string } {
  const machining = deriveActiveMachiningOperations(document);
  if (machining.status !== 'ready') return { status: 'blocked', message: 'Resolve machining participation before placing a travel-distance stop.' };
  const matches = machining.operations.filter((operation) =>
    (operation.machiningIntent?.sourceOperationId ?? operation.id) === operationId);
  if (matches.length !== 1) return { status: 'blocked', message: 'A travel-distance stop requires one active contour run. Split or inactive contours need their travel reviewed separately.' };
  const index = machining.operations.indexOf(matches[0]);
  return { status: 'ready', path: afterContourTravelPath(document, matches[0], machining.operations[index + 1]) };
}

export function travelDistanceError(path: AfterContourTravelPath, travelLengthMm: number): string | null {
  if (!Number.isFinite(travelLengthMm) || travelLengthMm <= 0) return 'Travel distance must be a finite number greater than 0.';
  if (!Number.isFinite(path.totalLengthMm) || path.totalLengthMm <= 0) return 'No exit lead or next positioning move exists after this contour. Configure the intended travel first.';
  if (travelLengthMm >= path.totalLengthMm) return `Travel distance must be less than the available path (${path.totalLengthMm.toFixed(3)} mm). Use the endpoint placement to stop at the end.`;
  if (travelLengthMm > path.exitLengthMm && path.separatingPosition) return 'A distance stop cannot split positioning that separates the wire automatically. Use Before positioning or After positioning, or review a supported separation-before-positioning strategy. Installed posts are not changed.';
  return null;
}

export function pointAlongAfterContourTravel(path: AfterContourTravelPath, travelLengthMm: number) {
  const phase = travelLengthMm <= path.exitLengthMm ? 'exit' : 'positioning';
  const distanceMm = phase === 'exit' ? travelLengthMm : travelLengthMm - path.exitLengthMm;
  const length = phase === 'exit' ? path.exitLengthMm : path.positioningLengthMm;
  const from = phase === 'exit' ? path.contourEnd : path.exitEnd;
  const to = phase === 'exit' ? path.exitEnd : path.positioningEnd;
  const fraction = distanceMm / length;
  return { phase, distanceMm, point: distanceMm === length ? { ...to }
    : { x: from.x + (to.x - from.x) * fraction, y: from.y + (to.y - from.y) * fraction } } as const;
}
