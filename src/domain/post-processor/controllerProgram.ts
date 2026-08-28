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
    const blocks = program.blocks.filter(({ eventId }) => eventId === event.id);
    if (blocks.length !== 1 || !blocks[0].motion) {
      diagnostics.push({
        code: 'POST_AUDIT_MOTION_MISSING',
        message: `Motion event ${event.id} must own exactly one structured motion block.`,
        eventId: event.id
      });
      continue;
    }
    if (!sameMotion(event, blocks[0].motion, plan.tolerance.endpointMm)) {
      diagnostics.push({
        code: 'POST_AUDIT_MOTION_MISMATCH',
        message: `Controller block ${blocks[0].id} does not preserve motion event ${event.id}.`,
        eventId: event.id
      });
    }
  }
  return diagnostics;
}

function sameMotion(
  event: Extract<WireEdmExecutionEvent, { kind: 'motion' | 'position' }>,
  motion: ControllerMotionTrace,
  toleranceMm: number
) {
  if (event.kind === 'position') {
    return motion.motion === 'linear' &&
      motion.role === 'position' &&
      samePoint(motion.start, event.from, toleranceMm) &&
      samePoint(motion.end, event.to, toleranceMm);
  }
  return motion.motion === event.motion &&
    motion.role === event.role &&
    samePoint(motion.start, event.start, toleranceMm) &&
    samePoint(motion.end, event.end, toleranceMm) &&
    sameOptionalPoint(motion.center, event.center, toleranceMm) &&
    motion.clockwise === event.clockwise &&
    motion.fullCircle === event.fullCircle;
}

function sameOptionalPoint(
  first: Point2 | undefined,
  second: Point2 | undefined,
  toleranceMm: number
) {
  return first === undefined && second === undefined ||
    first !== undefined && second !== undefined && samePoint(first, second, toleranceMm);
}

function samePoint(first: Point2, second: Point2, toleranceMm: number) {
  return Number.isFinite(first.x) &&
    Number.isFinite(first.y) &&
    Math.hypot(first.x - second.x, first.y - second.y) <= toleranceMm;
}
