import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CadDocument, CadSketchFeature } from '@/domain/cad/cadDocument';
import { Button } from '@/components/ui/button';
import { CadContextHelp } from './CadContextHelp';
import type { CadSketchConstraintInspection } from './cadSketchConstraintInspection';

export type CadInspectSketchConstraints = (sketchId: string, expectedVersion?: string, signal?: AbortSignal) => Promise<CadSketchConstraintInspection>;

/** Freedom is an observation of the accepted source, never saved state or a preview result. */
export function CadSketchConstraintStatus({ document, sketch, version, inspect, enabled, onFreedom }: {
  document: CadDocument; sketch: CadSketchFeature; version: string; inspect?: CadInspectSketchConstraints; enabled: boolean;
  onFreedom?(degreesOfFreedom: number | null): void;
}) {
  const callback = useRef(inspect); callback.current = inspect;
  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState<{ document: CadDocument; version: string; sketchId: string; inspection: CadSketchConstraintInspection } | null>(null);
  const [failure, setFailure] = useState<{ document: CadDocument; version: string; sketchId: string; message: string } | null>(null);
  const available = Boolean(inspect), hasGraph = Boolean(sketch.graph);
  useEffect(() => {
    if (!enabled || !available || !hasGraph) return;
    const controller = new AbortController();
    void callback.current?.(sketch.id, version, controller.signal).then(inspection => {
      if (!controller.signal.aborted) { setResult({ document, version, sketchId: sketch.id, inspection }); setFailure(null); }
    }, cause => {
      if (!controller.signal.aborted) setFailure({ document, version, sketchId: sketch.id, message: cause instanceof Error ? cause.message : 'Constraint analysis is unavailable.' });
    });
    return () => controller.abort();
  }, [document, sketch.id, version, enabled, available, hasGraph, retry]);
  const current = result?.document === document && result.version === version && result.sketchId === sketch.id ? result.inspection : null;
  const analysis = current?.analysis, freedom = analysis?.diagnostics.degreesOfFreedom;
  const message = failure?.document === document && failure.version === version && failure.sketchId === sketch.id ? failure.message : analysis && 'message' in analysis ? analysis.message : null;
  const unavailable = Boolean(message) && (!analysis || analysis.kind === 'unavailable');
  useLayoutEffect(() => {
    onFreedom?.(enabled && !unavailable && analysis?.kind === 'solved' ? analysis.diagnostics.degreesOfFreedom : null);
    return () => onFreedom?.(null);
  }, [enabled, unavailable, analysis, onFreedom]);
  if (!hasGraph) return null;
  const label = !enabled ? 'Editing…' : unavailable || !available ? 'Freedom unavailable'
    : !analysis ? 'Checking freedom…' : analysis.kind === 'rejected' ? analysis.reason === 'redundant' ? 'Redundant relations' : 'Constraint issue'
      : freedom === 0 ? 'Fully constrained' : freedom === null || freedom === undefined ? 'Freedom unknown' : `${freedom} DOF`;
  return <div className="cad-sketch-freedom">
    <output aria-label="Sketch constraint status">{label}</output>
    <CadContextHelp label="Sketch freedom">
      <p>DOF counts the degrees of freedom left in the sketch. Each free point starts with two directions of movement. Dimensions, expressions and geometric relations remove those freedoms.</p>
      {current?.legacyProfileCount ? <p>This count covers sketch points and edges. Older profile groups keep their own dimensions.</p> : null}
      {message && <p>{message}</p>}
      {enabled && unavailable && <Button type="button" onClick={() => { setFailure(null); setResult(null); setRetry(value => value + 1); }}>Retry analysis</Button>}
    </CadContextHelp>
  </div>;
}
