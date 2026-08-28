import type {
  ExecutionMotionRole,
  WireEdmExecutionEvent,
  WireEdmExecutionPlan
} from '@/domain/execution-plan/executionPlan';
import type { Point2 } from '@/domain/path-intel/types';

export interface ControllerMotionTrace {
  readonly motion: 'linear' | 'circular';
  readonly role: ExecutionMotionRole | 'position';
  readonly start: Point2;
  readonly end: Point2;
  readonly center?: Point2;
  readonly clockwise?: boolean;
  readonly fullCircle?: boolean;
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
  registeredCommandIds: ReadonlySet<string>
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
  for (const [index, block] of program.blocks.entries()) {
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
    const motions = program.blocks
      .filter(({ eventId, motion }) => eventId === event.id && motion !== null)
      .map(({ motion }) => motion)
      .filter((motion) => motion !== null);
    if (motions.length === 0) {
      diagnostics.push({
        code: 'POST_AUDIT_MOTION_MISSING',
        message: `Motion event ${event.id} must own at least one structured motion block.`,
        eventId: event.id
      });
      continue;
    }
    if (!sameMotionSequence(event, motions, plan.tolerance.endpointMm)) {
      diagnostics.push({
        code: 'POST_AUDIT_MOTION_MISMATCH',
        message: `Controller motion blocks do not preserve motion event ${event.id}.`,
        eventId: event.id
      });
    }
  }
  return diagnostics;
}

function sameMotionSequence(
  event: Extract<WireEdmExecutionEvent, { kind: 'motion' | 'position' }>,
  motions: readonly ControllerMotionTrace[],
  toleranceMm: number
) {
  const expectedStart = event.kind === 'position' ? event.from : event.start;
  const expectedEnd = event.kind === 'position' ? event.to : event.end;
  if (
    !samePoint(motions[0].start, expectedStart, toleranceMm) ||
    !samePoint(motions.at(-1)!.end, expectedEnd, toleranceMm) ||
    motions.some((motion, index) => (
      index > 0 && !samePoint(motions[index - 1].end, motion.start, toleranceMm)
    ))
  ) return false;
  if (event.kind === 'position') {
    return sameLinearPath(motions, 'position', expectedStart, expectedEnd, toleranceMm);
  }
  if (event.motion === 'linear') {
    return sameLinearPath(motions, event.role, expectedStart, expectedEnd, toleranceMm);
  }
  if (!event.center || event.clockwise === undefined) return false;
  const radius = distance(event.center, event.start);
  if (!Number.isFinite(radius) || radius <= 0) return false;
  if (motions.some((motion) => (
    motion.motion !== 'circular' ||
    motion.role !== event.role ||
    !motion.center ||
    !samePoint(motion.center, event.center!, toleranceMm) ||
    motion.clockwise !== event.clockwise ||
    Math.abs(distance(event.center!, motion.start) - radius) > toleranceMm ||
    Math.abs(distance(event.center!, motion.end) - radius) > toleranceMm ||
    motion.fullCircle !== samePoint(motion.start, motion.end, toleranceMm)
  ))) return false;
  const expectedSweep = event.fullCircle
    ? Math.PI * 2
    : circularSweep(event.start, event.end, event.center, event.clockwise);
  const emittedSweep = motions.reduce((total, motion) => total + (
    motion.fullCircle
      ? Math.PI * 2
      : circularSweep(motion.start, motion.end, motion.center!, motion.clockwise!)
  ), 0);
  return radius * Math.abs(expectedSweep - emittedSweep) <= toleranceMm;
}

function sameLinearPath(
  motions: readonly ControllerMotionTrace[],
  role: ControllerMotionTrace['role'],
  start: Point2,
  end: Point2,
  toleranceMm: number
) {
  if (motions.some((motion) => motion.motion !== 'linear' || motion.role !== role)) return false;
  const expectedLength = distance(start, end);
  const emittedLength = motions.reduce((total, motion) => total + distance(motion.start, motion.end), 0);
  return Math.abs(expectedLength - emittedLength) <= toleranceMm;
}

function circularSweep(start: Point2, end: Point2, center: Point2, clockwise: boolean) {
  const startAngle = Math.atan2(start.y - center.y, start.x - center.x);
  const endAngle = Math.atan2(end.y - center.y, end.x - center.x);
  return clockwise
    ? positiveAngle(startAngle - endAngle)
    : positiveAngle(endAngle - startAngle);
}

function positiveAngle(value: number) {
  const fullTurn = Math.PI * 2;
  return ((value % fullTurn) + fullTurn) % fullTurn;
}

function samePoint(first: Point2, second: Point2, toleranceMm: number) {
  return Number.isFinite(first.x) &&
    Number.isFinite(first.y) &&
    Math.hypot(first.x - second.x, first.y - second.y) <= toleranceMm;
}

function distance(first: Point2, second: Point2) {
  return Math.hypot(first.x - second.x, first.y - second.y);
}
