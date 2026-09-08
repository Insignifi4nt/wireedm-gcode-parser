import { describe, expect, it } from 'vitest';

import { setManualCompensationIntent } from '@/domain/compensation/intent';
import { createUpidFromDxfEntities } from '@/domain/upid/upidDocument';
import { setMachiningSpanParticipation } from '@/domain/path-intel/machiningParticipation';
import { programStopValidationError } from '@/domain/path-intel/programStops';
import { reversePathOperation } from '@/domain/path-editor/pathDocumentOperations';

import { compileWireEdmExecutionPlan } from '../executionPlan';

describe('controller-neutral Wire EDM execution plans', () => {
  it('keeps saved controller-side choices dormant when geometry is wire-centre', () => {
    const source = rectangleDocument();
    source.geometryBasis = 'finished-contour';
    const configured = setManualCompensationIntent(source, source.plan.operations[0].id, 'outside');
    if (!configured) throw new Error('Expected closed contour');
    configured.geometryBasis = 'wire-centre';
    const compiled = compileWireEdmExecutionPlan(configured);
    if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));
    expect(compiled.plan.requirements.controllerCompensation).toBe(false);
    expect(compiled.plan.events.some((event) => event.kind === 'compensation-start')).toBe(false);
    expect(configured.plan.operations[0].compensationIntent).toMatchObject({ mode: 'controller', keptMaterial: 'outside' });
  });

  it.each([false, true])('preserves an explicit full-turn arc and its remaining-distance stop, clockwise=%s', (clockwise) => {
    const document = createUpidFromDxfEntities([{
      type: 'arc', layer: 'CUT', center: { x: 0, y: 0 }, radius: 5,
      start: { x: 5, y: 0 }, end: { x: 5, y: 0 }, startAngle: 0,
      endAngle: clockwise ? -360 : 360, sweepRadians: (clockwise ? -1 : 1) * 2 * Math.PI, clockwise
    }]);
    document.setup = { initialWirePosition: { kind: 'manual', point: { x: 5, y: 0 }, review: 'reviewed' } };
    const full = compileWireEdmExecutionPlan(document);
    if (!full.ok) throw new Error(JSON.stringify(full.diagnostics));
    expect(full.plan.events.filter((event) => event.kind === 'motion')).toEqual([
      expect.objectContaining({ motion: 'circular', clockwise, fullCircle: true,
        start: { x: 5, y: 0 }, end: { x: 5, y: 0 } })
    ]);
    document.plan.operations[0].programStops = [{ id: 'halfway', enabled: true, reason: 'operator-check',
      placement: { kind: 'before-operation-end', remainingCutLengthMm: 5 * Math.PI } }];
    const split = compileWireEdmExecutionPlan(document);
    if (!split.ok) throw new Error(JSON.stringify(split.diagnostics));
    const motions = split.plan.events.filter((event) => event.kind === 'motion');
    expect(motions).toHaveLength(2);
    expect(motions.every((motion) => motion.fullCircle === false && motion.clockwise === clockwise)).toBe(true);
    expect(motions[0].end.x).toBeCloseTo(-5, 12);
    expect(motions[0].end.y).toBeCloseTo(0, 12);
    expect(motions[1].end).toEqual({ x: 5, y: 0 });
  });

  it.each([false, true])('traces clipped cuts and stops to saved UPID identities and ranges, reversed=%s', (reversed) => {
    let source = createUpidFromDxfEntities([
      { type: 'line', layer: 'CUT', start: { x: 0, y: 0 }, end: { x: 10, y: 0 } }
    ]);
    source.setup = { initialWirePosition: { kind: 'manual', point: { x: 0, y: 0 }, review: 'reviewed' } };
    if (reversed) {
      source = reversePathOperation(source, source.plan.operations[0].id) ?? source;
    }
    const original = source.plan.operations[0];
    const document = setMachiningSpanParticipation(source, {
      sourceSegmentId: source.segments[0].id,
      range: { start: 0.6, end: 1 }, participation: 'inactive-reference'
    });
    if (!document) throw new Error('Expected partial contour');
    document.plan.operations[0].programStops = [{ id: 'retain', enabled: true, reason: 'part-retention',
      placement: { kind: 'before-operation-end', remainingCutLengthMm: 2 } }];
    const before = structuredClone(document);
    const compiled = compileWireEdmExecutionPlan(document);
    if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));
    expect(compiled.plan.source.operationIds).toEqual([original.id]);
    const motions = compiled.plan.events.filter((event) => event.kind === 'motion')
      .filter((event) => event.role === 'contour');
    const parameters = reversed ? [0.6, 0.2, 0] : [0, 0.4, 0.6];
    expect(motions).toHaveLength(2);
    motions.forEach((motion, index) => {
      expect(motion.sourceSegmentId).toBe(source.segments[0].id);
      expect(motion.sourceRange?.start).toBeCloseTo(parameters[index], 12);
      expect(motion.sourceRange?.end).toBeCloseTo(parameters[index + 1], 12);
      expect(motion.trace).toEqual([{ kind: 'segment', operationId: original.id,
        segmentId: source.segments[0].id, sourceRange: motion.sourceRange }]);
    });
    for (const event of compiled.plan.events) {
      for (const trace of event.trace) {
        if (trace.kind !== 'program') expect(trace.operationId).toBe(original.id);
      }
    }
    expect(document).toEqual(before);
  });

  it.each(['entry', 'exit'] as const)('blocks stored coincident %s leads and accepts an explicit no-lead correction', (role) => {
    const document = rectangleDocument();
    const operation = document.plan.operations[0];
    const anchor = role === 'entry' ? operation.startPoint : operation.endPoint;
    const offset = document.options.coincidenceEpsilon * 0.9;
    operation.transitions = {
      [role]: { strategy: 'manual-straight', move: 'cut', from: anchor,
        to: { x: anchor.x + offset, y: anchor.y + offset }, review: 'reviewed' }
    };
    const before = structuredClone(document);
    expect(compileWireEdmExecutionPlan(document)).toMatchObject({
      ok: false, diagnostics: [expect.objectContaining({
        code: 'EXECUTION_PLAN_DEGENERATE_TRANSITION', operationId: operation.id
      })]
    });
    expect(document).toEqual(before);
    operation.transitions = { [role]: { strategy: 'none', review: 'reviewed' } };
    const result = compileWireEdmExecutionPlan(document);
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    expect(result.plan.events.filter((event) => event.kind === 'motion').map((event) => event.role))
      .toEqual(['contour', 'contour', 'contour', 'contour']);
  });

  it('uses only active cutting length when validating and executing a remaining-distance stop', () => {
    const source = createUpidFromDxfEntities([
      { type: 'line', layer: 'CUT', start: { x: 0, y: 0 }, end: { x: 10, y: 0 } }
    ]);
    source.setup = { initialWirePosition: { kind: 'manual', point: { x: 0, y: 0 }, review: 'reviewed' } };
    const configured = setManualCompensationIntent(source, source.plan.operations[0].id, 'centerline');
    if (!configured) throw new Error('Expected centerline intent');
    const document = setMachiningSpanParticipation(configured, {
      sourceSegmentId: source.segments[0].id,
      range: { start: 0.6, end: 1 },
      participation: 'inactive-reference'
    });
    if (!document) throw new Error('Expected partial contour');
    const operation = document.plan.operations[0];
    operation.programStops = [{ id: 'retain', enabled: true, reason: 'part-retention',
      placement: { kind: 'before-operation-end', remainingCutLengthMm: 2 } }];
    expect(programStopValidationError(document, operation, operation.programStops[0], operation.programStops)).toBeNull();
    const result = compileWireEdmExecutionPlan(document);
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    expect(result.plan.events.filter((event) => event.kind === 'program-stop')).toEqual([
      expect.objectContaining({ stopId: 'retain', point: { x: 4, y: 0 } })
    ]);
    expect(result.plan.events.filter((event) => event.kind === 'motion').at(-1)?.end).toEqual({ x: 6, y: 0 });
    expect(document.segments).toEqual(source.segments);
    operation.programStops[0].placement = { kind: 'before-operation-end', remainingCutLengthMm: 7 };
    expect(programStopValidationError(document, operation, operation.programStops[0], operation.programStops))
      .toContain('less than the contour length (6.000 mm)');
    expect(compileWireEdmExecutionPlan(document)).toMatchObject({ ok: false,
      diagnostics: [expect.objectContaining({ code: 'EXECUTION_PLAN_PROGRAM_STOP_INVALID' })] });
  });

  it.each([false, true])('preserves circular travel and source ranges across multiple stops, reversed=%s', (reversed) => {
    const document = createUpidFromDxfEntities([
      { type: 'circle', layer: 'CUT', center: { x: 0, y: 0 }, radius: 5 }
    ]);
    document.setup = { initialWirePosition: { kind: 'manual', point: { x: 5, y: 0 }, review: 'reviewed' } };
    const operation = document.plan.operations[0];
    operation.segmentRefs[0].reversed = reversed;
    const baseline = compileWireEdmExecutionPlan(document);
    if (!baseline.ok) throw new Error(JSON.stringify(baseline.diagnostics));
    const circle = baseline.plan.events.find((event) => event.kind === 'motion' && event.role === 'contour');
    if (!circle || circle.kind !== 'motion') throw new Error('Expected circular contour');
    const circumference = 10 * Math.PI;
    operation.programStops = [
      { id: 'half', enabled: true, reason: 'operator-check', placement: { kind: 'before-operation-end', remainingCutLengthMm: circumference / 2 } },
      { id: 'disabled', enabled: false, reason: 'manual', placement: { kind: 'before-operation-end', remainingCutLengthMm: circumference / 4 } },
      { id: 'quarter', enabled: true, reason: 'part-retention', placement: { kind: 'before-operation-end', remainingCutLengthMm: circumference * 3 / 4 } }
    ];
    const result = compileWireEdmExecutionPlan(document);
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    const stops = result.plan.events.filter((event) => event.kind === 'program-stop');
    expect(stops.map((stop) => stop.stopId)).toEqual(['quarter', 'half']);
    const sign = circle.clockwise ? -1 : 1;
    expect(stops[0].point.x).toBeCloseTo(-sign * circle.start.y, 10);
    expect(stops[0].point.y).toBeCloseTo(sign * circle.start.x, 10);
    expect(stops[1].point.x).toBeCloseTo(-circle.start.x, 10);
    expect(stops[1].point.y).toBeCloseTo(-circle.start.y, 10);
    const motions = result.plan.events.filter((event) => event.kind === 'motion').filter((event) => event.role === 'contour');
    expect(motions).toHaveLength(3);
    const parameters = reversed ? [1, 0.75, 0.5, 0] : [0, 0.25, 0.5, 1];
    motions.forEach((motion, index) => {
      expect(motion.fullCircle).toBe(false);
      expect(motion.clockwise).toBe(circle.clockwise);
      expect(motion.sourceRange?.start).toBeCloseTo(parameters[index], 12);
      expect(motion.sourceRange?.end).toBeCloseTo(parameters[index + 1], 12);
      expect(motion.end).toEqual(index < stops.length ? stops[index].point : circle.end);
      expect(motion.start).toEqual(index === 0 ? circle.start : stops[index - 1].point);
    });
  });

  it('compiles reviewed geometry and compensation intent without controller vocabulary', () => {
    const source = rectangleDocument();
    source.geometryBasis = 'finished-contour';
    const operation = source.plan.operations[0];
    const document = setManualCompensationIntent(source, operation.id, 'outside');
    if (!document) throw new Error('Expected a closed contour fixture.');

    const result = compileWireEdmExecutionPlan(document);
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));

    expect(result.plan.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'program-start', initialWirePosition: { x: -2, y: 0 } }),
      expect.objectContaining({ kind: 'compensation-start', wireSide: 'left' }),
      expect.objectContaining({ kind: 'motion', role: 'contour', sourceSegmentId: expect.any(String) }),
      expect.objectContaining({ kind: 'compensation-end' })
    ]));
    expect(result.plan.requirements).toMatchObject({
      controllerCompensation: true,
      operationCount: 1,
      programStops: false,
      threading: []
    });
    expect(JSON.stringify(result.plan)).not.toMatch(/\b[GMT]\d+/);
  });

  it('requires a reviewed initial wire position instead of assuming an origin', () => {
    const document = createUpidFromDxfEntities(rectangle());

    expect(compileWireEdmExecutionPlan(document)).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'EXECUTION_PLAN_INITIAL_WIRE_REQUIRED', operationId: null }]
    });
  });

  it('requires explicit threading intent between operations', () => {
    const document = createUpidFromDxfEntities([
      ...rectangle(0, 0, 10, 10),
      ...rectangle(20, 0, 30, 10)
    ]);
    document.setup = {
      initialWirePosition: {
        kind: 'manual', point: { x: -2, y: 0 }, review: 'reviewed'
      }
    };

    expect(compileWireEdmExecutionPlan(document)).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'EXECUTION_PLAN_THREADING_REQUIRED' }]
    });

    document.setup.threadingDefault = {
      mode: 'manual',
      wireSeparation: 'manual-before-positioning'
    };
    const compiled = compileWireEdmExecutionPlan(document);
    if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));
    const destinationId = document.plan.operations[1].id;
    const lifecycle = compiled.plan.events.filter((event) => event.operationId === destinationId &&
      (event.kind === 'wire-separate' || event.kind === 'position' || event.kind === 'wire-thread'));
    expect(lifecycle).toEqual([
      expect.objectContaining({
        kind: 'wire-separate',
        method: 'manual'
      }),
      expect.objectContaining({ kind: 'position', from: { x: 0, y: 0 }, to: { x: 20, y: 0 } }),
      expect.objectContaining({ kind: 'wire-thread', method: 'manual' })
    ]);
    expect(compiled.plan.requirements).toMatchObject({
      threading: ['manual'],
      wireSeparation: true
    });
    document.plan.operations[1].threadingTransition = {
      mode: 'automatic', wireSeparation: 'automatic-before-positioning', source: 'operation-override'
    };
    const overridden = compileWireEdmExecutionPlan(document);
    if (!overridden.ok) throw new Error(JSON.stringify(overridden.diagnostics));
    expect(overridden.plan.events.filter((event) => event.operationId === destinationId &&
      (event.kind === 'wire-separate' || event.kind === 'position' || event.kind === 'wire-thread'))).toEqual([
      expect.objectContaining({ kind: 'wire-separate', method: 'automatic' }),
      expect.objectContaining({ kind: 'position', from: { x: 0, y: 0 }, to: { x: 20, y: 0 } }),
      expect.objectContaining({ kind: 'wire-thread', method: 'automatic' })
    ]);
    expect(overridden.plan.requirements.threading).toEqual(['automatic']);
  });

  it('represents an explicit continuous transition between disconnected closed contours', () => {
    const document = createUpidFromDxfEntities([
      ...rectangle(0, 0, 10, 10),
      ...rectangle(20, 0, 30, 10)
    ]);
    document.setup = {
      initialWirePosition: {
        kind: 'manual', point: { x: 0, y: 0 }, review: 'reviewed'
      }
    };
    document.plan.operations[1].threadingTransition = {
      mode: 'continuous',
      wireSeparation: 'already-separated',
      source: 'operation-override'
    };

    const compiled = compileWireEdmExecutionPlan(document);
    if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));

    expect(compiled.plan.events.filter((event) =>
      event.operationId === document.plan.operations[1].id &&
      (event.kind === 'wire-continue' || event.kind === 'wire-thread' || event.kind === 'wire-separate' || event.kind === 'position')
    )).toEqual([
      expect.objectContaining({ kind: 'wire-continue' }),
      expect.objectContaining({
        kind: 'position',
        from: { x: 0, y: 0 },
        to: { x: 20, y: 0 }
      })
    ]);
    expect(compiled.plan.requirements).toMatchObject({
      threading: [],
      wireSeparation: false
    });
  });

  it('splits contour motion around an exact remaining-distance program stop', () => {
    const document = createUpidFromDxfEntities([
      { type: 'line', layer: 'CUT', start: { x: 0, y: 0 }, end: { x: 10, y: 0 } }
    ]);
    document.setup = {
      initialWirePosition: {
        kind: 'manual', point: { x: -2, y: 0 }, review: 'reviewed'
      }
    };
    document.plan.operations[0].programStops = [{
      id: 'retain-part',
      enabled: true,
      placement: { kind: 'before-operation-end', remainingCutLengthMm: 2 },
      reason: 'part-retention'
    }];

    const result = compileWireEdmExecutionPlan(document);
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    const ordered = result.plan.events.filter(({ kind }) => kind === 'motion' || kind === 'program-stop');
    expect(ordered).toEqual([
      expect.objectContaining({ kind: 'motion', start: { x: 0, y: 0 }, end: { x: 8, y: 0 } }),
      expect.objectContaining({ kind: 'program-stop', stopId: 'retain-part', point: { x: 8, y: 0 } }),
      expect.objectContaining({ kind: 'motion', start: { x: 8, y: 0 }, end: { x: 10, y: 0 } })
    ]);
  });
});

function rectangleDocument() {
  const document = createUpidFromDxfEntities(rectangle());
  document.setup = {
    initialWirePosition: {
      kind: 'manual', point: { x: -2, y: 0 }, review: 'reviewed'
    }
  };
  return document;
}

function rectangle(minX = 0, minY = 0, maxX = 10, maxY = 10) {
  return [
    { type: 'line' as const, layer: 'CUT', start: { x: minX, y: minY }, end: { x: maxX, y: minY } },
    { type: 'line' as const, layer: 'CUT', start: { x: maxX, y: minY }, end: { x: maxX, y: maxY } },
    { type: 'line' as const, layer: 'CUT', start: { x: maxX, y: maxY }, end: { x: minX, y: maxY } },
    { type: 'line' as const, layer: 'CUT', start: { x: minX, y: maxY }, end: { x: minX, y: minY } }
  ];
}
