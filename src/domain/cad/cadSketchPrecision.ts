import { cadPathClosureTolerance } from './cadAnalyticSegments';
import type { DxfPoint } from '../dxf/types';

/** Physical driver convergence, separate from analytic joint/closure roundoff. */
export const CAD_SKETCH_DRIVER_RESIDUAL_MM = 1e-10;
export function cadSketchDriverTolerance(operands: readonly DxfPoint[]): number {
  return Math.max(CAD_SKETCH_DRIVER_RESIDUAL_MM, cadPathClosureTolerance(operands));
}
