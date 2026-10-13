import type { CadPlane } from './cadDocument';
import { CadError } from './cadError';

export type CadNumericPoint2 = readonly [number, number];
export type CadNumericPoint3 = readonly [number, number, number];
export interface CadPlaneBasis { readonly u: CadNumericPoint3; readonly v: CadNumericPoint3; readonly normal: CadNumericPoint3 }
const bases: Readonly<Record<CadPlane, CadPlaneBasis>> = {
  XY: Object.freeze({ u: Object.freeze([1, 0, 0] as const), v: Object.freeze([0, 1, 0] as const), normal: Object.freeze([0, 0, 1] as const) }),
  XZ: Object.freeze({ u: Object.freeze([1, 0, 0] as const), v: Object.freeze([0, 0, 1] as const), normal: Object.freeze([0, -1, 0] as const) }),
  YZ: Object.freeze({ u: Object.freeze([0, 1, 0] as const), v: Object.freeze([0, 0, 1] as const), normal: Object.freeze([1, 0, 0] as const) })
};
/** Principal sketch coordinates are right-handed; XZ offset follows negative Y. */
export function cadPlaneBasis(plane: CadPlane): CadPlaneBasis {
  if (plane !== 'XY' && plane !== 'XZ' && plane !== 'YZ') throw new CadError('invalid-plane', 'Choose XY, XZ or YZ.');
  return bases[plane];
}
export function cadPlanePointToWorld(plane: CadPlane, offset: number, point: CadNumericPoint2): CadNumericPoint3 {
  const { u, v, normal } = cadPlaneBasis(plane);
  return Object.freeze([u[0] * point[0] + v[0] * point[1] + normal[0] * offset,
    u[1] * point[0] + v[1] * point[1] + normal[1] * offset,
    u[2] * point[0] + v[2] * point[1] + normal[2] * offset]);
}
export function cadPlaneDirectionToWorld(plane: CadPlane, direction: CadNumericPoint2): CadNumericPoint3 {
  return cadPlanePointToWorld(plane, 0, direction);
}
