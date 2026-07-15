import { describe, expect, it } from 'vitest';

import { createDefaultMachineProfile } from '@/domain/workbench/defaultProject';
import { composeUpidGCodeExport, createUpidFromDxfEntities } from '@/domain/upid/upidDocument';

import { compileSimulationTimeline, sampleSimulationCursor } from '../simulationTimeline';

describe('simulation timeline compilation', () => {
  it('compiles exact posted rapid, line, and arc moves with stable trace metadata', () => {
    const document = mixedMotionDocument();
    const machine = createDefaultMachineProfile();
    const posted = composeUpidGCodeExport(document, { machine });

    const timeline = compileSimulationTimeline(document, machine);
    const secondCompilation = compileSimulationTimeline(document, machine);
    const postedMoves = posted.programOperations.flatMap((operation) => operation.moves);

    expect(timeline.status).toBe('ready');
    expect(timeline.diagnostics).toEqual(posted.diagnostics);
    expect(timeline.moves.map((move) => move.id)).toEqual(
      secondCompilation.moves.map((move) => move.id)
    );
    expect(new Set(timeline.moves.map((move) => move.id)).size).toBe(timeline.moves.length);
    expect(timeline.moves.map((move) => ({
      command: move.command,
      kind: move.kind,
      operationId: move.operationId,
      programLineNumber: move.programLineNumber,
      reason: move.reason,
      segmentId: move.segmentId
    }))).toEqual(postedMoves.map((move) => ({
      command: move.command,
      kind: move.kind,
      operationId: move.operationId,
      programLineNumber: move.programLineNumber,
      reason: move.reason,
      segmentId: move.segmentId
    })));
    expect(timeline.moves.map((move) => move.command)).toEqual(['G0', 'G1', 'G3', 'G0', 'G1']);
    expect(timeline.moves.map((move) => move.id)).toEqual(
      postedMoves.map((move) => `simulation-move-line-${move.programLineNumber}`)
    );
  });

  it('samples posted arcs at equal arc-length intervals using their source segment geometry', () => {
    const timeline = compileSimulationTimeline(mixedMotionDocument(), createDefaultMachineProfile());
    const arc = timeline.moves.find((move) => move.command === 'G3');

    expect(arc).toBeDefined();
    expect(arc!.points.length).toBeGreaterThan(2);
    expect(arc!.points[0]).toEqual(arc!.start);
    expect(arc!.points.at(-1)).toEqual(arc!.end);
    expect(arc!.lengthMm).toBeCloseTo((5 * Math.PI) / 2, 10);

    const angles = arc!.points.map((point) => Math.atan2(point.y - 5, point.x - 10));
    const steps = angles.slice(1).map((angle, index) => angle - angles[index]);
    steps.forEach((step) => expect(step).toBeCloseTo(steps[0], 10));
    arc!.points.forEach((point) => {
      expect(Math.hypot(point.x - 10, point.y - 5)).toBeCloseTo(5, 10);
    });
  });

  it('samples each posted half of a circle from the same exact source geometry', () => {
    const document = createUpidFromDxfEntities([
      {
        type: 'circle',
        layer: 'CUT',
        center: { x: 2, y: 3 },
        radius: 4
      }
    ]);

    const timeline = compileSimulationTimeline(document, createDefaultMachineProfile());
    const circularMoves = timeline.moves.filter((move) => move.command === 'G3');

    expect(circularMoves).toHaveLength(2);
    expect(timeline.cutDistanceMm).toBeCloseTo(8 * Math.PI, 10);
    circularMoves.forEach((move) => {
      expect(move.lengthMm).toBeCloseTo(4 * Math.PI, 10);
      expect(move.points.length).toBeGreaterThan(2);
      expect(move.points[0]).toEqual(move.start);
      expect(move.points.at(-1)).toEqual(move.end);
      move.points.forEach((point) => {
        expect(Math.hypot(point.x - 2, point.y - 3)).toBeCloseTo(4, 10);
      });
    });
  });

  it('accumulates cut, rapid, move, and operation distances without counting an unknown initial position', () => {
    const timeline = compileSimulationTimeline(mixedMotionDocument(), createDefaultMachineProfile());
    const expectedArcLength = (5 * Math.PI) / 2;
    const expectedRapidLength = Math.hypot(15, -5);

    expect(timeline.moves.map((move) => move.lengthMm)).toEqual([
      0,
      10,
      expect.closeTo(expectedArcLength, 10),
      expect.closeTo(expectedRapidLength, 10),
      5
    ]);
    expect(timeline.moves.map((move) => move.startDistanceMm)).toEqual([
      0,
      0,
      10,
      expect.closeTo(10 + expectedArcLength, 10),
      expect.closeTo(10 + expectedArcLength + expectedRapidLength, 10)
    ]);
    expect(timeline.cutDistanceMm).toBeCloseTo(15 + expectedArcLength, 10);
    expect(timeline.rapidDistanceMm).toBeCloseTo(expectedRapidLength, 10);
    expect(timeline.totalDistanceMm).toBeCloseTo(15 + expectedArcLength + expectedRapidLength, 10);

    expect(timeline.operations).toHaveLength(2);
    expect(timeline.operations[0]).toMatchObject({
      operationId: timeline.moves[0].operationId,
      moveStartIndex: 0,
      moveEndIndex: 2,
      startDistanceMm: 0,
      endDistanceMm: 10 + expectedArcLength,
      cutDistanceMm: 10 + expectedArcLength,
      rapidDistanceMm: 0
    });
    expect(timeline.operations[1]).toMatchObject({
      operationId: timeline.moves[3].operationId,
      moveStartIndex: 3,
      moveEndIndex: 4,
      startDistanceMm: 10 + expectedArcLength,
      endDistanceMm: 15 + expectedArcLength + expectedRapidLength,
      cutDistanceMm: 5,
      rapidDistanceMm: expectedRapidLength
    });
  });

  it('propagates invalid-document blocking diagnostics without compiling partial motion', () => {
    const document = mixedMotionDocument();
    document.segments[0].length = Number.POSITIVE_INFINITY;

    const timeline = compileSimulationTimeline(document, createDefaultMachineProfile());

    expect(timeline.status).toBe('blocked');
    expect(timeline.diagnostics.some((diagnostic) => diagnostic.severity === 'error')).toBe(true);
    expect(timeline.diagnostics.some((diagnostic) => diagnostic.code === 'upid-invalid-value')).toBe(true);
    expect(timeline.moves).toEqual([]);
    expect(timeline.operations).toEqual([]);
    expect(timeline.totalDistanceMm).toBe(0);
    expect(timeline.cutDistanceMm).toBe(0);
    expect(timeline.rapidDistanceMm).toBe(0);
  });

  it('propagates a blocked machine post without guessing motion', () => {
    const machine = createDefaultMachineProfile();
    machine.controller.unitsCode = 'G20';

    const timeline = compileSimulationTimeline(mixedMotionDocument(), machine);

    expect(timeline.status).toBe('blocked');
    expect(timeline.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: 'error',
          code: 'post-inch-units-unsupported'
        })
      ])
    );
    expect(timeline.moves).toEqual([]);
    expect(timeline.operations).toEqual([]);
    expect(timeline.totalDistanceMm).toBe(0);
  });
});

