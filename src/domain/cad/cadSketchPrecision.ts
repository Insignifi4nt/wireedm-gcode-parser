import { cadPathClosureTolerance } from './cadAnalyticSegments';
import type { DxfPoint } from '../dxf/types';
import { CAD_PRECISION } from '../precision/cadPrecision';

/** Physical driver convergence, separate from analytic joint/closure roundoff. */
export const CAD_SKETCH_DRIVER_RESIDUAL_MM = CAD_PRECISION.solverResidualMm;
export function cadSketchDriverTolerance(operands: readonly DxfPoint[]): number {
  return Math.max(CAD_SKETCH_DRIVER_RESIDUAL_MM, cadPathClosureTolerance(operands));
}
