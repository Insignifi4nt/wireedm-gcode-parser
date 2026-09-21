import type { PathPlanningDocument } from '@/domain/path-intel/types';
import type { SimulationSettings } from '@/domain/simulation';

export function defaultSimulationSettings(document: PathPlanningDocument): SimulationSettings {
  const bounds = document.segments.reduce((all, { bounds }) => ({ minX: Math.min(all.minX, bounds.minX), minY: Math.min(all.minY, bounds.minY),
    maxX: Math.max(all.maxX, bounds.maxX), maxY: Math.max(all.maxY, bounds.maxY) }), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
  const { minX, minY, maxX, maxY } = document.segments.length ? bounds : { minX: 0, minY: 0, maxX: 50, maxY: 50 };
  const margin = Math.max(5, Math.max(maxX - minX, maxY - minY) * 0.1);
  return {
    stock: { originX: minX - margin, originY: minY - margin, width: maxX - minX + margin * 2,
      depth: maxY - minY + margin * 2, thickness: 20, bottomZ: 0 },
    wireDiameter: 0.25, cutSpeedMmPerSecond: 5, rapidSpeedMmPerSecond: 25,
    retention: 'fall', wasteHandling: 'remove-before-next-operation', supportFloorZ: -20, guideClearanceMm: 20, eventHoldSeconds: 1
  };
}