describe('simulation cursor sampling', () => {
  it('interpolates by accumulated distance and selects the completed move at exact boundaries', () => {
    const timeline = compileSimulationTimeline(mixedMotionDocument(), createDefaultMachineProfile());
    const line = timeline.moves[1];

    expect(sampleSimulationCursor(timeline, 0)).toMatchObject({
      progress: 0,
      distanceMm: 0,
      moveIndex: 1,
      moveId: line.id,
      moveProgress: 0,
      point: { x: 0, y: 0 }
    });

    const lineBoundary = sampleSimulationCursor(timeline, line.endDistanceMm / timeline.totalDistanceMm);
    expect(lineBoundary).toMatchObject({
      moveIndex: 1,
      moveId: line.id,
      moveProgress: 1,
      point: { x: 10, y: 0 },
      operationId: line.operationId,
      segmentId: line.segmentId,
      programLineNumber: line.programLineNumber
    });

    const rapid = timeline.moves[3];
    const rapidMidpoint = sampleSimulationCursor(
      timeline,
      ((rapid.startDistanceMm + rapid.endDistanceMm) / 2) / timeline.totalDistanceMm
    );
    expect(rapidMidpoint).toMatchObject({
      moveIndex: 3,
      moveId: rapid.id,
      moveProgress: 0.5,
      point: { x: 22.5, y: 2.5 },
      kind: 'rapid',
      command: 'G0'
    });

    const last = timeline.moves.at(-1)!;
    expect(sampleSimulationCursor(timeline, 2)).toMatchObject({
      progress: 1,
      distanceMm: timeline.totalDistanceMm,
      moveIndex: timeline.moves.length - 1,
      moveId: last.id,
      moveProgress: 1,
      point: { x: 35, y: 0 }
    });
  });
});

function mixedMotionDocument() {
  return createUpidFromDxfEntities(
    [
      {
        type: 'line',
        layer: 'CUT',
        start: { x: 0, y: 0 },
        end: { x: 10, y: 0 }
      },
      {
        type: 'arc',
        layer: 'CUT',
        center: { x: 10, y: 5 },
        radius: 5,
        startAngle: -Math.PI / 2,
        endAngle: 0,
        sweepRadians: Math.PI / 2,
        clockwise: false,
        start: { x: 10, y: 0 },
        end: { x: 15, y: 5 }
      },
      {
        type: 'line',
        layer: 'CUT',
        start: { x: 30, y: 0 },
        end: { x: 35, y: 0 }
      }
    ],
    { operationOrderStrategy: 'source-order' }
  );
}
