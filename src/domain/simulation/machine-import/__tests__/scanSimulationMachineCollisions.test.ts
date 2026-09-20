import { describe, expect, it } from 'vitest';
import type { DxfEntity } from '@/domain/dxf/types';
import { createUpidFromDxfEntities } from '@/domain/upid/upidDocument';
import { compileSimulation } from '../../simulation';
import type { SimulationPlan } from '../../types';
import { createMachineCollisionIndex } from '../machineCollision';
import { scanSimulationMachineCollisions } from '../scanSimulationMachineCollisions';
import { triangleModel } from './machineTestModel';

function planFor(entity: DxfEntity = { type: 'line', layer: 'CUT', start: { x: 0, y: 0 }, end: { x: 10, y: 0 } }): SimulationPlan {
  const document = createUpidFromDxfEntities([entity]);
  document.geometryBasis = 'wire-centre';
  document.setup = { initialWirePosition: { kind: 'manual', point: { ...document.plan.operations[0].startPoint }, review: 'reviewed' },
    threadingDefault: { mode: 'manual', wireSeparation: 'manual-before-positioning' } };
  for (const operation of document.plan.operations) operation.transitions = {
    entry: { strategy: 'none', review: 'reviewed' }, exit: { strategy: 'none', review: 'reviewed' }
  };
  const compiled = compileSimulation(document, { stock: { originX: -20, originY: -20, width: 40, depth: 40, thickness: 10, bottomZ: 0 },
    wireDiameter: 0.25, cutSpeedMmPerSecond: 10, rapidSpeedMmPerSecond: 20, guideClearanceMm: 2 });
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));
  return compiled.plan;
}

describe('execution plan against imported machine surfaces', () => {
  it('links a between-sample intersection to its execution event and viewing time', async () => {
    const plan = planFor();
    const scan = await scanSimulationMachineCollisions(plan, createMachineCollisionIndex(triangleModel()));
    expect(scan.complete).toBe(true);
    expect(scan.warnings).toHaveLength(1);
    expect(scan.warnings[0]).toMatchObject({ code: 'SIMULATION_MACHINE_SURFACE_INTERSECTION', elapsedSeconds: 0.5,
      eventId: plan.steps.find((step) => step.event.kind === 'motion')!.event.id, approximate: false });
    expect(scan.limitations.join(' ')).toContain('does not verify wire, guide or machine clearance');
  });

  it('does not report wire collisions for travel with separated wire', async () => {
    const plan = planFor();
    const separated = { ...plan, steps: plan.steps.map((step) => ({ ...step, wireThreaded: false })) };
    const scan = await scanSimulationMachineCollisions(separated, createMachineCollisionIndex(triangleModel()));
    expect(scan.warnings).toHaveLength(0);
    expect(scan.complete).toBe(true);
    expect(scan.checkedSweeps).toBe(0);
  });

  it('reports an incomplete scan when its total work budget is reached', async () => {
    const scan = await scanSimulationMachineCollisions(planFor(), createMachineCollisionIndex(triangleModel()), { maxSweeps: 1 });
    expect(scan.complete).toBe(false);
    expect(scan.message).toContain('remaining motion was not checked');
    expect(scan.warnings).toHaveLength(0);
  });

  it('conservatively includes a surface between an arc and its chord, labelling approximate time and position', async () => {
    const plan = planFor({ type: 'circle', layer: 'CUT', center: { x: 0, y: 0 }, radius: 10 });
    const angle = Math.PI / 180;
    const x = 10 * Math.cos(angle), y = 10 * Math.sin(angle);
    const obstacle = triangleModel([[x, y - 0.00001, 0], [x, y + 0.00001, 0], [x, y, 10]]);
    const scan = await scanSimulationMachineCollisions(plan, createMachineCollisionIndex(obstacle));
    expect(scan.complete).toBe(true);
    expect(scan.warnings.some((warning) => warning.code === 'SIMULATION_MACHINE_CURVE_ENVELOPE')).toBe(true);
    expect(scan.limitations.join(' ')).toContain('maximum circular sagitta');
  });

  it('allows cancellation between batches and never presents a partial scan as complete', async () => {
    const controller = new AbortController();
    const plan = planFor({ type: 'circle', layer: 'CUT', center: { x: 0, y: 0 }, radius: 10 });
    const index = createMachineCollisionIndex(triangleModel([[1000, 0, 0], [1000, 1, 0], [1000, 0, 10]]));
    const promise = scanSimulationMachineCollisions(plan, index, { signal: controller.signal });
    setTimeout(() => controller.abort(), 0);
    const scan = await promise;
    expect(scan.cancelled).toBe(true);
    expect(scan.complete).toBe(false);
    expect(scan.checkedSweeps).toBeLessThan(180);
  });
});
