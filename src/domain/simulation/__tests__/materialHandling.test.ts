import { describe, expect, it } from 'vitest';
import { setManualCompensationIntent } from '@/domain/compensation/intent';

import type { DxfEntity } from '@/domain/dxf/types';
import { movePathOperation, setPathOperationClassification } from '@/domain/path-editor/pathDocumentOperations';
import { setMachiningSpanParticipation, setPartialContourEntryReview, setPartialContourExitReview } from '@/domain/path-intel/machiningParticipation';
import { createUpidFromDxfEntities } from '@/domain/upid/upidDocument';
import { defaultSimulationSettings } from '@/features/simulation/simulationDefaults';

import { compileSimulation, resolveSimulationSettings, sampleSimulation } from '../simulation';
import type { SimulationSettings } from '../types';

const settings: SimulationSettings = {
  stock: { originX: -10, originY: -10, width: 40, depth: 40, thickness: 10, bottomZ: 0 },
  wireDiameter: 0.25, cutSpeedMmPerSecond: 10, rapidSpeedMmPerSecond: 20,
  retention: 'retain', guideClearanceMm: 20
};

function square(x: number, y: number, width: number): DxfEntity {
  return { type: 'lwpolyline', layer: 'CUT', closed: true,
    vertices: [[x, y], [x + width, y], [x + width, y + width], [x, y + width]]
      .map(([x, y]) => ({ x, y, bulge: 0 })) };
}

function document(entities: DxfEntity[]) {
  const source = createUpidFromDxfEntities(entities, { operationOrderStrategy: 'source-order' });
  source.geometryBasis = 'wire-centre';
  source.setup = { initialWirePosition: { kind: 'manual', point: { ...source.plan.operations[0].startPoint }, review: 'reviewed' },
    threadingDefault: { mode: 'manual', wireSeparation: 'manual-before-positioning' } };
  for (const operation of source.plan.operations) operation.transitions = {
    entry: { strategy: 'none', review: 'reviewed' }, exit: { strategy: 'none', review: 'reviewed' }
  };
  return source;
}

function compile(source: ReturnType<typeof document>, overrides: Partial<SimulationSettings> = {}) {
  const result = compileSimulation(source, { ...settings, ...overrides });
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result.plan;
}

