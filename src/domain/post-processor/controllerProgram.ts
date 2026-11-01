import type {
  ExecutionMotionRole,
  WireEdmExecutionEvent,
  WireEdmExecutionPlan
} from '@/domain/execution-plan/executionPlan';
import type { Point2 } from '@/domain/path-intel/types';
import { circularRadialDistance, signedRadialAngle } from '@/domain/path-intel/circularGeometry';
import {
  cadOutputDerivedRoundoff,
  cadOutputFitting,
  cadOutputPointRoundoff,
  cadRoundoff
} from '@/domain/precision/cadPrecision';

export interface ControllerMotionTrace {
  readonly motion: 'linear' | 'circular';
  readonly role: ExecutionMotionRole | 'position';
  readonly start: Point2;
  readonly end: Point2;
  readonly center?: Point2;
  readonly clockwise?: boolean;
  readonly fullCircle?: boolean;
  /** Coordinate representability of this block, in millimeters. */
  readonly rounding?: {
    readonly startX: number;
    readonly startY: number;
    readonly endX: number;
    readonly endY: number;
    readonly centerX: number;
    readonly centerY: number;
  };
}

export interface ControllerProgramBlock {
  readonly id: string;
  readonly lineIndex: number;
  readonly text: string;
  readonly eventId: string;
  readonly commandIds: readonly string[];
  readonly motion: ControllerMotionTrace | null;
}

export type PostEventDisposition =
  | {
      readonly kind: 'emitted';
      readonly eventId: string;
      readonly blockIds: readonly string[];
    }
  | {
      readonly kind: 'consumed';
      readonly eventId: string;
      readonly reason: string;
    };

export interface ControllerProgram {
  readonly text: string;
  readonly lines: readonly string[];
  readonly blocks: readonly ControllerProgramBlock[];
  readonly eventDispositions: readonly PostEventDisposition[];
}

export type ControllerProgramAuditDiagnosticCode =
  | 'POST_AUDIT_EVENT_MISSING'
  | 'POST_AUDIT_EVENT_DUPLICATE'
  | 'POST_AUDIT_EVENT_UNKNOWN'
  | 'POST_AUDIT_MOTION_MISSING'
  | 'POST_AUDIT_MOTION_MISMATCH'
  | 'POST_AUDIT_BLOCK_INVALID'
  | 'POST_AUDIT_COMMAND_UNKNOWN';

export interface ControllerProgramAuditDiagnostic {
  readonly code: ControllerProgramAuditDiagnosticCode;
  readonly message: string;
  readonly eventId: string | null;
}

