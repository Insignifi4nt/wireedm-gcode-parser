import { describe, expect, it } from 'vitest';

import type { Point2 } from '@/domain/path-intel/types';

import { auditControllerProgram, type ControllerProgram } from '../controllerProgram';
import { CANONICAL_POST_PLAN_FIXTURES } from '../custom-runtime/canonicalPostConformanceFixtures';

describe('controller linear motion audit', () => {
  it('audits ten thousand indexed motion events within a bounded host pass', () => {
    const base = CANONICAL_POST_PLAN_FIXTURES['core.single-closed-contour.v1'];
    const source = base.events.find((event) => event.kind === 'motion');
    if (!source || source.kind !== 'motion') throw new Error('Expected motion fixture');
    const events = Array.from({ length: 10_000 }, (_, index) => ({ ...source,
      id: `motion-${index}`, ordinal: index + 1, motion: 'linear' as const,
      start: { x: 0, y: 0 }, end: { x: 1, y: 0 } }));
    const blocks = events.map((event, index) => ({
      id: `block-${String(index + 1).padStart(6, '0')}`, lineIndex: index,
      text: 'G1 X1 Y0', eventId: event.id, commandIds: ['motion.linear'],
      motion: { motion: 'linear' as const, role: event.role, start: event.start, end: event.end }
    }));
    const program: ControllerProgram = { text: blocks.map(({ text }) => text).join('\n'),
      lines: blocks.map(({ text }) => text), blocks,
      eventDispositions: blocks.map((block) => ({ kind: 'emitted' as const,
        eventId: block.eventId, blockIds: [block.id] })) };
    const started = performance.now();
    expect(auditControllerProgram({ ...base, events }, program, new Set(['motion.linear']))).toEqual([]);
    expect(performance.now() - started).toBeLessThan(3000);
  });
  it.each([
    {
      name: 'a perpendicular deviation larger than the positional tolerance',
      points: [{ x: 0, y: 0 }, { x: 50, y: 0.1 }, { x: 100, y: 0 }]
    },
    {
      name: 'a short reversal hidden by the path-length tolerance',
      points: [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 49.9996, y: 0 }, { x: 100, y: 0 }]
    },
    {
      name: 'an overshoot followed by a return to the intended endpoint',
      points: [{ x: 0, y: 0 }, { x: 100.0004, y: 0 }, { x: 100, y: 0 }]
    }
  ])('rejects $name', ({ points }) => {
    expect(auditLinearPath(points)).toEqual([
      expect.objectContaining({ code: 'POST_AUDIT_MOTION_MISMATCH' })
    ]);
  });

  it('accepts ordered split moves within the positional tolerance', () => {
    expect(auditLinearPath([
      { x: 0, y: 0 },
      { x: 25, y: 0 },
      { x: 50, y: 0.0005 },
      { x: 100, y: 0 }
    ])).toEqual([]);
  });
});

describe('controller circular motion audit', () => {
  it.each([0.0005, 2 * Math.PI - 0.0005, -0.0005, -2 * Math.PI + 0.0005])(
    'keeps a non-full arc non-full when its endpoints are within tolerance, angle %s',
    (angle) => {
      const base = CANONICAL_POST_PLAN_FIXTURES['core.single-closed-contour.v1'];
      const source = base.events.find((event) => event.kind === 'motion');
      if (!source) throw new Error('Canonical contour must contain a motion event.');
      const event = {
        ...source,
        motion: 'circular' as const,
        start: { x: 1, y: 0 },
        end: { x: Math.cos(angle), y: Math.sin(angle) },
        center: { x: 0, y: 0 },
        clockwise: angle < 0,
        fullCircle: false
      };
      const text = `G${event.clockwise ? '2' : '3'} X${event.end.x} Y${event.end.y} I0 J0`;
      const program: ControllerProgram = {
        text,
        lines: [text],
        blocks: [{
          id: 'block-000001', lineIndex: 0, text, eventId: event.id,
          commandIds: ['arc'],
          motion: {
            motion: 'circular', role: event.role, start: event.start, end: event.end,
            center: event.center, clockwise: event.clockwise, fullCircle: false
          }
        }],
        eventDispositions: [{ kind: 'emitted', eventId: event.id, blockIds: ['block-000001'] }]
      };

      expect(auditControllerProgram(
        { ...base, events: [event], tolerance: { endpointMm: 0.001, coincidenceMm: 0.001 } },
        program,
        new Set(['arc'])
      )).toEqual([]);
    }
  );
});

function auditLinearPath(points: readonly Point2[]) {
  const base = CANONICAL_POST_PLAN_FIXTURES['core.single-closed-contour.v1'];
  const motion = base.events.find((event) => event.kind === 'motion');
  if (!motion) throw new Error('Canonical contour must contain a motion event.');
  const event = { ...motion, start: { x: 0, y: 0 }, end: { x: 100, y: 0 } };
  const blocks = points.slice(1).map((end, index) => ({
    id: `block-${String(index + 1).padStart(6, '0')}`,
    lineIndex: index,
    text: `G1 X${end.x} Y${end.y}`,
    eventId: event.id,
    commandIds: ['motion.linear'],
    motion: { motion: 'linear' as const, role: event.role, start: points[index], end }
  }));
  const lines = blocks.map(({ text }) => text);
  const program: ControllerProgram = {
    text: lines.join('\n'),
    lines,
    blocks,
    eventDispositions: [{ kind: 'emitted', eventId: event.id, blockIds: blocks.map(({ id }) => id) }]
  };
  return auditControllerProgram(
    { ...base, events: [event], tolerance: { endpointMm: 0.001, coincidenceMm: 0.001 } },
    program,
    new Set(['motion.linear'])
  );
}
