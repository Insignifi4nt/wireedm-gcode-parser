import { describe, expect, it } from 'vitest';

import type { Point2 } from '@/domain/path-intel/types';

import { auditControllerProgram, type ControllerProgram } from '../controllerProgram';
import { CANONICAL_POST_PLAN_FIXTURES } from '../custom-runtime/canonicalPostConformanceFixtures';

/**
 * Audits one planned straight move from `plannedStart` to `plannedEnd` that a post emitted through `emitted`, with the
 * given coordinate quantum on every axis, under a plan endpoint tolerance of zero (as DXF imports plan). Only half the
 * quantum and the floating-point roundoff then separate a correctly rounded coordinate from the plan.
 */
function auditRoundedMove(
  plannedEnd: Point2, emitted: readonly Point2[], quantum: number, plannedStart: Point2 = { x: 0, y: 0 }
) {
  const event = { ...canonicalMotion(), motion: 'linear' as const, start: plannedStart, end: plannedEnd };
  const rounding = { startX: quantum, startY: quantum, endX: quantum, endY: quantum, centerX: quantum, centerY: quantum };
  const points = [plannedStart, ...emitted];
  return auditMotions(event, 'motion.linear', emitted.map((end, index) => ({
    motion: 'linear' as const, role: event.role, start: points[index], end, rounding
  })));
}

/**
 * Audits one planned counterclockwise full circle about `center` from `plannedStart` that a post emitted as two halves
 * meeting at `split`, with a zero quantum on every axis, so only the floating-point roundoff separates the split point
 * from the circle.
 */
function auditSplitCircle(center: Point2, plannedStart: Point2, split: Point2) {
  const event = {
    ...canonicalMotion(), motion: 'circular' as const, start: plannedStart, end: plannedStart, center,
    clockwise: false, fullCircle: true
  };
  const rounding = { startX: 0, startY: 0, endX: 0, endY: 0, centerX: 0, centerY: 0 };
  const halves = [[plannedStart, split], [split, plannedStart]] as const;
  return auditMotions(event, 'motion.arc-counterclockwise', halves.map(([start, end]) => ({
    motion: 'circular' as const, role: event.role, start, end, center, clockwise: false, fullCircle: false, rounding
  })));
}

/**
 * Audits one planned counterclockwise full circle about the origin from (1000, 0), emitted as a single block whose arc
 * centre is `center`, with a zero quantum on every axis. Only the centre comparison reads the emitted centre.
 */
function auditCircleCenter(center: Point2, centerReference?: 'absolute' | 'incremental') {
  const plannedStart = { x: 1000, y: 0 };
  const event = {
    ...canonicalMotion(), motion: 'circular' as const, start: plannedStart, end: plannedStart, center: { x: 0, y: 0 },
    clockwise: false, fullCircle: true
  };
  const rounding = { startX: 0, startY: 0, endX: 0, endY: 0, centerX: 0, centerY: 0 };
  return auditMotions(event, 'motion.arc-counterclockwise', [{
    motion: 'circular' as const, role: event.role, start: plannedStart, end: plannedStart, center,
    ...(centerReference ? { centerReference } : {}), clockwise: false, fullCircle: true, rounding
  }]);
}

function canonicalMotion() {
  const source = CANONICAL_POST_PLAN_FIXTURES['core.single-closed-contour.v1'].events.find(event => event.kind === 'motion');
  if (!source || source.kind !== 'motion') throw new Error('Canonical contour must contain a motion event.');
  return source;
}

function auditMotions(
  event: ReturnType<typeof canonicalMotion>,
  command: string,
  motions: readonly NonNullable<ControllerProgram['blocks'][number]['motion']>[]
) {
  const base = CANONICAL_POST_PLAN_FIXTURES['core.single-closed-contour.v1'];
  const blocks = motions.map((motion, index) => ({
    id: `block-${String(index + 1).padStart(6, '0')}`, lineIndex: index, text: `X${motion.end.x} Y${motion.end.y}`,
    eventId: event.id, commandIds: [command], motion
  }));
  const lines = blocks.map(({ text }) => text);
  const program: ControllerProgram = {
    text: lines.join('\n'), lines, blocks,
    eventDispositions: [{ kind: 'emitted', eventId: event.id, blockIds: blocks.map(({ id }) => id) }]
  };
  return auditControllerProgram(
    { ...base, events: [event], tolerance: { endpointMm: 0, coincidenceMm: 0 } },
    program,
    new Set([command])
  );
}