export function auditControllerProgram(
  plan: WireEdmExecutionPlan,
  program: ControllerProgram,
  registeredCommandIds: ReadonlySet<string>,
  coordinateQuantumMm = 0
): readonly ControllerProgramAuditDiagnostic[] {
  const diagnostics: ControllerProgramAuditDiagnostic[] = [];
  const planEvents = new Map(plan.events.map((event) => [event.id, event]));
  const dispositionByEvent = new Map<string, PostEventDisposition>();
  for (const disposition of program.eventDispositions) {
    if (!planEvents.has(disposition.eventId)) {
      diagnostics.push({
        code: 'POST_AUDIT_EVENT_UNKNOWN',
        message: `Post disposition references unknown event ${disposition.eventId}.`,
        eventId: disposition.eventId
      });
      continue;
    }
    if (dispositionByEvent.has(disposition.eventId)) {
      diagnostics.push({
        code: 'POST_AUDIT_EVENT_DUPLICATE',
        message: `Execution event ${disposition.eventId} has more than one disposition.`,
        eventId: disposition.eventId
      });
      continue;
    }
    dispositionByEvent.set(disposition.eventId, disposition);
  }
  for (const event of plan.events) {
    if (dispositionByEvent.has(event.id)) continue;
    diagnostics.push({
      code: 'POST_AUDIT_EVENT_MISSING',
      message: `Execution event ${event.id} was neither emitted nor explicitly consumed.`,
      eventId: event.id
    });
  }

  if (
    program.lines.length !== program.blocks.length ||
    program.text !== program.lines.join('\n')
  ) {
    diagnostics.push({
      code: 'POST_AUDIT_BLOCK_INVALID',
      message: 'Controller program text, line collection, and block collection disagree.',
      eventId: null
    });
  }
  const motionsByEvent = new Map<string, ControllerMotionTrace[]>();
  for (const [index, block] of program.blocks.entries()) {
    if (block.motion) {
      const motions = motionsByEvent.get(block.eventId) ?? [];
      motions.push(block.motion);
      motionsByEvent.set(block.eventId, motions);
    }
    if (
      block.lineIndex !== index ||
      block.id !== `block-${String(index + 1).padStart(6, '0')}` ||
      block.text !== program.lines[index] ||
      block.text.length === 0 ||
      /[\r\n\u0000]/.test(block.text) ||
      !planEvents.has(block.eventId)
    ) {
      diagnostics.push({
        code: 'POST_AUDIT_BLOCK_INVALID',
        message: `Controller block ${block.id} has invalid identity, text, ordering, or event ownership.`,
        eventId: block.eventId
      });
    }
    for (const commandId of block.commandIds) {
      if (registeredCommandIds.has(commandId)) continue;
      diagnostics.push({
        code: 'POST_AUDIT_COMMAND_UNKNOWN',
        message: `Controller block ${block.id} uses unregistered dialect command ${commandId}.`,
        eventId: block.eventId
      });
    }
  }

  for (const event of plan.events) {
    if (event.kind !== 'motion' && event.kind !== 'position') continue;
    const motions = motionsByEvent.get(event.id) ?? [];
    if (motions.length === 0) {
      diagnostics.push({
        code: 'POST_AUDIT_MOTION_MISSING',
        message: `Motion event ${event.id} must own at least one structured motion block.`,
        eventId: event.id
      });
      continue;
    }
    if (!sameMotionSequence(event, motions, plan.tolerance.endpointMm, coordinateQuantumMm)) {
      diagnostics.push({
        code: 'POST_AUDIT_MOTION_MISMATCH',
        message: `Controller motion blocks do not preserve motion event ${event.id}: each emitted coordinate may differ from the plan only by rounding to its last digit, a floating-point allowance that grows with its magnitude, and the plan's endpoint tolerance. These audit rules changed in app 0.0.792.`,
        eventId: event.id
      });
    }
  }
  return diagnostics;
}

// Each axis may differ by the post's rounding on that axis (half its quantum) and by floating-point
// roundoff that grows with that axis's magnitude; what remains may not exceed the plan's endpoint
// tolerance. One axis's allowance never excuses another axis's error: a point comparison clamps each
// axis's residual by that axis's allowance before the Euclidean comparison, and a distance from a planned
// line, or the roundoff of a radial distance, weights each axis's allowance by that axis's share of the
// distance. Path lengths and arc sweeps compare scalar totals with one roundoff term per summed value;
// they only reject, and every point they read is held to its own axes by the point, line and radial
// comparisons. The roundoff counts live in the precision policy: `outputPointRoundoffUlps` for endpoints
// and centres, and `outputDerivedRoundoffUlps` per term for line distances, radial distances, lengths
// and sweeps.

/** Largest coordinate magnitude on each axis. */
interface AxisMagnitudes {
  readonly x: number;
  readonly y: number;
}

interface LinearAllowance {
  readonly sourceToleranceMm: number;
  /** Largest coordinate magnitude of the planned endpoints and every emitted motion point, over both axes and the quanta. */
  readonly pointMagnitude: number;
  /** The same points' largest magnitude on each axis. */
  readonly axisMagnitude: AxisMagnitudes;
  /** Euclidean point tolerance used when a motion carries no rounding metadata. */
  readonly fallbackPointMm: number;
  /** Largest coordinate quantum of the event, used when a motion carries no rounding metadata. */
  readonly fallbackQuantumMm: number;
}

