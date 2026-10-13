import type { SimplePoint } from 'replicad';
import type { CadPlane } from '../../../domain/cad/cadDocument';
/** Right-handed sketch-local coordinates. Offset is measured along the normal. */
export function cadKernelPlaneBasis(plane: CadPlane): { u: SimplePoint; v: SimplePoint; normal: SimplePoint } {
  switch (plane) {
    case 'XY': return { u: [1, 0, 0], v: [0, 1, 0], normal: [0, 0, 1] };
    case 'XZ': return { u: [1, 0, 0], v: [0, 0, 1], normal: [0, -1, 0] };
    case 'YZ': return { u: [0, 1, 0], v: [0, 0, 1], normal: [1, 0, 0] };
  }
}
