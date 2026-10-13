import { useMemo } from 'react';
import type { CadDocument } from '@/domain/cad/cadDocument';
import { measureCadSketch } from '@/domain/cad/cadMeasurements';

const format = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 3 });

export function CadSketchMeasurements({ document, sketchId, profileId }: { document: CadDocument; sketchId: string; profileId: string | null }) {
  const measurement = useMemo(() => {
    try { return { ok: true, value: measureCadSketch(document, sketchId) } satisfies { ok: true; value: ReturnType<typeof measureCadSketch> }; }
    catch (error) { return { ok: false, message: error instanceof Error ? error.message : 'Sketch measurements are unavailable.' } satisfies { ok: false; message: string }; }
  }, [document, sketchId]);
  if (!measurement.ok) return <p className="cad-error" role="status">{measurement.message}</p>;
  const sketch = measurement.value;
  const profile = sketch.profiles.find((entry) => entry.profileId === profileId);
  const bounds = profile?.boundsMm ?? sketch.boundsMm;
  return <section className="cad-measurements" aria-label="Sketch measurements">
    <div className="cad-measurements-heading">{profile ? 'PROFILE MEASUREMENTS' : 'SKETCH MEASUREMENTS'}</div>
    <dl><dt>{profile ? 'Area' : 'Material area'}</dt><dd>{format(profile?.areaMm2 ?? sketch.materialAreaMm2)} mm²</dd><dt>{profile ? 'Perimeter' : 'Boundary length'}</dt><dd>{format(profile?.perimeterMm ?? sketch.boundaryLengthMm)} mm</dd>{bounds && <><dt>Width × height</dt><dd>{format(bounds.maxX - bounds.minX)} × {format(bounds.maxY - bounds.minY)} mm</dd><dt>Min X, Y</dt><dd>{format(bounds.minX)}, {format(bounds.minY)} mm</dd><dt>Max X, Y</dt><dd>{format(bounds.maxX)}, {format(bounds.maxY)} mm</dd></>}<dt>Closed contours</dt><dd>{sketch.cutContourCount}</dd></dl>
    {profile?.construction && <p>Construction geometry is excluded from material totals.</p>}
  </section>;
}