function sameMotionSequence(
  event: Extract<WireEdmExecutionEvent, { kind: 'motion' | 'position' }>,
  motions: readonly ControllerMotionTrace[],
  sourceToleranceMm: number,
  coordinateQuantumMm: number
) {
  const eventQuantum = motions.reduce((maximum, motion) => Math.max(
    maximum, motion.rounding?.startX ?? 0, motion.rounding?.startY ?? 0,
    motion.rounding?.endX ?? 0, motion.rounding?.endY ?? 0,
    motion.rounding?.centerX ?? 0, motion.rounding?.centerY ?? 0
  ), coordinateQuantumMm);
  const expectedStart = event.kind === 'position' ? event.from : event.start;
  const expectedEnd = event.kind === 'position' ? event.to : event.end;
  // Arc centres are measured apart from the path's points: only centre and sweep comparisons read
  // them, so a distant centre widens neither the radial distance nor any linear comparison.
  const axisMagnitude = axisMagnitudes(
    [expectedStart, expectedEnd, ...motions.flatMap((motion) => [motion.start, motion.end])]
  );
  const pointMagnitude = Math.max(eventQuantum, axisMagnitude.x, axisMagnitude.y);
  const centerAxes = event.kind === 'motion' && event.motion === 'circular' && event.center
    ? axisMagnitudes([event.center, ...motions.flatMap((motion) => motion.center ? [motion.center] : [])])
    : { x: 0, y: 0 };
  const centerMagnitude = Math.max(centerAxes.x, centerAxes.y);
  // Non-finite input fails closed instead of widening every allowance to infinity.
  if (!Number.isFinite(pointMagnitude) || !Number.isFinite(centerMagnitude)) return false;
  // Output fitting widens point, length and arc sweep allowances to the post's rounding when a motion
  // carries no per-axis rounding; each comparison passes the roundoff of the values it reads.
  const fallbackPointMm = cadOutputFitting(
    sourceToleranceMm, eventQuantum, cadOutputPointRoundoff(Math.max(pointMagnitude, centerMagnitude))
  ).pointMm;
  if (
    !sameRoundedPoint(motions[0].start, expectedStart, sourceToleranceMm, motions[0].rounding?.startX, motions[0].rounding?.startY, fallbackPointMm) ||
    !sameRoundedPoint(motions.at(-1)!.end, expectedEnd, sourceToleranceMm, motions.at(-1)!.rounding?.endX, motions.at(-1)!.rounding?.endY, fallbackPointMm) ||
    motions.some((motion, index) => (
      index > 0 && !samePoint(motions[index - 1].end, motion.start, sourceToleranceMm)
    ))
  ) return false;
  const linearAllowance: LinearAllowance = {
    sourceToleranceMm, pointMagnitude, axisMagnitude, fallbackPointMm, fallbackQuantumMm: eventQuantum
  };
  if (event.kind === 'position') {
    return sameLinearPath(motions, 'position', expectedStart, expectedEnd, linearAllowance);
  }
  if (event.motion === 'linear') {
    return sameLinearPath(motions, event.role, expectedStart, expectedEnd, linearAllowance);
  }
  const center = event.center;
  if (!center || event.clockwise === undefined) return false;
  const radius = distance(center, event.start);
  if (!Number.isFinite(radius) || radius <= 0) return false;
  // The radial distance is formed from the point and the planned start directly, so its roundoff
  // scales with their coordinates and not with a distant centre. Each axis's roundoff is weighted by
  // that axis's share of the distance. The post's rounding keeps the bound it had before 0.0.792: half
  // the rounding box's diagonal, which holds in any radial direction.
  const radialRoundoffX = cadOutputDerivedRoundoff(axisMagnitude.x);
  const radialRoundoffY = cadOutputDerivedRoundoff(axisMagnitude.y);
  const radialFallbackMm = cadOutputFitting(
    sourceToleranceMm, eventQuantum, cadOutputDerivedRoundoff(pointMagnitude)
  ).lengthMm;
  const radialAllowance = (point: Point2, quantumX: number | undefined, quantumY: number | undefined) => {
    if (quantumX === undefined || quantumY === undefined) return radialFallbackMm;
    const share = radialAxisShares(point, event.start, center);
    return sourceToleranceMm + Math.hypot(quantumX, quantumY) / 2 +
      share.x * radialRoundoffX + share.y * radialRoundoffY;
  };
  if (motions.some((motion) => (
    motion.motion !== 'circular' ||
    motion.role !== event.role ||
    !motion.center ||
    !sameRoundedPoint(
      motion.center, center, sourceToleranceMm, motion.rounding?.centerX, motion.rounding?.centerY,
      fallbackPointMm, motion.start
    ) ||
    motion.clockwise !== event.clockwise ||
    circularRadialDistance(motion.start, event.start, center, radius) >
      radialAllowance(motion.start, motion.rounding?.startX, motion.rounding?.startY) ||
    circularRadialDistance(motion.end, event.start, center, radius) >
      radialAllowance(motion.end, motion.rounding?.endX, motion.rounding?.endY) ||
    motion.fullCircle !== (motion.start.x === motion.end.x && motion.start.y === motion.end.y)
  ))) return false;
  const expectedSweep = event.fullCircle
    ? Math.PI * 2
    : circularSweep(event.start, event.end, center, event.clockwise);
  const emittedSweep = motions.reduce((total, motion) => total + (
    motion.fullCircle
      ? Math.PI * 2
      : circularSweep(motion.start, motion.end, motion.center!, motion.clockwise!)
  ), 0);
  // An arc length's roundoff scales with the coordinates and with a full turn's arc length, once for
  // the planned sweep and once for each emitted motion.
  const sweepRoundoffMm = cadOutputDerivedRoundoff(
    Math.max(pointMagnitude, centerMagnitude) + 2 * Math.PI * radius, motions.length + 1
  );
  // To first order, rounding moves an arc length by each endpoint's displacement plus up to twice the
  // centre's. Doubling every term keeps the bound conservative while displacements are small against
  // the radius; arcs whose radius is near the quantum are below the controller's resolution.
  const sweepAllowanceMm = motions.every((motion) => motion.rounding)
    ? sourceToleranceMm + motions.reduce((total, motion) => total + 2 * (
      Math.hypot(motion.rounding!.startX, motion.rounding!.startY) / 2 +
      Math.hypot(motion.rounding!.endX, motion.rounding!.endY) / 2 +
      Math.hypot(motion.rounding!.centerX, motion.rounding!.centerY) / 2
    ), 0) + sweepRoundoffMm
    : cadOutputFitting(sourceToleranceMm, eventQuantum, sweepRoundoffMm).arcSweepMm;
  return radius * Math.abs(expectedSweep - emittedSweep) <= sweepAllowanceMm;
}

