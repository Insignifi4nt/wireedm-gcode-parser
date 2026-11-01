import { describe, expect, it } from 'vitest';

import type { Point2 } from '@/domain/path-intel/types';

import { auditControllerProgram, type ControllerProgram } from '../controllerProgram';
import { CANONICAL_POST_PLAN_FIXTURES } from '../custom-runtime/canonicalPostConformanceFixtures';

/**
 * Audits one planned straight move from the origin to `plannedEnd` that a post emitted through `emitted`, with the given
 * coordinate quantum on every axis, under a plan endpoint tolerance of zero (as DXF imports plan). Only half the quantum and
 * the floating-point roundoff then separate a correctly rounded coordinate from the plan.
 */
function auditRoundedMove(plannedEnd: Point2, emitted: readonly Point2[], quantum: number) {
  const base = CANONICAL_POST_PLAN_FIXTURES['core.single-closed-contour.v1'];
  const source = base.events.find(event => event.kind === 'motion');
  if (!source || source.kind !== 'motion') throw new Error('Canonical contour must contain a motion event.');
  const event = { ...source, motion: 'linear' as const, start: { x: 0, y: 0 }, end: plannedEnd };
  const rounding = { startX: quantum, startY: quantum, endX: quantum, endY: quantum, centerX: quantum, centerY: quantum };
  const points = [{ x: 0, y: 0 }, ...emitted];
  const blocks = emitted.map((end, index) => ({
    id: `block-${String(index + 1).padStart(6, '0')}`, lineIndex: index, text: `G1 X${end.x} Y${end.y}`,
    eventId: event.id, commandIds: ['motion.linear'],
    motion: { motion: 'linear' as const, role: event.role, start: points[index], end, rounding }
  }));
  const lines = blocks.map(({ text }) => text);
  const program: ControllerProgram = {
    text: lines.join('\n'), lines, blocks,
    eventDispositions: [{ kind: 'emitted', eventId: event.id, blockIds: blocks.map(({ id }) => id) }]
  };
  return auditControllerProgram(
    { ...base, events: [event], tolerance: { endpointMm: 0, coincidenceMm: 0 } },
    program,
    new Set(['motion.linear'])
  );
}

const ACCEPTED: unknown[] = [];
const REJECTED = [expect.objectContaining({ code: 'POST_AUDIT_MOTION_MISMATCH' })];

// Binary quanta and coordinates make every difference the audit forms exact, so each case sits a known
// number of ulps from its threshold.
const QUANTUM = 2 ** -10;

describe('outputPointRoundoffUlps', () => {
  // A point comparison allows 4 ulps of the largest coordinate it reads on each axis. At 1000 mm that is
  // 4 * 1000 * 2^-52 = 7.8125 * 2^-43 on X; Y reads only the quantum, so its 1 mm floor adds 4 * 2^-52.
  const ulp1000 = 2 ** -43;

  it.each([
    { name: 'inside', ulps: 7, expected: ACCEPTED },
    { name: 'outside', ulps: 8, expected: REJECTED }
  ])('$name: an endpoint $ulps ulps of 1000 mm beyond half a quantum', ({ ulps, expected }) => {
    expect(auditRoundedMove({ x: 1000, y: 0 }, [{ x: 1000 + QUANTUM / 2 + ulps * ulp1000, y: 0 }], QUANTUM)).toEqual(expected);
  });

  // Below 1 mm both axes count as 1 mm, so the endpoint allows hypot(4, 4) = 5.66 ulps of 1 mm, more than
  // the 2.8 ulps that 4 ulps of the 0.5 mm coordinate itself would give.
  it.each([
    { name: 'inside', ulps: 5, expected: ACCEPTED },
    { name: 'outside', ulps: 6, expected: REJECTED }
  ])('$name: an endpoint at 0.5 mm $ulps ulps of 1 mm beyond half a quantum, through the 1 mm floor', ({ ulps, expected }) => {
    expect(auditRoundedMove({ x: 0.5, y: 0 }, [{ x: 0.5 + QUANTUM / 2 + ulps * Number.EPSILON, y: 0 }], QUANTUM))
      .toEqual(expected);
  });

  it('accepts 2.002 for a planned 2.0025, whose binary values sit 0.75 epsilon beyond half a quantum apart', () => {
    // `(2.0025).toFixed(3)` is '2.002', so a correct post emits exactly this.
    expect(auditRoundedMove({ x: 2.0025, y: 0 }, [{ x: 2.002, y: 0 }], 0.001)).toEqual(ACCEPTED);
  });
});

describe('outputDerivedRoundoffUlps', () => {
  // The distance from a planned line allows 32 ulps of the largest coordinate the move reads, here 1000 mm,
  // above half the quantum across the line.
  it.each([
    { name: 'inside', ulps: 31, expected: ACCEPTED },
    { name: 'outside', ulps: 33, expected: REJECTED }
  ])('$name: a split point $ulps ulps of 1000 mm off the planned line beyond half a quantum', ({ ulps, expected }) => {
    const split = { x: 500, y: QUANTUM / 2 + ulps * Number.EPSILON * 1000 };
    expect(auditRoundedMove({ x: 1000, y: 0 }, [split, { x: 1000, y: 0 }], QUANTUM)).toEqual(expected);
  });
});
