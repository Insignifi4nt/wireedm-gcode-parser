import { describe, expect, it } from 'vitest';

import { reviewCenterline } from '@/__tests__/reviewedUpid';
import { setManualCompensationIntent } from '@/domain/compensation/intent';
import type { DxfEntity } from '@/domain/dxf/types';
import {
  mirrorPathDocument, reversePathOperation, rotatePathDocument, setClosedOperationStartNearPoint, translatePathDocument
} from '@/domain/path-editor/pathDocumentOperations';
import {
  setMachiningSpanParticipation, setPartialContourEntryReview, setPartialContourExitReview
} from '@/domain/path-intel/machiningParticipation';
import type { OperationProgramStop, PathPlanningDocument, Point2 } from '@/domain/path-intel/types';
import { auditControllerProgram } from '@/domain/post-processor/controllerProgram';
import { serializeControllerOutput } from '@/domain/post-processor/controllerOutput';
import { runPost } from '@/domain/post-processor/postEngine';
import { createEmptyPostLibrary, installPostPackage } from '@/domain/post-processor/postLibrary';
import { parseWireEdmPostPackage } from '@/domain/post-processor/postPackage';
import { compileSimulation, sampleSimulation, type SimulationPlan } from '@/domain/simulation';
import { buildUpidEditorTree } from '@/domain/upid/upidEditorTree';
import { createUpidFromDxfEntities } from '@/domain/upid/upidDocument';

import { compileWireEdmExecutionPlan, type WireEdmExecutionPlan } from '../executionPlan';
import robofilPackageJson from '../../../../tests/fixtures/machine-packages/robofil-100-v2/cristian-robofil-100-v2.wireedm-post.json';

const roundedLength = 48 + 4 * Math.PI;
const roundedSegmentLengths = [16, Math.PI, 8, Math.PI, 16, Math.PI, 8, Math.PI];

interface AnalyticStop {
  id: string;
  distance: number;
  point: Point2;
  segmentIndex: number;
  parameter: number;
}

// Worked points on a 20 by 12 rectangle with radius-2 corners, traversed CCW.
const roundedStops: AnalyticStop[] = [
  { id: 'bottom-line', distance: 4, point: { x: 6, y: 0 }, segmentIndex: 0, parameter: 0.25 },
  { id: 'before-line-arc', distance: 15.875, point: { x: 17.875, y: 0 }, segmentIndex: 0, parameter: 15.875 / 16 },
  { id: 'line-arc-join', distance: 16, point: { x: 18, y: 0 }, segmentIndex: 0, parameter: 1 },
  { id: 'after-line-arc', distance: 16.125, point: { x: 18 + 2 * Math.sin(0.0625), y: 2 - 2 * Math.cos(0.0625) }, segmentIndex: 1, parameter: 0.125 / Math.PI },
  { id: 'first-corner-half', distance: 16 + Math.PI / 2, point: { x: 18 + Math.SQRT2, y: 2 - Math.SQRT2 }, segmentIndex: 1, parameter: 0.5 },
  { id: 'arc-line-join', distance: 16 + Math.PI, point: { x: 20, y: 2 }, segmentIndex: 1, parameter: 1 },
  { id: 'after-arc-line', distance: 16.125 + Math.PI, point: { x: 20, y: 2.125 }, segmentIndex: 2, parameter: 0.125 / 8 },
  { id: 'before-second-corner', distance: 23.875 + Math.PI, point: { x: 20, y: 9.875 }, segmentIndex: 2, parameter: 7.875 / 8 },
  { id: 'second-corner-join', distance: 24 + Math.PI, point: { x: 20, y: 10 }, segmentIndex: 2, parameter: 1 },
  { id: 'second-corner-half', distance: 24 + 1.5 * Math.PI, point: { x: 18 + Math.SQRT2, y: 10 + Math.SQRT2 }, segmentIndex: 3, parameter: 0.5 },
  { id: 'last-corner-half', distance: 48 + 3.5 * Math.PI, point: { x: 2 - Math.SQRT2, y: 2 - Math.SQRT2 }, segmentIndex: 7, parameter: 0.5 },
  { id: 'near-closure', distance: roundedLength - 0.125, point: { x: 2 - 2 * Math.sin(0.0625), y: 2 - 2 * Math.cos(0.0625) }, segmentIndex: 7, parameter: 1 - 0.125 / Math.PI }
];

function line(start: Point2, end: Point2): DxfEntity {
  return { type: 'line', layer: 'CUT', start, end };
}

function arc(center: Point2, radius: number, start: Point2, end: Point2, startAngle: number, sweep: number): DxfEntity {
  return { type: 'arc', layer: 'CUT', center, radius, start, end,
    startAngle, endAngle: startAngle + sweep * 180 / Math.PI,
    sweepRadians: sweep, clockwise: sweep < 0 };
}