function sameLinearPath(
  motions: readonly ControllerMotionTrace[],
  role: ControllerMotionTrace['role'],
  start: Point2,
  end: Point2,
  allowance: LinearAllowance
) {
  const { sourceToleranceMm, pointMagnitude, axisMagnitude, fallbackPointMm, fallbackQuantumMm } = allowance;
  if (motions.some((motion) => motion.motion !== 'linear' || motion.role !== role)) return false;
  const expectedLength = distance(start, end);
  const emittedLength = motions.reduce((total, motion) => total + distance(motion.start, motion.end), 0);
  if (expectedLength > 0 && emittedLength === 0) return false;
  const directionX = expectedLength === 0 ? 0 : (end.x - start.x) / expectedLength;
  const directionY = expectedLength === 0 ? 0 : (end.y - start.y) / expectedLength;
  const lengthRoundoffMm = cadOutputDerivedRoundoff(
    Math.max(pointMagnitude, expectedLength, emittedLength), motions.length + 1
  );
  if (motions.every((motion) => motion.rounding)) {
    const range = roundedLengthRange(motions, start, end, directionX, directionY);
    if (
      emittedLength - expectedLength > range.longerMm + sourceToleranceMm + lengthRoundoffMm ||
      expectedLength - emittedLength > range.shorterMm + sourceToleranceMm + lengthRoundoffMm
    ) return false;
  } else if (
    Math.abs(expectedLength - emittedLength) >
      cadOutputFitting(sourceToleranceMm, fallbackQuantumMm, lengthRoundoffMm).lengthMm
  ) return false;
  if (expectedLength === 0) {
    return motions.every((motion) => (
      sameRoundedPoint(motion.start, start, sourceToleranceMm,
        motion.rounding?.startX, motion.rounding?.startY, fallbackPointMm) &&
      sameRoundedPoint(motion.end, start, sourceToleranceMm,
        motion.rounding?.endX, motion.rounding?.endY, fallbackPointMm)
    ));
  }
  const lineRoundoffX = cadOutputDerivedRoundoff(axisMagnitude.x);
  const lineRoundoffY = cadOutputDerivedRoundoff(axisMagnitude.y);
  const fallbackLineMm = cadOutputFitting(
    sourceToleranceMm, fallbackQuantumMm, cadOutputDerivedRoundoff(pointMagnitude)
  ).pointMm;
  // Positional tolerance permits rounding, but must not authorize backwards travel.
  const roundoff = cadRoundoff(8, Math.max(
    1, expectedLength, Math.abs(start.x), Math.abs(start.y), Math.abs(end.x), Math.abs(end.y)
  ));
  let previousProgress = -Infinity;
  for (const motion of motions) {
    for (const [point, quantumX, quantumY] of [
      [motion.start, motion.rounding?.startX, motion.rounding?.startY],
      [motion.end, motion.rounding?.endX, motion.rounding?.endY]
    ] as const) {
      const x = point.x - start.x;
      const y = point.y - start.y;
      const progress = x * directionX + y * directionY;
      const deviation = Math.abs(x * directionY - y * directionX);
      // Each axis's rounding and roundoff, projected across and along the line: the farthest the
      // per-axis allowance box reaches in each direction.
      const allowanceX = quantumX === undefined ? undefined : quantumX / 2 + lineRoundoffX;
      const allowanceY = quantumY === undefined ? undefined : quantumY / 2 + lineRoundoffY;
      const deviationTolerance = allowanceX === undefined || allowanceY === undefined
        ? fallbackLineMm
        : sourceToleranceMm + Math.abs(directionY) * allowanceX + Math.abs(directionX) * allowanceY;
      const progressTolerance = allowanceX === undefined || allowanceY === undefined
        ? fallbackLineMm
        : sourceToleranceMm + Math.abs(directionX) * allowanceX + Math.abs(directionY) * allowanceY;
      if (
        !Number.isFinite(progress) || !Number.isFinite(deviation) ||
        deviation > deviationTolerance ||
        progress < -progressTolerance || progress > expectedLength + progressTolerance ||
        progress < previousProgress - roundoff
      ) return false;
      previousProgress = progress;
    }
  }
  return true;
}