const ACCEPTED: unknown[] = [];
const REJECTED = [expect.objectContaining({ code: 'POST_AUDIT_MOTION_MISMATCH' })];

// Binary quanta and coordinates make every difference the audit forms exact, so each case sits a known
// number of ulps from its threshold.
const QUANTUM = 2 ** -10;

describe('outputPointRoundoffUlps', () => {
  // A point comparison allows each axis 4 ulps of the largest coordinate it reads on that axis. At 1000 mm that is
  // 4 * 1000 * 2^-52 = 7.8125 * 2^-43 on X.
  const ulp1000 = 2 ** -43;

  it.each([
    { name: 'inside', ulps: 7, expected: ACCEPTED },
    { name: 'outside', ulps: 8, expected: REJECTED }
  ])('$name: an endpoint $ulps ulps of 1000 mm beyond half a quantum', ({ ulps, expected }) => {
    expect(auditRoundedMove({ x: 1000, y: 0 }, [{ x: 1000 + QUANTUM / 2 + ulps * ulp1000, y: 0 }], QUANTUM)).toEqual(expected);
  });

  // Below 1 mm an axis counts as 1 mm, so X at 0.5 mm allows 4 ulps of 1 mm, which are 8 ulps of 0.5 mm, rather than
  // 4 ulps of the coordinate itself.
  const ulpHalf = 2 ** -53;
  it.each([
    { name: 'inside', ulps: 8, expected: ACCEPTED },
    { name: 'outside', ulps: 9, expected: REJECTED }
  ])('$name: an endpoint at 0.5 mm $ulps ulps of 0.5 mm beyond half a quantum, through the 1 mm floor', ({ ulps, expected }) => {
    expect(auditRoundedMove({ x: 0.5, y: 0 }, [{ x: 0.5 + QUANTUM / 2 + ulps * ulpHalf, y: 0 }], QUANTUM))
      .toEqual(expected);
  });

  // X's allowance at 1000 mm, 7.8 ulps of 1000 mm, would excuse this Y error if the axes shared their allowances.
  // Y reads only coordinates below 1 mm, so it allows 4 ulps of 1 mm.
  it.each([
    { name: 'inside', ulps: 4, expected: ACCEPTED },
    { name: 'outside', ulps: 5, expected: REJECTED }
  ])('$name: an endpoint whose Y is $ulps ulps of 1 mm beyond half a quantum while X is at 1000 mm', ({ ulps, expected }) => {
    expect(auditRoundedMove(
      { x: 1000, y: 0 }, [{ x: 1000, y: QUANTUM / 2 + ulps * Number.EPSILON }], QUANTUM, { x: 999, y: 0 }
    )).toEqual(expected);
  });

  // The runtime forms an incremental centre as the motion's start plus the emitted offset, so the sum carries the
  // start's roundoff: a centre at the origin of a circle starting at (1000, 0) may lie 7.8125 * 2^-43 off on X.
  it.each([
    { name: 'inside', ulps: 7, expected: ACCEPTED },
    { name: 'outside', ulps: 8, expected: REJECTED }
  ])('$name: an incremental arc centre $ulps ulps of 1000 mm off, from a start at 1000 mm', ({ ulps, expected }) => {
    expect(auditCircleCenter({ x: ulps * ulp1000, y: 0 }, 'incremental')).toEqual(expected);
  });

  // An absolute centre is the emitted value itself, so the start's magnitude does not widen it: the same centre below
  // 1 mm allows 4 ulps of 1 mm on X, and the 7 ulps of 1000 mm an incremental centre may carry fail.
  it.each([
    { name: 'inside', off: '4 ulps of 1 mm', offset: 4 * Number.EPSILON, expected: ACCEPTED },
    { name: 'outside', off: '5 ulps of 1 mm', offset: 5 * Number.EPSILON, expected: REJECTED },
    { name: 'outside', off: '7 ulps of 1000 mm', offset: 7 * ulp1000, expected: REJECTED }
  ])('$name: an absolute arc centre $off off, from a start at 1000 mm', ({ offset, expected }) => {
    expect(auditCircleCenter({ x: offset, y: 0 }, 'absolute')).toEqual(expected);
  });

  it('holds a trace without a centre reference to its own magnitude, as an absolute centre', () => {
    expect(auditCircleCenter({ x: 4 * Number.EPSILON, y: 0 })).toEqual(ACCEPTED);
    expect(auditCircleCenter({ x: 5 * Number.EPSILON, y: 0 })).toEqual(REJECTED);
  });

  it('accepts 2.002 for a planned 2.0025, whose binary values sit 0.75 epsilon beyond half a quantum apart', () => {
    // `(2.0025).toFixed(3)` is '2.002', so a correct post emits exactly this.
    expect(auditRoundedMove({ x: 2.0025, y: 0 }, [{ x: 2.002, y: 0 }], 0.001)).toEqual(ACCEPTED);
  });
});

