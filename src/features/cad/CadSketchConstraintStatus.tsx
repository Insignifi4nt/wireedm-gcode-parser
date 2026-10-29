import { readableMessage, userFacingMessage } from '@/lib/userMessage';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CadDocument, CadSketchFeature } from '@/domain/cad/cadDocument';
import { Button } from '@/components/ui/button';
import { InfoTip } from '@/components/ui/info-tip';
import { CadContextHelp } from './CadContextHelp';
import type { CadSketchConstraintAnalysis, CadSketchConstraintInspection } from './cadSketchConstraintInspection';

export type CadInspectSketchConstraints = (sketchId: string, expectedVersion?: string, signal?: AbortSignal) => Promise<CadSketchConstraintInspection>;
/**
 * The latest analysis of one sketch and the accepted version it belongs to, which may be older than the shown one.
 * `live` is false while editing or when analysis is unavailable: such a report may keep colours but never counts or locks.
 */
export interface CadSketchConstraintReport {
  readonly document: CadDocument; readonly version: string; readonly sketchId: string;
  readonly analysis: CadSketchConstraintAnalysis; readonly live: boolean;
}
const colourLegend = 'Green: fully defined by dimensions and relations. Blue grey: under defined, or not known yet. Red and purple: geometry held by conflicting or redundant relations, shown for a rejected preview or Apply and for a sketch that fails analysis.';

/** Freedom and definition are observations of the accepted source, never saved state or a preview result. */
export function CadSketchConstraintStatus({ document, sketch, version, inspect, enabled, onReport }: {
  document: CadDocument; sketch: CadSketchFeature; version: string; inspect?: CadInspectSketchConstraints; enabled: boolean;
  onReport?(report: CadSketchConstraintReport | null): void;
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
      if (!controller.signal.aborted) { setResult(null); setFailure({ document, version, sketchId: sketch.id, message: userFacingMessage(cause, 'Constraint analysis is unavailable.') }); }
    });
    return () => controller.abort();
  }, [document, sketch.id, version, enabled, available, hasGraph, retry]);
  const current = result?.document === document && result.version === version && result.sketchId === sketch.id ? result.inspection : null;
  const analysis = current?.analysis, freedom = analysis?.diagnostics.degreesOfFreedom;
  const message = failure?.document === document && failure.version === version && failure.sketchId === sketch.id ? failure.message : analysis && 'message' in analysis ? readableMessage(analysis.message) : null;
  const unavailable = Boolean(message) && (!analysis || analysis.kind === 'unavailable');
  // The last result stays reported until the next one arrives, so unchanged geometry keeps its colour across an edit.
  const report = useMemo<CadSketchConstraintReport | null>(() => result && { document: result.document, version: result.version, sketchId: result.sketchId,
    analysis: result.inspection.analysis, live: enabled && !unavailable }, [result, enabled, unavailable]);
  const reportAnalysis = useRef(onReport); reportAnalysis.current = onReport;
  useLayoutEffect(() => { onReport?.(report); }, [report, onReport]);
  // Each report replaces the last one, so only a removed status reports that nothing is known.
  useLayoutEffect(() => () => reportAnalysis.current?.(null), []);
  if (!hasGraph) return null;
  const label = !enabled ? 'Editing…' : unavailable || !available ? 'Freedom unavailable'
    : !analysis ? 'Checking freedom…' : analysis.kind === 'rejected' ? analysis.reason === 'redundant' ? 'Redundant relations' : 'Constraint issue'
      : freedom === 0 ? 'Fully defined' : freedom === null || freedom === undefined ? 'Definition unknown' : `Under defined · ${freedom} DOF`;
  return <div className="cad-sketch-freedom">
    <output aria-label="Sketch constraint status">{label}</output>
    <InfoTip label="Sketch colours" content={colourLegend} />
    <CadContextHelp label="Sketch freedom">
      <p>DOF counts the degrees of freedom left in the sketch. Each free point starts with two directions of movement. Dimensions, expressions and geometric relations remove those freedoms. Points and edges they fully define turn green, and a fully defined point or circle radius cannot be dragged or nudged.</p>
      {current?.legacyProfileCount ? <p>This count covers sketch points and edges. Older profile groups keep their own dimensions.</p> : null}
      {message && <p>{message}</p>}
      {enabled && unavailable && <Button type="button" onClick={() => { setFailure(null); setResult(null); setRetry(value => value + 1); }}>Retry analysis</Button>}
    </CadContextHelp>
  </div>;
}
