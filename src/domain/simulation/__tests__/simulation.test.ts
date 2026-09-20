import { describe, expect, it } from 'vitest';

import type { DxfEntity } from '@/domain/dxf/types';
import { movePathOperation } from '@/domain/path-editor/pathDocumentOperations';
import { setMachiningSpanParticipation, setPartialContourEntryReview, setPartialContourExitReview } from '@/domain/path-intel/machiningParticipation';
import { createUpidFromDxfEntities } from '@/domain/upid/upidDocument';

import { compileSimulation, sampleSimulation } from '../index';
import type { SimulationPlan, SimulationSettings } from '../types';

const settings: SimulationSettings = {
  stock: { originX: -20, originY: -20, width: 60, depth: 60, thickness: 10, bottomZ: 0 },
  wireDiameter: 0.25,
  cutSpeedMmPerSecond: 10,
  rapidSpeedMmPerSecond: 20,
  eventHoldSeconds: 1,
  retention: 'fall',
  supportFloorZ: -30,
  guideClearanceMm: 20
};

function document(entities: DxfEntity[]) {
  const result = createUpidFromDxfEntities(entities, { operationOrderStrategy: 'source-order' });
  result.geometryBasis = 'wire-centre';
  result.setup = {
    initialWirePosition: { kind: 'manual', point: { ...result.plan.operations[0].startPoint }, review: 'reviewed' },
    threadingDefault: { mode: 'manual', wireSeparation: 'manual-before-positioning' }
  };
  for (const operation of result.plan.operations) {
    operation.transitions = { entry: { strategy: 'none', review: 'reviewed' }, exit: { strategy: 'none', review: 'reviewed' } };
  }
  return result;
}

function rectangle(x = 0, y = 0, width = 10, height = 10): DxfEntity[] {
  const points = [{ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }];
  return points.map((start, index) => ({ type: 'line', layer: 'CUT', start, end: points[(index + 1) % 4] }));
}

function compiled(source: ReturnType<typeof document>, overrides: Partial<SimulationSettings> = {}): SimulationPlan {
  const result = compileSimulation(source, { ...settings, ...overrides });
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result.plan;
}