describe('outputDerivedRoundoffUlps', () => {
  // The distance from a planned line allows each axis 32 ulps of its largest coordinate, weighted by how far that axis
  // reaches across the line. Across a line along X at Y = 1000 that is 32 * 1000 * 2^-52 = 62.5 * 2^-43 of Y.
  const ulp1000 = 2 ** -43;
  it.each([
    { name: 'inside', ulps: 62, expected: ACCEPTED },
    { name: 'outside', ulps: 63, expected: REJECTED }
  ])('$name: a split point $ulps ulps of 1000 mm off the planned line beyond half a quantum', ({ ulps, expected }) => {
    const split = { x: 500, y: 1000 + QUANTUM / 2 + ulps * ulp1000 };
    expect(auditRoundedMove({ x: 1000, y: 1000 }, [split, { x: 1000, y: 1000 }], QUANTUM, { x: 0, y: 1000 }))
      .toEqual(expected);
  });

  // Across a line along X at Y = 0 only Y's roundoff counts: 32 ulps of 1 mm, however far X reaches.
  it.each([
    { name: 'inside', ulps: 32, expected: ACCEPTED },
    { name: 'outside', ulps: 33, expected: REJECTED }
  ])('$name: a split point $ulps ulps of 1 mm off a line at X = 1000 mm beyond half a quantum', ({ ulps, expected }) => {
    const split = { x: 999.5, y: QUANTUM / 2 + ulps * Number.EPSILON };
    expect(auditRoundedMove({ x: 1000, y: 0 }, [split, { x: 1000, y: 0 }], QUANTUM, { x: 999, y: 0 })).toEqual(expected);
  });

  // A radial distance weights each axis's roundoff by that axis's share of the distance. The split point and the start
  // lie straight above and below the centre at X = 1000, so X has no share and the split point may leave the circle by
  // 32 ulps of 1 mm, not 32 ulps of 1000 mm. The computed distance carries about an ulp of 1 mm of its own, so the pair
  // sits 8 ulps either side.
  it.each([
    { name: 'inside', ulps: 24, expected: ACCEPTED },
    { name: 'outside', ulps: 40, expected: REJECTED }
  ])('$name: a full-circle split point $ulps ulps of 1 mm off the circle at X = 1000 mm', ({ ulps, expected }) => {
    expect(auditSplitCircle({ x: 1000, y: 0 }, { x: 1000, y: -1 }, { x: 1000, y: 1 + ulps * Number.EPSILON }))
      .toEqual(expected);
  });
});

describe('radial rounding term, a recorded known limit', () => {
  // A point that splits an arc is checked only by its distance from the arc, whose rounding term is half the diagonal
  // of the point's rounding box, as before 0.0.792, in addition to the endpoint tolerance and the radial roundoff. With
  // X written to 0 decimals and Y to 12, X's half unit covers Y: at endpoint tolerance 0, a split point of a radius 10
  // circle may be almost 0.5 mm off on Y. Holding this term per axis would reject output accepted before, so it is
  // left for a separate audit compatibility release; this test then changes.
  function auditSplitPoint(split: Point2) {
    const start = { x: 0, y: -10 };
    const event = {
      ...canonicalMotion(), motion: 'circular' as const, start, end: start, center: { x: 0, y: 0 },
      clockwise: false, fullCircle: true
    };
    const rounding = { startX: 1, startY: 1e-12, endX: 1, endY: 1e-12, centerX: 1, centerY: 1e-12 };
    return auditMotions(event, 'motion.arc-counterclockwise', [[start, split], [split, start]].map(([from, to]) => ({
      motion: 'circular' as const, role: event.role, start: from, end: to, center: { x: 0, y: 0 },
      centerReference: 'absolute' as const, clockwise: false, fullCircle: false, rounding
    })));
  }

  it('accepts a split point almost half a coarse unit off on the fine axis, and rejects one beyond it', () => {
    expect(auditSplitPoint({ x: 0, y: 10.499999999999 })).toEqual(ACCEPTED);
    expect(auditSplitPoint({ x: 0, y: 10.500000000001 })).toEqual(REJECTED);
  });
});