/**
 * How much longer or shorter than a planned straight move correct rounding can make its emitted path.
 *
 * Each rounded coordinate lies within half its quantum of the planned one, so the emitted chord lies in
 * a box around the planned chord whose half-widths add the first start's and the last end's
 * half-quanta. The path is never shorter than the box's point nearest the origin. One motion is never
 * longer than the box's farthest corner, and each point that splits a move adds at most the diagonal
 * of its rounding (triangle inequality). These are the exact extremes, not a first-order projection:
 * a nearly axis-aligned move whose short side rounds across a quantum gains a second-order length the
 * projection misses. Neither side is narrower than the projection the audit used before.
 */
function roundedLengthRange(
  motions: readonly ControllerMotionTrace[], start: Point2, end: Point2, directionX: number, directionY: number
) {
  const planX = Math.abs(end.x - start.x);
  const planY = Math.abs(end.y - start.y);
  const planLength = Math.hypot(planX, planY);
  const first = motions[0].rounding!;
  const last = motions.at(-1)!.rounding!;
  const chordX = (first.startX + last.endX) / 2;
  const chordY = (first.startY + last.endY) / 2;
  const projectedMm = motions.reduce((total, motion) => total + (
    Math.abs(directionX) * (motion.rounding!.startX + motion.rounding!.endX) +
    Math.abs(directionY) * (motion.rounding!.startY + motion.rounding!.endY)
  ) / 2, 0);
  const shortest = Math.hypot(Math.max(0, planX - chordX), Math.max(0, planY - chordY));
  const longest = motions.length === 1
    ? Math.hypot(planX + chordX, planY + chordY)
    : planLength + motions.reduce((total, motion) => total + Math.hypot(
      (motion.rounding!.startX + motion.rounding!.endX) / 2,
      (motion.rounding!.startY + motion.rounding!.endY) / 2
    ), 0);
  return {
    longerMm: Math.max(longest - planLength, projectedMm),
    shorterMm: Math.max(planLength - shortest, projectedMm)
  };
}

