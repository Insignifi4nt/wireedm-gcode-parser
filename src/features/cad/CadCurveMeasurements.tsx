import { useMemo } from 'react';
import type { CadCurveFeature, CadDocument } from '@/domain/cad/cadDocument';
import { resolveCadCurve } from '@/domain/cad/cadCurve';

export function CadCurveMeasurements({ curve, parameters }: { curve: CadCurveFeature; parameters: CadDocument['parameters'] }) {
  const measurement = useMemo(() => {
    try { return resolveCadCurve(curve, parameters); } catch { return null; }
  }, [curve, parameters]);
  if (!measurement) return null;
  const n = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 4 });
  const point = (value: readonly number[]) => value.map(n).join(', ');
  return <dl className="cad-topology-details cad-curve-measurements" aria-label="Curve measurements">
    <dt>Length</dt><dd>{n(measurement.length)} mm</dd>
    <dt>Start (world)</dt><dd>{point(measurement.startWorld)} mm</dd>
    <dt>End (world)</dt><dd>{point(measurement.endWorld)} mm</dd>
    <dt>Bounds (world)</dt><dd>{point(measurement.worldBounds.min)} → {point(measurement.worldBounds.max)} mm</dd>
  </dl>;
}
