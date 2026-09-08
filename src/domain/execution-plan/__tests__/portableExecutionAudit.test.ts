import { describe, expect, it } from 'vitest';
import { createUpidFromDxfEntities } from '@/domain/upid/upidDocument';
import { compileWireEdmExecutionPlan } from '../executionPlan';

describe('execution numeric boundary audit', () => {
  it('keeps large finite geometry deterministic without freezing or aliasing the editable source', () => {
    const document = createUpidFromDxfEntities([
      { type: 'line', layer: null, start: { x: -1e150, y: 0 }, end: { x: 1e150, y: 0 } }
    ]);
    document.setup = { initialWirePosition: { kind: 'manual', point: { x: -1e150, y: 0 }, review: 'reviewed' } };
    const first = compileWireEdmExecutionPlan(document);
    const second = compileWireEdmExecutionPlan(document);
    if (!first.ok || !second.ok) throw new Error('Expected finite geometry to compile.');
    expect(first.plan).toEqual(second.plan);
    const ids = first.plan.events.map(({ id }) => id);
    expect(new Set(ids).size).toBe(ids.length);
    const motion = first.plan.events.find((event) => event.kind === 'motion');
    expect(motion).toMatchObject({ start: { x: -1e150, y: 0 }, end: { x: 1e150, y: 0 } });
    expect(Object.isFrozen(document.segments[0].start)).toBe(false);
    document.segments[0].start.x = 0;
    expect(motion?.start.x).toBe(-1e150);
  });

  it.each(['line', 'arc'] as const)('does not silently drop an accepted tiny %s cut', (kind) => {
    const sweep = 1e-16;
    const start = { x: 1, y: 0 };
    const end = { x: 1, y: sweep };
    const document = createUpidFromDxfEntities([
      kind === 'line' ? { type: 'line', layer: 'CUT', start, end } : {
        type: 'arc', layer: 'CUT', center: { x: 0, y: 0 }, radius: 1,
        start, end, startAngle: 0, endAngle: sweep * 180 / Math.PI,
        sweepRadians: sweep, clockwise: false
      }
    ], { coincidenceEpsilon: 0, endpointTolerance: 0 });
    expect(document.segments).toHaveLength(1);
    document.setup = { initialWirePosition: { kind: 'manual', point: start, review: 'reviewed' } };
    const compiled = compileWireEdmExecutionPlan(document);
    if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));
    const motions = compiled.plan.events.filter((event) => event.kind === 'motion');
    expect(motions).toHaveLength(1);
    expect(motions[0]).toMatchObject({ sourceSegmentId: document.segments[0].id, start, end });
    document.plan.operations[0].programStops = [{
      id: 'halfway', enabled: true, reason: 'operator-check',
      placement: { kind: 'before-operation-end', remainingCutLengthMm: sweep / 2 }
    }];
    const split = compileWireEdmExecutionPlan(document);
    if (!split.ok) throw new Error(JSON.stringify(split.diagnostics));
    const splitMotions = split.plan.events.filter((event) => event.kind === 'motion');
    expect(splitMotions).toHaveLength(2);
    expect(splitMotions[0].sourceRange).toEqual({ start: 0, end: 0.5 });
    expect(splitMotions[1].sourceRange).toEqual({ start: 0.5, end: 1 });
  });
});
