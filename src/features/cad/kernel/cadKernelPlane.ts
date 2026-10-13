import type { SimplePoint } from 'replicad';
import type { CadPlane } from '../../../domain/cad/cadDocument';
import { cadPlaneBasis } from '../../../domain/cad/cadPlanes';
/** Right-handed sketch-local coordinates. Offset is measured along the normal. */
export function cadKernelPlaneBasis(plane: CadPlane): { u: SimplePoint; v: SimplePoint; normal: SimplePoint } {
  const { u, v, normal } = cadPlaneBasis(plane);
  return { u: [u[0], u[1], u[2]], v: [v[0], v[1], v[2]], normal: [normal[0], normal[1], normal[2]] };
}
