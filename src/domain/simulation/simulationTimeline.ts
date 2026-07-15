import { distance, pointOnCircle, segmentMap } from '@/domain/path-intel/segments';
import type {
  GcodePostedMoveKind,
  GcodePostedMoveReason
} from '@/domain/path-intel/postGcode';
import type { PathDiagnostic, PathSegment, Point2 } from '@/domain/path-intel/types';
import {
  composeUpidGCodeExport,
  type UniversalPathIntelligenceDocument,
  type UpidGCodeProgramMove
} from '@/domain/upid/upidDocument';
import type { MachineProfile } from '@/domain/workbench/types';

const ARC_SAMPLE_SPACING_MM = 1;
const MAX_ARC_SAMPLE_ANGLE_RADIANS = Math.PI / 36;
const MAX_ARC_SAMPLE_SEGMENTS = 4096;

export interface SimulationTimelineMove {
  id: string;
  kind: GcodePostedMoveKind;
  command: UpidGCodeProgramMove['command'];
  reason: GcodePostedMoveReason;
  operationId: string | null;
  segmentId: string | null;
  programLineNumber: number;
  start: Point2;
  end: Point2;
  points: Point2[];
  lengthMm: number;
  startDistanceMm: number;
  endDistanceMm: number;
}

export interface SimulationTimelineOperationSummary {
  operationId: string;
  displayName: string;
  moveStartIndex: number;
  moveEndIndex: number;
  moveIds: string[];
  programLineStart: number;
  programLineEnd: number;
  startDistanceMm: number;
  endDistanceMm: number;
  cutDistanceMm: number;
  rapidDistanceMm: number;
}

export interface SimulationTimeline {
  status: 'ready' | 'blocked';
  diagnostics: PathDiagnostic[];
  moves: SimulationTimelineMove[];
  operations: SimulationTimelineOperationSummary[];
  totalDistanceMm: number;
  cutDistanceMm: number;
  rapidDistanceMm: number;
}

export interface SimulationCursorState {
  progress: number;
  distanceMm: number;
  moveIndex: number | null;
  moveId: string | null;
  moveProgress: number;
  point: Point2 | null;
  kind: SimulationTimelineMove['kind'] | null;
  command: SimulationTimelineMove['command'] | null;
  reason: SimulationTimelineMove['reason'] | null;
  operationId: string | null;
  segmentId: string | null;
  programLineNumber: number | null;
}

export function compileSimulationTimeline(
  document: UniversalPathIntelligenceDocument,
  machine: MachineProfile
): SimulationTimeline {
  const posted = composeUpidGCodeExport(document, { machine });
  if (posted.post.status === 'blocked') {
    return {
      status: 'blocked',
      diagnostics: posted.diagnostics,
      moves: [],
      operations: [],
      totalDistanceMm: 0,
      cutDistanceMm: 0,
      rapidDistanceMm: 0
    };
  }

  const segmentsById = segmentMap(document.segments);
  const moves: SimulationTimelineMove[] = [];
  const operations: SimulationTimelineOperationSummary[] = [];
  let totalDistanceMm = 0;
  let cutDistanceMm = 0;
  let rapidDistanceMm = 0;

  for (const operation of posted.programOperations) {
    const moveStartIndex = moves.length;
    const startDistanceMm = totalDistanceMm;
    let operationCutDistanceMm = 0;
    let operationRapidDistanceMm = 0;

    for (const postedMove of operation.moves) {
      const move = compileMove(postedMove, segmentsById, totalDistanceMm);
      moves.push(move);
      totalDistanceMm = move.endDistanceMm;
      if (move.kind === 'cut') {
        cutDistanceMm += move.lengthMm;
        operationCutDistanceMm += move.lengthMm;
      } else {
        rapidDistanceMm += move.lengthMm;
        operationRapidDistanceMm += move.lengthMm;
      }
    }

    operations.push({
      operationId: operation.operationId,
      displayName: operation.displayName,
      moveStartIndex,
      moveEndIndex: moves.length - 1,
      moveIds: moves.slice(moveStartIndex).map((move) => move.id),
      programLineStart: operation.programLineStart,
      programLineEnd: operation.programLineEnd,
      startDistanceMm,
      endDistanceMm: totalDistanceMm,
      cutDistanceMm: operationCutDistanceMm,
      rapidDistanceMm: operationRapidDistanceMm
    });
  }

  return {
    status: 'ready',
    diagnostics: posted.diagnostics,
    moves,
    operations,
    totalDistanceMm,
    cutDistanceMm,
    rapidDistanceMm
  };
}