function roundedEntities(): DxfEntity[] {
  return [
    line({ x: 2, y: 0 }, { x: 18, y: 0 }),
    arc({ x: 18, y: 2 }, 2, { x: 18, y: 0 }, { x: 20, y: 2 }, -90, Math.PI / 2),
    line({ x: 20, y: 2 }, { x: 20, y: 10 }),
    arc({ x: 18, y: 10 }, 2, { x: 20, y: 10 }, { x: 18, y: 12 }, 0, Math.PI / 2),
    line({ x: 18, y: 12 }, { x: 2, y: 12 }),
    arc({ x: 2, y: 10 }, 2, { x: 2, y: 12 }, { x: 0, y: 10 }, 90, Math.PI / 2),
    line({ x: 0, y: 10 }, { x: 0, y: 2 }),
    arc({ x: 2, y: 2 }, 2, { x: 0, y: 2 }, { x: 2, y: 0 }, 180, Math.PI / 2)
  ];
}

function reviewedDocument(entities: DxfEntity[], startPoint: Point2): PathPlanningDocument {
  const document = createUpidFromDxfEntities(entities, {
    startPoint, operationOrderStrategy: 'source-order',
    allowReverseClosedContours: false, allowReverseOpenChains: false
  });
  reviewCenterline(document);
  document.setup = { initialWirePosition: { kind: 'manual', point: startPoint, review: 'reviewed' },
    threadingDefault: { mode: 'manual', wireSeparation: 'manual-before-positioning' } };
  for (const operation of document.plan.operations) {
    operation.transitions = { entry: { strategy: 'none', review: 'reviewed' }, exit: { strategy: 'none', review: 'reviewed' } };
  }
  return document;
}

function compiled(document: PathPlanningDocument): WireEdmExecutionPlan {
  const result = compileWireEdmExecutionPlan(document);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result.plan;
}

function simulated(document: PathPlanningDocument): SimulationPlan {
  const result = compileSimulation(document, {
    stock: { originX: -100, originY: -100, width: 200, depth: 200, thickness: 10, bottomZ: 0 },
    wireDiameter: 0.25, cutSpeedMmPerSecond: 10, rapidSpeedMmPerSecond: 20,
    eventHoldSeconds: 0.25, retention: 'retain', wasteHandling: 'keep', supportFloorZ: 0
  });
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result.plan;
}

function contourMotions(plan: WireEdmExecutionPlan) {
  return plan.events.flatMap(event => event.kind === 'motion' && event.role === 'contour' ? [event] : []);
}

function nearPoint(actual: Point2, expected: Point2) {
  expect(actual.x).toBeCloseTo(expected.x, 10);
  expect(actual.y).toBeCloseTo(expected.y, 10);
}

function stopAt(id: string, remainingCutLengthMm: number, enabled = true): OperationProgramStop {
  return { id, enabled, reason: 'operator-check', placement: { kind: 'before-operation-end', remainingCutLengthMm } };
}

function expectSourceCoverage(
  plan: WireEdmExecutionPlan, segmentIds: string[], lengths: number[], reversed: boolean,
  expectedLength = roundedLength, ranges = segmentIds.map(() => ({ start: 0, end: 1 }))
) {
  const motions = contourMotions(plan);
  expect(motions.length).toBeGreaterThan(segmentIds.length);
  let cutLength = 0;
  segmentIds.forEach((segmentId, index) => {
    const fragments = motions.filter(motion => motion.sourceSegmentId === segmentId);
    expect(fragments.length).toBeGreaterThan(0);
    expect(fragments[0].sourceRange?.start).toBeCloseTo(reversed ? ranges[index].end : ranges[index].start, 12);
    expect(fragments.at(-1)?.sourceRange?.end).toBeCloseTo(reversed ? ranges[index].start : ranges[index].end, 12);
    fragments.forEach((fragment, fragmentIndex) => {
      if (!fragment.sourceRange) throw new Error('Expected contour source range');
      expect(fragment.trace).toEqual([{ kind: 'segment', operationId: plan.source.operationIds[0],
        segmentId, sourceRange: fragment.sourceRange }]);
      const span = fragment.sourceRange.end - fragment.sourceRange.start;
      expect(reversed ? -span : span).toBeGreaterThan(0);
      expect(Math.min(fragment.sourceRange.start, fragment.sourceRange.end)).toBeGreaterThanOrEqual(ranges[index].start);
      expect(Math.max(fragment.sourceRange.start, fragment.sourceRange.end)).toBeLessThanOrEqual(ranges[index].end);
      cutLength += Math.abs(span) * lengths[index];
      if (fragmentIndex > 0) expect(fragment.sourceRange.start).toBe(fragments[fragmentIndex - 1].sourceRange?.end);
    });
  });
  expect(cutLength).toBeCloseTo(expectedLength, 11);
  motions.slice(1).forEach((motion, index) => nearPoint(motion.start, motions[index].end));
  expect(new Set(plan.events.map(event => event.id)).size).toBe(plan.events.length);
  expect(plan.events.map(event => event.ordinal)).toEqual(plan.events.map((_, index) => index + 1));
}

