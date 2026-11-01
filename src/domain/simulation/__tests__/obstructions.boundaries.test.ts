import { describe, expect, it } from 'vitest';

import { createUpidFromDxfEntities } from '@/domain/upid/upidDocument';

import { compileSimulation } from '../simulation';
import type { SimulationPlan, SimulationSettings } from '../types';

const settings: SimulationSettings = {
  stock: { originX: -20, originY: -20, width: 60, depth: 60, thickness: 10, bottomZ: 0 },
  wireDiameter: 0.25,
  cutSpeedMmPerSecond: 10,
  rapidSpeedMmPerSecond: 20,
  eventHoldSeconds: 1,
  retention: 'fall',
  supportFloorZ: -30,
  guideRadiusMm: 2
};

/** One straight cut inside the rough stock, started where the wire is already threaded. */
function cutThroughStock(guideClearanceMm: number): SimulationPlan {
  const document = createUpidFromDxfEntities([{ type: 'line', layer: 'CUT', start: { x: 0, y: 0 }, end: { x: 10, y: 0 } }],
    { operationOrderStrategy: 'source-order' });
  document.geometryBasis = 'wire-centre';
  document.setup = {
    initialWirePosition: { kind: 'manual', point: { x: 0, y: 0 }, review: 'reviewed' },
    threadingDefault: { mode: 'manual', wireSeparation: 'manual-before-positioning' }
  };
  for (const operation of document.plan.operations) {
    operation.transitions = { entry: { strategy: 'none', review: 'reviewed' }, exit: { strategy: 'none', review: 'reviewed' } };
  }
  const result = compileSimulation(document, { ...settings, guideClearanceMm });
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result.plan;
}

const guideWarnings = (plan: SimulationPlan) => plan.warnings.filter(({ envelope }) => envelope === 'guide');

describe('obstruction clearance tolerance between guides and stock', () => {
  it('treats guides within the clearance tolerance of the stock faces as touching uncut stock', () => {
    const plan = cutThroughStock(4e-8);
    expect(guideWarnings(plan)).toContainEqual(expect.objectContaining({
      code: 'SIMULATION_UNCUT_STOCK_OBSTRUCTION', envelope: 'guide', pieceId: null
    }));
  });

  it('keeps guides beyond the clearance tolerance of the stock faces clear of uncut stock', () => {
    const plan = cutThroughStock(3e-7);
    expect(guideWarnings(plan)).toEqual([]);
  });
});