describe('simulation material roles and waste handling', () => {
  it.each(['retain', 'fall'] as const)('removes hole waste at the next operation, preserving its cut opening and reverse seeks (%s)', (retention) => {
    const source = document([square(3, 3, 4), square(0, 0, 10)]);
    source.plan.operations[0].programStops = [{ id: 'inspect-hole', enabled: true, reason: 'operator-check', placement: { kind: 'after-contour' } }];
    const original = structuredClone(source);
    const plan = compile(source, { retention });
    const waste = plan.pieces.find(piece => piece.operationId === source.plan.operations[0].id)!;
    const nextStart = plan.steps.find(step => step.event.kind === 'operation-start' && step.event.operationId === source.plan.operations[1].id)!;
    expect(waste).toMatchObject({ role: 'waste', removalSeconds: nextStart.startSeconds });
    expect(plan.settings.wasteHandling).toBe('remove-before-next-operation');
    const beforeRemoval = sampleSimulation(plan, waste.releaseSeconds + 0.01);
    expect(beforeRemoval.pieces).toContainEqual(expect.objectContaining({ id: waste.id, role: 'waste' }));
    const removed = sampleSimulation(plan, waste.removalSeconds!);
    expect(removed.pieces.some(piece => piece.id === waste.id)).toBe(false);
    expect(removed.removedPieceIds).toEqual([waste.id]);
    expect(removed.stockHoles).toEqual([waste.polygon]);
    expect(sampleSimulation(plan, waste.releaseSeconds + 0.01)).toEqual(beforeRemoval);
    expect(sampleSimulation(plan, Infinity).pieces).toContainEqual(expect.objectContaining({ role: 'part' }));
    expect(plan.diagnostics).toContainEqual(expect.objectContaining({ code: 'SIMULATION_WASTE_HANDLING' }));
    expect(source).toEqual(original);
  });

  it('keeps waste as an obstruction only when requested, including later motion through its opening', () => {
    const source = document([square(0, 0, 10),
      { type: 'line', layer: 'CUT', start: { x: 2, y: 5 }, end: { x: 8, y: 5 } }]);
    const hole = setPathOperationClassification(source, source.plan.operations[0].id, 'hole')!;
    const keep = compile(hole, { wasteHandling: 'keep' });
    const remove = compile(hole);
    const later = keep.steps.find(step => step.event.kind === 'motion' && step.event.operationId === source.plan.operations[1].id)!;
    expect(keep.warnings).toContainEqual(expect.objectContaining({ eventId: later.event.id, pieceId: keep.pieces[0].id }));
    expect(remove.warnings.filter(warning => warning.eventId === later.event.id && warning.pieceId !== null)).toEqual([]);
    expect(sampleSimulation(keep, Infinity).pieces).toContainEqual(expect.objectContaining({ role: 'waste' }));
    expect(sampleSimulation(remove, Infinity).pieces).toEqual([]);
  });

  it('waits for final waste to settle before removing it at program end, but never removes finished parts', () => {
    const source = document([square(0, 0, 10)]);
    const hole = setPathOperationClassification(source, source.plan.operations[0].id, 'hole')!;
    const plan = compile(hole, { retention: 'fall' });
    const waste = plan.pieces[0];
    expect(waste.removalSeconds).toBe(plan.durationSeconds);
    expect(waste.removalSeconds).toBeGreaterThan(plan.machiningDurationSeconds);
    expect(sampleSimulation(plan, waste.releaseSeconds + 0.01).pieces[0].state).toBe('falling');
    expect(sampleSimulation(plan, plan.durationSeconds - 0.001).pieces[0].state).toBe('supported');
    expect(sampleSimulation(plan, Infinity)).toMatchObject({ pieces: [], removedPieceIds: [waste.id] });
    const part = compile(source, { retention: 'fall' });
    expect(part.pieces[0]).toMatchObject({ role: 'part', removalSeconds: null });
    expect(sampleSimulation(part, Infinity).pieces).toHaveLength(1);
  });

  it('preserves a separated island when its enclosing waste is removed and supplies final solids at stock elevation', () => {
    const source = document([square(4, 4, 2), square(2, 2, 6), square(0, 0, 10)]);
    const plan = compile(source, { retention: 'fall' });
    expect(plan.pieces.map(piece => piece.role)).toEqual(['part', 'waste', 'part']);
    const end = sampleSimulation(plan, Infinity);
    expect(end.pieces.map(piece => piece.role)).toEqual(['part', 'part']);
    expect(end.pieces.find(piece => piece.id === plan.pieces[2].id)!.holes).toEqual([plan.pieces[1].polygon]);
    expect(plan.remainingStockRole).toBe('waste');
    expect(plan.finalMaterial.status).toBe('ready');
    expect(plan.finalMaterial.solids).toHaveLength(2);
    expect(plan.finalMaterial.solids.every(solid => solid.bottomZ === 0 && solid.topZ === 10)).toBe(true);
  });

  it('does not release a later island from an enclosing slug already removed from the stock', () => {
    const original = document([square(2, 2, 6), square(4, 4, 2), square(0, 0, 10)]);
    const source = movePathOperation(original, original.plan.operations.find(operation => operation.classification === 'hole')!.id, -1)!;
    source.setup!.initialWirePosition = { kind: 'manual', point: { ...source.plan.operations[0].startPoint }, review: 'reviewed' };
    const plan = compile(source);
    expect(plan.pieces.map(piece => piece.operationId)).not.toContain(source.plan.operations[1].id);
    expect(plan.diagnostics).toContainEqual(expect.objectContaining({ code: 'SIMULATION_CUT_AFTER_MATERIAL_REMOVAL', operationId: source.plan.operations[1].id }));
    expect(plan.finalMaterial.status).toBe('partial');
    const kept = compile(source, { wasteHandling: 'keep' });
    expect(kept.pieces.map(piece => piece.role)).toEqual(['waste', 'part', 'part']);
  });

  it('can cut a retained island after surrounding waste is removed because that island was already separated', () => {
    let source = document([square(8, 8, 4), square(6, 6, 8), square(3, 3, 14), square(0, 0, 20)]);
    const innerHoleId = source.plan.operations[0].id;
    source = movePathOperation(source, innerHoleId, 1)!;
    source = movePathOperation(source, innerHoleId, 1)!;
    source.setup!.initialWirePosition = { kind: 'manual', point: { ...source.plan.operations[0].startPoint }, review: 'reviewed' };
    const plan = compile(source);
    expect(plan.pieces.map(piece => piece.role)).toEqual(['part', 'waste', 'waste', 'part']);
    expect(plan.diagnostics.some(diagnostic => diagnostic.code === 'SIMULATION_CUT_AFTER_MATERIAL_REMOVAL')).toBe(false);
    expect(plan.finalMaterial.status).toBe('ready');
    expect(plan.finalMaterial.solids).toHaveLength(2);
    expect(plan.finalMaterial.solids.every(solid => solid.holes.length === 1)).toBe(true);
  });

  it('keeps four levels of concentric material partitioned after both hole wastes are removed', () => {
    const source = document([2, 5, 10, 20].map(radius => ({ type: 'circle', layer: 'CUT', center: { x: 0, y: 0 }, radius })));
    const plan = compile(source, { stock: { ...settings.stock, originX: -25, originY: -25, width: 50, depth: 50 } });
    expect(plan.pieces.map(piece => piece.role)).toEqual(['waste', 'part', 'waste', 'part']);
    expect(sampleSimulation(plan, Infinity).pieces.map(piece => piece.role)).toEqual(['part', 'part']);
    expect(plan.finalMaterial).toMatchObject({ status: 'ready', solids: [
      { polygon: plan.pieces[1].polygon, holes: [plan.pieces[0].polygon] },
      { polygon: plan.pieces[3].polygon, holes: [plan.pieces[2].polygon] }
    ] });
  });

  it('consumes waste removal at an exact next-operation boundary even when event holds are zero', () => {
    const source = document([square(3, 3, 4), square(0, 0, 10)]);
    const plan = compile(source, { eventHoldSeconds: 0 });
    const waste = plan.pieces[0];
    expect(waste.removalSeconds).toBe(waste.releaseSeconds);
    expect(sampleSimulation(plan, waste.releaseSeconds - 1e-8).removedPieceIds).toEqual([]);
    expect(sampleSimulation(plan, waste.releaseSeconds).removedPieceIds).toEqual([waste.id]);
    expect(sampleSimulation(plan, waste.releaseSeconds).stockHoles).toEqual([waste.polygon]);
  });

  it('shows a hole-only remaining plate and follows saved keep-outside intent even on an exterior classification', () => {
    const source = document([square(0, 0, 10)]);
    const overridden = setManualCompensationIntent(source, source.plan.operations[0].id, 'outside')!;
    const plan = compile(overridden);
    expect(plan.pieces[0].role).toBe('waste');
    expect(plan.remainingStockRole).toBe('part');
    expect(plan.finalMaterial).toMatchObject({ status: 'ready', solids: [{ kind: 'remaining-stock', holes: [plan.pieces[0].polygon] }] });
    expect(plan.diagnostics).toContainEqual(expect.objectContaining({ code: 'SIMULATION_MATERIAL_ROLE_OVERRIDE' }));
  });

  it('does not mistake a completed inner hole for a hole-only plate when the exterior is only partly cut', () => {
    const source = document([square(3, 3, 4), square(0, 0, 10)]);
    const outer = source.plan.operations[1];
    const partial = setMachiningSpanParticipation(source, { sourceSegmentId: outer.segmentRefs.at(-1)!.segmentId,
      range: { start: 0.5, end: 1 }, participation: 'inactive-reference' })!;
    const reviewed = setPartialContourExitReview(setPartialContourEntryReview(partial, outer.id, true)!, outer.id, true)!;
    const plan = compile(reviewed);
    expect(plan.pieces).toHaveLength(1);
    expect(plan.remainingStockRole).toBe('waste');
    expect(plan.finalMaterial).toMatchObject({ status: 'unavailable', solids: [] });
  });

  it('does not guess a residual stock role when disjoint saved outer boundaries disagree about retaining it', () => {
    const source = document([square(0, 0, 5), square(10, 0, 5)]);
    const mixed = setManualCompensationIntent(source, source.plan.operations[0].id, 'outside')!;
    const plan = compile(mixed);
    expect(plan.remainingStockRole).toBe('unclassified');
    expect(plan.finalMaterial).toMatchObject({ status: 'partial', solids: [{ kind: 'piece', operationId: source.plan.operations[1].id }] });
    expect(plan.diagnostics).toContainEqual(expect.objectContaining({ code: 'SIMULATION_REMAINING_STOCK_ROLE_UNKNOWN' }));
  });

  it('keeps ambiguous closed material unclassified and excludes it from final-only geometry', () => {
    const source = document([square(0, 0, 10)]);
    const unknown = setPathOperationClassification(source, source.plan.operations[0].id, 'ambiguous')!;
    const plan = compile(unknown);
    expect(plan.pieces[0]).toMatchObject({ role: 'unclassified', removalSeconds: null });
    expect(plan.finalMaterial).toMatchObject({ status: 'unavailable', solids: [] });
  });
});

describe('simulation support assumptions', () => {
  it('places the default support at the lower wire and preserves explicitly deeper or absent support with a diagnostic', () => {
    const source = document([square(0, 0, 10)]);
    const defaults = defaultSimulationSettings(source);
    expect(defaults.supportFloorZ).toBe(defaults.stock.bottomZ - defaults.guideClearanceMm!);
    expect(resolveSimulationSettings({ ...settings, stock: { ...settings.stock, bottomZ: 15 }, guideClearanceMm: 7 })!.supportFloorZ).toBe(8);
    for (const supportFloorZ of [-40, null]) {
      const plan = compile(source, { supportFloorZ });
      expect(plan.settings.supportFloorZ).toBe(supportFloorZ);
      expect(plan.diagnostics).toContainEqual(expect.objectContaining({ code: 'SIMULATION_SUPPORT_BELOW_WIRE' }));
    }
  });
});
