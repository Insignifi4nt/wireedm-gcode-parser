import { Vector, type SimplePoint } from 'replicad';
import type { CadPlane } from '../../../domain/cad/cadDocument';
import { cadPlaneBasis } from '../../../domain/cad/cadPlanes';
import { cadFramePointToWorld, type CadResolvedFrame } from '../../../domain/cad/cadDatumPlanes';

/**
 * A sketch placement that owns exactly its three native vectors, with the values Replicad's Plane
 * gives them: the origin as given, the normal and x direction normalized in place. Replicad 1.1's
 * Plane also builds coordinate transforms the kernel never reads, and leaks a gp_Trsf and two
 * gp_Ax3 on every plane, with a third transform left to garbage collection.
 */
export class CadKernelPlane {
  readonly origin: Vector;
  readonly xDir: Vector;
  readonly zDir: Vector;
  constructor(origin: SimplePoint, xDirection: SimplePoint, normal: SimplePoint) {
    const created: Vector[] = [];
    const make = (point: SimplePoint) => { const vector = new Vector(point); created.push(vector); return vector; };
    try {
      const zDir = make(normal);
      if (zDir.Length === 0) throw new Error('normal should be non null');
      const xDir = make(xDirection);
      if (xDir.Length === 0) throw new Error('xDir should be non null');
      this.zDir = zDir.normalize(); this.xDir = xDir.normalize(); this.origin = make(origin);
    } catch (error) { for (const vector of created) vector.delete(); throw error; }
  }
  delete(): void { this.origin.delete(); this.xDir.delete(); this.zDir.delete(); }
}

/** Caller owns the native plane. The frame origin has not incorporated offset. */
export function createCadKernelPlane(frame: CadResolvedFrame, stationMm: number): CadKernelPlane {
  const origin: SimplePoint = [...cadFramePointToWorld(frame, stationMm, [0, 0])];
  const u: SimplePoint = [...frame.u];
  const normal: SimplePoint = [...frame.normal];
  return new CadKernelPlane(origin, u, normal);
}
/** Right-handed sketch-local coordinates. Offset is measured along the normal. */
export function cadKernelPlaneBasis(plane: CadPlane): { u: SimplePoint; v: SimplePoint; normal: SimplePoint } {
  const { u, v, normal } = cadPlaneBasis(plane);
  return { u: [u[0], u[1], u[2]], v: [v[0], v[1], v[2]], normal: [normal[0], normal[1], normal[2]] };
}
