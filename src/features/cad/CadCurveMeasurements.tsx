import { useMemo } from 'react';
import type { CadCurveFeature, CadDocument } from '@/domain/cad/cadDocument';
import { measureCadCurve } from '@/domain/cad/cadCurveMeasurements';

export function CadCurveMeasurements({ curve, document }: { curve: CadCurveFeature; document: CadDocument }) {
  const measurement = useMemo(() => {
    try { return measureCadCurve(document, curve.id); } catch { return null; }
  }, [curve, document]);
  if (!measurement) return null;
  const n = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 4 });
  const point = (value: readonly number[]) => value.map(n).join(', ');
  return <dl className="cad-topology-details cad-curve-measurements" aria-label="Curve measurements">
    <dt>Length</dt><dd>{n(measurement.lengthMm)} mm</dd>
    {measurement.startWorldMm && measurement.endWorldMm && measurement.worldBoundsMm ? <>
      <dt>Start (world)</dt><dd>{point(measurement.startWorldMm)} mm</dd>
      <dt>End (world)</dt><dd>{point(measurement.endWorldMm)} mm</dd>
      <dt>Bounds (world)</dt><dd>{point(measurement.worldBoundsMm.min)} → {point(measurement.worldBoundsMm.max)} mm</dd>
    </> : <><dt>Start (local)</dt><dd>{point(measurement.startMm)} mm</dd><dt>End (local)</dt><dd>{point(measurement.endMm)} mm</dd><dt>Placement</dt><dd>Unavailable plane</dd></>}
  </dl>;
}
