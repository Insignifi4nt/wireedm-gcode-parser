import { describe, expect, it } from 'vitest';

import { auditControllerProgram, type ControllerProgram } from '../controllerProgram';
import { CANONICAL_POST_PLAN_FIXTURES } from '../custom-runtime/canonicalPostConformanceFixtures';

/**
 * Audits one linear move from the origin to `plannedX` that a three-decimal post emitted as
 * `emittedX`, under a plan endpoint tolerance of zero (as DXF imports plan), so only half the
 * 0.001 mm quantum and the rounding guard separate them.
 */
function auditThreeDecimalMove(plannedX: number, emittedX: number) {
  const base = CANONICAL_POST_PLAN_FIXTURES['core.single-closed-contour.v1'];
  const source = base.events.find(event => event.kind === 'motion');
  if (!source || source.kind !== 'motion') throw new Error('Canonical contour must contain a motion event.');
  const event = { ...source, motion: 'linear' as const, start: { x: 0, y: 0 }, end: { x: plannedX, y: 0 } };
  const text = `G1 X${emittedX} Y0`;
  const program: ControllerProgram = {
    text,
    lines: [text],
    blocks: [{
      id: 'block-000001', lineIndex: 0, text, eventId: event.id, commandIds: ['motion.linear'],
      motion: {
        motion: 'linear', role: event.role, start: { x: 0, y: 0 }, end: { x: emittedX, y: 0 },
        rounding: { startX: 0.001, startY: 0.001, endX: 0.001, endY: 0.001, centerX: 0, centerY: 0 }
      }
    }],
    eventDispositions: [{ kind: 'emitted', eventId: event.id, blockIds: ['block-000001'] }]
  };
  return auditControllerProgram(
    { ...base, events: [event], tolerance: { endpointMm: 0, coincidenceMm: 0 } },
    program,
    new Set(['motion.linear']),
    0.001
  );
}

describe('output rounding guard', () => {
  it('accepts 2.002 for a planned 2.0025, whose binary values sit 0.75 epsilon beyond half a quantum apart', () => {
    // `(2.0025).toFixed(3)` is '2.002', so a correct post emits exactly this.
    expect(auditThreeDecimalMove(2.0025, 2.002)).toEqual([]);
  });

  it('rejects 0.5 for a planned 0.5005000000000007, rounded the wrong way by 3.25 epsilon beyond half a quantum', () => {
    expect(auditThreeDecimalMove(0.5005000000000007, 0.5)).toEqual([
      expect.objectContaining({ code: 'POST_AUDIT_MOTION_MISMATCH' })
    ]);
  });
});
