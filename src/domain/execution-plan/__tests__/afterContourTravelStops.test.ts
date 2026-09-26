import { describe, expect, it } from 'vitest';
import { createUpidFromDxfEntities } from '@/domain/upid/upidDocument';
import { parsePortableUpid } from '@/domain/upid/portableUpidProject';
import { programStopPreview } from '@/domain/editor/programStopPreview';
import { setPathOperationProgramStops, setProjectThreadingDefault } from '@/domain/path-editor/pathDocumentOperations';
import { programStopValidationError } from '@/domain/path-intel/programStops';
import { setMachiningSpanParticipation } from '@/domain/path-intel/machiningParticipation';
import { compileSimulation, sampleSimulation } from '@/domain/simulation';
import { reviewCenterline } from '@/__tests__/reviewedUpid';
import type { OperationProgramStop } from '@/domain/path-intel/types';
import { compileWireEdmExecutionPlan } from '../executionPlan';

function fixture(includeNext = true) {
  const document = reviewCenterline(createUpidFromDxfEntities([
    { type: 'line', layer: 'CUT', start: { x: 0, y: 0 }, end: { x: 10, y: 0 } },
    ...(includeNext ? [{ type: 'line' as const, layer: 'CUT', start: { x: 30, y: 10 }, end: { x: 40, y: 10 } }] : [])
  ]));
  document.schemaVersion = 3;
  document.setup = { initialWirePosition: { kind: 'manual', point: { x: 0, y: 0 }, review: 'reviewed' },
    threadingDefault: { mode: 'manual', wireSeparation: 'already-separated' } };
  const operation = document.plan.operations[0];
  operation.transitions = { exit: { strategy: 'manual-straight', move: 'cut', from: { ...operation.endPoint },
    to: { x: 10, y: 10 }, review: 'reviewed' } };
  return document;
}

const stop = (travelLengthMm: number, id = `travel-${travelLengthMm}`): OperationProgramStop => ({
  id, enabled: true, reason: 'operator-check', placement: { kind: 'after-contour-distance', travelLengthMm }
});