describe('UPID simulation playback', () => {
  it('times exact linear motion at simulation speeds and seeks deterministically without changing UPID', () => {
    const source = document([{ type: 'line', layer: 'CUT', start: { x: 0, y: 0 }, end: { x: 10, y: 0 } }]);
    const original = structuredClone(source);
    const plan = compiled(source);
    expect(plan.machiningDurationSeconds).toBeCloseTo(1);
    const earlier = sampleSimulation(plan, 0.25);
    expect(earlier).toMatchObject({ phase: 'cutting', wire: { point: { x: 2.5, y: 0 }, cutting: true } });
    sampleSimulation(plan, plan.durationSeconds);
    expect(sampleSimulation(plan, 0.25)).toEqual(earlier);
    expect(sampleSimulation(plan, -10).elapsedSeconds).toBe(0);
    expect(sampleSimulation(plan, Infinity).phase).toBe('complete');
    expect(sampleSimulation(plan, NaN).elapsedSeconds).toBe(0);
    expect(source).toEqual(original);
    expect(plan.diagnostics.some(({ code }) => code === 'SIMULATION_ESTIMATE')).toBe(true);
  });

  it('owns its immutable render geometry without freezing the caller document or settings', () => {
    const source = document(rectangle());
    const plan = compiled(source);
    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.pieces[0].polygon[0])).toBe(true);
    expect(Object.isFrozen(source.segments[0].start)).toBe(false);
    expect(Object.isFrozen(settings.stock)).toBe(false);
    const oldX = plan.pieces[0].polygon[0].x;
    source.segments[0].start.x += 100;
    expect(plan.pieces[0].polygon[0].x).toBe(oldX);
  });

  it.each([false, true])('interpolates exact full circular motion, clockwise=%s', (clockwise) => {
    const source = document([{ type: 'arc', layer: 'CUT', center: { x: 0, y: 0 }, radius: 5,
      start: { x: 5, y: 0 }, end: { x: 5, y: 0 }, startAngle: 0,
      endAngle: clockwise ? -360 : 360, sweepRadians: (clockwise ? -1 : 1) * 2 * Math.PI, clockwise }]);
    const plan = compiled(source);
    const motion = plan.steps.find(({ event }) => event.kind === 'motion')!;
    expect(motion.lengthMm).toBeCloseTo(10 * Math.PI, 10);
    const halfway = sampleSimulation(plan, motion.startSeconds + (motion.endSeconds - motion.startSeconds) / 4);
    expect(halfway.wire.point.x).toBeCloseTo(0, 10);
    expect(halfway.wire.point.y).toBeCloseTo(clockwise ? -5 : 5, 10);
    expect(plan.pieces).toHaveLength(1);
  });

  it.each([false, true])('interpolates a partial arc without replacing it by its chord, clockwise=%s', (clockwise) => {
    const source = document([{ type: 'arc', layer: 'CUT', center: { x: 0, y: 0 }, radius: 5,
      start: { x: 5, y: 0 }, end: { x: -5, y: 0 }, startAngle: 0,
      endAngle: clockwise ? -180 : 180, sweepRadians: (clockwise ? -1 : 1) * Math.PI, clockwise }]);
    const plan = compiled(source);
    const motion = plan.steps.find(({ event }) => event.kind === 'motion')!;
    expect(motion.lengthMm).toBeCloseTo(5 * Math.PI, 10);
    const point = sampleSimulation(plan, (motion.startSeconds + motion.endSeconds) / 2).wire.point;
    expect(point.x).toBeCloseTo(0, 10);
    expect(point.y).toBeCloseTo(clockwise ? -5 : 5, 10);
    expect(plan.pieces).toHaveLength(0);
  });

  it('releases one circle only after all motion fragments around its program stops are traversed', () => {
    const source = document([{ type: 'circle', layer: 'CUT', center: { x: 0, y: 0 }, radius: 5 }]);
    source.plan.operations[0].programStops = [
      { id: 'quarter', enabled: true, reason: 'operator-check', placement: { kind: 'before-operation-end', remainingCutLengthMm: 7.5 * Math.PI } },
      { id: 'half', enabled: true, reason: 'part-retention', placement: { kind: 'before-operation-end', remainingCutLengthMm: 5 * Math.PI } }
    ];
    const plan = compiled(source);
    expect(plan.pieces).toHaveLength(1);
    const lastMotion = plan.steps.filter(({ event }) => event.kind === 'motion').at(-1)!;
    expect(plan.pieces[0].releaseSeconds).toBe(lastMotion.endSeconds);
    for (const stop of plan.steps.filter(({ event }) => event.kind === 'program-stop')) {
      expect(sampleSimulation(plan, stop.startSeconds + 0.5).pieces).toHaveLength(0);
    }
  });

  it('shows explicit stops and separated/rethreading travel without adding manufacturing decisions', () => {
    const source = document([...rectangle(), ...rectangle(20)]);
    source.plan.operations[0].programStops = [{ id: 'check', enabled: true, reason: 'operator-check',
      placement: { kind: 'before-operation-end', remainingCutLengthMm: 5 } }];
    const plan = compiled(source);
    const stop = plan.steps.find(({ event }) => event.kind === 'program-stop')!;
    expect(sampleSimulation(plan, stop.startSeconds + 0.5).phase).toBe('paused');
    const position = plan.steps.find(({ event }) => event.kind === 'position')!;
    expect(sampleSimulation(plan, (position.startSeconds + position.endSeconds) / 2))
      .toMatchObject({ phase: 'positioning', wire: { threaded: false } });
    const thread = plan.steps.find(({ event }) => event.kind === 'wire-thread')!;
    expect(sampleSimulation(plan, thread.startSeconds + 0.5))
      .toMatchObject({ phase: 'rethreading', wire: { threaded: false } });
    const laterMotion = plan.steps.find(({ event, startSeconds }) => event.kind === 'motion' && startSeconds >= thread.endSeconds)!;
    expect(sampleSimulation(plan, laterMotion.startSeconds + 0.01).wire.threaded).toBe(true);
  });

  it('honors an already-separated threading precondition with no wire-separate event', () => {
    const source = document([...rectangle(), ...rectangle(20)]);
    source.setup!.threadingDefault = { mode: 'manual', wireSeparation: 'already-separated' };
    const plan = compiled(source);
    expect(plan.steps.some(({ event }) => event.kind === 'wire-separate')).toBe(false);
    const position = plan.steps.find(({ event }) => event.kind === 'position')!;
    expect(sampleSimulation(plan, (position.startSeconds + position.endSeconds) / 2).wire.threaded).toBe(false);
  });

  it('rejects invalid settings and unresolved UPID instead of inventing setup intent', () => {
    const source = document(rectangle());
    expect(compileSimulation(source, { ...settings, cutSpeedMmPerSecond: 0 })).toMatchObject({ ok: false });
    expect(compileSimulation(source, { ...settings, supportFloorZ: 1 })).toMatchObject({ ok: false });
    delete source.setup;
    expect(compileSimulation(source, settings)).toMatchObject({ ok: false,
      diagnostics: [expect.objectContaining({ code: 'EXECUTION_PLAN_INITIAL_WIRE_REQUIRED' })] });
  });
});

