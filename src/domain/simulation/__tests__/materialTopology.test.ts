import { describe, expect, it } from 'vitest';
import type { DxfEntity } from '@/domain/dxf/types';
import { createUpidFromDxfEntities } from '@/domain/upid/upidDocument';
import { compileSimulation, sampleSimulation } from '../simulation';
import type { SimulationSettings } from '../types';

function polygon(points: readonly (readonly [number, number])[]): DxfEntity {
  return { type: 'lwpolyline', layer: 'CUT', closed: true, vertices: points.map(([x, y]) => ({ x, y, bulge: 0 })) };
}

function compile(entities: DxfEntity[], stock: SimulationSettings['stock'] = { originX: -20, originY: -20, width: 40, depth: 40, thickness: 10, bottomZ: 0 }) {
  const source = createUpidFromDxfEntities(entities, { operationOrderStrategy: 'source-order' });
  source.geometryBasis = 'wire-centre';
  source.setup = { initialWirePosition: { kind: 'manual', point: { ...source.plan.operations[0].startPoint }, review: 'reviewed' },
    threadingDefault: { mode: 'manual', wireSeparation: 'manual-before-positioning' } };
  for (const operation of source.plan.operations) operation.transitions = {
    entry: { strategy: 'none', review: 'reviewed' }, exit: { strategy: 'none', review: 'reviewed' }
  };
  return compileSimulation(source, { stock,
    wireDiameter: 0.25, cutSpeedMmPerSecond: 10, rapidSpeedMmPerSecond: 20, retention: 'retain' });
}
function simulate(entities: DxfEntity[]) {
  const result = compile(entities);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result.plan;
}

describe('simulation material topology', () => {
  it('does not feed intersecting holes and overlapping slugs to the renderer', () => {
    const result = compile([
      { type: 'circle', layer: 'CUT', center: { x: -2, y: 0 }, radius: 5 },
      { type: 'circle', layer: 'CUT', center: { x: 2, y: 0 }, radius: 5 }
    ]);
    expect(result).toMatchObject({ ok: false, diagnostics: [{ code: 'EXECUTION_PLAN_INVALID_UPID' }] });
  });

  it('rejects a self-crossing closed contour instead of extruding overlapping triangles', () => {
    expect(compile([polygon([[-5, -5], [5, 5], [-5, 5], [5, -2]])])).toMatchObject({
      ok: false, diagnostics: [{ code: 'EXECUTION_PLAN_INVALID_UPID' }]
    });
  });

  it('rejects holes that touch each other or the stock edge', () => {
    const touching = compile([
      { type: 'circle', layer: 'CUT', center: { x: -5, y: 0 }, radius: 5 },
      { type: 'circle', layer: 'CUT', center: { x: 5, y: 0 }, radius: 5 }
    ]);
    expect(touching.ok).toBe(false);
    const stockEdge = simulate([polygon([[-20, -5], [-10, -5], [-10, 5], [-20, 5]])]);
    expect(stockEdge.pieces).toHaveLength(0);
    expect(stockEdge.diagnostics.some(item => item.code === 'SIMULATION_MATERIAL_TOPOLOGY_UNSUPPORTED')).toBe(true);
  });

  it('does not extrude intersecting chord approximations of valid closely nested arcs', () => {
    const arcs: DxfEntity[] = [[999.9, 1], [1000, 0]].map(([radius, degrees]) => {
      const angle = degrees * Math.PI / 180;
      const point = { x: radius * Math.cos(angle), y: radius * Math.sin(angle) };
      return { type: 'arc', layer: 'CUT', center: { x: 0, y: 0 }, radius, start: point, end: point,
        startAngle: degrees, endAngle: degrees + 360, sweepRadians: Math.PI * 2, clockwise: false };
    });
    const result = compile(arcs, { originX: -1100, originY: -1100, width: 2200, depth: 2200, thickness: 10, bottomZ: 0 });
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    expect(result.plan.diagnostics.some(item => item.code === 'SIMULATION_MATERIAL_TOPOLOGY_UNSUPPORTED')).toBe(true);
    expect(sampleSimulation(result.plan, result.plan.durationSeconds).stockHoles).toHaveLength(0);
  });

  it('checks exact arc extents when stock-edge contact falls between sampled vertices', () => {
    const angle = Math.PI / 180;
    const point = { x: 10 * Math.cos(angle), y: 10 * Math.sin(angle) };
    const result = compile([{ type: 'arc', layer: 'CUT', center: { x: 0, y: 0 }, radius: 10, start: point, end: point,
      startAngle: 1, endAngle: 361, sweepRadians: Math.PI * 2, clockwise: false }],
    { originX: -10, originY: -10, width: 20, depth: 20, thickness: 10, bottomZ: 0 });
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    expect(result.plan.pieces).toHaveLength(0);
    expect(result.plan.diagnostics.some(item => item.code === 'SIMULATION_MATERIAL_TOPOLOGY_UNSUPPORTED')).toBe(true);
  });
});