describe('stops at an exact travel distance after contour', () => {
  it('splits exit and positioning at ordered exact points, with source ownership and preview parity', () => {
    const document = fixture();
    const operation = document.plan.operations[0];
    operation.programStops = [stop(25), stop(2), stop(15)];
    const original = structuredClone(document);
    const result = compileWireEdmExecutionPlan(document);
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    const stops = result.plan.events.filter((event) => event.kind === 'program-stop');
    expect(stops.map((event) => [event.stopId, event.point])).toEqual([
      ['travel-2', { x: 10, y: 2 }], ['travel-15', { x: 15, y: 10 }], ['travel-25', { x: 25, y: 10 }]
    ]);
    expect(stops.every((event) => event.operationId === operation.id &&
      event.trace[0].kind === 'program-stop' && event.trace[0].operationId === operation.id)).toBe(true);
    expect(result.plan.events.filter((event) => event.kind === 'position').map((event) => [event.from, event.to]))
      .toEqual([[{ x: 10, y: 10 }, { x: 15, y: 10 }], [{ x: 15, y: 10 }, { x: 25, y: 10 }], [{ x: 25, y: 10 }, { x: 30, y: 10 }]]);
    const byId = new Map(programStopPreview(document).map((marker) => [marker.stopId, marker.point]));
    for (const event of stops) expect(byId.get(event.stopId)).toEqual(event.point);
    const threadIndex = result.plan.events.findIndex((event) => event.kind === 'wire-thread');
    expect(threadIndex).toBeGreaterThan(result.plan.events.findIndex((event) => event.kind === 'program-stop' && event.stopId === 'travel-25'));
    expect(new Set(result.plan.events.map((event) => event.id)).size).toBe(result.plan.events.length);
    expect(document).toEqual(original);
    const simulation = compileSimulation(document, {
      stock: { originX: -5, originY: -5, width: 50, depth: 20, thickness: 10, bottomZ: 0 },
      wireDiameter: 0.25, cutSpeedMmPerSecond: 10, rapidSpeedMmPerSecond: 20,
      eventHoldSeconds: 1, retention: 'retain', supportFloorZ: -20, guideClearanceMm: 10
    });
    if (!simulation.ok) throw new Error(JSON.stringify(simulation.diagnostics));
    for (const step of simulation.plan.steps.filter((step) => step.event.kind === 'program-stop')) {
      const paused = sampleSimulation(simulation.plan, (step.startSeconds + step.endSeconds) / 2);
      expect(paused.phase).toBe('paused');
      if (step.event.kind === 'program-stop') expect(paused.wire.point).toEqual(step.event.point);
    }
  });

  it('stops at the exit boundary without zero-length motion and rejects a second pause there', () => {
    const document = fixture();
    const operation = document.plan.operations[0];
    operation.programStops = [stop(10)];
    const compiled = compileWireEdmExecutionPlan(document);
    if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));
    expect(compiled.plan.events.filter((event) => event.kind === 'motion' && event.role === 'exit')).toHaveLength(1);
    const existing: OperationProgramStop = { id: 'exit', enabled: true, reason: 'manual', placement: { kind: 'after-exit' } };
    operation.programStops.push(existing);
    expect(programStopValidationError(document, operation, stop(10), operation.programStops)).toContain('coincides');
    expect(programStopValidationError(document, operation, existing, operation.programStops)).toContain('coincides');
    expect(compileWireEdmExecutionPlan(document)).toMatchObject({ ok: false,
      diagnostics: [expect.objectContaining({ code: 'EXECUTION_PLAN_PROGRAM_STOP_INVALID' })] });
  });

  it.each([0, -1, NaN, Infinity, 30, 31])('rejects an invalid or out-of-path distance %s in authoring and execution', (value) => {
    const document = fixture();
    const operation = document.plan.operations[0];
    operation.programStops = [stop(value)];
    expect(programStopValidationError(document, operation, operation.programStops[0], [])).not.toBeNull();
    expect(compileWireEdmExecutionPlan(document).ok).toBe(false);
    expect(setPathOperationProgramStops({ ...document, plan: { ...document.plan, operations: document.plan.operations.map((item) =>
      item.id === operation.id ? { ...item, programStops: [] } : item) } }, operation.id, operation.programStops)).toBeNull();
  });

  it('allows final exit travel but rejects absent onward travel', () => {
    const document = fixture(false);
    document.plan.operations[0].programStops = [stop(2)];
    expect(compileWireEdmExecutionPlan(document).ok).toBe(true);
    document.plan.operations[0].transitions = undefined;
    expect(compileWireEdmExecutionPlan(document)).toMatchObject({ ok: false,
      diagnostics: [expect.objectContaining({ message: expect.stringContaining('No exit lead or next positioning') })] });
  });

  it('does not split an automatic separating rapid, while allowing an earlier exit stop', () => {
    const document = fixture();
    document.setup!.threadingDefault = { mode: 'manual', wireSeparation: 'automatic-during-positioning' };
    document.plan.operations[0].programStops = [stop(15)];
    expect(compileWireEdmExecutionPlan(document)).toMatchObject({ ok: false,
      diagnostics: [expect.objectContaining({ message: expect.stringContaining('cannot split positioning') })] });
    expect(programStopPreview(document)).toEqual([]);
    document.plan.operations[0].programStops = [stop(2)];
    const result = compileWireEdmExecutionPlan(document);
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    expect(result.plan.events.filter((event) => event.kind === 'position')).toEqual([
      expect.objectContaining({ from: { x: 10, y: 10 }, to: { x: 30, y: 10 }, separatesWire: true })
    ]);
  });

  it('promotes new intent to v3, round-trips it, and preserves the version in other edits', () => {
    const source = fixture();
    source.schemaVersion = 1;
    const document = setPathOperationProgramStops(source, source.plan.operations[0].id, [stop(15)])!;
    expect(document.schemaVersion).toBe(3);
    expect(source.schemaVersion).toBe(1);
    expect(parsePortableUpid(JSON.stringify({ format: 'upid', schemaVersion: 3, document })))
      .toMatchObject({ ok: true, document: { schemaVersion: 3 } });
    for (const schemaVersion of [1, 2]) expect(parsePortableUpid(JSON.stringify({ format: 'upid', schemaVersion,
      document: { ...document, schemaVersion } }))).toMatchObject({ ok: false });
    expect(setProjectThreadingDefault(document, { mode: 'manual', wireSeparation: 'automatic-during-positioning' })?.schemaVersion).toBe(3);
  });

  it('rejects travel when disconnected active runs have unresolved machining semantics', () => {
    const document = fixture();
    const operation = document.plan.operations[0];
    const split = setMachiningSpanParticipation(document, { sourceSegmentId: operation.segmentRefs[0].segmentId,
      range: { start: 0.3, end: 0.7 }, participation: 'inactive-reference' })!;
    split.plan.operations[0].programStops = [stop(2)];
    expect(programStopValidationError(split, split.plan.operations[0], stop(2), []))
      .toContain('Resolve machining participation');
    expect(programStopPreview(split)).toEqual([]);
    expect(setPathOperationProgramStops({ ...split, plan: { ...split.plan,
      operations: split.plan.operations.map((item) => ({ ...item, programStops: [] })) } }, operation.id, [stop(2)]))
      .toBeNull();
  });
});