describe('released material', () => {
  it('releases only after the final contour span and falls deterministically onto a support floor', () => {
    const plan = compiled(document(rectangle()));
    expect(plan.pieces).toHaveLength(1);
    const release = plan.pieces[0].releaseSeconds;
    expect(release).toBeCloseTo(4);
    expect(sampleSimulation(plan, release - 0.001).pieces).toHaveLength(0);
    const falling = sampleSimulation(plan, release + 0.01).pieces[0];
    expect(falling.bottomZ).toBeCloseTo(-0.4905);
    expect(falling.state).toBe('falling');
    const landed = sampleSimulation(plan, plan.durationSeconds).pieces[0];
    expect(landed).toMatchObject({ bottomZ: -30, topZ: -20, state: 'supported' });
    expect(sampleSimulation(plan, release + 0.01).pieces[0]).toEqual(falling);
  });

  it('retains completed pieces only when the scenario explicitly assumes support', () => {
    const plan = compiled(document(rectangle()), { retention: 'retain' });
    expect(sampleSimulation(plan, plan.durationSeconds).pieces[0]).toMatchObject({ bottomZ: 0, state: 'retained' });
  });

  it('does not release open or incompletely traversed closed contours', () => {
    const open = document([{ type: 'line', layer: 'CUT', start: { x: 0, y: 0 }, end: { x: 10, y: 0 } }]);
    expect(compiled(open).pieces).toHaveLength(0);
    const closed = document(rectangle());
    const partial = setMachiningSpanParticipation(closed, { sourceSegmentId: closed.segments.at(-1)!.id,
      range: { start: 0.5, end: 1 }, participation: 'inactive-reference' });
    if (!partial) throw new Error('Expected partial contour');
    const entryReviewed = setPartialContourEntryReview(partial, closed.plan.operations[0].id, true);
    if (!entryReviewed) throw new Error('Expected entry review');
    const reviewed = setPartialContourExitReview(entryReviewed, closed.plan.operations[0].id, true);
    if (!reviewed) throw new Error('Expected exit review');
    expect(compiled(reviewed).pieces).toHaveLength(0);
  });

  it('keeps inner slugs as separate pieces and removes their holes from subsequently released outer material', () => {
    const plan = compiled(document([...rectangle(3, 3, 4, 4), ...rectangle(0, 0, 10, 10)]));
    expect(plan.pieces).toHaveLength(2);
    const inner = plan.pieces.find(({ parentPieceId }) => parentPieceId !== null)!;
    const outer = plan.pieces.find(({ parentPieceId }) => parentPieceId === null)!;
    expect(inner.parentPieceId).toBe(outer.id);
    const between = sampleSimulation(plan, (inner.releaseSeconds + outer.releaseSeconds) / 2);
    expect(between.pieces).toHaveLength(1);
    expect(between.stockHoles).toEqual([inner.polygon]);
    const end = sampleSimulation(plan, plan.durationSeconds);
    expect(end.stockHoles).toEqual([outer.polygon]);
    expect(end.pieces.find(({ id }) => id === outer.id)!.holes).toEqual([inner.polygon]);
    expect(end.pieces.find(({ id }) => id === inner.id)!.holes).toEqual([]);
  });

  it('partitions three levels of nested releases without duplicating material', () => {
    const plan = compiled(document([...rectangle(4, 4, 2, 2), ...rectangle(2, 2, 6, 6), ...rectangle(0, 0, 10, 10)]), { retention: 'retain' });
    const [inner, middle, outer] = plan.pieces;
    expect(inner.parentPieceId).toBe(middle.id);
    expect(middle.parentPieceId).toBe(outer.id);
    const end = sampleSimulation(plan, plan.durationSeconds);
    expect(end.stockHoles).toEqual([outer.polygon]);
    expect(end.pieces.find(({ id }) => id === outer.id)!.holes).toEqual([middle.polygon]);
    expect(end.pieces.find(({ id }) => id === middle.id)!.holes).toEqual([inner.polygon]);
    expect(end.pieces.find(({ id }) => id === inner.id)!.holes).toEqual([]);
  });

  it('does not release a later inner contour after its enclosing material has fallen below the wire', () => {
    const original = document([...rectangle(0, 0, 10, 10), ...rectangle(3, 3, 4, 4)]);
    const source = movePathOperation(original, original.plan.operations.find(({ metrics }) => metrics.cutLength > 30)!.id, -1);
    if (!source) throw new Error('Expected outer contour order override');
    source.setup!.initialWirePosition = { kind: 'manual', point: { ...source.plan.operations[0].startPoint }, review: 'reviewed' };
    const plan = compiled(source, { supportFloorZ: -50 });
    expect(plan.pieces).toHaveLength(1);
    expect(plan.diagnostics).toContainEqual(expect.objectContaining({ code: 'SIMULATION_CUT_BELOW_WIRE' }));
    expect(sampleSimulation(plan, plan.durationSeconds).pieces[0].holes).toHaveLength(0);
  });

  it('does not manufacture a released piece for a boundary extending outside the rough stock', () => {
    const plan = compiled(document(rectangle()), { stock: { ...settings.stock, width: 22 } });
    expect(plan.pieces).toHaveLength(0);
    expect(plan.diagnostics.some(({ code }) => code === 'SIMULATION_BOUNDARY_OUTSIDE_STOCK')).toBe(true);
  });
});