function expectEditorTraces(document: PathPlanningDocument, plan: WireEdmExecutionPlan) {
  const tree = buildUpidEditorTree(document);
  if (tree.status !== 'ready') throw new Error(JSON.stringify(tree.diagnostics));
  const nodes = tree.operations.flatMap(operation => operation.children);
  for (const event of plan.events.filter(event => event.kind === 'motion' || event.kind === 'program-stop')) {
    expect(nodes.find(node => node.eventId === event.id)?.sourceTrace).toEqual(event.trace);
  }
}

describe('complex contour stop numerics', () => {
  it.each([
    { transform: 'original', reversed: false },
    { transform: 'original', reversed: true },
    { transform: 'mirror', reversed: false },
    { transform: 'mirror', reversed: true },
    { transform: 'rotate-translate', reversed: false },
    { transform: 'rotate-translate', reversed: true }
  ])('preserves rounded-contour joins, source ranges and playback: $transform, reversed=$reversed', ({ transform, reversed }) => {
    let document = reviewedDocument(roundedEntities(), { x: 2, y: 0 });
    const sourceIds = document.segments.map(segment => segment.id);
    let transformPoint = (point: Point2): Point2 => ({ ...point });
    if (transform === 'mirror') {
      document = mirrorPathDocument(document, 'x', { x: 0, y: 0 }) ?? document;
      transformPoint = point => ({ x: point.x, y: -point.y });
    } else if (transform === 'rotate-translate') {
      document = rotatePathDocument(document, 90, { x: 0, y: 0 }) ?? document;
      document = translatePathDocument(document, { x: 31.125, y: -17.75 }) ?? document;
      transformPoint = point => ({ x: 31.125 - point.y, y: -17.75 + point.x });
    }
    if (transform !== 'original') {
      document = setClosedOperationStartNearPoint(document, document.plan.operations[0].id,
        transformPoint({ x: 2, y: 0 })) ?? document;
    }
    if (reversed) document = reversePathOperation(document, document.plan.operations[0].id) ?? document;
    document.setup = { ...document.setup,
      initialWirePosition: { kind: 'manual', point: transformPoint({ x: 2, y: 0 }), review: 'reviewed' } };
    const baseline = simulated(document);
    expect(contourMotions(baseline.executionPlan)).toHaveLength(8);
    expect(baseline.steps.reduce((total, step) => total + step.lengthMm, 0)).toBeCloseTo(roundedLength, 10);
    const unordered = [roundedStops[9], roundedStops[2], roundedStops[11], roundedStops[5],
      roundedStops[0], roundedStops[8], roundedStops[3], roundedStops[10], roundedStops[6],
      roundedStops[1], roundedStops[7], roundedStops[4]];
    document.plan.operations[0].programStops = [
      ...unordered.map(stop => stopAt(stop.id, reversed ? stop.distance : roundedLength - stop.distance)),
      stopAt('disabled-with-duplicate-placement', reversed ? roundedStops[0].distance : roundedLength - roundedStops[0].distance, false)
    ];
    const original = structuredClone(document);
    const plan = compiled(document);
    const stops = plan.events.filter(event => event.kind === 'program-stop');
    const ordered = reversed ? [...roundedStops].reverse() : roundedStops;
    expect(stops.map(stop => stop.stopId)).toEqual(ordered.map(stop => stop.id));
    stops.forEach((stop, index) => {
      const expected = ordered[index];
      nearPoint(stop.point, transformPoint(expected.point));
      expect(stop.trace).toEqual([{ kind: 'program-stop', operationId: document.plan.operations[0].id, stopId: expected.id }]);
      // Check source coordinates separately from spatial points at every worked stop.
      const ranges = contourMotions(plan).filter(motion => motion.sourceSegmentId === sourceIds[expected.segmentIndex])
        .flatMap(motion => motion.sourceRange ? [motion.sourceRange.start, motion.sourceRange.end] : []);
      expect(ranges.some(parameter => Math.abs(parameter - expected.parameter) < 1e-12)).toBe(true);
      const previous = plan.events[stop.ordinal - 2];
      expect(previous.kind).toBe('motion');
      if (previous.kind === 'motion') nearPoint(previous.end, stop.point);
    });
    expectSourceCoverage(plan, sourceIds, roundedSegmentLengths, reversed);
    const directions = contourMotions(plan).filter(motion => motion.motion === 'circular').map(motion => motion.clockwise);
    expect(directions.every(clockwise => clockwise === (reversed !== (transform === 'mirror')))).toBe(true);
    expectEditorTraces(document, plan);
    const playback = simulated(document);
    expect(playback.executionPlan).toEqual(plan);
    const cutSteps = playback.steps.filter(step => step.event.kind === 'motion');
    expect(cutSteps.reduce((total, step) => total + step.lengthMm, 0)).toBeCloseTo(roundedLength, 10);
    expect(playback.machiningDurationSeconds - baseline.machiningDurationSeconds).toBeCloseTo(roundedStops.length * 0.25, 10);
    for (const step of playback.steps.filter(step => step.event.kind === 'program-stop')) {
      if (step.event.kind !== 'program-stop') throw new Error('Expected program stop');
      const snapshot = sampleSimulation(playback, (step.startSeconds + step.endSeconds) / 2);
      expect(snapshot.phase).toBe('paused');
      nearPoint(snapshot.wire.point, step.event.point);
      expect(snapshot.pieces).toHaveLength(0);
    }
    const finalCut = cutSteps.at(-1);
    expect(playback.pieces).toHaveLength(1);
    expect(playback.pieces[0].releaseSeconds).toBe(finalCut?.endSeconds);
    expect(sampleSimulation(playback, Infinity).pieces).toHaveLength(1);
    expect(document).toEqual(original);
  });

  it('accepts rounded contour tangencies after a 37-degree rotation and translation', () => {
    const source = reviewedDocument(roundedEntities(), { x: 2, y: 0 });
    expect(contourMotions(compiled(source))).toHaveLength(8);
    let transformed = rotatePathDocument(source, 37, { x: 0, y: 0 });
    if (!transformed) throw new Error('Expected supported rotation');
    transformed = translatePathDocument(transformed, { x: 31.125, y: -17.75 });
    if (!transformed) throw new Error('Expected supported translation');
    const angle = 37 * Math.PI / 180;
    const transform = (point: Point2): Point2 => ({
      x: 31.125 + point.x * Math.cos(angle) - point.y * Math.sin(angle),
      y: -17.75 + point.x * Math.sin(angle) + point.y * Math.cos(angle)
    });
    transformed.segments.forEach((segment, index) => {
      nearPoint(segment.start, transform(source.segments[index].start));
      nearPoint(segment.end, transform(source.segments[index].end));
    });
    transformed.setup = { ...transformed.setup,
      initialWirePosition: { kind: 'manual', point: transform({ x: 2, y: 0 }), review: 'reviewed' } };
    expect(contourMotions(compiled(transformed))).toHaveLength(8);
  });

  it.each([false, true])('measures stops only across a clipped open line/arc/line contour, reversed=%s', reversed => {
    let document = reviewedDocument([
      line({ x: 0, y: 0 }, { x: 10, y: 0 }),
      arc({ x: 10, y: 5 }, 5, { x: 10, y: 0 }, { x: 15, y: 5 }, -90, Math.PI / 2),
      line({ x: 15, y: 5 }, { x: 15, y: 15 })
    ], { x: 0, y: 0 });
    const operationId = document.plan.operations[0].id;
    const sourceIds = document.segments.map(segment => segment.id);
    document = setMachiningSpanParticipation(document, { sourceSegmentId: sourceIds[0],
      range: { start: 0, end: 0.2 }, participation: 'inactive-reference' }) ?? document;
    document = setMachiningSpanParticipation(document, { sourceSegmentId: sourceIds[2],
      range: { start: 0.7, end: 1 }, participation: 'inactive-reference' }) ?? document;
    if (reversed) document = reversePathOperation(document, operationId) ?? document;
    document = setPartialContourEntryReview(document, operationId, true) ?? document;
    document = setPartialContourExitReview(document, operationId, true) ?? document;
    document.setup = { ...document.setup,
      initialWirePosition: { kind: 'manual', point: reversed ? { x: 15, y: 12 } : { x: 2, y: 0 }, review: 'reviewed' } };
    const length = 15 + 2.5 * Math.PI;
    const analytic: AnalyticStop[] = [
      { id: 'clipped-first-line', distance: 4, point: { x: 6, y: 0 }, segmentIndex: 0, parameter: 0.6 },
      { id: 'first-join', distance: 8, point: { x: 10, y: 0 }, segmentIndex: 0, parameter: 1 },
      { id: 'arc-half', distance: 8 + 1.25 * Math.PI, point: { x: 10 + 5 / Math.SQRT2, y: 5 - 5 / Math.SQRT2 }, segmentIndex: 1, parameter: 0.5 },
      { id: 'second-join', distance: 8 + 2.5 * Math.PI, point: { x: 15, y: 5 }, segmentIndex: 1, parameter: 1 },
      { id: 'clipped-last-line', distance: 11.5 + 2.5 * Math.PI, point: { x: 15, y: 8.5 }, segmentIndex: 2, parameter: 0.35 }
    ];
    const baseline = simulated(document);
    document.plan.operations[0].programStops = [...analytic].reverse()
      .map(stop => stopAt(stop.id, reversed ? stop.distance : length - stop.distance));
    document.plan.operations[0].programStops.push(stopAt('disabled-outside-active-cut', 100, false));
    const before = structuredClone(document);
    const plan = compiled(document);
    const stops = plan.events.filter(event => event.kind === 'program-stop');
    const ordered = reversed ? [...analytic].reverse() : analytic;
    expect(stops.map(stop => stop.stopId)).toEqual(ordered.map(stop => stop.id));
    stops.forEach((stop, index) => nearPoint(stop.point, ordered[index].point));
    expect(plan.source.operationIds).toEqual([operationId]);
    expect(contourMotions(plan)[0].operationId).not.toBe(operationId);
    expectSourceCoverage(plan, sourceIds, [10, 2.5 * Math.PI, 10], reversed, length,
      [{ start: 0.2, end: 1 }, { start: 0, end: 1 }, { start: 0, end: 0.7 }]);
    nearPoint(contourMotions(plan)[0].start, reversed ? { x: 15, y: 12 } : { x: 2, y: 0 });
    nearPoint(contourMotions(plan).at(-1)?.end ?? { x: NaN, y: NaN }, reversed ? { x: 2, y: 0 } : { x: 15, y: 12 });
    expectEditorTraces(document, plan);
    const playback = simulated(document);
    expect(playback.steps.reduce((total, step) => total + step.lengthMm, 0)).toBeCloseTo(length, 11);
    expect(playback.machiningDurationSeconds - baseline.machiningDurationSeconds).toBeCloseTo(1.25, 11);
    expect(playback.pieces).toHaveLength(0);
    expect(document).toEqual(before);
  });

  it.each([
    { clockwise: false, reversed: false }, { clockwise: false, reversed: true },
    { clockwise: true, reversed: false }, { clockwise: true, reversed: true }
  ])('keeps a nearly full arc between lines partial through stops and playback, clockwise=$clockwise, reversed=$reversed', ({ clockwise, reversed }) => {
    const sign = clockwise ? -1 : 1;
    const sweep = 2 * Math.PI - 0.002;
    const radius = 7;
    const center = { x: 12.375, y: -3.875 };
    const pointAt = (parameter: number): Point2 => ({
      x: center.x + radius * Math.cos(sign * sweep * parameter),
      y: center.y + radius * Math.sin(sign * sweep * parameter)
    });
    const entry = { x: center.x + 10, y: center.y + sign * 3 };
    const exit = { x: center.x + 10, y: center.y - sign * 3 };
    const firstLength = 3 * Math.SQRT2;
    const arcLength = radius * sweep;
    const lastLength = Math.hypot(10 - radius * Math.cos(0.002), -sign * 3 + sign * radius * Math.sin(0.002));
    const length = firstLength + arcLength + lastLength;
    let document = reviewedDocument([
      line(entry, pointAt(0)), arc(center, radius, pointAt(0), pointAt(1), 0, sign * sweep),
      line(pointAt(1), exit)
    ], entry);
    const sourceIds = document.segments.map(segment => segment.id);
    if (reversed) document = reversePathOperation(document, document.plan.operations[0].id) ?? document;
    document.setup = { ...document.setup,
      initialWirePosition: { kind: 'manual', point: reversed ? exit : entry, review: 'reviewed' } };
    const baseline = simulated(document);
    expect(baseline.steps.reduce((total, step) => total + step.lengthMm, 0)).toBeCloseTo(length, 10);
    const arcParameters = [0.25, 0.5, 0.75, 1 - 0.0001 / arcLength];
    const analytic = [
      { id: 'before-arc', distance: firstLength, point: pointAt(0) },
      ...arcParameters.map((parameter, index) => ({ id: `arc-${index}`, distance: firstLength + arcLength * parameter, point: pointAt(parameter) })),
      { id: 'after-arc', distance: firstLength + arcLength, point: pointAt(1) }
    ];
    document.plan.operations[0].programStops = [analytic[4], analytic[0], analytic[5], analytic[2], analytic[1], analytic[3]]
      .map(stop => stopAt(stop.id, reversed ? stop.distance : length - stop.distance));
    const before = structuredClone(document);
    const plan = compiled(document);
    const stops = plan.events.filter(event => event.kind === 'program-stop');
    const ordered = reversed ? [...analytic].reverse() : analytic;
    expect(stops.map(stop => stop.stopId)).toEqual(ordered.map(stop => stop.id));
    stops.forEach((stop, index) => nearPoint(stop.point, ordered[index].point));
    expectSourceCoverage(plan, sourceIds, [firstLength, arcLength, lastLength], reversed, length);
    const arcMotions = contourMotions(plan).filter(motion => motion.sourceSegmentId === sourceIds[1]);
    expect(arcMotions.length).toBeGreaterThan(4);
    expect(arcMotions.every(motion => motion.fullCircle === false && motion.clockwise === (clockwise !== reversed))).toBe(true);
    const playback = simulated(document);
    expect(playback.steps.reduce((total, step) => total + step.lengthMm, 0)).toBeCloseTo(length, 10);
    expect(playback.machiningDurationSeconds - baseline.machiningDurationSeconds).toBeCloseTo(analytic.length * 0.25, 10);
    for (const step of playback.steps) {
      if (step.event.kind !== 'motion' || step.event.sourceSegmentId !== sourceIds[1]) continue;
      const range = step.event.sourceRange;
      if (!range) throw new Error('Expected original arc parameters');
      const snapshot = sampleSimulation(playback, (step.startSeconds + step.endSeconds) / 2);
      nearPoint(snapshot.wire.point, pointAt((range.start + range.end) / 2));
    }
    expectEditorTraces(document, plan);
    expect(playback.pieces).toHaveLength(0);
    expect(document).toEqual(before);
  });

  it.each([false, true])('preserves a clipped circle as original circle ranges through several stops, reversed=%s', reversed => {
    const center = { x: 11.5, y: -6.25 };
    const radius = 3;
    let document = reviewedDocument([{ type: 'circle', layer: 'CUT', center, radius }], { x: 14.5, y: -6.25 });
    const operationId = document.plan.operations[0].id;
    const sourceId = document.segments[0].id;
    document = setMachiningSpanParticipation(document, { sourceSegmentId: sourceId,
      range: { start: 0.75, end: 1 }, participation: 'inactive-reference' }) ?? document;
    if (reversed) document = reversePathOperation(document, operationId) ?? document;
    document = setPartialContourEntryReview(document, operationId, true) ?? document;
    document = setPartialContourExitReview(document, operationId, true) ?? document;
    document.setup = { ...document.setup, initialWirePosition: { kind: 'manual',
      point: reversed ? { x: 11.5, y: -9.25 } : { x: 14.5, y: -6.25 }, review: 'reviewed' } };
    const circumference = 6 * Math.PI;
    const length = 4.5 * Math.PI;
    const analytic = [
      { id: 'eighth', parameter: 0.125, point: { x: 11.5 + 3 / Math.SQRT2, y: -6.25 + 3 / Math.SQRT2 } },
      { id: 'quarter', parameter: 0.25, point: { x: 11.5, y: -3.25 } },
      { id: 'half', parameter: 0.5, point: { x: 8.5, y: -6.25 } },
      { id: 'five-eighths', parameter: 0.625, point: { x: 11.5 - 3 / Math.SQRT2, y: -6.25 - 3 / Math.SQRT2 } }
    ];
    const baseline = simulated(document);
    document.plan.operations[0].programStops = [analytic[3], analytic[1], analytic[0], analytic[2]]
      .map(stop => stopAt(stop.id, reversed ? circumference * stop.parameter : length - circumference * stop.parameter));
    const before = structuredClone(document);
    const plan = compiled(document);
    const stops = plan.events.filter(event => event.kind === 'program-stop');
    const ordered = reversed ? [...analytic].reverse() : analytic;
    expect(stops.map(stop => stop.stopId)).toEqual(ordered.map(stop => stop.id));
    stops.forEach((stop, index) => nearPoint(stop.point, ordered[index].point));
    expectSourceCoverage(plan, [sourceId], [circumference], reversed, length, [{ start: 0, end: 0.75 }]);
    expect(contourMotions(plan).every(motion => motion.fullCircle === false && motion.clockwise === reversed)).toBe(true);
    const playback = simulated(document);
    expect(playback.steps.reduce((total, step) => total + step.lengthMm, 0)).toBeCloseTo(length, 11);
    expect(playback.machiningDurationSeconds - baseline.machiningDurationSeconds).toBeCloseTo(1, 11);
    expect(playback.pieces).toHaveLength(0);
    expectEditorTraces(document, plan);
    expect(document).toEqual(before);
  });

  it.each([1e-16, 1e-12])('locates a stop inside a tiny trailing arc after a one-millimeter line, sweep=%s', sweep => {
    const document = createUpidFromDxfEntities([
      line({ x: 0, y: 0 }, { x: 1, y: 0 }),
      arc({ x: 0, y: 0 }, 1, { x: 1, y: 0 }, { x: 1, y: sweep }, 0, sweep)
    ], { startPoint: { x: 0, y: 0 }, coincidenceEpsilon: 0, endpointTolerance: 0,
      operationOrderStrategy: 'source-order' });
    reviewCenterline(document);
    document.setup = { initialWirePosition: { kind: 'manual', point: { x: 0, y: 0 }, review: 'reviewed' } };
    document.plan.operations[0].programStops = [stopAt('tail-half', sweep / 2)];
    const before = structuredClone(document);
    const plan = compiled(document);
    const motions = contourMotions(plan);
    expect(motions).toHaveLength(3);
    expect(motions[0]).toMatchObject({ sourceSegmentId: document.segments[0].id, sourceRange: { start: 0, end: 1 } });
    expect(motions[1]).toMatchObject({ sourceSegmentId: document.segments[1].id, sourceRange: { start: 0, end: 0.5 } });
    expect(motions[2]).toMatchObject({ sourceSegmentId: document.segments[1].id, sourceRange: { start: 0.5, end: 1 } });
    const stop = plan.events.find(event => event.kind === 'program-stop');
    if (!stop || stop.kind !== 'program-stop') throw new Error('Expected the trailing-arc stop');
    expect(stop.point).toEqual({ x: 1, y: sweep / 2 });
    expect(stop.trace).toEqual([{ kind: 'program-stop', operationId: document.plan.operations[0].id, stopId: 'tail-half' }]);
    expect(motions[1].end).toEqual(stop.point);
    expect(motions[2].start).toEqual(stop.point);
    const playback = simulated(document);
    const arcSteps = playback.steps.filter(step => step.event.kind === 'motion' && step.event.sourceSegmentId === document.segments[1].id);
    expect(arcSteps.map(step => step.lengthMm)).toEqual([sweep / 2, sweep / 2]);
    const hold = playback.steps.find(step => step.event.kind === 'program-stop');
    if (!hold) throw new Error('Expected an explicit playback hold');
    expect(sampleSimulation(playback, (hold.startSeconds + hold.endSeconds) / 2).wire.point).toEqual(stop.point);
    expectEditorTraces(document, plan);
    expect(document).toEqual(before);
  });

  it('posts a rounded contour and reversed circle with leads, ordered pauses and exact event ownership', async () => {
    let document = reviewedDocument([
      ...roundedEntities(), { type: 'circle', layer: 'CUT', center: { x: 30, y: 0 }, radius: 3 }
    ], { x: 2, y: 0 });
    const operationIds = document.plan.operations.map(operation => operation.id);
    for (const operationId of operationIds) {
      const configured = setManualCompensationIntent(document, operationId, 'outside');
      if (!configured) throw new Error('Expected closed contour compensation choice');
      document = configured;
    }
    document = reversePathOperation(document, operationIds[1]) ?? document;
    document.schemaVersion = 2;
    document.setup = { initialWirePosition: { kind: 'manual', point: { x: 0, y: 0 }, review: 'reviewed' },
      threadingDefault: { mode: 'manual', wireSeparation: 'automatic-during-positioning' } };
    document.plan.operations[0].transitions = {
      entry: { strategy: 'manual-straight', move: 'cut', from: { x: 0, y: 0 }, to: { x: 2, y: 0 }, review: 'reviewed' },
      exit: { strategy: 'manual-straight', move: 'cut', from: { x: 2, y: 0 }, to: { x: 2, y: -3 }, review: 'reviewed' }
    };
    document.plan.operations[0].programStops = [
      stopAt('corner', roundedLength - roundedStops[4].distance),
      { id: 'after-lead', enabled: true, reason: 'manual', placement: { kind: 'after-exit' } },
      stopAt('line-check', roundedLength - 4),
      { id: 'before-lead', enabled: true, reason: 'manual', placement: { kind: 'before-entry' } },
      { id: 'closed-contour', enabled: true, reason: 'part-retention', placement: { kind: 'after-contour' } }
    ];
    document.plan.operations[1].programStops = [stopAt('circle-half', 3 * Math.PI), stopAt('circle-quarter', 4.5 * Math.PI)];
    const before = structuredClone(document);
    const plan = compiled(document);
    const stops = plan.events.filter(event => event.kind === 'program-stop');
    expect(stops.map(stop => stop.stopId)).toEqual([
      'before-lead', 'line-check', 'corner', 'closed-contour', 'after-lead', 'circle-quarter', 'circle-half'
    ]);
    nearPoint(stops[0].point, { x: 0, y: 0 });
    nearPoint(stops[1].point, { x: 6, y: 0 });
    nearPoint(stops[2].point, { x: 18 + Math.SQRT2, y: 2 - Math.SQRT2 });
    nearPoint(stops[3].point, { x: 2, y: 0 });
    nearPoint(stops[4].point, { x: 2, y: -3 });
    nearPoint(stops[5].point, { x: 30, y: -3 });
    nearPoint(stops[6].point, { x: 27, y: 0 });
    expect(plan.events.filter(event => event.operationId === operationIds[1] &&
      ['wire-separate', 'position', 'wire-thread'].includes(event.kind)).map(event => event.kind)).toEqual(['position', 'wire-thread']);
    const playback = simulated(document);
    const cutLength = playback.steps.reduce((total, step) => total + (step.event.kind === 'motion' ? step.lengthMm : 0), 0);
    expect(cutLength).toBeCloseTo(roundedLength + 6 * Math.PI + 5, 10);
    const positioning = playback.steps.find(step => step.event.kind === 'position');
    if (!positioning) throw new Error('Expected positioning between contours');
    expect(positioning.lengthMm).toBeCloseTo(Math.sqrt(970), 12);
    expect(sampleSimulation(playback, (positioning.startSeconds + positioning.endSeconds) / 2).wire.threaded).toBe(false);
    for (const step of playback.steps) {
      if (step.event.kind !== 'program-stop') continue;
      const snapshot = sampleSimulation(playback, (step.startSeconds + step.endSeconds) / 2);
      nearPoint(snapshot.wire.point, step.event.point);
      expect(snapshot.phase).toBe('paused');
    }
    const parsed = parseWireEdmPostPackage(JSON.stringify(robofilPackageJson));
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics));
    const installed = await installPostPackage(createEmptyPostLibrary(), parsed.package);
    if (!installed.ok) throw new Error(installed.error.message);
    const result = await runPost(plan, { installation: installed.installation, properties: { coordinatePrecision: 3, offsetIndex: 0 } });
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    const program = result.program;
    expect(auditControllerProgram(plan, program, new Set(Object.keys(installed.installation.package.dialect.commands)))).toEqual([]);
    expect(program.lines).toEqual(expect.arrayContaining([
      'G1 X2.000 Y0.000', 'G1 X2.000 Y-3.000', 'G2 X30.000 Y-3.000 I30.000 J0.000',
      'G2 X27.000 Y0.000 I30.000 J0.000', 'G3 X19.414 Y0.586 I18.000 J2.000'
    ]));
    for (const stop of stops) {
      expect(program.blocks.filter(block => block.eventId === stop.id)).toEqual([
        expect.objectContaining({ text: 'M00', motion: null, commandIds: ['operator.program-stop'] })
      ]);
    }
    const stopIds = new Set(stops.map(stop => stop.id));
    expect(program.blocks.filter(block => stopIds.has(block.eventId)).map(block => block.eventId)).toEqual(stops.map(stop => stop.id));
    for (const event of plan.events) {
      expect(program.eventDispositions.filter(disposition => disposition.eventId === event.id)).toHaveLength(1);
    }
    const circleBlock = program.blocks.find(block => block.text === 'G2 X30.000 Y-3.000 I30.000 J0.000');
    if (!circleBlock?.motion) throw new Error('Expected the reversed-circle controller block');
    const changedDirection = { ...circleBlock, motion: { ...circleBlock.motion, clockwise: false } };
    const alteredProgram = { ...program, blocks: program.blocks.map(block => block.id === circleBlock.id ? changedDirection : block) };
    expect(auditControllerProgram(plan, alteredProgram, new Set(Object.keys(installed.installation.package.dialect.commands)))).toEqual([
      expect.objectContaining({ code: 'POST_AUDIT_MOTION_MISMATCH', eventId: circleBlock.eventId })
    ]);
    const output = serializeControllerOutput(program, installed.installation.package.manifest.output);
    if (!output.ok) throw new Error(output.error.message);
    expect(output.text.startsWith('%\r\nN10 G92 X0.000 Y0.000\r\n')).toBe(true);
    expect(output.text.endsWith(' M02\r\n')).toBe(true);
    expect(new TextDecoder().decode(output.bytes)).toBe(output.text);
    expect(output.bytes.every(byte => byte < 128)).toBe(true);
    expectEditorTraces(document, plan);
    expect(document).toEqual(before);
  });
});