function circularSweep(start: Point2, end: Point2, center: Point2, clockwise: boolean) {
  const angle = signedRadialAngle(start, end, center);
  const directed = clockwise ? -angle : angle;
  return directed < 0 ? directed + Math.PI * 2 : directed;
}

function samePoint(first: Point2, second: Point2, toleranceMm: number) {
  return Number.isFinite(first.x) &&
    Number.isFinite(first.y) &&
    Math.hypot(first.x - second.x, first.y - second.y) <= toleranceMm;
}

/**
 * Whether an emitted point is the planned point rounded to the post's quanta, within the plan's
 * endpoint tolerance. Each axis may differ by half its quantum plus the roundoff of that axis's values;
 * what remains on both axes may not exceed the plan's endpoint tolerance. `reference` is the motion's
 * start, whose magnitude an incremental arc centre also carries.
 */
function sameRoundedPoint(
  first: Point2, second: Point2, sourceToleranceMm: number,
  quantumX: number | undefined, quantumY: number | undefined, fallbackToleranceMm: number,
  reference?: Point2
) {
  if (quantumX === undefined || quantumY === undefined) return samePoint(first, second, fallbackToleranceMm);
  if (![first.x, first.y, second.x, second.y, quantumX, quantumY].every(Number.isFinite)) return false;
  const residualX = roundedAxisResidual(first.x, second.x, quantumX, reference?.x ?? 0);
  const residualY = roundedAxisResidual(first.y, second.y, quantumY, reference?.y ?? 0);
  return Math.hypot(residualX, residualY) <= sourceToleranceMm;
}

/** How far one emitted coordinate lies beyond half its quantum and the roundoff of its own axis's values. */
function roundedAxisResidual(emitted: number, planned: number, quantum: number, reference: number) {
  const roundoffMm = cadOutputPointRoundoff(
    Math.max(Math.abs(emitted), Math.abs(planned), quantum, Math.abs(reference))
  );
  return Math.max(0, Math.abs(emitted - planned) - quantum / 2 - roundoffMm);
}

function axisMagnitudes(points: readonly Point2[]): AxisMagnitudes {
  return points.reduce(
    (largest, point) => ({ x: Math.max(largest.x, Math.abs(point.x)), y: Math.max(largest.y, Math.abs(point.y)) }),
    { x: 0, y: 0 }
  );
}

/**
 * Each axis's share of the radial distance `circularRadialDistance` forms for `point` against the circle
 * through `start` about `center`: that axis's offsets of the point and the start from the centre, over
 * the sum of their radii. Each axis's roundoff moves the distance by at most its share times that
 * roundoff, and the shares sum to at least 1.
 */
function radialAxisShares(point: Point2, start: Point2, center: Point2): AxisMagnitudes {
  const pointX = Math.abs(point.x - center.x);
  const pointY = Math.abs(point.y - center.y);
  const startX = Math.abs(start.x - center.x);
  const startY = Math.abs(start.y - center.y);
  const radii = Math.hypot(pointX, pointY) + Math.hypot(startX, startY);
  return { x: (pointX + startX) / radii, y: (pointY + startY) / radii };
}

function distance(first: Point2, second: Point2) {
  return Math.hypot(first.x - second.x, first.y - second.y);
}