describe('approximate stock and released-piece obstructions', () => {
  it('warns when the initially threaded wire positions through uncut rough stock', () => {
    const source = document(rectangle());
    source.setup!.initialWirePosition = { kind: 'manual', point: { x: -10, y: 5 }, review: 'reviewed' };
    const plan = compiled(source);
    const warning = plan.warnings.find(({ code }) => code === 'SIMULATION_UNCUT_STOCK_OBSTRUCTION');
    expect(warning).toMatchObject({ envelope: 'wire', operationId: source.plan.operations[0].id, pieceId: null });
    expect(sampleSimulation(plan, 0).warnings).toHaveLength(0);
    expect(sampleSimulation(plan, plan.durationSeconds).warnings).toContainEqual(warning);
  });

  it('does not report wire obstruction during explicitly separated repositioning', () => {
    const source = document([...rectangle(), ...rectangle(20)]);
    const plan = compiled(source, { retention: 'retain' });
    expect(plan.warnings.filter(({ envelope }) => envelope === 'wire')).toEqual([]);
  });

  it('detects a narrow stock crossing between regular travel samples', () => {
    const source = document([{ type: 'line', layer: 'CUT', start: { x: 10, y: 0 }, end: { x: 20, y: 0 } }]);
    source.setup!.initialWirePosition = { kind: 'manual', point: { x: 0, y: 0 }, review: 'reviewed' };
    const plan = compiled(source, { wireDiameter: 0.001, stock: { ...settings.stock, originX: 3.137, originY: -1, width: 0.01, depth: 2 } });
    const warning = plan.warnings.find(({ code }) => code === 'SIMULATION_UNCUT_STOCK_OBSTRUCTION');
    expect(warning).toBeDefined();
    expect(warning!.point.x).toBeGreaterThanOrEqual(3.137 - 1e-8);
    expect(warning!.point.x).toBeLessThanOrEqual(3.147 + 1e-8);
  });

  it('detects travel into an internal released slug that is still within the vertical wire envelope', () => {
    const source = document(rectangle());
    source.plan.operations[0].transitions!.exit = {
      strategy: 'manual-straight', move: 'cut', review: 'reviewed',
      from: { ...source.plan.operations[0].endPoint }, to: { x: 5, y: 5 }
    };
    const plan = compiled(source, { supportFloorZ: -5 });
    expect(plan.warnings).toContainEqual(expect.objectContaining({ code: 'SIMULATION_RELEASED_PIECE_OBSTRUCTION',
      pieceId: plan.pieces[0].id, envelope: 'wire' }));
    expect(sampleSimulation(plan, plan.pieces[0].releaseSeconds - 0.001).warnings).toEqual([]);
  });

  it('allows travel through the vacated opening once the slug is below both wire and guides', () => {
    const source = document(rectangle());
    source.plan.operations[0].programStops = [{ id: 'settle', enabled: true, reason: 'operator-check', placement: { kind: 'after-contour' } }];
    source.plan.operations[0].transitions!.exit = {
      strategy: 'manual-straight', move: 'cut', review: 'reviewed',
      from: { ...source.plan.operations[0].endPoint }, to: { x: 5, y: 5 }
    };
    const plan = compiled(source, { supportFloorZ: -50 });
    const exit = plan.steps.find(({ event }) => event.kind === 'motion' && event.role === 'exit')!;
    expect(plan.warnings.filter(({ eventId }) => eventId === exit.event.id)).toEqual([]);
  });

  it('checks the guide envelope even when the wire is separated', () => {
    const source = document([...rectangle(), ...rectangle(20)]);
    const plan = compiled(source, { supportFloorZ: -25, guideClearanceMm: 20, guideRadiusMm: 2 });
    expect(plan.warnings).toContainEqual(expect.objectContaining({ code: 'SIMULATION_RELEASED_PIECE_OBSTRUCTION',
      pieceId: plan.pieces[0].id, envelope: 'guide' }));
  });
});
