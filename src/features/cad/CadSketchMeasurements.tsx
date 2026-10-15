import { useMemo } from 'react';
import type { CadDocument } from '@/domain/cad/cadDocument';
import { measureCadSketch } from '@/domain/cad/cadMeasurements';
import { CadContextHelp } from './CadContextHelp';
import { formatCadLocalizedQuantity } from './cadDisplayQuantity';

const format = (value: number) => formatCadLocalizedQuantity(value, 3);

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
    <div className="cad-measurements-heading">{profile ? 'Profile measurements' : 'Sketch measurements'}<CadContextHelp label="Sketch measurements">Area and perimeter use the current sketch geometry. Nested outlines subtract holes from material area. Construction profiles are measured individually but excluded from material and cutting totals.</CadContextHelp></div>
    <dl><dt>{profile ? 'Area' : 'Material area'}</dt><dd>{format(profile?.areaMm2 ?? sketch.materialAreaMm2)} mm²</dd><dt>{profile ? 'Perimeter' : 'Boundary length'}</dt><dd>{format(profile?.perimeterMm ?? sketch.boundaryLengthMm)} mm</dd></dl>
    <details className="cad-measurement-details cad-topology-measurements"><summary>Measurements</summary><dl>{bounds && <><dt>Width × height</dt><dd>{format(bounds.maxX - bounds.minX)} × {format(bounds.maxY - bounds.minY)} mm</dd><dt>Min X, Y</dt><dd>{format(bounds.minX)}, {format(bounds.minY)} mm</dd><dt>Max X, Y</dt><dd>{format(bounds.maxX)}, {format(bounds.maxY)} mm</dd></>}<dt>{profile ? 'Sketch closed contours' : 'Closed contours'}</dt><dd>{sketch.cutContourCount}</dd></dl></details>
    {profile?.construction && <span className="cad-measurement-tag">Construction reference</span>}
  </section>;
}
