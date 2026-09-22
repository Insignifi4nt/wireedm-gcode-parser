import { arcSweep } from '../geometry';
import type { SimulationPlan } from '../types';
import type { Point2 } from '@/domain/path-intel/types';
import type { Segment3 } from './triangleIntersection';
import { GEOMETRY_TOLERANCE_MM } from './triangleIntersection';
import {
  checkMachineWireCollision, checkMachineWireSweep, MACHINE_COLLISION_LIMITATION,
  type MachineCollisionIndex, type MachineSurfaceHit
} from './machineCollision';

export interface MachineSimulationWarning {
  readonly id: string;
  readonly code: 'SIMULATION_MACHINE_SURFACE_INTERSECTION' | 'SIMULATION_MACHINE_CURVE_ENVELOPE';
  readonly message: string;
  readonly eventId: string;
  readonly operationId: string | null;
  readonly elapsedSeconds: number;
  readonly meshId: string;
  readonly point: Point2;
  readonly approximate: boolean;
}
export interface MachineSimulationScan {
  readonly complete: boolean;
  readonly cancelled: boolean;
  readonly checkedSweeps: number;
  readonly testedTriangles: number;
  readonly warnings: readonly MachineSimulationWarning[];
  readonly message: string;
  readonly limitations: readonly string[];
}
export interface MachineSimulationScanOptions {
  readonly signal?: AbortSignal;
  readonly maxSweeps?: number;
  readonly maxTriangleTests?: number;
  readonly maxWarnings?: number;
}

/** Deterministic event-linked findings; cooperative yields allow a stale scan to be cancelled. */
export async function scanSimulationMachineCollisions(
  plan: SimulationPlan, index: MachineCollisionIndex, options: MachineSimulationScanOptions = {}
): Promise<MachineSimulationScan> {
  const limits = { sweeps: options.maxSweeps ?? 20_000, triangles: options.maxTriangleTests ?? 2_000_000, warnings: options.maxWarnings ?? 200 };
  const warnings: MachineSimulationWarning[] = [];
  const warningKeys = new Set<string>();
  let checkedSweeps = 0;
  let testedTriangles = 0;
  let complete = true;
  let curved = false;
  let message = 'No imported machine surface intersections found.';
  const bottomZ = plan.settings.stock.bottomZ - plan.settings.guideClearanceMm;
  const topZ = plan.settings.stock.bottomZ + plan.settings.stock.thickness + plan.settings.guideClearanceMm;
  const wire = (point: Point2): Segment3 => ({ start: [point.x, point.y, bottomZ], end: [point.x, point.y, topZ] });
  if (Object.values(limits).some((value) => !Number.isSafeInteger(value) || value < 1)) {
    return { complete: false, cancelled: false, checkedSweeps, testedTriangles, warnings,
      message: 'Machine collision scan limits must be positive integers.', limitations: [MACHINE_COLLISION_LIMITATION] };
  }
  outer: for (const step of plan.steps) {
    if (!step.wireThreaded && step.event.kind !== 'wire-thread') continue;
    if (step.path.length === 0) continue;
    if (step.path.length === 1 && checkedSweeps > 0 && step.startSeconds === step.endSeconds && step.event.kind !== 'wire-thread') continue;
    const motion = step.event.kind === 'motion' && step.event.motion === 'circular' && step.event.center ? step.event : null;
    const count = Math.max(1, step.path.length - 1);
    const radius = motion?.center ? Math.hypot(motion.start.x - motion.center.x, motion.start.y - motion.center.y) : 0;
    const deviation = motion ? radius * (1 - Math.cos(Math.abs(arcSweep(motion)) / count / 2)) + GEOMETRY_TOLERANCE_MM : 0;
    if (motion) curved = true;
    for (let segment = 0; segment < count; segment++) {
      if (options.signal?.aborted) { complete = false; message = 'Machine surface checking was cancelled.'; break outer; }
      if (checkedSweeps >= limits.sweeps || testedTriangles >= limits.triangles || warnings.length >= limits.warnings) {
        complete = false; message = 'Machine surface checking reached its scan budget; remaining motion was not checked.'; break outer;
      }
      const queryOptions = { signal: options.signal, maxTriangleTests: Math.min(100_000, limits.triangles - testedTriangles),
        maxHits: 1_000, curveDeviationMm: deviation };
      const result = step.path.length === 1
        ? checkMachineWireCollision(index, wire(step.path[0]), queryOptions)
        : checkMachineWireSweep(index, { from: wire(step.path[segment]), to: wire(step.path[segment + 1]) }, queryOptions);
      checkedSweeps++;
      testedTriangles += result.testedTriangles;
      const sorted = [...result.hits].sort((a, b) => a.travelFraction - b.travelFraction);
      for (const hit of sorted) {
        const key = `${step.event.id}\0${hit.meshId}`;
        if (warningKeys.has(key)) continue;
        if (warnings.length >= limits.warnings) {
          complete = false; message = 'Machine surface checking reached its warning budget; further contacts were omitted.'; break outer;
        }
        warningKeys.add(key);
        const fraction = step.path.length === 1 ? step.event.kind === 'wire-thread' ? 1 : 0 : (segment + hit.travelFraction) / count;
        warnings.push(toWarning(hit, step.event.id, step.event.operationId, step.startSeconds + fraction * (step.endSeconds - step.startSeconds), deviation));
      }
      if (!result.complete) { complete = false; message = result.message; break outer; }
      if (checkedSweeps % 32 === 0) await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  }
  if (options.signal?.aborted) { complete = false; message = 'Machine surface checking was cancelled.'; }
  if (complete && warnings.length) message = 'Imported machine surface contacts or conservative curve-envelope overlaps were found.';
  warnings.sort((a, b) => a.elapsedSeconds - b.elapsedSeconds || a.id.localeCompare(b.id));
  return { complete, cancelled: options.signal?.aborted ?? false, checkedSweeps, testedTriangles, warnings, message,
    limitations: [MACHINE_COLLISION_LIMITATION, ...(curved ? [
      'Arcs use straight chord sweeps expanded by their maximum circular sagitta. Overlapping triangle bounds produce conservative possible-contact warnings; their positions and times are approximate.'
    ] : [])] };
}

function toWarning(hit: MachineSurfaceHit, eventId: string, operationId: string | null, elapsedSeconds: number, deviation: number): MachineSimulationWarning {
  return { id: `machine:${eventId}:${hit.meshId}`, eventId, operationId, elapsedSeconds, meshId: hit.meshId,
    point: { x: hit.point[0], y: hit.point[1] }, approximate: hit.approximate,
    code: hit.approximate ? 'SIMULATION_MACHINE_CURVE_ENVELOPE' : 'SIMULATION_MACHINE_SURFACE_INTERSECTION',
    message: hit.approximate
      ? `Possible contact with ${hit.meshName} inside the curved-path chord envelope (maximum deviation ${deviation.toPrecision(3)} mm). Check the model placement and path.`
      : `The wire crosses an imported surface of ${hit.meshName}. Check the model placement and path.` };
}
