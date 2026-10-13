import { Plane, type SimplePoint } from 'replicad';
import type { CadPlane } from '../../../domain/cad/cadDocument';
import { cadPlaneBasis } from '../../../domain/cad/cadPlanes';
import { cadFramePointToWorld, type CadResolvedFrame } from '../../../domain/cad/cadDatumPlanes';
/** Caller owns the native plane. The frame origin has not incorporated offset. */
export function createCadKernelPlane(frame: CadResolvedFrame, stationMm: number): Plane {
  const origin: SimplePoint = [...cadFramePointToWorld(frame, stationMm, [0, 0])];
  const u: SimplePoint = [...frame.u];
  const normal: SimplePoint = [...frame.normal];
  return new Plane(origin, u, normal);
}
/** Right-handed sketch-local coordinates. Offset is measured along the normal. */
export function cadKernelPlaneBasis(plane: CadPlane): { u: SimplePoint; v: SimplePoint; normal: SimplePoint } {
  const { u, v, normal } = cadPlaneBasis(plane);
  return { u: [u[0], u[1], u[2]], v: [v[0], v[1], v[2]], normal: [normal[0], normal[1], normal[2]] };
}