export function sampleSimulationCursor(
  timeline: SimulationTimeline,
  progress: number
): SimulationCursorState {
  const normalizedProgress = clampProgress(progress);
  const distanceMm = timeline.totalDistanceMm * normalizedProgress;
  const moveIndex = moveIndexAtDistance(timeline.moves, distanceMm, timeline.totalDistanceMm);
  const move = moveIndex === null ? null : timeline.moves[moveIndex];
  const moveProgress = move
    ? move.lengthMm > 0
      ? clampProgress((distanceMm - move.startDistanceMm) / move.lengthMm)
      : normalizedProgress === 1
        ? 1
        : 0
    : 0;

  return {
    progress: normalizedProgress,
    distanceMm,
    moveIndex,
    moveId: move?.id ?? null,
    moveProgress,
    point: move ? sampleMovePoint(move, moveProgress) : null,
    kind: move?.kind ?? null,
    command: move?.command ?? null,
    reason: move?.reason ?? null,
    operationId: move?.operationId ?? null,
    segmentId: move?.segmentId ?? null,
    programLineNumber: move?.programLineNumber ?? null
  };
}

function compileMove(
  move: UpidGCodeProgramMove,
  segmentsById: Map<string, PathSegment>,
  startDistanceMm: number
): SimulationTimelineMove {
  const start = copyPoint(move.startPoint ?? move.endPoint);
  const end = copyPoint(move.endPoint);
  const segment = move.segmentId ? segmentsById.get(move.segmentId) : undefined;
  const circularGeometry = circularMoveGeometry(move, segment);
  const lengthMm = circularGeometry
    ? Math.abs(circularGeometry.radius * circularGeometry.sweepRadians)
    : distance(start, end);
  const points = circularGeometry
    ? sampleCircularMove(start, end, circularGeometry)
    : pointsForLinearMove(start, end);

  return {
    id: `simulation-move-line-${move.programLineNumber}`,
    kind: move.kind,
    command: move.command,
    reason: move.reason,
    operationId: move.operationId,
    segmentId: move.segmentId,
    programLineNumber: move.programLineNumber,
    start,
    end,
    points,
    lengthMm,
    startDistanceMm,
    endDistanceMm: startDistanceMm + lengthMm
  };
}

function circularMoveGeometry(move: UpidGCodeProgramMove, segment: PathSegment | undefined) {
  if ((move.command !== 'G2' && move.command !== 'G3') || !segment || segment.kind === 'line') {
    return null;
  }

  const direction = move.command === 'G2' ? -1 : 1;
  return {
    center: segment.center,
    radius: segment.radius,
    sweepRadians:
      segment.kind === 'circle'
        ? direction * Math.PI
        : direction * Math.abs(segment.sweepRadians)
  };
}

function sampleCircularMove(
  start: Point2,
  end: Point2,
  geometry: { center: Point2; radius: number; sweepRadians: number }
) {
  const lengthMm = Math.abs(geometry.radius * geometry.sweepRadians);
  const segmentCount = Math.min(
    MAX_ARC_SAMPLE_SEGMENTS,
    Math.max(
      1,
      Math.ceil(lengthMm / ARC_SAMPLE_SPACING_MM),
      Math.ceil(Math.abs(geometry.sweepRadians) / MAX_ARC_SAMPLE_ANGLE_RADIANS)
    )
  );
  const startAngle = Math.atan2(start.y - geometry.center.y, start.x - geometry.center.x);
  const points = Array.from({ length: segmentCount + 1 }, (_, index) =>
    pointOnCircle(
      geometry.center,
      geometry.radius,
      startAngle + geometry.sweepRadians * (index / segmentCount)
    )
  );
  points[0] = copyPoint(start);
  points[points.length - 1] = copyPoint(end);
  return points;
}

function pointsForLinearMove(start: Point2, end: Point2) {
  return distance(start, end) === 0
    ? [copyPoint(end)]
    : [copyPoint(start), copyPoint(end)];
}

function moveIndexAtDistance(
  moves: SimulationTimelineMove[],
  distanceMm: number,
  totalDistanceMm: number
) {
  if (moves.length === 0) return null;
  if (totalDistanceMm === 0) return moves.length - 1;

  const positiveMoveIndex = moves.findIndex(
    (move) => move.lengthMm > 0 && distanceMm <= move.endDistanceMm
  );
  return positiveMoveIndex >= 0 ? positiveMoveIndex : moves.length - 1;
}

function sampleMovePoint(move: SimulationTimelineMove, progress: number) {
  if (move.points.length === 1) return copyPoint(move.points[0]);
  const scaledIndex = progress * (move.points.length - 1);
  const leftIndex = Math.min(Math.floor(scaledIndex), move.points.length - 2);
  const localProgress = scaledIndex - leftIndex;
  const left = move.points[leftIndex];
  const right = move.points[leftIndex + 1];
  return {
    x: left.x + (right.x - left.x) * localProgress,
    y: left.y + (right.y - left.y) * localProgress
  };
}

function clampProgress(progress: number) {
  if (!Number.isFinite(progress)) return 0;
  return Math.min(1, Math.max(0, progress));
}

function copyPoint(point: Point2): Point2 {
  return { x: point.x, y: point.y };
}
